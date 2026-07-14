"use client";

// Les deux écrans du cœur de séance : le bloc (« 25 pompes », bouton
// massif Terminé) et le repos (cercle qui se vide, gros chiffres).
// Le décompte vient du hook, basé timestamps — ici on ne fait qu'afficher.

import { Block } from "@/hooks/useWorkout";
import { Player } from "@/lib/types";
import { formatClock } from "@/lib/workout";

/** Barre de progression fine : blocs faits / blocs totaux. */
function Progress({
  player,
  round,
  rounds,
  done,
  total,
}: {
  player: Player;
  round: number;
  rounds: number;
  done: number;
  total: number;
}) {
  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-bold text-muted">
          Tour {round}/{rounds}
        </p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Progression de la séance"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${(done / total) * 100}%`,
            background: player.color,
          }}
        />
      </div>
    </div>
  );
}

/** Bouton d'abandon discret : petit, en haut, avec confirmation derrière. */
function AbandonButton({ onAbandon }: { onAbandon: () => void }) {
  return (
    <button
      onClick={onAbandon}
      className="absolute top-0 right-0 min-h-11 px-2 text-[13px] font-medium text-faint"
    >
      Abandonner
    </button>
  );
}

export function BlockScreen({
  player,
  block,
  round,
  rounds,
  blockIdx,
  blocksCount,
  onDone,
  onAbandon,
}: {
  player: Player;
  block: Block;
  round: number;
  rounds: number;
  blockIdx: number;
  blocksCount: number;
  onDone: () => void;
  onAbandon: () => void;
}) {
  const doneBlocks = (round - 1) * blocksCount + blockIdx;
  return (
    <div className="relative flex min-h-full flex-col">
      <AbandonButton onAbandon={onAbandon} />
      <Progress
        player={player}
        round={round}
        rounds={rounds}
        done={doneBlocks}
        total={rounds * blocksCount}
      />

      {/* Le bloc : un seul chiffre, un seul geste */}
      <div
        key={`${round}-${blockIdx}`}
        className="rise-in flex flex-1 flex-col items-center justify-center"
      >
        <p
          className="num-display text-[7.5rem] leading-none"
          style={{ color: player.color }}
        >
          {block.reps}
        </p>
        <p className="mt-2 text-3xl font-bold">{block.label.toLowerCase()}</p>
      </div>

      <button
        onClick={() => {
          navigator.vibrate?.(18);
          onDone();
        }}
        className="mb-2 min-h-20 w-full rounded-3xl text-2xl font-bold transition-transform active:scale-[0.98]"
        style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
      >
        Terminé ✓
      </button>
    </div>
  );
}

export function RestScreen({
  player,
  restLeftMs,
  restTotal,
  nextRound,
  rounds,
  onSkip,
  onAbandon,
}: {
  player: Player;
  restLeftMs: number;
  restTotal: number;
  nextRound: number;
  rounds: number;
  onSkip: () => void;
  onAbandon: () => void;
}) {
  const leftSeconds = Math.ceil(restLeftMs / 1000);
  // Cercle qui se vide : la fraction restante pilote le trait
  const R = 108;
  const C = 2 * Math.PI * R;
  const frac = restTotal > 0 ? restLeftMs / (restTotal * 1000) : 0;

  return (
    <div className="relative flex min-h-full flex-col">
      <AbandonButton onAbandon={onAbandon} />
      <p className="mt-2 text-sm font-bold text-muted">
        Repos — tour {nextRound}/{rounds} ensuite
      </p>

      <div className="flex flex-1 items-center justify-center">
        <div className="relative">
          <svg
            width={260}
            height={260}
            viewBox="0 0 260 260"
            aria-hidden
            className="-rotate-90"
          >
            <circle
              cx={130}
              cy={130}
              r={R}
              fill="none"
              stroke="var(--color-surface)"
              strokeWidth={10}
            />
            <circle
              cx={130}
              cy={130}
              r={R}
              fill="none"
              stroke={player.color}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              style={{ transition: "stroke-dashoffset 200ms linear" }}
            />
          </svg>
          <p
            className="num-display absolute inset-0 flex items-center justify-center text-7xl"
            role="timer"
            aria-live="off"
            aria-label={`${leftSeconds} secondes de repos restantes`}
          >
            {formatClock(leftSeconds)}
          </p>
        </div>
      </div>

      <button
        onClick={onSkip}
        className="mb-2 min-h-14 w-full rounded-2xl bg-surface text-base font-bold text-ink transition-transform active:scale-[0.98]"
      >
        Passer le repos →
      </button>
    </div>
  );
}
