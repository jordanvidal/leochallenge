// Calculs de stats par joueur. Rien de plus que les 3 métriques de la phase 1,
// plus, pour le bilan de clôture, la meilleure série et les jours à zéro.

import { addDays, allChallengeDays, elapsedDays, parisToday } from "./challenge";
import { Entry, entryCount, entryKey, Player } from "./types";

export type PlayerStats = {
  perfectDays: number; // jours à 3/3
  completion: number; // % d'exos validés depuis le début du challenge
  streak: number; // jours consécutifs à 3/3, série en cours
  bestStreak: number; // plus longue série de tout le challenge
  zeroDays: number; // jours où rien n'a été coché
};

/** Une case de la ligne du temps du groupe : combien de joueurs parfaits ce jour. */
export type TimelineCell = { day: string; perfect: number };

/**
 * Stats d'un joueur sur l'ensemble des jours écoulés du challenge.
 * La série tolère un aujourd'hui incomplet : elle compte depuis hier
 * si le jour courant n'est pas (encore) parfait.
 */
export function computeStats(
  playerId: string,
  entries: Map<string, Entry>,
): PlayerStats {
  const days = elapsedDays(); // du plus récent au plus ancien
  if (days.length === 0)
    return { perfectDays: 0, completion: 0, streak: 0, bestStreak: 0, zeroDays: 0 };

  let perfectDays = 0;
  let done = 0;
  let zeroDays = 0;
  let run = 0;
  let bestStreak = 0;
  // `days` est contigu : une suite de jours parfaits dans la boucle = une vraie
  // série calendaire. On suit la plus longue au passage.
  for (const day of days) {
    const n = entryCount(entries.get(entryKey(playerId, day)));
    done += n;
    if (n === 3) {
      perfectDays++;
      run++;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
      if (n === 0) zeroDays++;
    }
  }
  const completion = Math.round((done / (days.length * 3)) * 100);

  // Série en cours : on remonte depuis aujourd'hui (ou hier si aujourd'hui
  // n'est pas complet) tant que les jours sont parfaits.
  let streak = 0;
  let cursor = parisToday();
  if (cursor > days[0]) cursor = days[0]; // challenge terminé : partir du dernier jour
  const isPerfect = (d: string) =>
    entryCount(entries.get(entryKey(playerId, d))) === 3;
  if (!isPerfect(cursor)) cursor = addDays(cursor, -1);
  while (cursor >= days[days.length - 1] && isPerfect(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return { perfectDays, completion, streak, bestStreak, zeroDays };
}

/**
 * La ligne du temps du groupe : pour chacun des 50 jours, combien de joueurs
 * ont été parfaits. Tout se calcule sur les entries déjà chargées.
 */
export function groupTimeline(
  players: Player[],
  entries: Map<string, Entry>,
): TimelineCell[] {
  return allChallengeDays().map((day) => {
    let perfect = 0;
    for (const p of players) {
      if (entryCount(entries.get(entryKey(p.id, day))) === 3) perfect++;
    }
    return { day, perfect };
  });
}
