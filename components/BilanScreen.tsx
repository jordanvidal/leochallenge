"use client";

// La cérémonie de clôture. Le seul écran de l'app qu'on regarde au lieu de le
// taper : podium, carte de chaque joueur, ligne du temps du groupe, partage.
// Zéro recalcul de points ici — tout vient du RPC leaderboard() et des entries.

import {
  bilanProvisoire,
  CHALLENGE_DAYS,
  CHALLENGE_END,
  CHALLENGE_START,
  frenchDayMonth,
  hoursUntilFinalLock,
} from "@/lib/challenge";
import { BADGES, fmtPoints, frenchRank, Gamification, LeaderboardRow } from "@/lib/gamification";
import { computeStats, groupTimeline, PlayerStats, TimelineCell } from "@/lib/stats";
import { Entry, Player } from "@/lib/types";
import { Avatar, BigButton } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  gamification: Gamification | null;
  onShareFinal: () => void;
  onRematch: () => void;
  onGoHistory: () => void;
};

const GOLD = "oklch(0.82 0.15 85)"; // la couleur du groupe : ni un joueur, ni neutre
const frNum = (n: number) => n.toLocaleString("fr-FR");

/** Bandeau provisoire (1-2 sept.) ou définitif (dès le 3). */
function Banner({ onGoHistory }: { onGoHistory: () => void }) {
  if (!bilanProvisoire()) {
    return (
      <p className="mt-4 text-sm font-medium text-faint">🔒 Scores définitifs.</p>
    );
  }
  const h = hoursUntilFinalLock();
  return (
    <div
      className="mt-4 rounded-2xl p-4 text-sm"
      style={{ background: `color-mix(in oklch, ${GOLD} 14%, var(--color-surface))` }}
    >
      <p className="font-bold" style={{ color: GOLD }}>
        Scores provisoires
      </p>
      <p className="mt-1 text-muted">
        Il reste {h} h pour rattraper les 30 et 31 août.
      </p>
      <button
        onClick={onGoHistory}
        className="mt-2 min-h-8 font-bold"
        style={{ color: "var(--pc)" }}
      >
        Corriger dans l&apos;Historique →
      </button>
    </div>
  );
}

