"use client";

// La ligne de statut : une seule phrase sous le header, tappable vers le
// classement. Rang et série cohabitent — et le soir, quand la série est
// en jeu, elle prend toute la place : c'est la peur de la casser qui fait
// cocher, pas l'écart de points. Le détail (écarts, paliers) vit au
// Classement, un tap plus loin.

import { daysLeft } from "@/lib/challenge";
import { fmtPoints, frenchRank, Gamification } from "@/lib/gamification";
import { Player } from "@/lib/types";

type Props = {
  player: Player;
  players: Player[];
  gamification: Gamification | null;
  perfect: boolean; // le 3/3 du jour est-il déjà fait ?
  onGoLeaderboard: () => void;
};

/** ×1 avant 3 jours parfaits consécutifs, ×1,5 dès 3, ×2 dès 7.
    Même barème que la vue daily_points — copie assumée, 3 lignes. */
function multFor(pos: number): number {
  return pos >= 7 ? 2 : pos >= 3 ? 1.5 : 1;
}

/** "×1,5" / "×2" */
function fmtMult(m: number): string {
  return `×${String(m).replace(".", ",")}`;
}

export default function RankLine({
  player,
  players,
  gamification,
  perfect,
  onGoLeaderboard,
}: Props) {
  if (!gamification || players.length < 2) return null;
  const rows = [...gamification.total].sort((a, b) => a.rank - b.rank);
  const mine = rows.find((r) => r.player_id === player.id);
  if (!mine) return null;

  // current_streak inclut le jour même s'il est à 3/3, et reste vivant si
  // le dernier jour parfait est hier (la série ne casse qu'à minuit).
  const streak = mine.current_streak;

  let emoji: string;
  let phrase: string;

  if (!perfect && streak > 0) {
    // La série est en jeu : la phrase du soir, celle qui fait cocher.
    emoji = "🔥";
    const posIfDone = streak + 1;
    const multIfDone = multFor(posIfDone);
    if (multIfDone > 1) {
      phrase = `Série : ${streak} j en jeu — ton 3/3 vaut ${fmtMult(multIfDone)}`;
    } else if (daysLeft() - 1 >= 3 - posIfDone) {
      // posIfDone < 3 ⇒ le ×1,5 tombe dans (3 - posIfDone) jours
      const k = 3 - posIfDone;
      phrase = `Série : ${streak} j en jeu — ×1,5 ${k === 1 ? "demain" : `dans ${k} j`}`;
    } else {
      phrase = `Série : ${streak} j en jeu`;
    }
  } else {
    emoji = "🏆";
    phrase = `${frenchRank(mine.rank)} · ${fmtPoints(mine.points)} pts`;
    if (streak > 0) {
      const mult = multFor(streak);
      phrase += ` · 🔥 ${streak} j${mult > 1 ? ` ${fmtMult(mult)}` : ""}`;
      // Le prochain palier n'est annoncé que s'il tombe demain (le hook le
      // plus fort) et avant la fin du challenge — pas de promesse en l'air.
      const next = streak < 3 ? 3 : streak < 7 ? 7 : null;
      if (next && next - streak === 1 && daysLeft() > 1) {
        phrase += ` — ${fmtMult(multFor(next))} demain`;
      }
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
      <span aria-hidden>{emoji}</span> {phrase}
    </button>
  );
}
