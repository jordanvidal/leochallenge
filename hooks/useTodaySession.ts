"use client";

// Le portier de la journée : tant qu'aucune séance n'a été ouverte
// aujourd'hui, on ne coche rien. « Lancer ma séance » fait foi.
//
// L'état est daté (le jour de la séance connue, pas un booléen) : passé
// minuit sur une app restée ouverte, la journée se reverrouille toute
// seule sans dépendre d'un re-fetch.

import { useCallback, useEffect, useState } from "react";
import { parisToday } from "@/lib/challenge";
import { fetchTodaySessionStarted } from "@/lib/workout";

export function useTodaySession(playerId: string | null) {
  const [startedDay, setStartedDay] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!playerId) return;
    const day = parisToday();
    const { started, error } = await fetchTodaySessionStarted(playerId);
    // Hors ligne : on ne sait pas, donc on ne dégrade pas ce qu'on savait.
    if (error) return;
    setStartedDay(started ? day : null);
  }, [playerId]);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  /** La séance vient de partir : on ouvre sans attendre le re-fetch. */
  const markStarted = useCallback(() => setStartedDay(parisToday()), []);

  return { started: startedDay === parisToday(), reload, markStarted };
}
