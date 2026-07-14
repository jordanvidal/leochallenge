"use client";

// La machine à états de la séance : bloc → bloc → repos → tour suivant.
// Tout le temps est basé sur des timestamps (Date.now()), jamais sur des
// intervalles cumulés : onglet gelé ou téléphone verrouillé, le temps
// réel est recalculé à la reprise, pas perdu.

import { useCallback, useEffect, useRef, useState } from "react";
import { Exercise, EXERCISES } from "@/lib/types";
import {
  finishSession,
  humanWorkoutError,
  startSession,
  touchPreset,
  WorkoutConfig,
} from "@/lib/workout";

export type Block = { exo: Exercise; label: string; reps: number };

export type WorkoutStep =
  | { kind: "block"; round: number; blockIdx: number }
  | { kind: "rest"; nextRound: number; endsAt: number }
  | { kind: "done" };

/** Blocs d'un tour : les exos à 0 répétition sont sautés. */
export function configBlocks(c: WorkoutConfig): Block[] {
  return EXERCISES.filter(({ key }) => c.reps[key] > 0).map(
    ({ key, label }) => ({ exo: key, label, reps: c.reps[key] }),
  );
}

// Le type WakeLock n'est pas garanti par le lib DOM de TS : shim local.
type WakeLockSentinelLike = { release(): Promise<void> };
type NavigatorWakeLock = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};

export function useWorkout(playerId: string, showToast: (m: string) => void) {
  const [config, setConfig] = useState<WorkoutConfig | null>(null);
  const [step, setStep] = useState<WorkoutStep | null>(null);
  const [restLeft, setRestLeft] = useState(0); // millisecondes restantes
  const [serverDuration, setServerDuration] = useState<number | null>(null);
  const sessionDay = useRef<string | null>(null);
  const startedAt = useRef(0); // repli client si le serveur est injoignable
  const wakeLock = useRef<WakeLockSentinelLike | null>(null);

  const running = !!config && !!step;
  const blocks = config ? configBlocks(config) : [];

  /** Lance la séance : chrono serveur ouvert, format mémorisé (MRU). */
  const launch = useCallback(
    (c: WorkoutConfig) => {
      startedAt.current = Date.now();
      setConfig(c);
      setServerDuration(null);
      setStep({ kind: "block", round: 1, blockIdx: 0 });
      // En arrière-plan : la séance démarre sans attendre le réseau.
      touchPreset(playerId, c);
      startSession(playerId, c).then(({ day, error }) => {
        sessionDay.current = day;
        if (error) showToast(humanWorkoutError(error));
      });
    },
    [playerId, showToast],
  );

  /** Clôture serveur : la durée officielle revient de la base. */
  const closeSession = useCallback(async () => {
    if (!sessionDay.current) return;
    const { duration, error } = await finishSession(
      playerId,
      sessionDay.current,
    );
    if (error) showToast(humanWorkoutError(error));
    else setServerDuration(duration);
  }, [playerId, showToast]);

  /** Bloc terminé : bloc suivant, repos, ou fin de séance. */
  const finishBlock = useCallback(() => {
    if (!config || step?.kind !== "block") return;
    if (step.blockIdx < blocks.length - 1) {
      setStep({ kind: "block", round: step.round, blockIdx: step.blockIdx + 1 });
    } else if (step.round < config.rounds) {
      if (config.restSeconds === 0) {
        setStep({ kind: "block", round: step.round + 1, blockIdx: 0 });
      } else {
        setStep({
          kind: "rest",
          nextRound: step.round + 1,
          endsAt: Date.now() + config.restSeconds * 1000,
        });
      }
    } else {
      setStep({ kind: "done" });
      closeSession();
    }
  }, [config, step, blocks.length, closeSession]);

  const skipRest = useCallback(() => {
    if (step?.kind !== "rest") return;
    setStep({ kind: "block", round: step.nextRound, blockIdx: 0 });
  }, [step]);

  /** Répétitions déjà faites par exo (blocs terminés uniquement). */
  const repsDone = useCallback((): Record<Exercise, number> => {
    const done: Record<Exercise, number> = { pushups: 0, abs: 0, squats: 0 };
    if (!config || !step) return done;
    const fullRounds =
      step.kind === "done"
        ? config.rounds
        : step.kind === "rest"
          ? step.nextRound - 1
          : step.round - 1;
    for (const b of blocks) done[b.exo] += fullRounds * b.reps;
    if (step.kind === "block")
      for (let i = 0; i < step.blockIdx; i++)
        done[blocks[i].exo] += blocks[i].reps;
    return done;
  }, [config, step, blocks]);

  /** Ferme le mode (fin ou abandon) et remet la machine à zéro. */
  const reset = useCallback(() => {
    setConfig(null);
    setStep(null);
    sessionDay.current = null;
  }, []);

  // Décompte du repos : recalculé depuis le timestamp de fin à chaque
  // tick ET au retour de visibilité — jamais de temps accumulé.
  useEffect(() => {
    if (step?.kind !== "rest") return;
    const tick = () => {
      const left = Math.max(0, step.endsAt - Date.now());
      setRestLeft(left);
      if (left === 0) {
        navigator.vibrate?.([200, 100, 200]);
        setStep({ kind: "block", round: step.nextRound, blockIdx: 0 });
      }
    };
    tick();
    const id = setInterval(tick, 200);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [step]);

  // Wake Lock pendant la séance : écran allumé, repli silencieux si
  // non supporté, ré-acquisition au retour de visibilité.
  const inSession = running && step?.kind !== "done";
  useEffect(() => {
    if (!inSession) return;
    let cancelled = false;
    const acquire = async () => {
      try {
        const lock = await (navigator as NavigatorWakeLock).wakeLock?.request(
          "screen",
        );
        if (cancelled) lock?.release().catch(() => {});
        else wakeLock.current = lock ?? null;
      } catch {
        // non supporté ou refusé : la séance marche quand même
      }
    };
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock.current?.release().catch(() => {});
      wakeLock.current = null;
    };
  }, [inSession]);

  /** Durée à afficher : la vérité serveur, sinon l'estimation client. */
  const displayDuration =
    serverDuration ??
    (startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0);

  return {
    config,
    step,
    blocks,
    restLeft,
    serverDuration,
    displayDuration,
    launch,
    finishBlock,
    skipRest,
    repsDone,
    reset,
  };
}

export type Workout = ReturnType<typeof useWorkout>;
