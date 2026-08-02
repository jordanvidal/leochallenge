// LE moteur de score côté client — une seule vérité pour les règles.
//
// Jusqu'ici, chaque écran recopiait sa part des règles : la série vivait
// dans lib/stats.ts (sans joker ni jour off), le multiplicateur dans
// RankLine, le vainqueur de duel dans lib/duels.ts, l'ordre du classement
// dans lib/gamification.ts. Chaque nouvelle règle (joker, jour off…)
// obligeait à réaligner ces copies une à une — et chaque oubli, c'est un
// écran qui ment.
//
// Ce module rassemble TOUTES ces règles, alignées sur la vérité serveur :
// les vues SQL de supabase/migration46-bareme-s4.sql (et migration38 pour
// le schéma des ligues). Chaque fonction dit quelle CTE elle recopie.
// Copies assumées et testées (tests/score-*.test.ts) — le serveur reste
// seul à CALCULER les points (RPC leaderboard) ; ici vivent les règles
// que le client doit rejouer pour afficher sans mentir : séries, joker,
// jour off, barème par saison, duels, ordre du classement.
//
// Tout est pur : entrées en paramètres, aucun accès réseau, aucune
// lecture d'horloge cachée (le « aujourd'hui » s'injecte pour les tests).

import {
  addDays,
  allChallengeDays,
  aUneBasculeDeBareme,
  elapsedDays,
  FENETRE_ENV,
  Fenetre,
  parisToday,
  SAISON4_START,
} from "./challenge";
import type { Duel } from "./duels";
import { Entry, entryCount, entryKey } from "./types";

// ---------------------------------------------------------------------------
// Le barème, par saison
// ---------------------------------------------------------------------------
// Les valeurs sont celles des vues SQL — la base du jour et ses paliers.
// Les montants des bonus (duel, semaine pleine, événements…) ne sont PAS
// ici : ils vivent dans bonus_catalog, en base, et les écrans les lisent
// de là. On n'encode que ce que le client rejoue.

export type Saison = "S1S2" | "S3" | "S4";

export type Bareme = {
  saison: Saison;
  /** 1 point par exo coché — stable depuis le premier jour. */
  pointParExo: number;
  /** La prime du 3/3 : +2 jusqu'au 26/07, +4 depuis la S3. */
  primeJourParfait: number;
  /** ×1,5 dès ce nombre de jours parfaits consécutifs. */
  seuilMult15: number;
  /** ×2 dès ce nombre — et ça ne monte plus. */
  seuilMult2: number;
  /** 😴 Le jour off hebdo existe-t-il ? S4 uniquement, et uniquement sur
      le challenge d'origine — les ligues neuves restent en S3 pur. */
  jourOffActif: boolean;
};

/**
 * La saison d'un jour donné, pour une fenêtre donnée.
 *
 * La S4 n'existe que sur une fenêtre qui a connu une bascule de barème en
 * cours de route — le challenge d'origine, et lui seul (même garde que
 * `saison4Started`, mais sur un jour arbitraire plutôt qu'aujourd'hui) :
 * une ligue neuve naît en S3 et y reste, son schéma n'a pas la table
 * `jours_off` ni les deux événements S4.
 */
export function saisonDe(day: string, f: Fenetre = FENETRE_ENV): Saison {
  if (aUneBasculeDeBareme(f) && day >= SAISON4_START) return "S4";
  return day >= f.saison3 ? "S3" : "S1S2";
}

/** Le barème en vigueur un jour donné. */
export function baremeDe(day: string, f: Fenetre = FENETRE_ENV): Bareme {
  const saison = saisonDe(day, f);
  return {
    saison,
    pointParExo: 1,
    primeJourParfait: saison === "S1S2" ? 2 : 4,
    seuilMult15: 3,
    seuilMult2: 7,
    jourOffActif: saison === "S4",
  };
}

/** ×1 avant 3 jours parfaits consécutifs, ×1,5 dès 3, ×2 dès 7. Les seuils
    n'ont pas bougé d'une saison à l'autre — miroir du `case` de la vue
    daily_points. */
export function multiplicateurSerie(streakPos: number): number {
  return streakPos >= 7 ? 2 : streakPos >= 3 ? 1.5 : 1;
}

