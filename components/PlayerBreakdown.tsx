"use client";

// Détail des points d'un joueur, en overlay plein écran depuis le
// classement. « D'où viennent ses points » : base décomposée, bonus
// par catégorie, rappel du barème. La donnée vient de la RPC
// player_breakdown — aucun calcul ici.

import { useEffect, useState } from "react";
import { useCoucheRetour } from "@/hooks/useRetour";
import { frenchDateShort, saison3Started } from "@/lib/challenge";
import {
  Breakdown,
  BreakdownRow,
  DayPoints,
  fetchBreakdown,
  fetchDays,
} from "@/lib/breakdown";
import { fmtPoints, frenchRank, LeaderboardRow } from "@/lib/gamification";
import { Player } from "@/lib/types";
import { Avatar, Skeleton } from "./ui";
import { MiniBareme } from "./MiniBareme";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  row: LeaderboardRow; // rang + total déjà connus du classement
  // Fenêtre du classement affiché (null = pas de borne) et son libellé,
  // fournis par LeaderboardScreen : général, semaine en cours ou semaine
  // passée de l'historique.
  from: string | null;
  until: string | null;
  label: string;
  onClose: () => void;
};

/** Une ligne de jour : date, marqueurs (parfait, série), points. */
function DayRow({ d, color }: { d: DayPoints; color: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1 truncate text-sm">
        {frenchDateShort(d.day)}
      </span>
      <span className="flex items-center gap-1.5 text-xs text-faint" aria-hidden>
        {d.perfect ? "✅" : `${d.exos}/3`}
        {d.multiplier > 1 && (
          <span className="text-muted">🔥×{d.multiplier}</span>
        )}
        {d.bonusPoints > 0 && (
          <span className="text-muted">+{fmtPoints(d.bonusPoints)}</span>
        )}
      </span>
      <span className="num-display w-12 text-right text-base" style={{ color }}>
        {fmtPoints(d.points)}
      </span>
    </li>
  );
}

/** Une ligne de source : emoji, libellé, note, fréquence, points.

    La note est la seule chose qui ne se déduit pas du chiffre : d'où
    sort un « 7 » de bonus de série, quelle part d'un « 8 » vient d'un
    jour 🎲. Sans elle, l'écran donne des résultats et laisse le calcul
    au lecteur — c'est précisément ce qu'on lui reprochait. */
