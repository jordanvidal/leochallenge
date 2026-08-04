// La mi-temps : les chiffres de la première moitié du challenge, figés.
//
// Concept et garde-fous : docs/mi-temps.md. Deux règles tiennent tout ce
// module :
//
//  1. **Rien n'est « à aujourd'hui ».** Tout est borné au dernier jour de la
//     première mi-temps (`p_until`, `lte("day", …)`, fenêtre gelée). Celui qui
//     ouvre l'écran le 10 août doit lire exactement les mêmes chiffres que
//     celui qui l'a ouvert le 7 au réveil — sinon l'écran raconte une histoire
//     qui bouge, et le partage WhatsApp de l'un contredit celui de l'autre.
//  2. **La mi-temps raconte, elle ne score pas.** Aucune écriture, aucun
//     point distribué, aucune migration. Ce module ne fait que lire.

import {
  addDays,
  diffDays,
  Fenetre,
  joursDeFenetre,
  parisToday,
} from "./challenge";
import { fmtPoints, LeaderboardRow } from "./gamification";
import { argLigue } from "./ligue";
import { computeStats, ordonneClassement } from "./score";
import { supabase } from "./supabase";
import { Entry, entryCount, entryKey, Player } from "./types";

/**
 * Le dernier jour de la première mi-temps.
 *
 * Déduit de la fenêtre plutôt qu'écrit en dur : la règle du repo veut que les
 * dates du challenge vivent dans `lib/challenge.ts` et se dérivent, jamais
 * qu'un composant connaisse un « 6 août ». Sur le challenge d'origine (50
 * jours à partir du 13/07), ça rend bien le 06/08 : 25 jours faits, 25 devant.
 *
 * Sur un nombre impair de jours, la première moitié prend le jour du milieu
 * (`ceil`) — mieux vaut une mi-temps qui arrive un jour trop tard qu'un écran
 * qui promet plus de jours restants qu'il n'en existe.
 */
export function jourDeMiTemps(f: Fenetre): string {
  return addDays(f.start, Math.ceil(joursDeFenetre(f) / 2) - 1);
}

/** Le matin où l'écran s'ouvre : le lendemain de la mi-temps. */
export function ouvertureMiTemps(f: Fenetre): string {
  return addDays(jourDeMiTemps(f), 1);
}

/**
 * La mi-temps est-elle ouverte pour cette fenêtre ?
 *
 * `aUneBasculeDeBareme` n'est PAS testé ici mais côté App, avec le reste des
 * gardes d'affichage — voir le commentaire là-bas. Ici on ne répond qu'à la
 * question de date : rien avant le lendemain de la mi-temps, rien après la fin
 * du challenge (à ce moment-là c'est le Bilan qui parle, pas la mi-temps).
 */
export function miTempsOuverte(f: Fenetre): boolean {
  const today = parisToday();
  return today >= ouvertureMiTemps(f) && today <= f.end;
}

/** La distinction d'UN joueur : son terrain à lui, et son chiffre dessus. */
export type Mvp = {
  emoji: string;
  /** Le joueur distingué. Un seul — voir `distinctions()`. */
  nom: string;
  /** Ce qu'il a fait, sans le nom (« 22 jours parfaits d'affilée »). */
  exploit: string;
  /** Vrai s'il mène vraiment cette mesure. Seul cas où la phrase se
      permet un superlatif — sinon elle énonce un fait, sans classer. */
  superlatif: boolean;
};

/** Tout ce que la mi-temps raconte. Calculé par `fetchMiTemps`, figé. */
export type MiTempsData = {
  joursFaits: number;
  joursRestants: number;
  // La bande
  totalExos: number;
  totalReps: number;
  joursParfaitsCollectifs: number;
  seances: number;
  mvps: Mvp[];
  // La course
  top3: { name: string; color: string; points: number }[];
  duels: { tranches: number; nuls: number };
  // Toi
  me: {
    rank: number;
    points: number;
    exos: number;
    perfectDays: number;
    bestStreak: number;
    /** L'angle personnel de deuxième mi-temps. */
    relance: string;
  };
};

// ---------------------------------------------------------------------------
// Les lectures
// ---------------------------------------------------------------------------

type SeanceRow = { player_id: string; duration_seconds: number | null };
type ChronoRow = { player_id: string; day: string; completed_at: string | null };
type DuelRow = { winner: string | null };