// ---------------------------------------------------------------------------
// La série : jours parfaits, joker, jour off
// ---------------------------------------------------------------------------
// Miroir des CTE kept0 → streaks de daily_points (migration 46) :
//   · un jour parfait allonge la série ;
//   · le jour off (😴, S4) la PRÉSERVE sans l'allonger — 6 parfaits autour
//     d'un repos font 6, pas 7. Qui s'entraîne quand même a un vrai 3/3 ;
//   · le joker (migration 24) recolle UNE fois un trou d'un jour après une
//     série d'au moins 3, si le joueur est revenu juste derrière. Le jour
//     sauvé ne compte pas non plus dans la position.

/** Ce que la chaîne d'un joueur permet d'afficher. */
export type Serie = {
  /** La série en cours, au sens du classement : vivante tant que le
      dernier jour qui tient la chaîne date d'hier ou d'aujourd'hui. */
  streak: number;
  /** La plus longue série du challenge, joker et jours off enjambés. */
  bestStreak: number;
  /** Le jour recollé par le joker, dérivé des coches — null si le joker
      n'est pas (encore) parti. Même dérivation que la CTE `joker`. */
  jokerDay: string | null;
};

type Chaine = Serie & {
  /** Position de série de chaque jour parfait (streak_pos). */
  posParJour: Map<string, number>;
};

/** entryCount == 3 sur la map partagée. */
function parfait(
  playerId: string,
  entries: Map<string, Entry>,
  day: string,
): boolean {
  return entryCount(entries.get(entryKey(playerId, day))) === 3;
}

/**
 * Rejoue la chaîne complète d'un joueur sur les jours écoulés.
 *
 * `joursOff` est le tirage du calendrier (table jours_off) : le même pour
 * tout le monde, vide avant la S4 et hors du challenge d'origine — absent,
 * tout se réduit mot pour mot au calcul d'avant, comme côté SQL.
 */
function chaineDuJoueur(
  playerId: string,
  entries: Map<string, Entry>,
  days: string[], // jours écoulés, ordre chronologique
  joursOff: ReadonlySet<string>,
  refDay: string, // le « aujourd'hui » du calcul (clampé à la fin de ligue)
): Chaine {
  const estParfait = (d: string) => parfait(playerId, entries, d);
  // Un jour off où l'on a fait son 3/3 est un vrai jour parfait, pas un
  // repos — même exclusion que la CTE `offs`.
  const estOff = (d: string) => joursOff.has(d) && !estParfait(d);

  // 1. Le joker, dérivé : le PREMIER trou d'un jour (ni parfait, ni off)
  //    qui interrompt une série d'au moins 3 jours parfaits (jours off
  //    enjambés), avec un retour parfait au premier jour non-off suivant.
  let jokerDay: string | null = null;
  {
    let run = 0; // position de base (parfaits seulement, îles off comprises)
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (estParfait(d)) {
        run++;
        continue;
      }
      if (estOff(d)) continue; // le repos n'interrompt pas l'île
      // d est un trou. Le joker part-il ici ?
      if (run >= 3) {
        // « Le lendemain » saute un éventuel jour off — il n'y en a
        // jamais deux d'affilée (un par semaine, jamais le week-end).
        let j = i + 1;
        while (j < days.length && estOff(days[j])) j++;
        if (j < days.length && estParfait(days[j])) {
          jokerDay = d;
          break; // un seul joker pour tout le challenge
        }
      }
      run = 0; // trou non recollé : l'île casse
    }
  }

  // 2. La chaîne finale : parfaits + offs + jour joker. streak_pos ne
  //    compte que les parfaits (WHERE avant la fenêtre, côté SQL).
  const posParJour = new Map<string, number>();
  let run = 0;
  let bestStreak = 0;
  let lastPerfectPos = 0;
  let lastKept: string | null = null;
  let prevTientLaChaine = false; // hier était parfait ou joker ?
  for (const d of days) {
    if (estParfait(d)) {
      run++;
      posParJour.set(d, run);
      if (run > bestStreak) bestStreak = run;
      lastPerfectPos = run;
      lastKept = d;
      prevTientLaChaine = true;
    } else if (d === jokerDay) {
      // Le jour sauvé entre dans l'île sans consommer de rang.
      lastKept = d;
      prevTientLaChaine = true;
    } else if (estOff(d)) {
      // Le repos préserve l'île. Mais il n'est « un dernier jour qui
      // tient la chaîne » que s'il prolonge VRAIMENT quelque chose :
      // le jour off est distribué à tout le monde, y compris à qui a
      // arrêté depuis trois semaines — sans l'adjacence, le classement
      // ressusciterait une série morte (voir last_kept, migration 46).
      if (prevTientLaChaine) lastKept = d;
      prevTientLaChaine = false;
    } else {
      run = 0;
      prevTientLaChaine = false;
    }
  }

  // 3. La série en cours : la position du dernier jour parfait, si le
  //    dernier jour qui tient la chaîne date d'hier ou d'aujourd'hui —
  //    la série ne casse qu'à minuit (leaderboard(), migration 46).
  const streak =
    lastKept !== null && lastKept >= addDays(refDay, -1) ? lastPerfectPos : 0;

  return { streak, bestStreak, jokerDay, posParJour };
}

