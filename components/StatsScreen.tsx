"use client";

// Stats = le profil, pas un tableau de bord. Une grande carte pour soi, une
// ligne par pote.
//
// L'ancienne version alignait trois tuiles par joueur — jours parfaits,
// complétion, série. Les trois disaient la même chose : personne ne fait de
// journée partielle, donc « complétion » valait exactement « jours parfaits
// ÷ jours écoulés ». Huit cartes, un seul chiffre répété.
//
// Ce qui les remplace vient de données que l'app possédait déjà sans jamais
// les montrer : l'heure de chaque validation (le créneau) et la durée des
// séances guidées. Plus la meilleure série, calculée depuis le premier jour
// par computeStats et jamais affichée.

import { useEffect, useState } from "react";
import { elapsedDays } from "@/lib/challenge";
import { BADGES, Gamification } from "@/lib/gamification";
import {
  clockOf,
  fetchProfiles,
  hourCounts,
  Profile,
  slotLabel,
} from "@/lib/profile";
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

/**
 * La bande des 24 heures. Un cran par heure, haut comme le nombre de
 * validations tombées dedans. Ce n'est pas un graphique : il n'y a ni axe
 * ni valeur à lire, juste une forme — du matin ou du soir, régulier ou
 * dispersé. Les heures vides restent visibles en creux, sinon on ne voit
 * plus que le créneau ne couvre qu'un cinquième de la journée.
 */
function HourStrip({
  hours,
  color,
  height,
}: {
  hours: number[];
  color: string;
  height: number;
}) {
  const cells = hourCounts(hours);
  const peak = Math.max(1, ...cells);
  return (
    <div
      className="flex items-end gap-px"
      style={{ height }}
      aria-hidden
    >
      {cells.map((n, h) => (
        <span
          key={h}
          className="flex-1 rounded-[2px]"
          style={
            n === 0
              ? { height: 3, background: "var(--color-raised)" }
              : {
                  height: 3 + Math.round((n / peak) * (height - 3)),
                  background: color,
                  opacity: 0.45 + 0.55 * (n / peak),
                }
          }
        />
      ))}
    </div>
  );
}

