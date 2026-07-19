"use client";

// Classement : podium, liste, variation de rang depuis la semaine dernière.
// La semaine est LA compétition : le compteur repart de zéro chaque lundi
// 00h, la vue hebdo est donc l'onglet par défaut. Le général reste là pour
// la course de fond, et l'historique (S1, S2…) garde la trace de chaque
// semaine — recalculée à la demande, jamais stockée.

import { useEffect, useState } from "react";
import {
  ChallengeWeek,
  challengeWeeks,
  diffDays,
  elapsedDays,
  parisToday,
} from "@/lib/challenge";
import {
  fetchWeekLeaderboard,
  fmtPoints,
  frenchRank,
  Gamification,
  LeaderboardRow,
} from "@/lib/gamification";
import { Entry, Player } from "@/lib/types";
import DuelCard from "./DuelCard";
import PlayerBreakdown from "./PlayerBreakdown";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
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

export default function LeaderboardScreen({ player, players, entries, gamification }: Props) {
  const [view, setView] = useState<"total" | "week">("week");
  const weeks = challengeWeeks();
  const currentWeek = weeks.find((w) => w.current) ?? null;
  // Semaine affichée dans la vue hebdo. Par défaut : celle en cours.
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  // Classements des semaines passées, chargés à la demande puis gardés.
  // null = échec de chargement (retenté quand on revient sur la semaine).
  const [history, setHistory] = useState<Map<number, LeaderboardRow[] | null>>(
    () => new Map(),
  );
  // Joueur dont on regarde le détail des points (overlay), null = fermé.
  const [detail, setDetail] = useState<LeaderboardRow | null>(null);

  const selectedWeek: ChallengeWeek | null =
    view === "week"
      ? (weekIdx === null ? currentWeek : weeks.find((w) => w.index === weekIdx) ?? currentWeek)
      : null;
  const isPastWeek = selectedWeek !== null && !selectedWeek.current;

  useEffect(() => {
    if (view !== "week" || !selectedWeek || selectedWeek.current) return;
    if (history.get(selectedWeek.index)) return; // déjà chargée
    let cancelled = false;
    fetchWeekLeaderboard(selectedWeek.from, selectedWeek.until).then((rows) => {
      if (cancelled) return;
      setHistory((h) => new Map(h).set(selectedWeek.index, rows));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedWeek?.index]);

  const byId = new Map(players.map((p) => [p.id, p]));

  if (!gamification) {
    return (
      <div className="flex flex-1 flex-col px-5 pt-safe">
        <h1 className="mt-4 text-2xl font-bold">Classement</h1>
        <p className="mt-4 animate-pulse text-muted">Calcul en cours…</p>
      </div>
    );
  }

  // Dénominateur de complétion : jours écoulés de la fenêtre affichée.
  const today = parisToday();
  const nDays = Math.max(
    selectedWeek
      ? diffDays(selectedWeek.from, selectedWeek.until < today ? selectedWeek.until : today) + 1
      : elapsedDays().length,
    1,
  );

  const rawRows =
    view === "total"
      ? gamification.total
      : isPastWeek
        ? history.get(selectedWeek.index)
        : gamification.week;
  const rows = (rawRows ?? []).filter((r) => byId.has(r.player_id));
  const podium = rows.filter((r) => r.rank <= 3).slice(0, 3);
  // ordre visuel du podium : 2e, 1er, 3e
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);

  const variation = (r: LeaderboardRow): number | null => {
    if (view !== "total") return null;
    const old = gamification.lastWeekRanks.get(r.player_id);
    if (old === undefined) return null;
    return old - r.rank;
  };

  // Fenêtre passée au détail des points, alignée sur la vue affichée.
  const breakdownWindow =
    view === "total"
      ? { from: null, until: null, label: "Depuis le début" }
      : isPastWeek
        ? {
            from: selectedWeek.from,
            until: selectedWeek.until,
            label: `Semaine ${selectedWeek.index}`,
          }
        : { from: currentWeek?.from ?? null, until: null, label: "Cette semaine" };

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      <h1 className="mt-4 text-2xl font-bold">Classement</h1>

      <DuelCard
        player={player}
        players={players}
        entries={entries}
        gamification={gamification}
      />

      {/* Semaine / Général */}
      <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(
          [
            ["week", "Semaine"],
            ["total", "Général"],
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

      {/* Historique : une puce par semaine. Visible dès la 2e semaine. */}
      {view === "week" && weeks.length > 1 && (
        <div
          className="scrollbar-none -mx-5 mt-3 flex gap-2 overflow-x-auto px-5"
          role="tablist"
          aria-label="Choisir la semaine"
        >
          {weeks.map((w) => {
            const active = selectedWeek?.index === w.index;
            return (
              <button
                key={w.index}
                role="tab"
                aria-selected={active}
                onClick={() => setWeekIdx(w.current ? null : w.index)}
                className="min-h-9 shrink-0 rounded-full px-4 text-sm font-bold transition-colors"
                style={
                  active
                    ? { background: "var(--color-raised)", color: "var(--color-ink)" }
                    : { background: "var(--color-surface)", color: "var(--color-muted)" }
                }
              >
                {w.current ? "En cours" : `S${w.index}`}
              </button>
            );
          })}
        </div>
      )}

      {isPastWeek && rawRows === undefined && (
        <p className="mt-6 animate-pulse text-muted">Calcul en cours…</p>
      )}
      {isPastWeek && rawRows === null && (
        <p className="mt-6 text-muted">
          Impossible de charger cette semaine. Change de semaine et reviens.
        </p>
      )}

      {rawRows != null && (
        <>
          {/* Podium */}
          <div className="mt-5 flex items-end justify-center gap-6">
            {podiumOrder.map((r) => {
              const p = byId.get(r.player_id)!;
              const first = r.rank === 1;
              return (
                <button
                  key={r.player_id}
                  onClick={() => setDetail(r)}
                  aria-label={`Voir le détail des points de ${p.name}`}
                  className="flex flex-col items-center gap-1 rounded-xl p-1 transition-transform active:scale-95"
                >
                  <Avatar name={p.name} color={p.color} size={first ? 64 : 48} />
                  <span className="max-w-20 truncate text-sm font-bold">
                    {isPastWeek && first && r.points > 0 ? "🏆 " : ""}
                    {p.name}
                  </span>
                  <span
                    className={`num-display ${first ? "text-4xl" : "text-2xl"}`}
                    style={{ color: p.color }}
                  >
                    {fmtPoints(r.points)}
                  </span>
                  <span className="text-[10px] font-medium text-faint">
                    {frenchRank(r.rank)} · pts
                  </span>
                </button>
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
                <li key={r.player_id}>
                  <button
                    onClick={() => setDetail(r)}
                    aria-label={`Voir le détail des points de ${me ? "toi" : p.name}`}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-transform active:scale-[0.99]"
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
                        {/* current_streak = série d'aujourd'hui : hors sujet
                            sur une semaine passée, on ne l'affiche pas. */}
                        {!isPastWeek && r.current_streak > 0
                          ? `🔥 ${r.current_streak} · `
                          : ""}
                        {completion}% de complétion
                        {r.bonus_points > 0
                          ? ` · dont ${fmtPoints(r.bonus_points)} pts bonus`
                          : ""}
                      </p>
                    </div>
                    <span className="num-display text-xl">{fmtPoints(r.points)}</span>
                    <Variation delta={variation(r)} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {detail && byId.has(detail.player_id) && (
        <PlayerBreakdown
          player={byId.get(detail.player_id)!}
          row={detail}
          from={breakdownWindow.from}
          until={breakdownWindow.until}
          label={breakdownWindow.label}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