function SourceRow({
  r,
  color,
  note,
}: {
  r: BreakdownRow;
  color: string;
  note?: string;
}) {
  // Toute la ligne doublée : le badge ×2 suffit et se lit d'un œil.
  // Doublée en partie (déclarée trois fois, doublée une seule), un
  // badge mentirait — c'est la note qui le dit, en points.
  const toutDouble = r.doubled > 0 && Math.abs(r.points - r.doubled * 2) < 0.05;
  const partiel = r.doubled > 0 && !toutDouble;
  const sousTitre =
    note ?? (partiel ? `dont ${fmtPoints(r.doubled)} doublés 🎲` : undefined);

  return (
    <li className="flex items-center gap-3 py-2">
      <span className="text-lg" aria-hidden>
        {r.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{r.label}</span>
        {sousTitre && (
          <span className="block truncate text-xs text-faint">{sousTitre}</span>
        )}
      </span>
      {toutDouble && (
        <span
          className="num-display shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
          style={{
            background: "var(--color-surface)",
            boxShadow: "inset 0 0 0 1px var(--color-line)",
          }}
        >
          ×2
        </span>
      )}
      {/* Le compteur sort toujours dans la base : « Journées parfaites 4 »
          sans lui laisse croire à 4 journées à 1 pt. */}
      {(r.cnt > 1 || r.category === "base") && (
        <span className="shrink-0 text-xs text-faint">×{r.cnt}</span>
      )}
      <span className="num-display w-12 text-right text-base" style={{ color }}>
        {fmtPoints(r.points)}
      </span>
    </li>
  );
}

export default function PlayerBreakdown({ player, row, from, until, label, onClose }: Props) {
  const f = useFenetre();
  // Le retour arrière refait le geste de la flèche « ← » en tête d'écran.
  useCoucheRetour(onClose);

  // Le mini-barème décrit les règles EN VIGUEUR. C'est l'écran qu'on ouvre
  // quand on ne comprend pas son score : le faire passer à la S3 avant la
  // S3, c'est répondre à côté au seul moment où quelqu'un pose la question.
  const s3 = saison3Started(f);
  const [data, setData] = useState<Breakdown | null>(null);
  const [days, setDays] = useState<DayPoints[] | null>(null);
  const [showDays, setShowDays] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchBreakdown(player.id, from, until).then((b) => {
      if (b) setData(b);
      else setFailed(true);
    });
    fetchDays(player.id, from, until).then(setDays);
  }, [player.id, from, until]);

  const total = row.points;
  const basePct =
    data && total > 0 ? Math.round((data.baseTotal / total) * 100) : 0;

  // « Bonus de série : 7 » est le seul chiffre de l'écran qu'aucun
  // barème n'explique — c'est le surplus du multiplicateur sur la base,
  // pas un bonus qu'on gagne. On nomme donc le facteur, lu sur les jours
  // de la fenêtre. Facteurs mélangés (×1,5 puis ×2) : on n'en cite aucun
  // plutôt que d'en choisir un au hasard.
  const facteurs = [...new Set((days ?? []).filter((d) => d.multiplier > 1).map((d) => d.multiplier))];
  const noteSerie =
    facteurs.length === 1
      ? `ce que ta série ×${fmtPoints(facteurs[0])} ajoute à ta base`
      : "ce que ta série ajoute à ta base";

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg px-5 pt-safe pb-safe">
      {/* En-tête : retour + identité + total */}
      <div className="flex items-center gap-3 py-2">
        <button
          onClick={onClose}
          aria-label="Retour au classement"
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-2xl text-muted"
        >
          ←
        </button>
        <span className="flex-1 text-sm font-medium text-faint">
          {label}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Avatar name={player.name} color={player.color} photo={player.photo} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-bold">{player.name}</p>
          {/* Le rang est celui de la fenêtre affichée. « 1er au classement »
              sur une semaine, quand on est 3e au général, c'est un écran
              qui se trompe de sujet — il dit alors sur quoi il compte. */}
          <p className="text-sm text-muted">
            {frenchRank(row.rank)}{" "}
            {from || until ? label.toLowerCase() : "au classement"}
          </p>
        </div>
        <span
          className="num-display text-4xl"
          style={{ color: player.color }}
        >
          {fmtPoints(total)}
        </span>
      </div>

      {failed && (
        <p className="mt-8 text-muted">Impossible de charger le détail. Réessaie.</p>
      )}

      {/* Le détail se calcule ligne à ligne côté serveur : la forme de la
          page tient la place, l'en-tête (nom, rang, total) est déjà juste. */}
      {!data && !failed && (
        <div
          className="mt-6"
          role="status"
          aria-label="Détail des points en cours de calcul"
        >
          <Skeleton h={10} radius={999} />
          <div className="mt-2 flex justify-between">
            <Skeleton w={72} h={12} radius={6} />
            <Skeleton w={72} h={12} radius={6} />
          </div>
          <Skeleton className="mt-7" w={70} h={14} radius={7} />
          <ul className="mt-3 flex flex-col gap-3">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <Skeleton h={22} radius={6} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && total === 0 && (
        <p className="mt-8 text-muted">
          Pas encore de points. Ça commence par cocher trois exos.
        </p>
      )}

      {data && total > 0 && (
        <div className="rise-in mt-6">
          {/* Répartition base / bonus */}
          <div
            className="flex h-2.5 overflow-hidden rounded-full"
            style={{ background: "var(--color-surface)" }}
            aria-hidden
          >
            <div
              style={{
                width: `${basePct}%`,
                background: player.color,
              }}
            />
            <div
              style={{
                width: `${100 - basePct}%`,
                background: `color-mix(in oklch, ${player.color} 35%, var(--color-surface))`,
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs">
            <span className="text-muted">
              Base <span className="num-display text-ink">{fmtPoints(data.baseTotal)}</span>
            </span>
            <span className="text-muted">
              <span className="num-display text-ink">{fmtPoints(data.bonusTotal)}</span> bonus
            </span>
          </div>

          {/* Base */}
          <h2 className="mt-7 text-sm font-bold text-faint">La base</h2>
          <ul className="mt-1 divide-y divide-line/60">
            {data.base.map((r) => (
              <SourceRow
                key={r.item_key}
                r={r}
                color={player.color}
                note={r.item_key === "streak" ? noteSerie : undefined}
              />
            ))}
          </ul>

          {/* Bonus */}
          {data.bonus.length > 0 && (
            <>
              <h2 className="mt-7 text-sm font-bold text-faint">Les bonus</h2>
              <ul className="mt-1 divide-y divide-line/60">
                {data.bonus.map((r) => (
                  <SourceRow key={r.item_key} r={r} color={player.color} />
                ))}
              </ul>
            </>
          )}

          {/* Jour par jour, replié par défaut : le détail sans le tableur */}
          {days && days.length > 0 && (
            <div className="mt-7">
              <button
                onClick={() => setShowDays((v) => !v)}
                aria-expanded={showDays}
                className="flex w-full items-center justify-between text-sm font-bold text-faint"
              >
                <span>Jour par jour</span>
                <span className="text-muted">{showDays ? "Masquer −" : `${days.length} jours +`}</span>
              </button>
              {showDays && (
                <ul className="rise-in mt-1 divide-y divide-line/60">
                  {days.map((d) => (
                    <DayRow key={d.day} d={d} color={player.color} />
                  ))}
                </ul>
              )}
            </div>
          )}

          <MiniBareme s3={s3} />
        </div>
      )}
    </div>
  );
}
