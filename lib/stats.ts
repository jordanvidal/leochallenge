// Calculs de stats par joueur. Rien de plus que les 3 métriques de la phase 1,
// plus, pour le bilan de clôture, la meilleure série et les jours à zéro.

import {
  addDays,
  allChallengeDays,
  elapsedDays,
  FENETRE_ENV,
  Fenetre,
  parisToday,
} from "./challenge";
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
 * Stats d'un joueur sur l'ensemble des jours écoulés de sa ligue.
 * La série tolère un aujourd'hui incomplet : elle compte depuis hier
 * si le jour courant n'est pas (encore) parfait.
 *
 * `jokerDay` — le jour où le joueur a brûlé son joker, s'il l'a brûlé.
 * Sans lui, ce calcul contredit le serveur, et pas qu'un peu : le RPC
 * `leaderboard` construit la série sur des îlots de jours **conservés**,
 * parfaits OU sauvés par le joker (supabase/migration38-app-scoring.sql,
 * CTE `kept` → `islands` → `streaks`), tandis qu'ici tout jour non
 * parfait cassait la série. Un joueur dont le joker avait pontifié un
 * jour manqué voyait 🔥17 au Classement et « 9 j » aux Stats.
 *
 * Le serveur a raison, et c'est la doctrine du produit : un jour sauvé
 * n'est pas un jour manqué — c'est exactement pourquoi l'historique le
 * marque d'une bouée. Le joker tient donc la chaîne sans la faire
 * avancer : il ne casse pas l'îlot, et il ne compte pas comme un jour
 * parfait (le serveur ne numérote que les jours parfaits).
 */
export function computeStats(
  playerId: string,
  entries: Map<string, Entry>,
  f: Fenetre = FENETRE_ENV,
  jokerDay: string | null = null,
): PlayerStats {
  const days = elapsedDays(f); // du plus récent au plus ancien
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
      if (n === 0) zeroDays++;
      // Le jour du joker reste un jour à zéro — il l'est — mais il ne
      // coupe pas l'îlot. C'est tout ce que le joker fait.
      if (day !== jokerDay) run = 0;
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
  /** Ce qui tient la chaîne : un jour parfait, ou le jour du joker. */
  const tientLaChaine = (d: string) => isPerfect(d) || d === jokerDay;
  if (!tientLaChaine(cursor)) cursor = addDays(cursor, -1);
  while (cursor >= days[days.length - 1] && tientLaChaine(cursor)) {
    if (isPerfect(cursor)) streak++;
    cursor = addDays(cursor, -1);
  }
  return { perfectDays, completion, streak, bestStreak, zeroDays };
}

/**
 * La série en sursis : ce que le serveur ne peut pas encore dire.
 *
 * Le joker est dérivé de l'historique (migration 24) et ne peut se
 * déclencher qu'une fois le retour joué — un joker qui ne recolle rien
 * n'existe pas. Conséquence : le matin qui suit le trou, `leaderboard()`
 * rend encore `current_streak = 0` et `joker_day = null`. L'app annonce
 * donc à celui qui vient de casser une série de 14 que tout est perdu ET
 * que son joker est intact, deux phrases qu'un 3/3 dans la journée rendra
 * fausses. C'est le moment de décrochage que le joker existe pour couvrir,
 * et le seul où il est invisible.
 *
 * Cette fonction rend le nombre de jours en sursis, 0 s'il n'y a rien à
 * sauver. Elle recopie les trois conditions de la CTE `joker` : joker
 * jamais brûlé, exactement un jour manqué (hier), au moins 3 jours
 * parfaits juste avant lui. Copie assumée et bornée — elle annonce, elle
 * n'accorde rien. Le serveur reste seul à décider ce soir si le joker
 * part ; au pire cette phrase aura promis un filet qui tombe quand même,
 * jamais l'inverse.
 */
export function streakEnSursis(
  playerId: string,
  entries: Map<string, Entry>,
  jokerDay: string | null | undefined,
  today: string,
  f: Fenetre = FENETRE_ENV,
): number {
  // undefined = on ne sait pas encore (ligne ou colonne absente) ; une date
  // = déjà brûlé. Dans les deux cas on se tait, comme la tuile des Stats.
  if (jokerDay !== null) return 0;

  const isPerfect = (d: string) =>
    entryCount(entries.get(entryKey(playerId, d))) === 3;

  // Le 3/3 est fait : le serveur a repris la main, il dit la vérité.
  if (isPerfect(today)) return 0;

  // Le trou, c'est hier — et hier seulement. Deux jours ratés d'affilée et
  // la série tombe pour de bon, joker ou pas.
  const trou = addDays(today, -1);
  if (trou < f.start || isPerfect(trou)) return 0;

  let sursis = 0;
  for (
    let d = addDays(trou, -1);
    d >= f.start && isPerfect(d);
    d = addDays(d, -1)
  ) {
    sursis++;
  }
  // Sous 3 jours parfaits, le joker ne part pas : il n'y a rien à sauver et
  // le brûler serait du gâchis. Même seuil que le ×1,5.
  return sursis >= 3 ? sursis : 0;
}

/**
 * La ligne du temps du groupe : pour chaque jour de la ligue, combien de
 * joueurs ont été parfaits. Tout se calcule sur les entries déjà chargées.
 */
export function groupTimeline(
  players: Player[],
  entries: Map<string, Entry>,
  f: Fenetre = FENETRE_ENV,
): TimelineCell[] {
  return allChallengeDays(f).map((day) => {
    let perfect = 0;
    for (const p of players) {
      if (entryCount(entries.get(entryKey(p.id, day))) === 3) perfect++;
    }
    return { day, perfect };
  });
}
