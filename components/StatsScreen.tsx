"use client";

// Stats, une seule vue : jours parfaits, complétion, série en cours.
// Pas de classement, pas de points, pas de badges — c'est la phase 2.

import { computeStats } from "@/lib/stats";
import { Entry, Player } from "@/lib/types";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  onShareWeek: () => void;
};

function Metric({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex-1 text-center">
      <p className="num-display text-3xl" style={color ? { color } : undefined}>
        {value}
      </p>
      <p className="mt-1 text-[11px] font-medium text-muted">{label}</p>
    </div>
  );
}

export default function StatsScreen({
  player,
  players,
  entries,
  onShareWeek,
}: Props) {
  // Soi d'abord, puis l'ordre d'arrivée. Ce n'est pas un classement.
  const ordered = [player, ...players.filter((p) => p.id !== player.id)];

  return (
    <div className="flex min-h-full flex-col px-5 pt-safe">
      <h1 className="mt-4 mb-4 text-2xl font-bold">Stats</h1>

      <div className="flex flex-1 flex-col gap-3">
        {ordered.map((p) => {
          const s = computeStats(p.id, entries);
          return (
            <section
              key={p.id}
              className="rounded-2xl bg-surface p-4"
              aria-label={`Stats de ${p.name}`}
            >
              <div className="mb-3 flex items-center gap-3">
                <Avatar name={p.name} color={p.color} size={34} />
                <h2 className="text-lg font-bold">
                  {p.id === player.id ? "Toi" : p.name}
                </h2>
              </div>
              <div className="flex items-start">
                <Metric
                  value={String(s.perfectDays)}
                  label="jours parfaits"
                  color={p.color}
                />
                <Metric value={`${s.completion}%`} label="complétion" />
                <Metric
                  value={s.streak > 0 ? `${s.streak} 🔥` : "0"}
                  label="série en cours"
                />
              </div>
            </section>
          );
        })}
      </div>

      <button
        onClick={onShareWeek}
        className="mt-4 mb-3 min-h-12 w-full rounded-2xl bg-surface text-sm font-bold"
      >
        Partager ma semaine 💬
      </button>
    </div>
  );
}
