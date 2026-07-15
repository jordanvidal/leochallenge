"use client";

// L'écran de fin : la durée totale en très gros, l'état de la journée,
// les points du jour lus au serveur, et le partage WhatsApp qui inclut
// désormais la ligne « Séance : 22 min 14 ».

import { entryCount } from "@/lib/types";
import type { Player } from "@/lib/types";
import { DayBreakdown, formatClock } from "@/lib/workout";
import { fmtPoints } from "@/lib/gamification";

type Props = {
  player: Player;
  durationSeconds: number;
  /** true = durée serveur (foi du chrono), false = estimation locale. */
  official: boolean;
  /** Exos cochés sur l'entrée du jour après l'upsert (0 à 3). */
  exosDone: ReturnType<typeof entryCount>;
  breakdown: DayBreakdown | null;
  onShare: () => void;
  onClose: () => void;
};

export default function DoneScreen({
  player,
  durationSeconds,
  official,
  exosDone,
  breakdown,
  onShare,
  onClose,
}: Props) {
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
          {exosDone === 3
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
      </div>

      <button
        onClick={onShare}
        className="min-h-14 w-full rounded-2xl text-base font-bold transition-transform active:scale-[0.98]"
        style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
      >
        Partager ma semaine 💬
      </button>
      <button
        onClick={onClose}
        className="mt-2 mb-2 min-h-12 w-full rounded-2xl bg-surface text-sm font-bold text-muted"
      >
        Fermer
      </button>
    </div>
  );
}
