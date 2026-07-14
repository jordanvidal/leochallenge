"use client";

// L'écran par défaut, celui qui doit être parfait : trois grosses cartes,
// un tap = validé, retap = annulé. Ouvrir → cocher → fermer en 10 secondes.

import {
  CHALLENGE_END,
  daysLeft,
  frenchDate,
  parisToday,
} from "@/lib/challenge";
import {
  Entry,
  entryCount,
  entryKey,
  Exercise,
  EXERCISES,
  Player,
} from "@/lib/types";
import { Avatar, ExoDots } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  onToggle: (day: string, exo: Exercise) => void;
  onShareWeek: () => void;
  onInvite: () => void;
};

export default function TodayScreen({
  player,
  players,
  entries,
  onToggle,
  onShareWeek,
  onInvite,
}: Props) {
  const today = parisToday();
  const over = today > CHALLENGE_END;
  const left = daysLeft();
  const mine = entries.get(entryKey(player.id, today));
  const perfect = entryCount(mine) === 3;
  const others = players.filter((p) => p.id !== player.id);

  return (
    <div
      className={`flex flex-1 flex-col px-5 pt-safe ${perfect ? "celebrate-bg" : ""}`}
    >
      {/* Date + compte à rebours */}
      <header className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-muted first-letter:uppercase">
            {frenchDate(today)}
          </p>
          {over ? (
            <p className="num-display mt-1 text-4xl">Challenge terminé 🏁</p>
          ) : perfect ? (
            <p
              className="rise-in num-display mt-1 text-4xl"
              style={{ color: player.color }}
            >
              Jour parfait ✓
            </p>
          ) : (
            <p className="mt-1 text-2xl font-bold">100 · 100 · 100</p>
          )}
        </div>
        {!over && (
          <div className="text-right">
            <p className="num-display text-6xl">{left}</p>
            <p className="-mt-0.5 text-xs font-medium text-muted">
              jour{left > 1 ? "s" : ""} restant{left > 1 ? "s" : ""}
            </p>
          </div>
        )}
      </header>

      {/* Les trois cartes. Physiques, presque tactiles. */}
      {!over && (
        <div className="mt-5 flex flex-1 flex-col gap-3">
          {EXERCISES.map(({ key, label }) => {
            const done = mine?.[key] ?? false;
            return (
              <button
                key={key}
                aria-pressed={done}
                onClick={() => {
                  navigator.vibrate?.(done ? 8 : 18);
                  onToggle(today, key);
                }}
                className="exo-card flex min-h-24 flex-1 items-center justify-between rounded-3xl px-6 text-left"
                style={
                  done
                    ? {
                        background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                        boxShadow: `inset 0 0 0 2px color-mix(in oklch, ${player.color} 65%, transparent)`,
                      }
                    : {
                        background: "var(--color-surface)",
                        boxShadow: "inset 0 0 0 1px var(--color-line)",
                      }
                }
              >
                <span
                  className="text-2xl font-bold"
                  style={{ color: done ? player.color : "var(--color-ink)" }}
                >
                  {label}
                </span>
                {done ? (
                  <span
                    className="check-pop flex size-12 items-center justify-center rounded-full text-2xl font-bold"
                    style={{ background: player.color, color: "oklch(0.15 0 0)" }}
                    aria-hidden
                  >
                    ✓
                  </span>
                ) : (
                  <span className="num-display text-4xl text-faint" aria-hidden>
                    100
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {over && (
        <div className="mt-8 flex-1">
          <p className="text-lg text-muted">
            50 jours, c&apos;est plié. Va voir les stats pour le bilan.
          </p>
        </div>
      )}

      {/* La ligne des potes : c'est ça qui fait tenir le truc. */}
      <section className="mt-5 mb-3">
        {others.length > 0 ? (
          <>
            <h2 className="mb-2 text-xs font-bold tracking-wide text-faint uppercase">
              Les potes aujourd&apos;hui
            </h2>
            <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1">
              {others.map((p) => (
                <div
                  key={p.id}
                  className="flex shrink-0 flex-col items-center gap-1.5"
                >
                  <Avatar name={p.name} color={p.color} size={46} />
                  <span className="max-w-16 truncate text-xs font-medium text-muted">
                    {p.name}
                  </span>
                  <ExoDots
                    entry={entries.get(entryKey(p.id, today))}
                    color={p.color}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <button
            onClick={onInvite}
            className="w-full rounded-2xl border border-dashed border-line p-4 text-left"
          >
            <p className="font-bold">Tu es seul pour l&apos;instant</p>
            <p className="mt-1 text-sm text-muted">
              Envoie le lien au groupe, la pression sociale fait le reste →
            </p>
          </button>
        )}
      </section>

      <button
        onClick={onShareWeek}
        className="mb-3 min-h-12 w-full rounded-2xl bg-surface text-sm font-bold text-ink"
      >
        Partager ma semaine 💬
      </button>
    </div>
  );
}
