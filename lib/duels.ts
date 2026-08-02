// Duels 1v1 hebdo : chaque lundi, les actifs sont appariés par rangs
// voisins ; le plus de jours parfaits d'ici dimanche prend 3 pts à
// l'autre (départage aux points de la semaine, sinon nul). Les jours
// parfaits sont plafonnés à 7 : entre assidus, ce sont les points —
// déplafonnés par les déclarations et les tirages — qui tranchent.
// La vérité est SQL (vue duel_results → daily_points) ; ce module
// duplique la règle pour l'affichage live — même précédent assumé
// que le CTE `active` recopié dans reminders.ts.

import { addDays, CHALLENGE_START, FENETRE_ENV, Fenetre, mondayOf } from "./challenge";
import { normalizeName } from "./palette";

/**
 * Prénoms tenus hors de l'appariement, lus depuis `DUELS_EXCLUS` (variable
 * serveur, prénoms séparés par des virgules — « Jerem, Hugo, Nathan »).
 *
 * Pourquoi une variable d'env et pas une colonne : un joueur qui décroche
 * n'a pas quitté la ligue. Il garde son classement, ses points, ses badges
 * et ses notifications ; on ne lui cherche simplement plus d'adversaire.
 * Le retirer du roster serait une autre décision, bien plus lourde.
 *
 * Et pourquoi le prénom plutôt que l'uuid : c'est la seule clé qui se tape
 * de mémoire dans un champ Vercel à 23h. La casse et les accents sont donc
 * pardonnés (`normalizeName`, la même normalisation que les doublons de
 * prénom côté client), et l'unicité du prénom par ligue en base garantit
 * qu'un prénom ne désigne qu'une personne.
 *
 * Portée : l'appariement du lundi, rien d'autre. Un duel déjà en cours va
 * jusqu'à son terme et se résout normalement — on n'efface pas une semaine
 * commencée.
 */
export function nomsExclus(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map(normalizeName)
      .filter((n) => n.length > 0),
  );
}

/**
 * Premier lundi de duels d'une ligue : sa 2e semaine. La semaine 1 sert à
 * établir un classement à apparier — sans elle, on apparierait au hasard.
 *
 * Conséquence à connaître : une ligue d'une ou deux semaines n'aura jamais de
 * duel, puisqu'il faut une semaine PLEINE après la première. Ce n'est pas un
 * oubli, c'est la règle appliquée telle quelle à une ligue courte. S'il faut
 * ouvrir les duels dès la semaine 1 sur les formats sprint, c'est une décision
 * produit, pas un ajustement de constante.
 */
export function duelsFrom(f: Fenetre = FENETRE_ENV): string {
  return addDays(mondayOf(f.start), 7);
}

/** Premier lundi de duels du challenge d'origine (le 20/07). */
export const DUELS_FROM = addDays(mondayOf(CHALLENGE_START), 7);

/** Montant du transfert, miroir de bonus_catalog('duel_hebdo'). */
export const DUEL_POINTS = 3;

export type Duel = {
  week_monday: string;
  player_a: string; // le mieux classé des deux à l'appariement
  player_b: string | null; // null = exempt (nombre impair)
};

// Les règles du duel (tally et vainqueur) vivent dans le moteur de score
// (lib/score.ts), avec les autres règles rejouées côté client. Ré-exportées
// ici pour que « les duels » restent un seul import — l'implémentation, elle,
// n'existe qu'à un endroit.
export { duelWinner, tallyDuel, type DuelTally } from "./score";

/** Le duel (ou l'exemption) d'un joueur pour un lundi donné. */
export function duelOf(
  duels: Duel[],
  playerId: string,
  weekMonday: string,
): Duel | null {
  return (
    duels.find(
      (d) =>
        d.week_monday === weekMonday &&
        (d.player_a === playerId || d.player_b === playerId),
    ) ?? null
  );
}