/**
 * Les séances guidées bouclées jusqu'à la mi-temps.
 *
 * `finished_at not null` seulement : une séance lancée et jamais clôturée
 * n'est pas une séance faite, et il y en a — on ferme l'app en plein milieu.
 */
function seancesJusqua(jour: string) {
  return supabase
    .from("workout_sessions")
    .select("player_id, duration_seconds")
    .lte("day", jour)
    .not("finished_at", "is", null);
}

/** L'heure du 3/3 de chaque jour, pour désigner les premiers du jour. */
function chronosJusqua(jour: string) {
  return supabase
    .from("entries")
    .select("player_id, day, completed_at")
    .lte("day", jour)
    .not("completed_at", "is", null);
}

/**
 * Les jours off tombés avant la mi-temps.
 *
 * Sans eux, `computeStats` casserait chaque série sur le repos hebdo de la
 * S4 (en vigueur depuis le 03/08, donc à l'intérieur de la première
 * mi-temps) : l'écran annoncerait des séries de 3 jours à des gens qui n'en
 * ont pas raté un seul, et la distinction « plus longue série » irait au
 * mauvais nom. Table absente ou en erreur : on retombe sur un ensemble vide,
 * c'est-à-dire le calcul d'avant la S4.
 */
function joursOffJusqua(jour: string) {
  return supabase.from("jours_off").select("day").lte("day", jour);
}

/**
 * Les bonus déclarés jusqu'à la mi-temps, et le catalogue qui les qualifie.
 *
 * C'est la source des terrains de mouvement : le catalogue dit quelles clés
 * sont des exercices (`kind = 'exercise'`), les claims disent qui a déclaré
 * quoi. Une trentaine de lignes par joueur sur 25 jours — deux requêtes
 * légères, faites une seule fois à l'ouverture de l'écran.
 */
function claimsJusqua(jour: string) {
  return supabase
    .from("bonus_claims")
    .select("player_id, bonus_key")
    .lte("day", jour);
}

function catalogueExercices() {
  return supabase.from("bonus_catalog").select("key, kind");
}

/**
 * Les duels **clos** au moment de la mi-temps.
 *
 * `duel_results` ne contient déjà que les semaines terminées, mais elle suit
 * le calendrier réel : ouvrir l'écran le 10 août y ferait apparaître la
 * semaine du 03/08, absente le 7. On borne donc au dernier dimanche tombé
 * avant la mi-temps — le compte des duels ne bouge plus après.
 */
function duelsJusqua(jour: string) {
  return supabase
    .from("duel_results")
    .select("winner")
    .lte("week_monday", addDays(jour, -6));
}

/**
 * Tous les chiffres de la mi-temps, en un aller-retour.
 *
 * `entries` n'est pas relu : la Map est déjà en mémoire (`useChallengeData`)
 * et couvre tout le challenge. Elle sert les séries et la régularité, bornées
 * par la fenêtre gelée.
 *
 * Rend `null` si le classement ou les joueurs manquent — mieux vaut ne pas
 * ouvrir l'écran du tout que d'ouvrir une story de zéros. Les lectures
 * secondaires (séances, chronos, duels), elles, sont tolérées en échec : une
 * distinction en moins ne vaut pas un écran en moins.
 */
