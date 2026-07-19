"use client";

// Le duel de la semaine, en haut du classement : ton adversaire, le
// score en jours parfaits, l'enjeu. Le tally se calcule depuis la Map
// entries déjà en mémoire — le realtime la fait vivre, la carte suit
// sans aucun fetch. La vérité des points reste SQL (duel_results).

import { addDays, mondayOf, parisToday } from "@/lib/challenge";
import { DUEL_POINTS, DUELS_FROM, duelOf, tallyDuel } from "@/lib/duels";
import { fmtPoints, Gamification } from "@/lib/gamification";
import { Entry, Player } from "@/lib/types";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  gamification: Gamification;
};

export default function DuelCard({ player, players, entries, gamification }: Props) {
  const today = parisToday();
  const monday = mondayOf(today);
  if (monday < DUELS_FROM) return null;

  const duel = duelOf(gamification.duels, player.id, monday);
  if (!duel) return null;

  if (duel.player_b === null) {
    return (
      <div className="mt-3 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
        ⚔️ Exempt cette semaine — tu regardes les autres se battre.
      </div>
    );
  }

  const iAmA = duel.player_a === player.id;
  const oppId = iAmA ? duel.player_b : duel.player_a;
  const opp = players.find((p) => p.id === oppId);
  if (!opp) return null;

  const sunday = addDays(monday, 6);
  const t = tallyDuel(entries, duel, monday, today < sunday ? today : sunday);
  const mine = iAmA ? t.perfectA : t.perfectB;
  const theirs = iAmA ? t.perfectB : t.perfectA;
  // Le départage : les points de la semaine, ceux du classement hebdo.
  // Rafraîchis au fetch (pas en realtime) — indicatif, la vérité est SQL.
  const myPts = gamification.week.find((r) => r.player_id === player.id)?.points ?? 0;
  const theirPts = gamification.week.find((r) => r.player_id === oppId)?.points ?? 0;

  return (
    <div
      className="mt-3 rounded-2xl px-4 py-3"
      style={{
        background: `color-mix(in oklch, ${player.color} 10%, var(--color-surface))`,
      }}
      aria-label={`Duel de la semaine contre ${opp.name} : ${mine} jours parfaits à ${theirs}`}
    >
      <p className="text-xs font-bold text-muted">
        ⚔️ Duel de la semaine · le gagnant prend {DUEL_POINTS} pts à l&apos;autre
        dimanche soir
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={player.name} color={player.color} size={36} />
          <span className="truncate font-bold">Toi</span>
        </div>
        <span className="num-display shrink-0 text-3xl">
          <span style={{ color: player.color }}>{mine}</span>
          <span className="text-faint"> – </span>
          <span style={{ color: opp.color }}>{theirs}</span>
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-bold">{opp.name}</span>
          <Avatar name={opp.name} color={opp.color} size={36} />
        </div>
      </div>
      {mine === theirs && (
        <p className="mt-1.5 text-center text-xs text-muted">
          Égalité — le départage se joue aux points de la semaine :{" "}
          {fmtPoints(myPts)} à {fmtPoints(theirPts)}
        </p>
      )}
    </div>
  );
}