/**
 * La série d'un joueur, seule. Pour la ligne de statut et les tests —
 * les écrans de stats passent par `computeStats`, qui la comprend.
 */
export function computeSerie(
  playerId: string,
  entries: Map<string, Entry>,
  f: Fenetre = FENETRE_ENV,
  joursOff: ReadonlySet<string> = new Set(),
): Serie {
  const days = elapsedDays(f);
  if (days.length === 0) return { streak: 0, bestStreak: 0, jokerDay: null };
  const asc = [...days].reverse();
  let ref = parisToday();
  if (ref > asc[asc.length - 1]) ref = asc[asc.length - 1];
  const { streak, bestStreak, jokerDay } = chaineDuJoueur(
    playerId,
    entries,
    asc,
    joursOff,
    ref,
  );
  return { streak, bestStreak, jokerDay };
}

// ---------------------------------------------------------------------------
// Les stats d'un joueur (Bilan, Stats, partage)
// ---------------------------------------------------------------------------

export type PlayerStats = {
  perfectDays: number; // jours à 3/3 (un jour off sans coche n'en est pas un)
  completion: number; // % d'exos validés depuis le début du challenge
  streak: number; // jours consécutifs à 3/3, série en cours (joker + off)
  bestStreak: number; // plus longue série du challenge (joker + off)
  zeroDays: number; // jours à rien — un jour off n'est pas un jour raté
};

/**
 * Stats d'un joueur sur l'ensemble des jours écoulés de sa ligue.
 *
 * Les séries suivent la vérité serveur : le joker et le jour off les
 * préservent sans les allonger. `perfectDays` et `completion` ne bougent
 * pas (un repos ne fabrique ni 3/3 ni exo coché — mêmes agrégats que la
 * RPC leaderboard). `zeroDays` exclut les jours off : le serveur dit
 * « un jour off n'est pas une faute » (badge sans_faute, migration 46),
 * le bilan ne va pas le compter comme un jour raté.
 */
export function computeStats(
  playerId: string,
  entries: Map<string, Entry>,
  f: Fenetre = FENETRE_ENV,
  joursOff: ReadonlySet<string> = new Set(),
): PlayerStats {
  const days = elapsedDays(f); // du plus récent au plus ancien
  if (days.length === 0)
    return { perfectDays: 0, completion: 0, streak: 0, bestStreak: 0, zeroDays: 0 };

  let perfectDays = 0;
  let done = 0;
  let zeroDays = 0;
  for (const day of days) {
    const n = entryCount(entries.get(entryKey(playerId, day)));
    done += n;
    if (n === 3) perfectDays++;
    else if (n === 0 && !joursOff.has(day)) zeroDays++;
  }
  const completion = Math.round((done / (days.length * 3)) * 100);

  const { streak, bestStreak } = computeSerie(playerId, entries, f, joursOff);
  return { perfectDays, completion, streak, bestStreak, zeroDays };
}

// ---------------------------------------------------------------------------
// La série en sursis : ce que le serveur ne peut pas encore dire
// ---------------------------------------------------------------------------

/**
 * Le joker est dérivé de l'historique (migration 24) et ne se déclenche
 * qu'une fois le retour joué — un joker qui ne recolle rien n'existe pas.
 * Conséquence : le matin qui suit le trou, `leaderboard()` rend encore
 * `current_streak = 0` et `joker_day = null`. Cette fonction rend le
 * nombre de jours encore rattrapables, 0 s'il n'y a rien à sauver. Elle
 * recopie les conditions de la CTE `joker` (version migration 46, jours
 * off enjambés) — elle annonce, elle n'accorde rien : le serveur reste
 * seul à décider ce soir si le joker part.
 *
 * `jokerDay` vient du classement : `undefined` = on ne sait pas encore
 * (ligne ou colonne absente), une date = déjà brûlé. Dans les deux cas on
 * se tait, comme la tuile des Stats.
 */
