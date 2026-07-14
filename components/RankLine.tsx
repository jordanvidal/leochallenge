"use client";

// La phrase qui fait faire les pompes : "3e — 47 pts — 6 pts derrière Marc".
// En haut de l'écran du jour, tappable vers le classement.

import { fmtPoints, frenchRank, Gamification } from "@/lib/gamification";
import { Player } from "@/lib/types";

type Props = {
  player: Player;
  players: Player[];
  gamification: Gamification | null;
  onGoLeaderboard: () => void;
};

export default function RankLine({
  player,
  players,
  gamification,
  onGoLeaderboard,
}: Props) {
  if (!gamification || players.length < 2) return null;
  const rows = [...gamification.total].sort((a, b) => a.rank - b.rank);
  const mine = rows.find((r) => r.player_id === player.id);
  if (!mine) return null;

  const names = new Map(players.map((p) => [p.id, p.name]));
  let phrase = `${frenchRank(mine.rank)} — ${fmtPoints(mine.points)} pts`;

  if (mine.rank === 1) {
    const runnerUp = rows.find((r) => r.player_id !== player.id);
    if (runnerUp) {
      const gap = mine.points - runnerUp.points;
      phrase +=
        gap > 0
          ? ` — ${fmtPoints(gap)} pts d'avance sur ${names.get(runnerUp.player_id)}`
          : ` — à égalité avec ${names.get(runnerUp.player_id)}`;
    }
  } else {
    // le joueur juste devant : le prochain à faire tomber
    const ahead = [...rows].reverse().find((r) => r.rank < mine.rank);
    if (ahead) {
      const gap = ahead.points - mine.points;
      phrase += ` — ${fmtPoints(gap)} pts derrière ${names.get(ahead.player_id)}`;
    }
  }

  return (
    <button
      onClick={onGoLeaderboard}
      className="mt-3 w-full rounded-2xl px-4 py-2.5 text-left text-sm font-bold"
      style={{
        background: `color-mix(in oklch, ${player.color} 10%, var(--color-surface))`,
        color: player.color,
      }}
    >
      🏆 {phrase}
    </button>
  );
}
