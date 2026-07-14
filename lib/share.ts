// "Partager ma semaine" : un bloc de texte façon Wordle, prêt pour WhatsApp.
// Du texte et des emojis, pas d'image : ça se colle partout.

import {
  addDays,
  CHALLENGE_END,
  CHALLENGE_START,
  daysLeft,
  frenchDayMonth,
  mondayOf,
  parisToday,
} from "./challenge";
import { computeStats } from "./stats";
import { Entry, entryCount, entryKey } from "./types";
import { Player } from "./types";

/** Emoji d'un jour : plein = 3/3, partiel = 1-2, vide = 0 ou hors challenge. */
function daySquare(count: number): string {
  if (count === 3) return "🟩";
  if (count > 0) return "🟨";
  return "⬜";
}

/** Construit le message de la semaine en cours pour un joueur. */
export function buildWeekShare(
  player: Player,
  entries: Map<string, Entry>,
): string {
  const today = parisToday();
  const monday = mondayOf(today > CHALLENGE_END ? CHALLENGE_END : today);

  const squares: string[] = [];
  let perfect = 0;
  let elapsed = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const inChallenge =
      day >= CHALLENGE_START && day <= CHALLENGE_END && day <= today;
    if (!inChallenge) {
      squares.push("⬜");
      continue;
    }
    elapsed++;
    const n = entryCount(entries.get(entryKey(player.id, day)));
    if (n === 3) perfect++;
    squares.push(daySquare(n));
  }

  const { streak } = computeStats(player.id, entries);
  const left = daysLeft();

  return [
    `💪 Challenge 100-100-100 — Semaine du ${frenchDayMonth(monday)}`,
    `${player.name} — ${perfect}/${elapsed || 7} jours parfaits — série : ${streak}${streak > 0 ? " 🔥" : ""}`,
    "",
    "L M M J V S D",
    squares.join(" "),
    "",
    left > 0 ? `Plus que ${left} jour${left > 1 ? "s" : ""}` : "Challenge terminé 🏁",
  ].join("\n");
}

/**
 * Partage via le sélecteur natif si dispo (envoi direct WhatsApp),
 * sinon copie dans le presse-papier. Retourne le canal utilisé.
 */
export async function shareText(text: string): Promise<"share" | "clipboard"> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ text });
      return "share";
    } catch {
      // annulé ou refusé : on retombe sur le presse-papier
    }
  }
  await navigator.clipboard.writeText(text);
  return "clipboard";
}
