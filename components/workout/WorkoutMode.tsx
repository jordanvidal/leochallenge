"use client";

// Le mode séance guidée plein écran : config → blocs → repos → fin.
// Il n'écrit JAMAIS les entrées lui-même : la validation passe par le
// chemin d'écriture existant (onValidate → upsert optimiste + triggers).

import { useEffect, useRef, useState } from "react";
import { useCoucheRetour } from "@/hooks/useRetour";
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
  WorkoutConfig,
  WorkoutPreset,
} from "@/lib/workout";
import BonusPlanner, { SeanceTab } from "./BonusPlanner";
import ConfigScreen from "./ConfigScreen";
import DoneScreen from "./DoneScreen";
import { BonusCatalogItem, BonusState } from "@/lib/bonus";
import { LeaderboardRow } from "@/lib/gamification";
import { BlockScreen, RestScreen } from "./SessionScreens";
import { useLigueCourante } from "@/components/ligue/LigueContexte";

type Props = {
  player: Player;
  players: Player[];
  todayEntry: Entry | undefined;
  /** Catalogue + déclarations du jour. null = pas encore chargé : les
      onglets n'apparaissent pas plutôt que d'ouvrir un écran vide. */
  bonus: BonusState | null;
  /** Pour l'objectif « passer X » du planificateur. */
  leaderboard: LeaderboardRow[] | null;
  /** Déclare un bonus. Appelé à la validation d'une séance bonus, jamais
      bloc par bloc — voir BonusRunScreen. */
  onClaimBonus: (item: BonusCatalogItem) => void;
  /** Ouvrir directement sur l'onglet bonus (entrée « Enchaîner »). */
  startOnBonus: boolean;
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
  players,
  todayEntry,
  bonus,
  leaderboard,
  onClaimBonus,
  startOnBonus,
  onValidate,
  streak,
  onSessionStart,
  onClose,
  showToast,
}: Props) {
  const ligueId = useLigueCourante()?.id ?? null;
  const w = useWorkout(player.id, showToast, onSessionStart);
  const [presets, setPresets] = useState<WorkoutPreset[] | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [breakdown, setBreakdown] = useState<DayBreakdown | null>(null);
  const validated = useRef(false);
  // L'onglet de « Ma séance ». Le contrat par défaut : c'est lui qui ouvre
  // la journée, et il reste le chemin par défaut de tout le monde.
  const [tab, setTab] = useState<SeanceTab>(startOnBonus ? "bonus" : "contrat");

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
      fetchDayBreakdown(player.id, parisToday(), ligueId).then(setBreakdown);
    });
  }, [w.step, w.config, onValidate, player.id, ligueId]);

  // Le retour arrière passe par la même porte que le bouton « Abandonner » :
  // un chrono tourne, et une séance qu'on perd d'un coup de pouce au bord
  // de l'écran ne se rattrape pas. Sur la config et l'écran de fin, il n'y
  // a rien à perdre — on sort directement, comme la croix.
  useCoucheRetour(() => {
    if (w.step && w.step.kind !== "done") setConfirmQuit(true);
    else {
      w.reset();
      onClose();
    }
  });

  /**
   * « Je l'ai déjà faite ailleurs » : la journée se valide sans dérouler
   * le chrono. On ouvre quand même une ligne de séance — le portier du
   * 21/07 ne bouge pas, il n'y a toujours qu'un seul chemin d'écriture —
   * mais on ne la clôture pas, donc aucun bonus lié au temps ne tombe.
   *
   * Les trois exos sont validés, pas ceux que couvre la config : quelqu'un
   * qui déclare sa séance faite à la salle a fait ses 100-100-100, et le
   * format affiché à l'écran ne décrit que la façon dont l'app AURAIT
   * guidé. Il n'a rien à dire sur ce qui s'est passé dehors.
   */
  async function declarerAilleurs(c: WorkoutConfig) {
    await w.ouvrirSeanceSansChrono(c);
    await onValidate(EXERCISES.map((e) => e.key));
    showToast("Journée validée. Sans chrono : pas de bonus vitesse ni d'horaire.");
    onClose();
  }

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

  // Les onglets n'existent que si le catalogue est là. Sans lui, « Ma
  // séance » reste exactement l'écran qu'elle a toujours été.
  const onglets = bonus !== null;

  let content: React.ReactNode;
  if (!w.config || !w.step) {
    content =
      onglets && tab === "bonus" ? (
        <BonusPlanner
          player={player}
          players={players}
          bonus={bonus}
          leaderboard={leaderboard}
          tab={tab}
          onTab={setTab}
          onClaim={onClaimBonus}
          onClose={onClose}
          showToast={showToast}
        />
      ) : (
        <ConfigScreen
          player={player}
          presets={presets}
          initial={
            presets.length > 0 ? presetToConfig(presets[0]) : DEFAULT_CONFIG
          }
          tab={onglets ? tab : undefined}
          onTab={onglets ? setTab : undefined}
          onLaunch={w.launch}
          onDejaFaite={declarerAilleurs}
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
        onPlanBonus={
          onglets
            ? () => {
                // La séance du contrat est finie et validée : on rend la
                // main au planificateur sans repasser par l'accueil.
                w.reset();
                setTab("bonus");
              }
            : undefined
        }
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
  // Un second retour referme la question au lieu de la traverser : c'est
  // « Continuer », qui est aussi la réponse la moins coûteuse.
  useCoucheRetour(onCancel);
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
