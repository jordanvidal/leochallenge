"use client";

// Détail des points d'un joueur, en overlay plein écran depuis le
// classement. « D'où viennent ses points » : base décomposée, bonus
// par catégorie, rappel du barème. La donnée vient de la RPC
// player_breakdown — aucun calcul ici.

import { useEffect, useState } from "react";
import { frenchDateShort, mondayOf, parisToday } from "@/lib/challenge";
import {
  Breakdown,
  BreakdownRow,
  DayPoints,
  fetchBreakdown,
  fetchDays,
} from "@/lib/breakdown";
import { fmtPoints, frenchRank, LeaderboardRow } from "@/lib/gamification";
import { Player } from "@/lib/types";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  row: LeaderboardRow; // rang + total déjà connus du classement
  view: "total" | "week";
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

/** Une ligne de source : emoji, libellé, fréquence, points. */
function SourceRow({ r, color }: { r: BreakdownRow; color: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="text-lg" aria-hidden>
        {r.emoji}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{r.label}</span>
      {r.cnt > 1 && (
        <span className="text-xs text-faint">×{r.cnt}</span>
      )}
      <span className="num-display w-12 text-right text-base" style={{ color }}>
        {fmtPoints(r.points)}
      </span>
    </li>
  );
}

export default function PlayerBreakdown({ player, row, view, onClose }: Props) {
  const [data, setData] = useState<Breakdown | null>(null);
  const [days, setDays] = useState<DayPoints[] | null>(null);
  const [showDays, setShowDays] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Fenêtre alignée sur la vue : « Cette semaine » = depuis lundi.
    const from = view === "week" ? mondayOf(parisToday()) : null;
    fetchBreakdown(player.id, from, null).then((b) => {
      if (b) setData(b);
      else setFailed(true);
    });
    fetchDays(player.id, from, null).then(setDays);
  }, [player.id, view]);

  const total = row.points;
  const basePct =
    data && total > 0 ? Math.round((data.baseTotal / total) * 100) : 0;

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
          {view === "week" ? "Cette semaine" : "Depuis le début"}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Avatar name={player.name} color={player.color} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-bold">{player.name}</p>
          <p className="text-sm text-muted">{frenchRank(row.rank)} au classement</p>
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

      {!data && !failed && (
        <p className="mt-8 animate-pulse text-muted">Calcul en cours…</p>
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
              <SourceRow key={r.item_key} r={r} color={player.color} />
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

          {/* Mini-barème */}
          <div className="mt-8 mb-4 rounded-2xl bg-surface p-4 text-xs text-muted">
            <p className="mb-3 font-bold text-faint">Comment on marque</p>
            <dl className="space-y-2">
              <div className="flex items-baseline gap-3">
                <dt className="num-display w-14 shrink-0 text-ink">1 pt</dt>
                <dd>par exo coché</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="num-display w-14 shrink-0 text-ink">+2</dt>
                <dd>journée parfaite (3 exos sur 3)</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="num-display w-14 shrink-0 text-ink">×1,5</dt>
                <dd>série de 3 jours parfaits</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="num-display w-14 shrink-0 text-ink">×2</dt>
                <dd>série de 7 jours parfaits</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-14 shrink-0 font-bold text-ink">+ bonus</dt>
                <dd>premier du jour, séances, événements et exos déclarés s&apos;ajoutent par-dessus</dd>
              </div>
            </dl>

            {/* Les événements du jour : tirés au hasard, expliqués une bonne fois */}
            <p className="mt-4 mb-3 border-t border-line pt-4 font-bold text-faint">
              Les événements du jour{" "}
              <span className="font-normal">(tirés au hasard, 1 max/jour)</span>
            </p>
            <dl className="space-y-2">
              <div className="flex items-baseline gap-3">
                <dt className="w-6 shrink-0 text-center" aria-hidden>🎲</dt>
                <dd>pompes double : tes pompes comptent double ce jour-là</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-6 shrink-0 text-center" aria-hidden>🍻</dt>
                <dd>happy hour : séance finie entre 18h et 20h → +5</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-6 shrink-0 text-center" aria-hidden>🌄</dt>
                <dd>lève-tôt : séance finie avant 7h → +6</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-6 shrink-0 text-center" aria-hidden>🎰</dt>
                <dd>
                  quitte ou double : si tu boucles ton 3/3, <b>tous</b> tes
                  points du jour comptent double. Si tu rates, rien ne change
                  (aucune perte).
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-6 shrink-0 text-center" aria-hidden>🪞</dt>
                <dd>
                  jour miroir : le <b>dernier</b> du classement général reçoit
                  +8 pour se relancer
                </dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-6 shrink-0 text-center" aria-hidden>👊</dt>
                <dd>boss du dimanche : 200 pompes au total → +10 (dimanche only)</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