export async function fetchMiTemps(
  playerId: string,
  players: Player[],
  entries: Map<string, Entry>,
  f: Fenetre,
  ligueId: string | null,
): Promise<MiTempsData | null> {
  const jour = jourDeMiTemps(f);
  const gelee: Fenetre = { ...f, end: jour };

  const [lb, seances, chronos, duels, offs, claims, catalogue] = await Promise.all([
    supabase.rpc("leaderboard", { ...argLigue(ligueId), p_until: jour }),
    seancesJusqua(jour),
    chronosJusqua(jour),
    duelsJusqua(jour),
    joursOffJusqua(jour),
    claimsJusqua(jour),
    catalogueExercices(),
  ]);
  if (lb.error || !lb.data) return null;

  const noms = new Map(players.map((p) => [p.id, p.name]));
  const rows = (lb.data as LeaderboardRow[])
    .map(numifie)
    .filter((r) => noms.has(r.player_id));
  if (rows.length === 0) return null;

  const classement = ordonneClassement(rows, noms);
  const joursOff = new Set(
    offs.error ? [] : (offs.data as { day: string }[]).map((o) => o.day),
  );
  const stats = new Map(
    players.map((p) => [p.id, computeStats(p.id, entries, gelee, joursOff)]),
  );

  const seancesParJoueur = compteParJoueur(
    seances.error ? [] : (seances.data as SeanceRow[]),
  );
  const premiersParJoueur = premiersDuJour(
    chronos.error ? [] : (chronos.data as ChronoRow[]),
    jour,
    f.start,
  );

  // Les terrains, puis l'affectation « chacun le sien ». La présence sert
  // deux fois : elle décide qui est actif, et elle est elle-même un terrain —
  // celui de qui vient tous les jours sans jamais briller ailleurs.
  const joursFaits = diffDays(f.start, jour) + 1;
  const presence = new Map(
    players.map((p) => [p.id, joursPresentsJusqua(p.id, entries, f.start, jour)]),
  );
  // Les mouvements d'abord (pompes, jambes, gainage, course…), puis les
  // compteurs de jeu en filet. Les deux lectures tolèrent l'échec : sans
  // claims on retombe sur les mesures de jeu, et l'écran reste debout.
  const clesExercice = new Set(
    catalogue.error
      ? []
      : (catalogue.data as { key: string; kind: string }[])
          .filter((c) => c.kind === "exercise")
          .map((c) => c.key),
  );
  const mesures = mesuresDeMouvement(
    claims.error ? [] : (claims.data as { player_id: string; bonus_key: string }[]),
    clesExercice,
  );
  mesures.set(
    "serie",
    new Map(players.map((p) => [p.id, stats.get(p.id)?.bestStreak ?? 0])),
  );
  mesures.set("matinal", premiersParJoueur);
  mesures.set("seances", seancesParJoueur);
  mesures.set("bonus", new Map(rows.map((r) => [r.player_id, r.bonus_points])));
  mesures.set("parfaits", new Map(rows.map((r) => [r.player_id, r.perfect_days])));
  mesures.set("presence", presence);

  const mvps = distinctions(joueursActifs(presence, joursFaits), noms, mesures);

  const moi = rows.find((r) => r.player_id === playerId);
  const statsMoi = stats.get(playerId);
  if (!moi || !statsMoi) return null;

  const totalExos = rows.reduce((s, r) => s + r.exos_done, 0);
  const lignesDuel = duels.error ? [] : (duels.data as DuelRow[]);

  return {
    joursFaits,
    joursRestants: diffDays(jour, f.end),
    totalExos,
    totalReps: totalExos * 100,
    joursParfaitsCollectifs: rows.reduce((s, r) => s + r.perfect_days, 0),
    seances: seances.error ? 0 : (seances.data as SeanceRow[]).length,
    mvps,
    top3: classement.slice(0, 3).map((r) => ({
      name: noms.get(r.player_id) ?? "",
      color: players.find((p) => p.id === r.player_id)?.color ?? "",
      points: r.points,
    })),
    duels: {
      tranches: lignesDuel.filter((d) => d.winner !== null).length,
      nuls: lignesDuel.filter((d) => d.winner === null).length,
    },
    me: {
      rank: moi.rank,
      points: moi.points,
      exos: moi.exos_done,
      perfectDays: moi.perfect_days,
      bestStreak: statsMoi.bestStreak,
      relance: angleDeRelance(moi, statsMoi.bestStreak, classement, noms, {
        joursFaits,
        joursRestants: diffDays(jour, f.end),
      }),
    },
  };
}

/** Postgres rend les numeric en chaînes ; `numify` de gamification est privé. */
function numifie(r: LeaderboardRow): LeaderboardRow {
  return {
    ...r,
    points: Number(r.points),
    rank: Number(r.rank),
    perfect_days: Number(r.perfect_days),
    exos_done: Number(r.exos_done),
    current_streak: Number(r.current_streak),
    bonus_points: Number(r.bonus_points),
  };
}

// ---------------------------------------------------------------------------
// Les distinctions
// ---------------------------------------------------------------------------

/** Combien de lignes par joueur (séances bouclées, par exemple). */
export function compteParJoueur(
  lignes: { player_id: string }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lignes) m.set(l.player_id, (m.get(l.player_id) ?? 0) + 1);
  return m;
}

/**
 * Combien de fois chacun a bouclé son 3/3 avant tous les autres.
 *
 * Une seule subtilité : `completed_at` peut porter un jour différent de
 * `day` (une coche rattrapée après minuit garde la date de la journée de
 * jeu). Comparer les horodatages bruts ferait gagner « le premier du jour »
 * à celui qui a coché la veille au soir pour le lendemain. On ne compare donc
 * que des 3/3 posés le jour même, exactement comme le fait la vue SQL.
 */