function Fact({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex-1 rounded-xl bg-bg px-2.5 py-2">
      <p className="num-display text-xl">{value}</p>
      <p className="mt-0.5 text-[10px] leading-tight font-semibold text-muted">
        {label}
      </p>
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
  const [profiles, setProfiles] = useState<Map<string, Profile> | null>(null);
  useEffect(() => {
    fetchProfiles().then(setProfiles);
  }, []);

  const elapsed = elapsedDays().length;
  const mine = computeStats(player.id, entries);
  const myProfile = profiles?.get(player.id);
  const mySlot = myProfile ? slotLabel(myProfile.hours) : null;
  const myBadges = gamification?.badges.get(player.id) ?? [];
  const jokerDay = gamification?.total.find(
    (r) => r.player_id === player.id,
  )?.joker_day;

  // Les autres, du plus régulier au moins régulier. Pas par points : ce
  // serait le Classement en double, et ce n'est pas la question ici.
  const others = players
    .filter((p) => p.id !== player.id)
    .map((p) => ({ p, s: computeStats(p.id, entries) }))
    .sort((a, b) => b.s.bestStreak - a.s.bestStreak);

  return (
    <div className="flex min-h-full flex-col px-5 pt-safe">
      <h1 className="mt-4 mb-4 text-2xl font-bold">Stats</h1>

      {/* ---- Moi ---- */}
      <section
        className="rounded-3xl p-4"
        style={{
          background: `color-mix(in oklch, ${player.color} 8%, var(--color-surface))`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${player.color} 22%, transparent)`,
        }}
        aria-label="Ton profil"
      >
        <div className="flex items-center gap-2.5">
          <Avatar name={player.name} color={player.color} size={32} />
          <span className="font-bold">Toi</span>
          <span
            className="ml-auto text-base"
            title={
              jokerDay
                ? `Joker brûlé le ${jokerDay}`
                : "Joker de série disponible"
            }
            style={jokerDay ? { opacity: 0.35 } : undefined}
          >
            🛟
          </span>
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span
            className="num-display text-6xl"
            style={{ color: player.color }}
          >
            {mine.bestStreak}
          </span>
          <span className="text-xs leading-snug font-bold text-muted">
            jours d&apos;affilée
            <br />
            {mine.bestStreak === 0
              ? "ton record t'attend"
              : mine.streak === mine.bestStreak
                ? "ton record — et ta série en cours"
                : `ton record · en cours : ${mine.streak}`}
          </span>
        </div>

        {/* Le créneau : muet tant que le chargement n'a rien rendu, et
            définitivement absent pour qui n'a jamais bouclé une journée. */}
        {mySlot && myProfile && (
          <div className="mt-3.5">
            <div className="flex items-baseline justify-between text-[11px] font-semibold text-muted">
              <span>Ton créneau</span>
              <b className="text-xs text-ink">
                {mySlot.emoji} {mySlot.moment} · {mySlot.hour}
              </b>
            </div>
            <div className="mt-1.5">
              <HourStrip
                hours={myProfile.hours}
                color={player.color}
                height={26}
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[9px] font-semibold text-faint">
              <span>0 h</span>
              <span>6 h</span>
              <span>12 h</span>
              <span>18 h</span>
              <span>24 h</span>
            </div>
          </div>
        )}

        <div className="mt-3.5 flex gap-2">
          {myProfile?.fastestSeconds != null && (
            <Fact
              value={clockOf(myProfile.fastestSeconds)}
              label="ta séance la plus rapide"
            />
          )}
          <Fact
            value={
              <>
                {mine.perfectDays}
                <span className="text-[0.6em]"> / {elapsed}</span>
              </>
            }
            label="jours parfaits"
          />
          <Fact value="🛟" label={jokerDay ? "joker brûlé" : "joker intact"} />
        </div>

        {myBadges.length > 0 && <BadgeRow unlocked={myBadges} />}
      </section>

      {/* ---- Les autres ---- */}
      <h2 className="mt-5 mb-1 text-xs font-bold tracking-wide text-faint uppercase">
        Les autres · meilleure série
      </h2>
      <ul className="flex flex-1 flex-col">
        {others.map(({ p, s }) => {
          const prof = profiles?.get(p.id);
          const active = !!prof && prof.hours.length > 0;
          return (
            <li
              key={p.id}
              className="flex items-center gap-2.5 border-t border-line py-2 first:border-t-0"
            >
              <span
                className="w-16 shrink-0 truncate text-sm font-bold"
                style={{ color: active ? p.color : "var(--color-faint)" }}
              >
                {p.name}
              </span>
              {active ? (
                <>
                  <div className="min-w-0 flex-1">
                    <HourStrip hours={prof.hours} color={p.color} height={14} />
                  </div>
                  <span
                    className="num-display w-9 shrink-0 text-right text-base"
                    style={{ color: p.color }}
                  >
                    {s.bestStreak}
                    <span className="text-[0.55em] font-semibold text-muted">
                      {" "}
                      j
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[11px] text-faint">
                    pas encore de séance
                  </span>
                  <span className="w-9 shrink-0 text-right text-faint">—</span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <button
        onClick={onShareWeek}
        className="mt-4 mb-3 min-h-12 w-full rounded-2xl bg-surface text-sm font-bold"
      >
        Partager ma semaine 💬
      </button>
    </div>
  );
}

/** Les badges décrochés, sobres. Les verrouillés ne s'affichent pas :
    une liste de cases vides n'a jamais motivé personne. */
function BadgeRow({ unlocked }: { unlocked: string[] }) {
  const set = new Set(unlocked);
  const earned = BADGES.filter((b) => set.has(b.key));
  if (earned.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {earned.map((b) => (
        <span
          key={b.key}
          title={b.hint}
          className="rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ background: "var(--color-raised)", color: "var(--color-ink)" }}
        >
          {b.emoji} {b.label}
        </span>
      ))}
    </div>
  );
}
