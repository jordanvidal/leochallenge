"use client";

// État gamification : classements + badges, rechargés après chaque coche
// et au retour sur l'app. La vérité vient du serveur (RPC leaderboard).

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGamification, Gamification } from "@/lib/gamification";

export function useGamification(enabled: boolean) {
  const [data, setData] = useState<Gamification | null>(null);
  const inflight = useRef(false);

  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const g = await fetchGamification();
      if (g) setData(g);
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

  return { gamification: data, reloadGamification: reload };
}
