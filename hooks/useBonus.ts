"use client";

// État bonus : catalogue, événement du jour, déclarations.
// Écritures optimistes comme les coches : l'écran d'abord,
// rollback + toast si la base dit non (plafonds, fenêtre 48h).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BonusCatalogItem,
  BonusClaim,
  BonusState,
  deleteClaim,
  fetchBonus,
  humanBonusError,
  insertClaim,
} from "@/lib/bonus";
import { parisToday } from "@/lib/challenge";

export function useBonus(
  enabled: boolean,
  showToast: (msg: string) => void,
  onScored: () => void,
) {
  const [state, setState] = useState<BonusState | null>(null);
  const inflight = useRef(false);

  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const s = await fetchBonus();
      if (s) setState(s);
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
    setState((prev) => {
      if (!prev) return prev;
      const keep = (c: BonusClaim) =>
        !(
          c.player_id === claim.player_id &&
          c.day === claim.day &&
          c.bonus_key === claim.bonus_key
        );
      return {
        ...prev,
        todayClaims: add
          ? [...prev.todayClaims, claim]
          : prev.todayClaims.filter(keep),
        weekClaims: add
          ? [...prev.weekClaims, claim]
          : prev.weekClaims.filter(keep),
      };
    });
  }, []);

  /** Déclare un bonus pour aujourd'hui. Optimiste. */
  const claim = useCallback(
    async (playerId: string, item: BonusCatalogItem) => {
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
