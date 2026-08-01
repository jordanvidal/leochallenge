"use client";

// L'écran de fin : la durée totale en très gros, l'état de la journée,
// puis un bloc à deux cellules — les points du jour lus au serveur, et
// la série.
//
// Le partage a été retiré d'ici : le bouton appelait le même shareWeek()
// que l'écran du jour, qui l'affiche déjà dès le 3/3 — deux boutons pour
// un texte identique, à deux taps d'écart. La série prend sa place et
// devient la dernière chose qu'on lit avant de fermer.
//
// Les points étaient une ligne muette de 14 px sous le 3/3, pendant que
// la série tenait un bloc coloré à elle seule (01/08). Ils partagent
// maintenant ce bloc : deux chiffres au même rang, en Anton, séparés
// d'un filet. Chaque cellule sait disparaître — la lecture des points
// arrive après l'upsert et peut échouer, la série vaut zéro le premier
// jour — et celle qui reste occupe alors toute la largeur. La part de
// bonus passe sous le bloc : c'est une précision sur un chiffre déjà lu,
// pas un troisième compteur.
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

/** Durée du beat de fond, alignée sur .streak-beat-block dans globals.css.
    Il couvre toute la séquence longue de StreakCount, rebond compris. */
const BEAT_MS = 1860;

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
  /** Enchaîner sur une séance de bonus. Absent = catalogue pas chargé. */
  onPlanBonus?: () => void;
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
  onPlanBonus,
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

        {(breakdown !== null || streak > 0) && (
          <div
            className={`mt-6 flex w-full items-start rounded-3xl px-2 py-4 ${beating ? "streak-beat-block" : ""}`}
            style={{
              background: `color-mix(in oklch, ${player.color} 9%, var(--color-surface))`,
            }}
          >
            {breakdown !== null && (
              <div className="flex-1 px-2">
                <p
                  className="num-display text-5xl"
                  style={{ color: player.color }}
                >
                  {fmtPoints(breakdown.points)}
                </p>
                <p className="mt-2 text-xs font-bold tracking-wide text-muted uppercase">
                  points aujourd&apos;hui
                </p>
              </div>
            )}
            {breakdown !== null && streak > 0 && (
              <div
                className="w-px self-stretch"
                style={{
                  background: `color-mix(in oklch, ${player.color} 18%, transparent)`,
                }}
                aria-hidden
              />
            )}
            {streak > 0 && (
              <div className="flex-1 px-2">
                <p
                  className="num-display text-5xl"
                  style={{ color: player.color }}
                >
                  <span aria-hidden>🔥</span>{" "}
                  {perfect ? (
                    <StreakCount
                      value={streak}
                      from={streakBefore}
                      big
                      onIncrement={onIncrement}
                    />
                  ) : (
                    streak
                  )}
                </p>
                <p
                  className="mt-2 text-xs font-bold tracking-wide uppercase"
                  style={{
                    color: perfect
                      ? "var(--color-muted)"
                      : "var(--color-danger)",
                  }}
                >
                  {perfect
                    ? "jours d'affilée"
                    : `en jeu — il te manque ${missingLabel(missing)}`}
                </p>
              </div>
            )}
          </div>
        )}
        {breakdown !== null && breakdown.bonusPoints > 0 && (
          <p className="mt-2 text-sm font-medium text-muted">
            dont {fmtPoints(breakdown.bonusPoints)} pts bonus 🎁
          </p>
        )}
      </div>

      {/* Le corps est encore chaud : c'est ici que proposer des bonus a du
          sens, pas dix minutes plus tard depuis l'écran du jour. Discret —
          la séance est finie, personne n'est obligé d'en remettre, et le
          contrat du jour est déjà rempli quoi qu'il arrive ensuite. */}
      {onPlanBonus && (
        <button
          onClick={onPlanBonus}
          className="mb-3 min-h-13 w-full rounded-2xl text-[15px] font-bold transition-transform active:scale-[0.98]"
          style={{
            background: `color-mix(in oklch, ${player.color} 12%, var(--color-surface))`,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 45%, transparent)`,
            color: player.color,
          }}
        >
          ＋ Enchaîner des bonus
        </button>
      )}

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
