"use client";

// Stats par joueur : jours parfaits, complétion, série — et les badges
// (phase 2), débloqués automatiquement, sobres. Le profil, c'est ici.

import { BADGES, Gamification } from "@/lib/gamification";
import { computeStats } from "@/lib/stats";
import { Entry, Player } from "@/lib/types";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  gamification: Gamification | null;
  onShareWeek: () => void;
};

/** Rangée des 8 badges d'un joueur : obtenus en clair, verrouillés grisés.
    Même vue pour soi et pour les autres — c'est la comparaison qui motive. */
function BadgeRow({ unlocked }: { unlocked: string[] }) {
  const set = new Set(unlocked);
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {BADGES.map((b) => {
        const has = set.has(b.key);
        return (
          <span
            key={b.key}
            title={b.hint}
            className="rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={
              has
                ? { background: "var(--color-raised)", color: "var(--color-ink)" }
                : { color: "var(--color-faint)", boxShadow: "inset 0 0 0 1px var(--color-line)", opacity: 0.6 }
            }
          >
            {b.emoji} {b.label}
          </span>
        );
      })}
    </div>
  );
}

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
  gamification,
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
              <BadgeRow unlocked={gamification?.badges.get(p.id) ?? []} />
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
