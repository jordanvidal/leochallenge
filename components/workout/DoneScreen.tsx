"use client";

// L'écran de fin : la durée totale en très gros, l'état de la journée,
// les points du jour lus au serveur, et la série.
//
// Le partage a été retiré d'ici : le bouton appelait le même shareWeek()
// que l'écran du jour, qui l'affiche déjà dès le 3/3 — deux boutons pour
// un texte identique, à deux taps d'écart. La série prend sa place et
// devient la dernière chose qu'on lit avant de fermer.
//
// Le bloc série a deux états, parce qu'on peut finir une séance sans
// avoir bouclé la journée : une config à 25/25/0 se termine normalement
// et arrive ici à 2/3 (ConfigScreen ne bloque le lancement que si TOUT
// est à zéro). Dans ce cas la série n'a pas monté, et afficher un chiffre
// triomphant serait un faux succès. On dit ce qu'il manque.

import { useCallback, useEffect, useState } from "react";
import { entryCount, EXERCISES, Exercise } from "@/lib/types";
import type { Player } from "@/lib/types";
import { DayBreakdown, formatClock } from "@/lib/workout";
import { fmtPoints } from "@/lib/gamification";
import StreakCount from "../StreakCount";

/** Durée du beat de fond, alignée sur .streak-beat-block dans globals.css. */
const BEAT_MS = 1600;

type Props = {
  player: Player;
  durationSeconds: number;
  /** true = durée serveur (foi du chrono), false = estimation locale. */
  official: boolean;
  /** Exos cochés sur l'entrée du jour après l'upsert (0 à 3). */
  exosDone: ReturnType<typeof entryCount>;
  /** Exos encore à faire aujourd'hui — nommés, pour dire ce qui manque. */
  missing: Exercise[];
  /** Série serveur. Monte d'elle-même quand rescore() a rechargé. */
  streak: number;
  breakdown: DayBreakdown | null;
  onClose: () => void;
};

/** "les squats" / "les abdos et les squats" */
function missingLabel(missing: Exercise[]): string {
  const labels = missing.map(
    (key) => `les ${EXERCISES.find((e) => e.key === key)!.label.toLowerCase()}`,
  );
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} et ${labels[labels.length - 1]}`;
}

export default function DoneScreen({
  player,
  durationSeconds,
  official,
  exosDone,
  missing,
  streak,
  breakdown,
  onClose,
}: Props) {
  const perfect = exosDone === 3;

  // La série d'avant, gelée au montage. Cet écran s'affiche avant que
  // l'entrée du jour soit écrite : la valeur qu'on lit ici est donc bien
  // celle d'hier soir. On la garde parce que le bloc série, lui, n'apparaît
  // qu'une fois le 3/3 enregistré — trop tard pour observer le +1 tout seul.
  const [streakBefore] = useState(streak);

  const [beating, setBeating] = useState(false);
  const onIncrement = useCallback(() => setBeating(true), []);
  useEffect(() => {
    if (!beating) return;
    const t = setTimeout(() => setBeating(false), BEAT_MS);
    return () => clearTimeout(t);
  }, [beating]);

  return (
    <div className="celebrate-bg -mx-5 flex min-h-full flex-col px-5">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p
          className="rise-in text-2xl font-bold"
          style={{ color: player.color }}
        >
          Séance terminée 💪
        </p>
        <p className="num-display mt-4 text-8xl" aria-label="Durée totale">
          {formatClock(durationSeconds)}
        </p>
        <p className="mt-1 text-sm font-medium text-muted">
          {official
            ? "durée totale"
            : "durée estimée — chrono non enregistré, le bonus vitesse ne comptera pas cette fois"}
        </p>

        <p className="mt-8 text-lg font-bold">
          {perfect
            ? "Journée validée 3/3 ✓"
            : `${exosDone}/3 exos validés aujourd'hui`}
        </p>
        {breakdown !== null && (
          <p className="mt-1 text-sm font-medium text-muted">
            {fmtPoints(breakdown.points)} pts aujourd&apos;hui
            {breakdown.bonusPoints > 0
              ? ` · dont ${fmtPoints(breakdown.bonusPoints)} pts bonus 🎁`
              : ""}
          </p>
        )}

        {streak > 0 && (
          <div
            className={`mt-6 w-full rounded-3xl px-4 py-4 ${beating ? "streak-beat-block" : ""}`}
            style={{
              background: `color-mix(in oklch, ${player.color} 9%, var(--color-surface))`,
            }}
          >
            <p className="num-display text-6xl" style={{ color: player.color }}>
              <span aria-hidden>🔥</span>{" "}
              {perfect ? (
                <StreakCount
                  value={streak}
                  from={streakBefore}
                  onIncrement={onIncrement}
                />
              ) : (
                streak
              )}
            </p>
            <p
              className="mt-2 text-xs font-bold tracking-wide uppercase"
              style={{
                color: perfect ? "var(--color-muted)" : "var(--color-danger)",
              }}
            >
              {perfect
                ? "jours d'affilée"
                : `en jeu — il te manque ${missingLabel(missing)}`}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="mb-2 min-h-14 w-full rounded-2xl text-base font-bold transition-transform active:scale-[0.98]"
        style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
      >
        Fermer
      </button>
    </div>
  );
}
