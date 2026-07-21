"use client";

// Le mode séance guidée plein écran : config → blocs → repos → fin.
// Il n'écrit JAMAIS les entrées lui-même : la validation passe par le
// chemin d'écriture existant (onValidate → upsert optimiste + triggers).

import { useEffect, useRef, useState } from "react";
import { useWorkout } from "@/hooks/useWorkout";
import { parisToday } from "@/lib/challenge";
import { Entry, entryCount, EXERCISES, Exercise, Player } from "@/lib/types";
import {
  coveredExos,
  DayBreakdown,
  DEFAULT_CONFIG,
  fetchDayBreakdown,
  fetchPresets,
  presetToConfig,
  WorkoutPreset,
} from "@/lib/workout";
import ConfigScreen from "./ConfigScreen";
import DoneScreen from "./DoneScreen";
import { BlockScreen, RestScreen } from "./SessionScreens";

type Props = {
  player: Player;
  todayEntry: Entry | undefined;
  /** Écrit les exos validés par le chemin existant. Résout après l'upsert. */
  onValidate: (exos: Exercise[]) => Promise<boolean>;
  /** Série serveur du joueur. Monte quand rescore() a rechargé le classement,
      c'est ce changement qui déclenche l'animation sur l'écran de fin. */
  streak: number;
  /** Séance ouverte en base : déverrouille les coches de la journée. */
  onSessionStart: () => void;
  onClose: () => void;
  showToast: (msg: string) => void;
};

export default function WorkoutMode({
  player,
  todayEntry,
  onValidate,
  streak,
  onSessionStart,
  onClose,
  showToast,
}: Props) {
  const w = useWorkout(player.id, showToast, onSessionStart);
  const [presets, setPresets] = useState<WorkoutPreset[] | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [breakdown, setBreakdown] = useState<DayBreakdown | null>(null);
  const validated = useRef(false);

  useEffect(() => {
    fetchPresets(player.id).then(setPresets);
  }, [player.id]);

  // Fin de séance : l'entrée du jour passe à fait (exos couverts par la
  // config), une seule fois, puis on lit les points du jour côté serveur.
  useEffect(() => {
    if (w.step?.kind !== "done" || !w.config || validated.current) return;
    validated.current = true;
    const exos = coveredExos(w.config);
    onValidate(exos).then(() => {
      fetchDayBreakdown(player.id, parisToday()).then(setBreakdown);
    });
  }, [w.step, w.config, onValidate, player.id]);

  /** Abandon confirmé : les blocs déjà terminés restent comptés. */
  function quit() {
    const done = w.repsDone();
    const earned = EXERCISES.filter(({ key }) => done[key] >= 100).map(
      (e) => e.key,
    );
    if (earned.length > 0) onValidate(earned);
    w.reset();
    onClose();
  }

  // Presets pas encore chargés : écran vide un instant, pas de flash.
  if (presets === null)
    return <div className="fixed inset-0 z-40 bg-bg" aria-hidden />;

  let content: React.ReactNode;
  if (!w.config || !w.step) {
    content = (
      <ConfigScreen
        player={player}
        presets={presets}
        initial={presets.length > 0 ? presetToConfig(presets[0]) : DEFAULT_CONFIG}
        onLaunch={w.launch}
        onClose={onClose}
      />
    );
  } else if (w.step.kind === "done") {
    content = (
      <DoneScreen
        player={player}
        durationSeconds={w.displayDuration}
        official={w.serverDuration !== null}
        exosDone={entryCount(todayEntry)}
        missing={EXERCISES.filter(({ key }) => !todayEntry?.[key]).map(
          (e) => e.key,
        )}
        streak={streak}
        breakdown={breakdown}
        onClose={() => {
          w.reset();
          onClose();
        }}
      />
    );
  } else if (w.step.kind === "rest") {
    content = (
      <RestScreen
        player={player}
        restLeftMs={w.restLeft}
        restTotal={w.config.restSeconds}
        nextRound={w.step.nextRound}
        rounds={w.config.rounds}
        onSkip={w.skipRest}
        onAbandon={() => setConfirmQuit(true)}
      />
    );
  } else {
    content = (
      <BlockScreen
        player={player}
        block={w.blocks[w.step.blockIdx]}
        round={w.step.round}
        rounds={w.config.rounds}
        blockIdx={w.step.blockIdx}
        blocksCount={w.blocks.length}
        onDone={w.finishBlock}
        onAbandon={() => setConfirmQuit(true)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg px-5 pt-safe pb-safe">
      {content}
      {confirmQuit && (
        <QuitConfirm
          player={player}
          done={w.repsDone()}
          onConfirm={quit}
          onCancel={() => setConfirmQuit(false)}
        />
      )}
    </div>
  );
}

/** Confirmation d'abandon : on dit exactement ce qui sera gardé. */
function QuitConfirm({
  player,
  done,
  onConfirm,
  onCancel,
}: {
  player: Player;
  done: Record<Exercise, number>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 px-5 pb-safe">
      <div className="rise-in mb-4 w-full rounded-3xl bg-raised p-5">
        <p className="text-lg font-bold">Abandonner la séance ?</p>
        <ul className="mt-3 space-y-1">
          {EXERCISES.map(({ key, label }) => (
            <li
              key={key}
              className="flex items-baseline justify-between text-sm"
            >
              <span className="text-muted">{label}</span>
              {done[key] >= 100 ? (
                <span className="font-bold" style={{ color: player.color }}>
                  {done[key]} ✓ validé
                </span>
              ) : (
                <span className="font-medium text-muted">
                  {done[key]}/100 — pas validé
                </span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-2xl font-bold"
            style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
          >
            Je continue
          </button>
          <button
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-2xl bg-surface font-bold text-muted"
          >
            J&apos;abandonne
          </button>
        </div>
      </div>
    </div>
  );
}