/** Le podium : les trois premiers en grand, ordre visuel 2 · 1 · 3. */
function Podium({ rows, byId }: { rows: LeaderboardRow[]; byId: Map<string, Player> }) {
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  return (
    <div className="mt-6 flex items-end justify-center gap-6">
      {order.map((r) => {
        const p = byId.get(r.player_id)!;
        const first = r.rank === 1;
        return (
          <div key={r.player_id} className="flex flex-col items-center gap-1.5">
            <Avatar name={p.name} color={p.color} size={first ? 76 : 54} />
            <span className="max-w-24 truncate text-sm font-bold">{p.name}</span>
            <span
              className={`num-display ${first ? "text-5xl" : "text-3xl"}`}
              style={{ color: p.color }}
            >
              {fmtPoints(r.points)}
            </span>
            <span className="text-[11px] font-medium text-faint">
              {frenchRank(r.rank)} · {r.perfect_days} j. parfaits
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Couleur d'une case selon le nombre de joueurs parfaits ce jour-là. */
function cellBg(perfect: number, total: number): string {
  if (perfect === 0) return "var(--color-surface)";
  const pct = Math.max(24, Math.round((perfect / Math.max(total, 1)) * 100));
  return `color-mix(in oklch, ${GOLD} ${pct}%, var(--color-line))`;
}

/** La bande des 50 jours, découpée en semaines pour se lire d'un coup d'œil. */
function TimelineBand({ cells, total }: { cells: TimelineCell[]; total: number }) {
  const weeks: TimelineCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">La ligne du groupe</h2>
      <p className="mt-1 text-xs text-muted">
        Une case par jour, plus c&apos;est doré, plus on était nombreux à tenir.
      </p>
      <div
        className="mt-3 flex gap-1.5"
        role="img"
        aria-label={`Jours parfaits du groupe sur les ${CHALLENGE_DAYS} jours du challenge`}
      >
        {weeks.map((week, wi) => (
          <div key={wi} className="flex gap-0.5" style={{ flexGrow: week.length }}>
            {week.map((c) => (
              <div
                key={c.day}
                title={`${frenchDayMonth(c.day)} · ${c.perfect}/${total} parfaits`}
                className="h-11 flex-1 rounded-[3px]"
                style={{ background: cellBg(c.perfect, total) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-faint">
        <span>personne</span>
        {[0, 0.4, 0.7, 1].map((f) => (
          <span
            key={f}
            className="h-3 w-3 rounded-[2px]"
            style={{ background: cellBg(Math.round(f * total), total) }}
          />
        ))}
        <span>tout le groupe</span>
      </div>
    </section>
  );
}

/** Une métrique de la carte joueur. `hero` = le gros chiffre mérité. */
function Metric(props: { value: string; label: string; hero?: boolean; color?: string }) {
  const { value, label, hero, color } = props;
  return (
    <div className={hero ? "col-span-2" : ""}>
      <p
        className={`num-display ${hero ? "text-5xl" : "text-3xl"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] font-medium text-muted">{label}</p>
    </div>
  );
}

/** Les badges d'un joueur : décrochés en clair, ratés grisés. Ce qu'on a raté
    fait partie de l'histoire. */
function Badges({ unlocked }: { unlocked: string[] }) {
  const set = new Set(unlocked);
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
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
                : { color: "var(--color-faint)", boxShadow: "inset 0 0 0 1px var(--color-line)", opacity: 0.55 }
            }
          >
            {b.emoji} {b.label}
          </span>
        );
      })}
    </div>
  );
}

/** La carte dépliable d'un joueur. Le leader s'ouvre par défaut. */
function PlayerCard(props: {
  player: Player;
  row: LeaderboardRow;
  stats: PlayerStats;
  badges: string[];
  open: boolean;
}) {
  const { player, row, stats, badges, open } = props;
  return (
    <details open={open} className="rounded-2xl bg-surface [&[open]_.chev]:rotate-180">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <span className="num-display w-6 text-xl text-faint">{row.rank}</span>
        <Avatar name={player.name} color={player.color} size={38} />
        <span className="min-w-0 flex-1 truncate font-bold">{player.name}</span>
        <span className="num-display text-xl" style={{ color: player.color }}>
          {fmtPoints(row.points)}
        </span>
        <svg className="chev transition-transform" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="px-4 pb-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Metric value={`${stats.perfectDays} / ${CHALLENGE_DAYS}`} label="jours parfaits" color={player.color} />
          <Metric value={`${stats.bestStreak}`} label="plus longue série" />
          <Metric value={frNum(row.exos_done * 100)} label="répétitions au total" hero />
          <Metric value={`${stats.zeroDays}`} label="jours à zéro" />
        </div>
        <Badges unlocked={badges} />
      </div>
    </details>
  );
}

export default function BilanScreen({
  player,
  players,
  entries,
  gamification,
  onShareFinal,
  onRematch,
  onGoHistory,
}: Props) {
  const range = `${frenchDayMonth(CHALLENGE_START)} → ${frenchDayMonth(CHALLENGE_END)}`;

  const header = (
    <header className="rise-in pt-safe">
      <p className="mt-4 text-sm font-medium text-muted">🏁 Challenge 100-100-100</p>
      <h1 className="mt-1 text-4xl font-bold">C&apos;est fini.</h1>
      <p className="mt-1 text-muted">
        {range} · {CHALLENGE_DAYS} jours
      </p>
      <Banner onGoHistory={onGoHistory} />
    </header>
  );

  if (!gamification) {
    return (
      <div className="flex flex-1 flex-col px-5">
        {header}
        <p className="mt-8 animate-pulse text-muted">Calcul du bilan…</p>
      </div>
    );
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [...gamification.total]
    .filter((r) => byId.has(r.player_id))
    .sort((a, b) => a.rank - b.rank);
  const timeline = groupTimeline(players, entries);

  return (
    <div className="flex flex-1 flex-col px-5 pb-8">
      {header}

      <Podium rows={rows} byId={byId} />

      <TimelineBand cells={timeline} total={players.length} />

      <section className="mt-8 flex flex-col gap-2">
        <h2 className="text-lg font-bold">Chaque joueur</h2>
        {rows.map((r, i) => {
          const p = byId.get(r.player_id)!;
          return (
            <PlayerCard
              key={r.player_id}
              player={p}
              row={r}
              stats={computeStats(p.id, entries)}
              badges={gamification.badges.get(p.id) ?? []}
              open={i === 0 || p.id === player.id}
            />
          );
        })}
      </section>

      <div className="mt-8">
        <BigButton onClick={onShareFinal}>Partager le bilan 🏁</BigButton>
      </div>

      <button
        onClick={onRematch}
        className="mx-auto mt-6 min-h-10 text-sm font-medium text-faint"
      >
        On remet ça en septembre ? →
      </button>
    </div>
  );
}
