"use client";

// Configuration de la séance : tours × répétitions + repos, c'est tout.
// Le dernier format utilisé est présélectionné, les favoris se relancent
// en un tap. Si la config ne couvre pas 100-100-100, on le dit franchement
// avant de lancer — mais on n'empêche personne de faire sa séance.

import { useState } from "react";
import { useCoucheRetour } from "@/hooks/useRetour";
import { EXERCISES, Player } from "@/lib/types";
import {
  configEquals,
  configLabel,
  coverageGaps,
  presetToConfig,
  WorkoutConfig,
  WorkoutPreset,
  formatRest,
} from "@/lib/workout";

type Props = {
  player: Player;
  presets: WorkoutPreset[];
  initial: WorkoutConfig;
  onLaunch: (c: WorkoutConfig) => void;
  /** Séance faite ailleurs : valide la journée sans ouvrir le chrono. */
  onDejaFaite: (c: WorkoutConfig) => void;
  onClose: () => void;
};

/** Une ligne de réglage : − valeur +. Gros chiffres, grosses cibles. */
function Stepper({
  label,
  display,
  onMinus,
  onPlus,
  minusOff,
  plusOff,
}: {
  label: string;
  display: string;
  onMinus: () => void;
  onPlus: () => void;
  minusOff?: boolean;
  plusOff?: boolean;
}) {
  const btn =
    "flex size-11 shrink-0 items-center justify-center rounded-full bg-raised text-xl font-bold transition-transform active:scale-[0.94] disabled:opacity-30";
  return (
    <div className="flex min-h-14 items-center justify-between gap-3">
      <span className="text-[15px] font-medium text-muted">{label}</span>
      <div className="flex items-center gap-2">
        <button
          aria-label={`Moins de ${label.toLowerCase()}`}
          onClick={() => {
            navigator.vibrate?.(6);
            onMinus();
          }}
          disabled={minusOff}
          className={btn}
        >
          −
        </button>
        <span className="num-display w-20 text-center text-3xl tabular-nums">
          {display}
        </span>
        <button
          aria-label={`Plus de ${label.toLowerCase()}`}
          onClick={() => {
            navigator.vibrate?.(6);
            onPlus();
          }}
          disabled={plusOff}
          className={btn}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default function ConfigScreen({
  player,
  presets,
  initial,
  onLaunch,
  onDejaFaite,
  onClose,
}: Props) {
  const [config, setConfig] = useState<WorkoutConfig>(initial);
  const [dejaFaite, setDejaFaite] = useState(false);
  const gaps = coverageGaps(config);
  const empty = EXERCISES.every(({ key }) => config.reps[key] === 0);

  const setReps = (exo: (typeof EXERCISES)[number]["key"], delta: number) =>
    setConfig((c) => ({
      ...c,
      reps: {
        ...c.reps,
        [exo]: Math.min(100, Math.max(0, c.reps[exo] + delta)),
      },
    }));

  return (
    <div className="flex min-h-full flex-col">
      <header className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ma séance</h1>
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full bg-surface text-lg text-muted"
        >
          ✕
        </button>
      </header>

      {/* Formats favoris : le plus récent d'abord, relançable en un tap */}
      {presets.length > 0 && (
        <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
          {presets.map((p) => {
            const c = presetToConfig(p);
            const active = configEquals(c, config);
            return (
              <button
                key={p.id}
                aria-pressed={active}
                onClick={() => setConfig(c)}
                className="min-h-11 shrink-0 rounded-full px-4 text-sm font-bold whitespace-nowrap"
                style={
                  active
                    ? {
                        background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                        boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 65%, transparent)`,
                        color: player.color,
                      }
                    : {
                        background: "var(--color-surface)",
                        boxShadow: "inset 0 0 0 1px var(--color-line)",
                        color: "var(--color-ink)",
                      }
                }
              >
                {configLabel(c)}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex flex-col rounded-3xl bg-surface px-5 py-2">
        <Stepper
          label="Tours"
          display={String(config.rounds)}
          onMinus={() =>
            setConfig((c) => ({ ...c, rounds: Math.max(1, c.rounds - 1) }))
          }
          onPlus={() =>
            setConfig((c) => ({ ...c, rounds: Math.min(10, c.rounds + 1) }))
          }
          minusOff={config.rounds <= 1}
          plusOff={config.rounds >= 10}
        />
        {EXERCISES.map(({ key, label }) => (
          <Stepper
            key={key}
            label={`${label} / tour`}
            display={String(config.reps[key])}
            onMinus={() => setReps(key, -5)}
            onPlus={() => setReps(key, +5)}
            minusOff={config.reps[key] <= 0}
            plusOff={config.reps[key] >= 100}
          />
        ))}
        <Stepper
          label="Repos"
          display={formatRest(config.restSeconds)}
          onMinus={() =>
            setConfig((c) => ({
              ...c,
              restSeconds: Math.max(0, c.restSeconds - 15),
            }))
          }
          onPlus={() =>
            setConfig((c) => ({
              ...c,
              restSeconds: Math.min(300, c.restSeconds + 15),
            }))
          }
          minusOff={config.restSeconds <= 0}
          plusOff={config.restSeconds >= 300}
        />
      </div>

      {/* Le total, sans détour : couvre ou ne couvre pas la journée */}
      <div className="mt-3 flex-1">
        {gaps.length === 0 ? (
          <p className="text-sm font-medium" style={{ color: player.color }}>
            ✓ Cette séance valide la journée : 100 pompes, 100 abdos, 100
            squats
          </p>
        ) : (
          // Bloquant, et pas seulement prévenant : depuis que la séance est
          // le SEUL chemin de validation, un format qui ne couvre pas les
          // trois exos rend les manquants impossibles à valider de la
          // journée. On refuse de lancer plutôt que de piéger.
          <p className="text-sm font-medium text-danger">
            Complète ton format pour lancer — il manque {gaps.join(", ")}.
          </p>
        )}
      </div>

      <button
        onClick={() => {
          navigator.vibrate?.(18);
          onLaunch(config);
        }}
        disabled={empty || gaps.length > 0}
        className="mb-2 min-h-16 w-full rounded-2xl text-lg font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
        style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
      >
        Lancer ma séance
      </button>

      {/* La séance faite ailleurs. Volontairement PAS bornée par
          `gaps` : le format décrit la façon dont l'app aurait guidé, il n'a
          rien à dire sur ce qui s'est passé à la salle. */}
      <button
        onClick={() => setDejaFaite(true)}
        className="mb-2 min-h-12 w-full text-sm font-medium text-quiet"
      >
        Je l&apos;ai déjà faite ailleurs
      </button>

      {dejaFaite && (
        <DejaFaiteConfirm
          player={player}
          onConfirm={() => {
            navigator.vibrate?.(18);
            onDejaFaite(config);
          }}
          onCancel={() => setDejaFaite(false)}
        />
      )}
    </div>
  );
}

/**
 * On dit le prix avant, jamais après.
 *
 * Une règle qui touche au score et qu'on découvre après coup passe pour de
 * la triche — c'est la raison d'être de la migration 24, et elle vaut ici :
 * quelqu'un qui valide sa journée sans chrono doit savoir en appuyant ce
 * qu'il ne touchera pas.
 */
function DejaFaiteConfirm({
  player,
  onConfirm,
  onCancel,
}: {
  player: Player;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useCoucheRetour(onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 px-5 pb-safe">
      <div className="rise-in mb-4 w-full rounded-3xl bg-raised p-5">
        <p className="text-lg font-bold">Séance faite ailleurs ?</p>
        <p className="mt-2 text-sm text-muted">
          Tes 100 pompes, 100 abdos et 100 squats sont validés pour
          aujourd&apos;hui.
        </p>
        <p className="mt-2 text-sm text-muted">
          Sans chrono, les bonus de vitesse et d&apos;horaire ne comptent pas.
          Tout le reste de tes points est identique.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-2xl bg-surface font-bold text-muted"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className="min-h-12 flex-1 rounded-2xl font-bold"
            style={{ background: player.color, color: "oklch(0.15 0 0)" }}
          >
            Valider ma journée
          </button>
        </div>
      </div>
    </div>
  );
}