export function streakEnSursis(
  playerId: string,
  entries: Map<string, Entry>,
  jokerDay: string | null | undefined,
  today: string,
  f: Fenetre = FENETRE_ENV,
  joursOff: ReadonlySet<string> = new Set(),
): number {
  if (jokerDay !== null) return 0;

  const estParfait = (d: string) => parfait(playerId, entries, d);
  // Le 3/3 est fait : le serveur a repris la main, il dit la vérité.
  if (estParfait(today)) return 0;

  const estOff = (d: string) => joursOff.has(d) && !estParfait(d);

  // Le trou : le premier jour non-off en remontant depuis hier. Un jour
  // off n'est pas une cassure — il n'y a rien à racheter (CTE joker, S4).
  let trou = addDays(today, -1);
  while (trou >= f.start && estOff(trou)) trou = addDays(trou, -1);
  if (trou < f.start || estParfait(trou)) return 0;

  // La série d'avant le trou, jours off enjambés. Deux jours ratés
  // d'affilée et elle est tombée pour de bon, joker ou pas.
  let sursis = 0;
  for (let d = addDays(trou, -1); d >= f.start; d = addDays(d, -1)) {
    if (estOff(d)) continue;
    if (!estParfait(d)) break;
    sursis++;
  }
  // Sous 3 jours parfaits, le joker ne part pas : il n'y a rien à sauver
  // et le brûler serait du gâchis. Même seuil que le ×1,5.
  return sursis >= 3 ? sursis : 0;
}

// ---------------------------------------------------------------------------
// La ligne du temps du groupe (Bilan)
// ---------------------------------------------------------------------------

/** Une case de la ligne du temps : combien de joueurs parfaits ce jour. */
export type TimelineCell = { day: string; perfect: number };

/** Pour chaque jour de la ligue (à venir compris — cases vides du Bilan),
    combien de joueurs ont été parfaits. Purement factuel : le jour off
    n'invente de 3/3 pour personne. */
export function groupTimeline(
  players: { id: string }[],
  entries: Map<string, Entry>,
  f: Fenetre = FENETRE_ENV,
): TimelineCell[] {
  return allChallengeDays(f).map((day) => {
    let perfect = 0;
    for (const p of players) {
      if (parfait(p.id, entries, day)) perfect++;
    }
    return { day, perfect };
  });
}

// ---------------------------------------------------------------------------
// Le classement : l'ordre d'affichage
// ---------------------------------------------------------------------------

/**
 * L'ordre d'affichage d'un classement. `leaderboard()` n'a pas d'ORDER BY :
 * le tri porte sur `rank`, que le serveur calcule, et le nom départage les
 * ex æquo — sans ce second critère, deux joueurs à égalité échangent leur
 * place d'un rechargement à l'autre, et le podium du bilan hebdo peut
 * contredire celui du Classement au même instant.
 */
export function ordonneClassement<T extends { player_id: string; rank: number }>(
  rows: T[],
  noms: Map<string, string>,
): T[] {
  return [...rows].sort(
    (a, b) =>
      a.rank - b.rank ||
      (noms.get(a.player_id) ?? "").localeCompare(
        noms.get(b.player_id) ?? "",
        "fr",
      ),
  );
}

// ---------------------------------------------------------------------------
// Le duel de la semaine
// ---------------------------------------------------------------------------
// Miroir de la vue duel_results : le duel se joue aux jours parfaits, se
// départage aux points de la semaine (ceux du classement hebdo, calculés
// par le serveur), sinon nul. Le jour off n'est pas un jour de duel : il
// n'y fabrique de 3/3 pour personne — neutre par construction, puisqu'il
// est le même pour les deux camps.

export type DuelTally = {
  perfectA: number;
  perfectB: number;
};

/** Jours parfaits de chaque camp sur [from, to], bornes incluses. Se
    calcule depuis la Map entries déjà en mémoire (et en realtime). */
export function tallyDuel(
  entries: Map<string, Entry>,
  duel: Duel,
  from: string,
  to: string,
): DuelTally {
  const t: DuelTally = { perfectA: 0, perfectB: 0 };
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (parfait(duel.player_a, entries, day)) t.perfectA++;
    if (duel.player_b && parfait(duel.player_b, entries, day)) t.perfectB++;
  }
  return t;
}

/** Même règle que la vue duel_results : jours parfaits, puis points de la
    semaine (hors transferts), sinon nul. */
export function duelWinner(
  t: DuelTally,
  pointsA: number,
  pointsB: number,
): "a" | "b" | null {
  if (t.perfectA !== t.perfectB) return t.perfectA > t.perfectB ? "a" : "b";
  if (pointsA !== pointsB) return pointsA > pointsB ? "a" : "b";
  return null;
}
