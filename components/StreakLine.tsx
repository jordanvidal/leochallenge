"use client";

// La série, là où elle se joue : sous le rang, sur l'écran du jour.
// C'est la peur de casser la série qui fait la régularité — encore faut-il
// que celui qui hésite à 23h voie ce qu'il est en train de sauver.
// Une ligne de texte, rien d'animé : le 🔥 porte la chaleur, pas un confetti.

import { daysLeft } from "@/lib/challenge";
import { Gamification } from "@/lib/gamification";
import { Player } from "@/lib/types";

type Props = {
  player: Player;
  gamification: Gamification | null;
  perfect: boolean; // le 3/3 du jour est-il déjà fait ?
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

export default function StreakLine({ player, gamification, perfect }: Props) {
  const mine = gamification?.total.find((r) => r.player_id === player.id);
  if (!mine) return null;

  // current_streak inclut le jour même s'il est à 3/3, et reste vivant si le
  // dernier jour parfait est hier (la série ne casse qu'à minuit).
  const streak = mine.current_streak;
  if (streak === 0 && !perfect) return null; // rien à sauver, pas de ligne

  // Un palier futur n'est annoncé que s'il tombe avant le 31 août :
  // promettre un ×2 hors challenge serait un mensonge.
  const reachable = (inDays: number) => daysLeft() - 1 >= inDays;
  const inDaysLabel = (n: number) => (n === 1 ? "demain" : `dans ${n} j`);

  let phrase: string;
  if (perfect) {
    // Série à jour, on montre l'acquis et le prochain palier.
    const mult = multFor(streak);
    if (mult === 1) {
      const k = 3 - streak;
      phrase = reachable(k)
        ? `Série : ${streak} j — ×1,5 ${inDaysLabel(k)}`
        : `Série : ${streak} j`;
    } else if (mult === 1.5) {
      const k = 7 - streak;
      phrase = reachable(k)
        ? `Série : ${streak} j · ×1,5 — ×2 ${inDaysLabel(k)}`
        : `Série : ${streak} j · ×1,5`;
    } else {
      phrase = `Série : ${streak} j · ×2 sur tes points du jour`;
    }
  } else {
    // Série en jeu : dire ce que vaut le 3/3 de ce soir.
    const posIfDone = streak + 1;
    const multIfDone = multFor(posIfDone);
    if (multIfDone > 1) {
      phrase = `Série : ${streak} j en jeu — ton 3/3 vaut ${fmtMult(multIfDone)}`;
    } else {
      const k = 3 - posIfDone;
      phrase = reachable(k)
        ? `Série : ${streak} j en jeu — ×1,5 ${inDaysLabel(k)}`
        : `Série : ${streak} j en jeu`;
    }
  }

  return (
    <p className="mt-2 px-1 text-sm font-bold text-muted">
      <span aria-hidden>🔥</span> {phrase}
    </p>
  );
}
