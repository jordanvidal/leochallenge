"use client";

// « Enchaîner des bonus » : l'app compose une séance cadencée dans le
// temps qu'on lui donne, et la déroule bloc par bloc. Un seul réglage,
// la durée. L'objectif de points et les filtres par zone sont partis le
// 02/08 avec les onglets « Le contrat / Des bonus » : trois rangées de
// réglages posées en égal du contrat, c'était le vocabulaire du dashboard
// que PRODUCT.md interdit. La variété n'est pas un réglage — le composeur
// alterne les zones de lui-même, c'est sa raison d'être.
//
// Écran secondaire : on n'y arrive que par la feuille de déclaration ou
// par « Enchaîner des bonus » (journée bouclée, fin de séance). Son sort
// se juge aux données de S4 — critère de sortie écrit dans la PR.
//
// Ce n'est PAS un deuxième portier : cet écran n'ouvre aucune séance
// serveur et ne coche jamais les trois exos du contrat. Il ne touche que
// les déclarations de bonus, exactement comme la feuille — un bloc
// terminé se déclare, un bloc sauté ne se déclare pas.

import { useMemo, useState } from "react";
import { BonusCatalogItem, BonusState } from "@/lib/bonus";
import { fmtPoints } from "@/lib/gamification";
import { Player } from "@/lib/types";
import BonusRun from "./BonusRunScreen";
import {
  composePlan,
  Plan,
  PlanBlock,
  planLabel,
  REST_MINUTES,
  zoneLabel,
} from "@/lib/bonusPlan";

const DURATIONS: (number | null)[] = [10, 15, 20, 30, null];

type Props = {
  player: Player;
  bonus: BonusState;
  /** Déclare un bonus, par le chemin existant (optimiste + toast). Appelé
      une seule fois par bloc, à la validation — jamais pendant la séance. */
  onClaim: (item: BonusCatalogItem) => void;
  onClose: () => void;
  showToast: (msg: string) => void;
};

export default function BonusPlanner({
  player,
  bonus,
  onClaim,
  onClose,
  showToast,
}: Props) {
  const [budget, setBudget] = useState<number | null>(15);
  const [run, setRun] = useState<PlanBlock[] | null>(null);

  const claimedKeys = useMemo(
    () =>
      new Set(
        bonus.todayClaims
          .filter((c) => c.player_id === player.id)
          .map((c) => c.bonus_key),
      ),
    [bonus.todayClaims, player.id],
  );

  const plan: Plan | null = useMemo(
    () => composePlan(bonus, player.id, budget),
    [bonus, player.id, budget],
  );

  if (run) {
    return (
      <BonusRun
        player={player}
        blocks={run}
        catalog={bonus.catalog}
        claimedKeys={claimedKeys}
        onClaim={onClaim}
        onQuit={() => setRun(null)}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Enchaîner des bonus</h1>
        <button
          aria-label="Fermer"
          onClick={onClose}
          className="flex size-11 items-center justify-center rounded-full bg-surface text-lg text-muted"
        >
          ✕
        </button>
      </header>

      {/* Le seul réglage : le temps qu'on a. Même grammaire que les puces
          de la feuille — allumée = couleur du joueur. */}
      <div className="mt-4">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[13px] font-bold">⏱ J&apos;ai</span>
          <span className="text-[11px] text-quiet">repos compris</span>
        </div>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {DURATIONS.map((d) => {
            const on = budget === d;
            return (
              <button
                key={String(d)}
                aria-pressed={on}
                onClick={() => {
                  navigator.vibrate?.(8);
                  setBudget(d);
                }}
                className="min-h-11 rounded-full px-3.5 text-sm font-bold whitespace-nowrap transition-transform active:scale-[0.97]"
                style={
                  on
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
                {d === null ? "peu importe" : `${d} min`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 flex-1">
        {plan ? (
          <div className="flex flex-col gap-2">
            {plan.blocks.map((b, i) => (
              <div
                key={b.key}
                className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3"
              >
                <span className="text-xl" aria-hidden>
                  {b.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold">
                    {planLabel(b, claimedKeys, bonus.catalog)}
                  </p>
                  <p className="text-[11px] text-quiet">
                    {zoneLabel(b.family)} · ~{b.minutes} min
                    {i < plan.blocks.length - 1
                      ? ` · puis ${REST_MINUTES} min de repos`
                      : ""}
                  </p>
                </div>
                <span
                  className="num-display shrink-0 text-xl"
                  style={{ color: player.color }}
                >
                  +{fmtPoints(b.todayPoints)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium text-muted">
            {budget === null
              ? "Plus rien à enchaîner : tout ce qui se déclare aujourd'hui l'est déjà."
              : `Rien ne rentre en ${budget} min avec ce qui te reste à déclarer. Donne-toi un peu plus de temps.`}
          </p>
        )}
      </div>

      {plan && (
        <p className="mt-3 text-center text-sm font-medium text-muted">
          <span className="num-display text-2xl text-ink">{plan.minutes}</span>{" "}
          min ·{" "}
          <span className="num-display text-2xl" style={{ color: player.color }}>
            +{fmtPoints(plan.points)}
          </span>{" "}
          pts · {plan.blocks.length} blocs
          {plan.zones > 1 ? ` · ${plan.zones} zones` : ""}
        </p>
      )}

      {/* Surtout PAS « Lancer ma séance » : ces trois mots appartiennent au
          portier de l'accueil, celui qui ouvre un chrono en base et
          déverrouille la journée (21/07). Cet écran-ci n'ouvre aucune
          séance serveur et ne coche aucun des trois exos du contrat — il
          enchaîne des blocs de bonus. Deux boutons au même libellé pour
          deux choses opposées, c'est la meilleure façon de faire croire
          qu'on a lancé sa journée alors qu'on n'a rien lancé du tout. */}
      <button
        onClick={() => {
          navigator.vibrate?.(18);
          if (plan) setRun(plan.blocks);
        }}
        disabled={!plan}
        className="mt-3 mb-2 min-h-15 w-full rounded-2xl text-lg font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
        style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
      >
        Enchaîner les blocs
      </button>
    </div>
  );
}
