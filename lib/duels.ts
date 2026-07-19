// Duels 1v1 hebdo : chaque lundi, les actifs sont appariés par rangs
// voisins ; le plus de jours parfaits d'ici dimanche prend 3 pts à
// l'autre (départage aux points de la semaine, sinon nul). Les jours
// parfaits sont plafonnés à 7 : entre assidus, ce sont les points —
// déplafonnés par les déclarations et les tirages — qui tranchent.
// La vérité est SQL (vue duel_results → daily_points) ; ce module
// duplique la règle pour l'affichage live — même précédent assumé
// que le CTE `active` recopié dans reminders.ts.

import { addDays, CHALLENGE_START, mondayOf } from "./challenge";
import { Entry, entryCount, entryKey } from "./types";

/** Premier lundi de duels : la 2e semaine du challenge (le 20/07 ici).
    La semaine 1 sert à établir un classement à apparier. */
export const DUELS_FROM = addDays(mondayOf(CHALLENGE_START), 7);

/** Montant du transfert, miroir de bonus_catalog('duel_hebdo'). */
export const DUEL_POINTS = 3;

/** Ouverture de l'annonce in-app des duels : la veille du 1er tirage à 19h
    Paris (17h UTC en CEST), alignée sur la notif push GitHub Actions. Avant
    ce moment la modale reste muette — sinon elle s'affiche en avance. */
export const DUELS_ANNOUNCE_FROM = new Date(
  `${addDays(DUELS_FROM, -1)}T17:00:00Z`,
);

export type Duel = {
  week_monday: string;
  player_a: string; // le mieux classé des deux à l'appariement
  player_b: string | null; // null = exempt (nombre impair)
};

export type DuelTally = {
  perfectA: number;
  perfectB: number;
};

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

/** Jours parfaits de chaque camp sur [from, to], bornes incluses.
    Se calcule depuis la Map entries déjà en mémoire (et en realtime) —
    aucun aller-retour serveur. */
export function tallyDuel(
  entries: Map<string, Entry>,
  duel: Duel,
  from: string,
  to: string,
): DuelTally {
  const t: DuelTally = { perfectA: 0, perfectB: 0 };
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const a = entryCount(entries.get(entryKey(duel.player_a, day)));
    if (a === 3) t.perfectA++;
    if (duel.player_b) {
      const b = entryCount(entries.get(entryKey(duel.player_b, day)));
      if (b === 3) t.perfectB++;
    }
  }
  return t;
}

/** Même règle que la vue duel_results : jours parfaits, puis points de
    la semaine (le classement hebdo, hors transferts), sinon nul. */
export function duelWinner(
  t: DuelTally,
  pointsA: number,
  pointsB: number,
): "a" | "b" | null {
  if (t.perfectA !== t.perfectB) return t.perfectA > t.perfectB ? "a" : "b";
  if (pointsA !== pointsB) return pointsA > pointsB ? "a" : "b";
  return null;
}
