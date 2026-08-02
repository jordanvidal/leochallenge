"use client";

// « Des bonus » : préparer une séance à partir du catalogue, et la
// cadencer. Trois réglages — j'ai tant de temps, je veux tant de points,
// je veux travailler ça — et l'app propose une suite de blocs alternés.
//
// Ce n'est PAS un deuxième portier : cet écran n'ouvre aucune séance
// serveur et ne coche jamais les trois exos du contrat. Il ne touche que
// les déclarations de bonus, exactement comme la feuille — un bloc
// terminé se déclare, un bloc sauté ne se déclare pas.

import { useMemo, useState } from "react";
import {
  BonusCatalogItem,
  BonusFamily,
  BonusState,
  claimables,
} from "@/lib/bonus";
import { fmtPoints, LeaderboardRow } from "@/lib/gamification";
import { Player } from "@/lib/types";
import BonusRun from "./BonusRunScreen";
import {
  composePlan,
  gapToNext,
  Plan,
  PlanBlock,
  PLAN_ZONES,
  planLabel,
  REST_MINUTES,
  shortestTimeFor,
  zoneLabel,
} from "@/lib/bonusPlan";

export type SeanceTab = "contrat" | "bonus";

/** Les deux onglets de « Ma séance ». Le contrat d'un côté, le catalogue
    de l'autre : c'est le même geste, on prépare ce qu'on va faire. */
export function SeanceTabs({
  tab,
  onTab,
  player,
}: {
  tab: SeanceTab;
  onTab: (t: SeanceTab) => void;
  player: Player;
}) {
  const tabs: { key: SeanceTab; label: string }[] = [
    { key: "contrat", label: "Le contrat" },
    { key: "bonus", label: "Des bonus" },
  ];
  // `role="tab"` hors d'un `tablist` est de l'ARIA invalide : VoiceOver
  // annonce « onglet » sans jamais dire lequel sur combien. Le conteneur
  // porte le rôle, chaque onglet nomme le panneau qu'il commande.
  return (
    <div role="tablist" aria-label="Ce que je prépare" className="mt-4 flex gap-2">
      {tabs.map((t) => {
        const on = tab === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            id={`seance-tab-${t.key}`}
            aria-selected={on}
            aria-controls={`seance-panneau-${t.key}`}
            onClick={() => {
              navigator.vibrate?.(8);
              onTab(t.key);
            }}
            className="min-h-11 flex-1 rounded-2xl text-sm font-bold transition-transform active:scale-[0.98]"
            style={
              on
                ? {
                    background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                    boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 65%, transparent)`,
                    color: player.color,
                  }
                : { background: "var(--color-surface)", color: "var(--color-muted)" }
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Une puce de réglage. Même grammaire que les puces de la feuille de
    bonus : allumée = couleur du joueur. */
function Opt({
  label,
  on,
  onClick,
  player,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  player: Player;
}) {
  return (
    <button
      aria-pressed={on}
      onClick={() => {
        navigator.vibrate?.(8);
        onClick();
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
      {label}
    </button>
  );
}

function Knob({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13px] font-bold">{label}</span>
        {hint && <span className="text-[11px] text-quiet">{hint}</span>}
      </div>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">{children}</div>
    </div>
  );
}

const DURATIONS: (number | null)[] = [10, 15, 20, 30, null];

type Props = {
  player: Player;
  players: Player[];
  bonus: BonusState;
  leaderboard: LeaderboardRow[] | null;
  tab: SeanceTab;
  onTab: (t: SeanceTab) => void;
  /** Déclare un bonus, par le chemin existant (optimiste + toast). Appelé
      une seule fois par bloc, à la validation — jamais pendant la séance. */
  onClaim: (item: BonusCatalogItem) => void;
  onClose: () => void;
  showToast: (msg: string) => void;
};

export default function BonusPlanner({
  player,
  players,
  bonus,
  leaderboard,
  tab,
  onTab,
  onClaim,
  onClose,
  showToast,
}: Props) {
  const [budget, setBudget] = useState<number | null>(15);
  const [goal, setGoal] = useState<number | "rival" | null>(null);
  const [zones, setZones] = useState<Set<BonusFamily>>(new Set());
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

  // Le raccourci classement : l'écart avec celui de devant, s'il y en a un.
  const next = gapToNext(leaderboard, player.id);
  const rivalName = players.find((p) => p.id === next?.playerId)?.name ?? null;
  // Passer, pas égaler.
  const rivalGoal = next ? next.gap + 0.5 : null;

  const goalPoints = goal === "rival" ? rivalGoal : goal;

  // Tant que la migration 31 n'a pas peuplé `family`, aucune zone n'est
  // connue : on retire le réglage plutôt que d'afficher quatre puces qui
  // ne filtrent rien et vident la séance.
  const zonesKnown = claimables(bonus).some((c) => c.family !== null);

  const zonesKey = [...zones].sort().join(",");
  const plan: Plan | null = useMemo(
    () => composePlan(bonus, player.id, { budget, goal: goalPoints, zones }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bonus, player.id, budget, goalPoints, zonesKey],
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

  const needed =
    goalPoints !== null
      ? shortestTimeFor(bonus, player.id, goalPoints, zones)
      : null;

  return (
    <div
      className="flex min-h-full flex-col"
      role="tabpanel"
      id="seance-panneau-bonus"
      aria-labelledby="seance-tab-bonus"
    >
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

      <SeanceTabs tab={tab} onTab={onTab} player={player} />

      <Knob label="⏱ J'ai" hint="repos compris">
        {DURATIONS.map((d) => (
          <Opt
            key={String(d)}
            label={d === null ? "peu importe" : `${d} min`}
            on={budget === d}
            onClick={() => setBudget(d)}
            player={player}
          />
        ))}
      </Knob>

      <Knob label="🎯 Objectif" hint="facultatif">
        <Opt
          label="aucun"
          on={goal === null}
          onClick={() => setGoal(null)}
          player={player}
        />
        <Opt
          label="+5 pts"
          on={goal === 5}
          onClick={() => setGoal(5)}
          player={player}
        />
        <Opt
          label="+10 pts"
          on={goal === 10}
          onClick={() => setGoal(10)}
          player={player}
        />
        {rivalName && rivalGoal !== null && (
          <Opt
            label={`passer ${rivalName} (+${fmtPoints(rivalGoal)})`}
            on={goal === "rival"}
            onClick={() => setGoal("rival")}
            player={player}
          />
        )}
      </Knob>

      {zonesKnown && (
        <Knob label="🧍 Zones" hint={zones.size === 0 ? "toutes" : undefined}>
          {PLAN_ZONES.map((z) => (
            <Opt
              key={z.key}
              label={z.short}
              on={zones.has(z.key)}
              onClick={() =>
                setZones((prev) => {
                  const s = new Set(prev);
                  if (s.has(z.key)) s.delete(z.key);
                  else s.add(z.key);
                  return s;
                })
              }
              player={player}
            />
          ))}
        </Knob>
      )}

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
            {goalPoints === null
              ? `Rien ne rentre en ${budget} min avec ces zones. Élargis la sélection, ou donne-toi un peu plus de temps.`
              : needed === null
                ? "Pas atteignable avec ces zones — et ce qui est déjà déclaré aujourd'hui ne compte plus. Élargis la sélection ou baisse l'objectif."
                : `${fmtPoints(goalPoints)} pts ne rentrent pas en ${budget} min. Il te faudrait ${needed} min — ou moins de points.`}
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
