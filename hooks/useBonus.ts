"use client";

// État bonus : catalogue, événement du jour, déclarations.
// Écritures optimistes comme les coches : l'écran d'abord,
// rollback + toast si la base dit non (bonus inconnu, boss inactif,
// doublon). On ne déclare que parisToday() : les gardes de date du
// trigger ne se déclenchent jamais depuis l'appli.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BonusCatalogItem,
  BonusClaim,
  BonusState,
  deleteClaim,
  fetchBonus,
  humanBonusError,
  insertClaim,
  movementLocked,
} from "@/lib/bonus";
import { parisToday } from "@/lib/challenge";

export function useBonus(
  enabled: boolean,
  showToast: (msg: string) => void,
  onScored: () => void,
) {
  const [state, setState] = useState<BonusState | null>(null);
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
        stateRef.current = s;
        setState(s);
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

  /** Déclare un bonus pour aujourd'hui. Optimiste. */
  const claim = useCallback(
    async (playerId: string, item: BonusCatalogItem) => {
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
      const optimistic: BonusClaim = {
        player_id: playerId,
        day: parisToday(),
        bonus_key: item.key,
        points: item.points,
      };
      patch(optimistic, true);
      const err = await insertClaim(playerId, item);
      if (err) {
        patch(optimistic, false);
        showToast(humanBonusError(err));
      } else {
        onScored();
      }
    },
    [patch, showToast, onScored],
  );

  /** Annule une déclaration du jour. Optimiste aussi. */
  const unclaim = useCallback(
    async (playerId: string, item: BonusCatalogItem) => {
      const removed: BonusClaim = {
        player_id: playerId,
        day: parisToday(),
        bonus_key: item.key,
        points: item.points,
      };
      patch(removed, false);
      const err = await deleteClaim(playerId, item.key);
      if (err) {
        patch(removed, true);
        showToast(humanBonusError(err));
      } else {
        onScored();
      }
    },
    [patch, showToast, onScored],
  );

  return { bonus: state, reloadBonus: reload, claim, unclaim };
}
