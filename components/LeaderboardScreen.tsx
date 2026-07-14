"use client";

// Classement : podium, liste, variation de rang depuis la semaine dernière.
// Deux vues : général et semaine en cours (pour que le 6e ait encore
// une raison de s'y mettre).

import { useState } from "react";
import { elapsedDays } from "@/lib/challenge";
import { fmtPoints, frenchRank, Gamification, LeaderboardRow } from "@/lib/gamification";
import { Player } from "@/lib/types";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  gamification: Gamification | null;
};

/** ↑2 / ↓1 / = depuis la semaine dernière. */
function Variation({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const label = delta > 0 ? `↑${delta}` : delta < 0 ? `↓${-delta}` : "=";
  const color =
    delta > 0 ? "var(--pc)" : delta < 0 ? "var(--color-danger)" : "var(--color-faint)";
  return (
    <span
      className="min-w-8 text-right text-sm font-bold"
      style={{ color }}
      aria-label={`variation : ${label}`}
    >
      {label}
    </span>
  );
}

export default function LeaderboardScreen({ player, players, gamification }: Props) {
  const [view, setView] = useState<"total" | "week">("total");
  const byId = new Map(players.map((p) => [p.id, p]));
  const nDays = Math.max(elapsedDays().length, 1);

  if (!gamification) {
    return (
      <div className="flex flex-1 flex-col px-5 pt-safe">
        <h1 className="mt-4 text-2xl font-bold">Classement</h1>
        <p className="mt-4 animate-pulse text-muted">Calcul en cours…</p>
      </div>
    );
  }

  const rows = (view === "total" ? gamification.total : gamification.week).filter(
    (r) => byId.has(r.player_id),
  );
  const podium = rows.filter((r) => r.rank <= 3).slice(0, 3);
  // ordre visuel du podium : 2e, 1er, 3e
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);

  const variation = (r: LeaderboardRow): number | null => {
    if (view !== "total") return null;
    const old = gamification.lastWeekRanks.get(r.player_id);
    if (old === undefined) return null;
    return old - r.rank;
  };

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      <h1 className="mt-4 text-2xl font-bold">Classement</h1>

      {/* Général / Cette semaine */}
      <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(
          [
            ["total", "Général"],
            ["week", "Cette semaine"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className="min-h-10 flex-1 rounded-lg text-sm font-bold transition-colors"
            style={
              view === key
                ? { background: "var(--color-raised)", color: "var(--color-ink)" }
                : { color: "var(--color-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Podium */}
      <div className="mt-5 flex items-end justify-center gap-6">
        {podiumOrder.map((r) => {
          const p = byId.get(r.player_id)!;
          const first = r.rank === 1;
          return (
            <div key={r.player_id} className="flex flex-col items-center gap-1">
              <Avatar name={p.name} color={p.color} size={first ? 64 : 48} />
              <span className="max-w-20 truncate text-sm font-bold">{p.name}</span>
              <span
                className={`num-display ${first ? "text-4xl" : "text-2xl"}`}
                style={{ color: p.color }}
              >
                {fmtPoints(r.points)}
              </span>
              <span className="text-[10px] font-medium text-faint">
                {frenchRank(r.rank)} · pts
              </span>
            </div>
          );
        })}
      </div>

      {/* Liste complète */}
      <ul className="mt-6 flex flex-col gap-2 pb-4">
        {rows.map((r) => {
          const p = byId.get(r.player_id)!;
          const me = r.player_id === player.id;
          const completion = Math.round((r.exos_done / (nDays * 3)) * 100);
          return (
            <li
              key={r.player_id}
              className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{
                background: me
                  ? `color-mix(in oklch, ${p.color} 12%, var(--color-surface))`
                  : "var(--color-surface)",
              }}
            >
              <span className="num-display w-8 text-2xl text-faint">{r.rank}</span>
              <Avatar name={p.name} color={p.color} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {me ? "Toi" : p.name}
                </p>
                <p className="text-xs text-muted">
                  {r.current_streak > 0 ? `🔥 ${r.current_streak} · ` : ""}
                  {completion}% de complétion
                  {r.bonus_points > 0
                    ? ` · dont ${fmtPoints(r.bonus_points)} pts bonus`
                    : ""}
                </p>
              </div>
              <span className="num-display text-xl">{fmtPoints(r.points)}</span>
              <Variation delta={variation(r)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