export function premiersDuJour(
  lignes: ChronoRow[],
  jusqua: string,
  depuis: string,
): Map<string, number> {
  const parJour = new Map<string, { playerId: string; ts: number }>();
  for (const l of lignes) {
    if (!l.completed_at) continue;
    if (l.day < depuis || l.day > jusqua) continue;
    const ts = Date.parse(l.completed_at);
    if (Number.isNaN(ts)) continue;
    // Le 3/3 doit avoir été posé pendant sa propre journée (heure de Paris).
    const jourDuClic = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts));
    if (jourDuClic !== l.day) continue;

    const tenant = parJour.get(l.day);
    if (!tenant || ts < tenant.ts) parJour.set(l.day, { playerId: l.player_id, ts });
  }
  const m = new Map<string, number>();
  for (const { playerId } of parJour.values()) {
    m.set(playerId, (m.get(playerId) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Les distinctions : chacun son terrain
// ---------------------------------------------------------------------------
//
// Règle d'acceptance posée par Jordan le 03/08 : **chaque joueur actif est cité
// une fois et une seule** sur la carte « L'équipe ». C'est une contrainte de
// couverture, incompatible avec « le meilleur de chaque mesure gagne » : sur
// les données du 03/08, Pierre menait quatre mesures sur quatre et quatre
// personnes n'étaient nommées nulle part.
//
// On inverse donc le problème. Beaucoup de terrains, cinq actifs, et une
// affectation gloutonne : chacun reçoit **celui où il est le plus fort par
// rapport au groupe**, chaque terrain ne servant qu'une fois.
//
// Le mensonge que ça pourrait introduire est écarté par une seule règle : **la
// phrase ne se permet un superlatif que si le joueur mène vraiment sa mesure.**
// Sinon elle énonce son chiffre, sans classer.
//
// Deuxième demande de Jordan (03/08, au vu des premières lignes) : les jours
// parfaits et les séries ne parlent que des deux premiers. Les terrains qui
// suivent sont donc d'abord **des mouvements** — pompes, jambes, gainage,
// course, corde — tirés des bonus que chacun déclare. C'est là que les
// tempéraments se voient : celui qui court, celui qui saute à la corde, celui
// qui tient la chaise murale. Les mesures « de jeu » (série, points, présence)
// restent en fin de liste, en filet.

/**
 * Combien de répétitions, de minutes ou de kilomètres vaut un palier.
 *
 * Le catalogue ne stocke que des points, jamais des quantités — même constat
 * que `REPS_PAR_PALIER` dans `lib/records.ts`, dont cette table est le
 * prolongement à tout le catalogue d'exercices. Elle peut donc se
 * désynchroniser du jour où un palier s'ajoute en base ; d'où `TERRAINS_SURS`
 * plus bas, qui suspend un terrain plutôt que d'annoncer un total partiel.
 *
 * Les quantités sont lisibles dans les libellés du catalogue (« +50 pompes »,
 * « 3 min de gainage », « 10 km de course ») : les tenir ici plutôt que de les
 * analyser à l'exécution évite qu'un libellé retouché change un chiffre affiché.
 */
const QUANTITES: Record<string, number> = {
  pompes_50: 50,
  pompes_100: 100,
  dips_50: 50,
  squats_100: 100,
  squats_200: 200,
  squats_jump_50: 50,
  squats_jump_100: 100,
  fentes_100: 100,
  fentes_200: 200,
  chaise_3min: 3,
  abdos_100: 100,
  abdos_200: 200,
  gainage_3min: 3,
  burpees_30: 30,
  burpees_60: 60,
  climbers_100: 100,
  climbers_200: 200,
  jumping_jacks_100: 100,
  jumping_jacks_200: 200,
  corde_10min: 10,
  course_5km: 5,
  course_10km: 10,
  marches_500: 500,
  pas_10000: 1,
};

/** Un terrain : ce qu'on mesure, et comment on le raconte. */
type Terrain = {
  cle: string;
  emoji: string;
  /** Les clés du catalogue qui l'alimentent. Vide = mesure calculée ailleurs
      (série, séances, points, jours parfaits, présence). */
  cles: string[];
  /** Le fait, sans superlatif. */
  fait: (v: number) => string;
  /** Le fait, quand le joueur mène vraiment la mesure. */
  record: (v: number) => string;
};

/**
 * Les terrains, dans l'ordre d'affichage — et c'est un ordre qui compte.
 *
 * Il départage les ex æquo de l'affectation (il doit donc être stable), et
 * comme le glouton sert d'abord les scores les plus dominants, ce sont les
 * premiers terrains qui raflent les joueurs qui écrasent leur mesure. Les
 * mouvements passent donc avant les compteurs de jeu : « 800 pompes en plus »
 * dit quelque chose de quelqu'un, « 19 journées parfaites » beaucoup moins
 * quand quatre personnes en ont 19.
 */
const TERRAINS: Terrain[] = [
  {
    cle: "serie",
    emoji: "🔥",
    cles: [],
    fait: (v) => `${v} jours parfaits d'affilée`,
    record: (v) => `la plus longue série du challenge : ${v} jours parfaits`,
  },
  {
    cle: "matinal",
    emoji: "🌅",
    cles: [],
    fait: (v) => `${v} fois le premier du jour à boucler son 3/3`,
    record: (v) => `${v} fois le premier du jour, personne n'a fait mieux`,
  },
  {
    cle: "pompes",
    emoji: "💪",
    cles: ["pompes_50", "pompes_100", "dips_50"],
    fait: (v) => `${frNum(v)} pompes déclarées en plus du contrat`,
    record: (v) => `${frNum(v)} pompes en plus du contrat, le haut du corps du groupe`,
  },
  {
    cle: "jambes",
    emoji: "🦵",
    cles: ["squats_100", "squats_200", "fentes_100", "fentes_200", "squats_jump_50", "squats_jump_100"],
    fait: (v) => `${frNum(v)} squats et fentes en plus`,
    record: (v) => `${frNum(v)} squats et fentes en plus, les jambes du groupe`,
  },
  {
    cle: "abdos",
    emoji: "🫁",
    cles: ["abdos_100", "abdos_200"],
    fait: (v) => `${frNum(v)} abdos déclarés en plus`,
    record: (v) => `${frNum(v)} abdos en plus, le ventre le plus travaillé`,
  },
  {
    cle: "course",
    emoji: "🏃",
    cles: ["course_5km", "course_10km"],
    fait: (v) => `${v} km de course à côté`,
    record: (v) => `${v} km de course à côté, le plus gros kilométrage`,
  },
  {
    cle: "burpees",
    emoji: "💥",
    cles: ["burpees_30", "burpees_60"],
    fait: (v) => `${frNum(v)} burpees encaissés`,
    record: (v) => `${frNum(v)} burpees, l'exercice que personne n'aime`,
  },
  {
    cle: "gainage",
    emoji: "🧱",
    cles: ["gainage_3min"],
    fait: (v) => `${v} minutes de gainage`,
    record: (v) => `${v} minutes de gainage, la planche du groupe`,
  },
  {
    cle: "chaise",
    emoji: "🪑",
    cles: ["chaise_3min"],
    fait: (v) => `${v} minutes de chaise murale`,
    record: (v) => `${v} minutes de chaise murale, les cuisses en feu`,
  },
  {
    cle: "corde",
    emoji: "🪢",
    cles: ["corde_10min"],
    fait: (v) => `${v} minutes de corde à sauter`,
    record: (v) => `${v} minutes de corde à sauter, personne d'autre n'y touche`,
  },
  {
    cle: "climbers",
    emoji: "🧗",
    cles: ["climbers_100", "climbers_200"],
    fait: (v) => `${frNum(v)} mountain climbers`,
    record: (v) => `${frNum(v)} mountain climbers, le plus gros total`,
  },
  {
    cle: "jacks",
    emoji: "🤸",
    cles: ["jumping_jacks_100", "jumping_jacks_200"],
    fait: (v) => `${frNum(v)} jumping jacks`,
    record: (v) => `${frNum(v)} jumping jacks, le plus gros total`,
  },
  {
    cle: "marches",
    emoji: "🪜",
    cles: ["marches_500"],
    fait: (v) => `${frNum(v)} marches d'escalier grimpées`,
    record: (v) => `${frNum(v)} marches grimpées, le seul à les compter`,
  },
  {
    cle: "pas",
    emoji: "🚶",
    cles: ["pas_10000"],
    fait: (v) => `${v} journées à plus de 10 000 pas`,
    record: (v) => `${v} journées à 10 000 pas, le plus gros marcheur`,
  },
  // ---- Les compteurs de jeu, en filet ----
  // Ils ne disent rien d'un tempérament, mais ils garantissent qu'un actif
  // qui ne déclare aucun bonus d'exercice a quand même une ligne.
  {
    cle: "seances",
    emoji: "🏋️",
    cles: [],
    fait: (v) =>
      `${v} séance${v > 1 ? "s" : ""} guidée${v > 1 ? "s" : ""} bouclée${v > 1 ? "s" : ""}`,
    record: (v) => `${v} séances guidées bouclées, le record de la bande`,
  },
  {
    cle: "bonus",
    emoji: "⚡",
    cles: [],
    fait: (v) => `${fmtPoints(v)} pts de bonus au compteur`,
    record: (v) => `${fmtPoints(v)} pts de bonus, le plus gros magot`,
  },
  {
    cle: "parfaits",
    emoji: "✅",
    cles: [],
    fait: (v) => `${v} journées parfaites`,
    record: (v) => `${v} journées parfaites, le meilleur total`,
  },
  {
    cle: "presence",
    emoji: "📅",
    cles: [],
    fait: (v) => `présent ${v} jours sur la première mi-temps`,
    record: (v) => `présent ${v} jours, le plus assidu de tous`,
  },
];

/** Une valeur par joueur, par terrain. */
export type Mesures = Map<string, Map<string, number>>;

/** Toutes les clés d'exercice que les terrains savent quantifier. */
const CLES_CONNUES = new Set(TERRAINS.flatMap((t) => t.cles));

/**
 * Les terrains de mouvement, alimentés par les bonus déclarés.
 *
 * `inconnues` reçoit les clés d'exercice vues en base mais absentes de
 * `QUANTITES` : un palier ajouté au catalogue et oublié ici. Le terrain
 * concerné est alors **suspendu** plutôt qu'affiché à un total partiel —
 * même parti pris que `volumeRecords()` dans `lib/records.ts`. Mieux vaut une
 * distinction en moins qu'un chiffre faux sous le nom de quelqu'un.
 */
export function mesuresDeMouvement(
  claims: { player_id: string; bonus_key: string }[],
  clesExercice: Set<string>,
): Mesures {
  const suspendus = new Set<string>();
  for (const c of claims) {
    if (!clesExercice.has(c.bonus_key)) continue; // événement ou exécution
    if (CLES_CONNUES.has(c.bonus_key) && QUANTITES[c.bonus_key] === undefined) {
      const t = TERRAINS.find((x) => x.cles.includes(c.bonus_key));
      if (t) suspendus.add(t.cle);
    }
  }

  const m: Mesures = new Map();
  for (const t of TERRAINS) {
    if (t.cles.length === 0 || suspendus.has(t.cle)) continue;
    const parJoueur = new Map<string, number>();
    for (const c of claims) {
      if (!t.cles.includes(c.bonus_key)) continue;
      const q = QUANTITES[c.bonus_key];
      if (q === undefined) continue;
      parJoueur.set(c.player_id, (parJoueur.get(c.player_id) ?? 0) + q);
    }
    m.set(t.cle, parJoueur);
  }
  return m;
}

/**
 * Qui compte comme « actif ».
 *
 * Le seuil est celui que `fetchBilanSaison` applique déjà au bilan de saison —
 * **au moins la moitié des jours joués**. Il n'exclut personne à la main et la
 * marge est large : au 6 août, les cinq qui jouent sont entre 17 et 22 jours de
 * présence, les quatre autres entre 0 et 5. Reprendre ce seuil plutôt que d'en
 * inventer un garde une seule définition de « joueur actif » dans l'app.
 *
 * Ceux qui n'y sont pas ne reçoivent PAS de ligne, et c'est voulu : « Nathan —
 * 2 exos validés » n'est pas une distinction, c'est un constat d'absence
 * affiché devant tout le monde.
 */
export function joueursActifs(
  presence: Map<string, number>,
  joursFaits: number,
): string[] {
  const seuil = Math.ceil(joursFaits / 2);
  return [...presence.entries()]
    .filter(([, jours]) => jours >= seuil)
    .map(([id]) => id);
}

/**
 * Une distinction par joueur actif, chaque terrain servi une seule fois.
 *
 * Glouton sur le score normalisé (valeur ÷ meilleure valeur du groupe) : on
 * sert d'abord la paire joueur × terrain la plus dominante, on retire les deux
 * du jeu, on recommence. Déterministe de bout en bout — à score égal, l'ordre
 * des terrains puis le prénom tranchent, jamais l'ordre de la base.
 *
 * Dix-huit terrains pour cinq actifs : la marge est large, et le test
 * d'acceptance la surveille.
 */
export function distinctions(
  actifs: string[],
  noms: Map<string, string>,
  mesures: Mesures,
): Mvp[] {
  const valeur = (id: string, t: Terrain) => mesures.get(t.cle)?.get(id) ?? 0;
  const maxima = new Map(
    TERRAINS.map((t) => [
      t.cle,
      actifs.reduce((mx, id) => Math.max(mx, valeur(id, t)), 0),
    ]),
  );

  type Paire = { id: string; terrain: Terrain; v: number; score: number };
  const paires: Paire[] = [];
  for (const id of actifs) {
    for (const t of TERRAINS) {
      const v = valeur(id, t);
      if (v <= 0) continue; // un zéro n'est jamais une performance
      const mx = maxima.get(t.cle) ?? 0;
      paires.push({ id, terrain: t, v, score: mx > 0 ? v / mx : 0 });
    }
  }
  paires.sort(
    (a, b) =>
      b.score - a.score ||
      TERRAINS.indexOf(a.terrain) - TERRAINS.indexOf(b.terrain) ||
      (noms.get(a.id) ?? "").localeCompare(noms.get(b.id) ?? "", "fr"),
  );

  const prisJoueur = new Set<string>();
  const prisTerrain = new Set<string>();
  const retenues: Paire[] = [];
  for (const p of paires) {
    if (prisJoueur.has(p.id) || prisTerrain.has(p.terrain.cle)) continue;
    prisJoueur.add(p.id);
    prisTerrain.add(p.terrain.cle);
    retenues.push(p);
  }

  // Affichage dans l'ordre des terrains, pas dans celui de l'affectation :
  // la liste doit avoir la même allure d'un jour à l'autre.
  retenues.sort(
    (a, b) => TERRAINS.indexOf(a.terrain) - TERRAINS.indexOf(b.terrain),
  );

  return retenues.map((p) => {
    const superlatif = p.v === (maxima.get(p.terrain.cle) ?? 0);
    return {
      emoji: p.terrain.emoji,
      nom: noms.get(p.id) ?? "",
      exploit: superlatif ? p.terrain.record(p.v) : p.terrain.fait(p.v),
      superlatif,
    };
  });
}

// ---------------------------------------------------------------------------
// L'angle personnel
// ---------------------------------------------------------------------------

/**
 * La phrase de relance d'un joueur : ce qu'IL a à défendre ou à aller
 * chercher en deuxième mi-temps.
 *
 * L'écran s'adresse d'abord à ceux qui ont décroché — c'est sa raison d'être
 * au creux d'août. Chaque branche doit donc rester vraie ET jouable : jamais
 * « rattrape les 600 pts qui te séparent du premier », qui ne relance
 * personne. On préfère l'échelon juste au-dessus, toujours atteignable.
 */
export function angleDeRelance(
  moi: LeaderboardRow,
  bestStreak: number,
  classement: LeaderboardRow[],
  noms: Map<string, string>,
  ctx: { joursFaits: number; joursRestants: number },
): string {
  const phrases: string[] = [];

  // Ce que vaut une semaine au sommet, mesuré sur le meilleur de la bande :
  // c'est l'unité de mesure d'un écart « rattrapable ». Un écart plus grand
  // ne se dit pas — « 339 pts te séparent de Hichem » est peut-être vrai,
  // mais c'est l'exact contraire d'une relance, et cet écran existe d'abord
  // pour ceux qui ont décroché. On leur parle alors du seul terrain où ils
  // repartent à égalité : le classement de la semaine, remis à zéro chaque
  // lundi.
  const meilleur = classement[0]?.points ?? 0;
  const semaineAuSommet = ctx.joursFaits > 0 ? (meilleur / ctx.joursFaits) * 7 : 0;

  // 1 — La position. En tête, c'est l'avance qu'on défend ; derrière, c'est
  // l'écart avec celui qu'on a juste devant — s'il est jouable.
  const monIndex = classement.findIndex((r) => r.player_id === moi.player_id);
  const devant = monIndex > 0 ? classement[monIndex - 1] : null;
  if (moi.rank === 1) {
    const second = classement[1];
    const avance = second ? moi.points - second.points : 0;
    phrases.push(
      avance > 0
        ? `Tu passes la mi-temps en tête, ${fmtPoints(avance)} pts devant. C'est exactement la position où on se relâche.`
        : "Tu passes la mi-temps en tête. C'est exactement la position où on se relâche.",
    );
  } else if (devant && devant.points - moi.points <= semaineAuSommet) {
    const ecart = devant.points - moi.points;
    phrases.push(
      `${fmtPoints(ecart)} pts te séparent de ${noms.get(devant.player_id) ?? "celui de devant"} — une semaine bien jouée, pas plus.`,
    );
  } else {
    phrases.push(
      "Chaque lundi, le classement de la semaine repart de zéro. Tout le monde y part à égalité, toi compris.",
    );
  }

  // 2 — Ce qu'on a à défendre, ou à reprendre.
  if (moi.current_streak >= 3) {
    phrases.push(
      `Ta série de ${moi.current_streak} jours arrive intacte à la mi-temps : ne sois pas celui qui la casse en août.`,
    );
  } else if (bestStreak >= 3) {
    phrases.push(
      `Ta meilleure série, c'était ${bestStreak} jours. Elle est reprenable dès ce soir.`,
    );
  } else if (moi.exos_done > 0) {
    phrases.push(
      `${moi.exos_done} exos au compteur. Il reste ${ctx.joursRestants} jours pour que ce soit la deuxième moitié dont on se souvient.`,
    );
  } else {
    phrases.push(
      `${ctx.joursRestants} jours devant toi, et une séance qui se lance en dix secondes. Personne ne compte les jours d'avant.`,
    );
  }

  return phrases.join(" ");
}

// ---------------------------------------------------------------------------
// Le partage
// ---------------------------------------------------------------------------

/** Nombre à la française : 35100 → "35 100". */
function frNum(n: number): string {
  return n.toLocaleString("fr-FR");
}

/**
 * Le bilan de la bande, façon Wordle — même famille que `buildWeekShare` et
 * `buildFinalShare`. Du texte et des emojis : ça se colle dans WhatsApp.
 * C'est la carte COLLECTIVE qui se partage, pas les chiffres perso : on
 * chambre le groupe, on n'étale pas son propre score.
 */
export function buildMiTempsShare(d: MiTempsData): string {
  const medals = ["🥇", "🥈", "🥉"];
  // Une seule distinction dans le message, et seulement si c'en est
  // vraiment une : les lignes non-superlatives sont des faits, justes à
  // l'écran où chacun a la sienne, mais isolées dans WhatsApp elles
  // ressembleraient à un titre qu'on ne mérite pas.
  const exploit = d.mvps.find((m) => m.superlatif);

  return [
    "⏱️ 100-100-100 — MI-TEMPS",
    `${d.joursFaits} jours faits, ${d.joursRestants} restants.`,
    "",
    ...d.top3.map((p, i) => `${medals[i]} ${p.name} — ${fmtPoints(p.points)} pts`),
    "",
    `L'équipe : ${frNum(d.totalExos)} exos validés, ${frNum(d.totalReps)} répétitions, ` +
      `${d.joursParfaitsCollectifs} jours parfaits, ${d.seances} séances guidées.`,
    ...(exploit ? [`${exploit.emoji} ${exploit.nom} — ${exploit.exploit}`] : []),
    ...(d.duels.tranches + d.duels.nuls > 0
      ? [
          `⚔️ ${d.duels.tranches} duel${d.duels.tranches > 1 ? "s" : ""} tranché${d.duels.tranches > 1 ? "s" : ""}, ` +
            `${d.duels.nuls} nul${d.duels.nuls > 1 ? "s" : ""}.`,
        ]
      : []),
    "",
    "Deuxième mi-temps. Tout se rejoue.",
  ].join("\n");
}

/**
 * Les jours où un joueur a validé au moins un exo, sur la première mi-temps.
 *
 * C'est la mesure de présence — pas de performance : elle sert à décider qui
 * est actif (`joueursActifs`) et elle est aussi un terrain à part entière,
 * celui de qui vient tous les jours sans jamais briller nulle part ailleurs.
 */
export function joursPresentsJusqua(
  playerId: string,
  entries: Map<string, Entry>,
  depuis: string,
  jusqua: string,
): number {
  let n = 0;
  for (let d = depuis; d <= jusqua; d = addDays(d, 1)) {
    if (entryCount(entries.get(entryKey(playerId, d))) > 0) n++;
  }
  return n;
}
