"use client";

// État bonus : catalogue, événement du jour, déclarations.
// Écritures optimistes comme les coches : l'écran d'abord — mais depuis
// la file d'attente (lib/outbox.ts), une absence de réseau n'est plus un
// échec. Le geste part en file, se rejoue au retour du réseau, et le
// rollback + toast ne se produit QUE sur un refus définitif du serveur
// (plafond, jour verrouillé, doublon logique). On ne déclare que
// parisToday() : les gardes de date du trigger ne se déclenchent depuis
// l'appli qu'à un moment — une entrée en file qui n'est partie qu'après
// minuit, et ce refus-là se dit avec ses mots à lui.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  appliquerFileBonus,
  BonusCatalogItem,
  BonusClaim,
  BonusOutboxPayload,
  BonusState,
  cleEcritureBonus,
  enregistrerExpediteursBonus,
  estEcritureBonus,
  fetchBonus,
  humanBonusError,
  movementLocked,
  OUTBOX_BONUS_CLAIM,
  OUTBOX_BONUS_UNCLAIM,
} from "@/lib/bonus";
import { parisToday } from "@/lib/challenge";
import { outbox, OutboxEntry } from "@/lib/outbox";

// Au chargement du module, pas dans un effet : la file peut avoir des
// entrées d'hier soir à rejouer avant même le premier rendu.
enregistrerExpediteursBonus();

/** Le refus, dit avec les bons mots. Un geste noté hors ligne et parti
    trop tard (minuit est passé, le trigger a verrouillé son jour) n'est
    pas « ce jour est verrouillé » — l'utilisateur est déjà demain. */
function messageRefus(entry: OutboxEntry, refus: string): string {
  if (entry.day !== parisToday() && refus.includes("JOUR_VERROUILLE"))
    return "Un bonus noté hors ligne n'est pas parti : son jour est clos 🔒";
  return humanBonusError(refus);
}

export function useBonus(
  enabled: boolean,
  showToast: (msg: string) => void,
  onScored: () => void,
) {
  const [state, setState] = useState<BonusState | null>(null);
  // Écritures bonus encore en file : ce que l'écran peut dire, sobrement.
  const [enAttente, setEnAttente] = useState(0);
  const inflight = useRef(false);
  // Le même état, lisible tout de suite. La feuille valide plusieurs
  // déclarations d'affilée : entre deux, `state` n'a pas encore été
  // re-rendu, et un garde qui le lirait raisonnerait sur l'avant-dernier
  // coup. Le ref, lui, est à jour dès le patch.
  const stateRef = useRef<BonusState | null>(null);

  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const s = await fetchBonus();
      if (s) {
        // La base ne connaît pas encore ce qui attend dans la file : on le
        // rejoue par-dessus, sinon un re-fetch ferait disparaître un bonus
        // pourtant « noté » — exactement le mensonge que la file évite.
        const merged = appliquerFileBonus(s, outbox.entries());
        stateRef.current = merged;
        setState(merged);
      }
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, reload]);

  /** Ajoute/retire une déclaration dans l'état local. */
  const patch = useCallback((claim: BonusClaim, add: boolean) => {
    const prev = stateRef.current;
    if (!prev) return;
    const keep = (c: BonusClaim) =>
      !(
        c.player_id === claim.player_id &&
        c.day === claim.day &&
        c.bonus_key === claim.bonus_key
      );
    const next: BonusState = {
      ...prev,
      todayClaims: add
        ? [...prev.todayClaims, claim]
        : prev.todayClaims.filter(keep),
      weekClaims: add
        ? [...prev.weekClaims, claim]
        : prev.weekClaims.filter(keep),
    };
    stateRef.current = next;
    setState(next);
  }, []);

  // Ce que la file raconte : un départ réussi rafraîchit le score, un
  // refus définitif déclenche LE rollback visible (c'est le seul endroit
  // où il se produit — une absence de réseau n'en est plus un motif), et
  // le compteur d'attente suit chaque mouvement.
  useEffect(() => {
    if (!enabled) return;
    setEnAttente(outbox.entries().filter(estEcritureBonus).length);
    return outbox.subscribe((evt) => {
      if (evt.type === "file") {
        setEnAttente(outbox.entries().filter(estEcritureBonus).length);
        return;
      }
      if (!estEcritureBonus(evt.entry)) return;
      if (evt.outcome === "ok") {
        onScored();
        return;
      }
      const p = evt.entry.payload as BonusOutboxPayload;
      const claim: BonusClaim = {
        player_id: p.playerId,
        day: evt.entry.day,
        bonus_key: p.bonusKey,
        points: p.points,
      };
      // Refus d'une déclaration : elle s'efface. Refus d'un retrait : la
      // déclaration revient. Dans les deux cas, l'écran redit le vrai.
      patch(claim, evt.entry.kind === OUTBOX_BONUS_UNCLAIM);
      showToast(messageRefus(evt.entry, evt.outcome.refus));
    });
  }, [enabled, patch, onScored, showToast]);

  /** Déclare un bonus pour aujourd'hui. Optimiste, via la file. */
  const claim = useCallback(
    (playerId: string, item: BonusCatalogItem) => {
      // Dernier filet sur « un seul déplacement par jour ». La feuille
      // éteint déjà les puces concernées ; ce garde-là couvre ce qu'elle
      // ne voit pas — un deuxième appareil, un état chargé avant la
      // déclaration, une autre entrée que la feuille. La règle vit en
      // deux endroits parce qu'il n'y en a aucun en base : le trigger
      // laisserait passer les 20 + 4 points sans broncher.
      const now = stateRef.current;
      if (now && movementLocked(now, playerId, item)) {
        showToast("Un seul déplacement par jour 🚶");
        return;
      }
      const day = parisToday();
      patch(
        { player_id: playerId, day, bonus_key: item.key, points: item.points },
        true,
      );
      outbox.enqueue({
        key: cleEcritureBonus(playerId, day, item.key),
        kind: OUTBOX_BONUS_CLAIM,
        payload: {
          playerId,
          bonusKey: item.key,
          points: item.points,
        } satisfies BonusOutboxPayload,
        day,
      });
      outbox.flush();
    },
    [patch, showToast],
  );

  /** Annule une déclaration du jour. Optimiste aussi. Même clé que la
      déclaration : hors ligne, annuler une déclaration pas encore partie
      la remplace dans la file — rien ne part du tout. */
  const unclaim = useCallback(
    (playerId: string, item: BonusCatalogItem) => {
      const day = parisToday();
      patch(
        { player_id: playerId, day, bonus_key: item.key, points: item.points },
        false,
      );
      outbox.enqueue({
        key: cleEcritureBonus(playerId, day, item.key),
        kind: OUTBOX_BONUS_UNCLAIM,
        payload: {
          playerId,
          bonusKey: item.key,
          points: item.points,
        } satisfies BonusOutboxPayload,
        day,
      });
      outbox.flush();
    },
    [patch],
  );

  return { bonus: state, enAttente, reloadBonus: reload, claim, unclaim };
}
