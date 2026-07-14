// Calculs de stats par joueur. Rien de plus que les 3 métriques de la phase 1.

import { addDays, elapsedDays, parisToday } from "./challenge";
import { Entry, entryCount, entryKey } from "./types";

export type PlayerStats = {
  perfectDays: number; // jours à 3/3
  completion: number; // % d'exos validés depuis le début du challenge
  streak: number; // jours consécutifs à 3/3, série en cours
};

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
  if (days.length === 0) return { perfectDays: 0, completion: 0, streak: 0 };

  let perfectDays = 0;
  let done = 0;
  for (const day of days) {
    const n = entryCount(entries.get(entryKey(playerId, day)));
    done += n;
    if (n === 3) perfectDays++;
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
  return { perfectDays, completion, streak };
}
