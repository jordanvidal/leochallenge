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

/** Une distinction collective, avec le ou les noms qui la portent. */
export type Mvp = {
  emoji: string;
  /** Les gagnants, du même exploit : à égalité, on nomme tout le monde. */
  noms: string[];
  /** Ce qu'ils ont fait, sans le nom (« tient la plus longue série : 21 jours »). */
  exploit: string;
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

  const [lb, seances, chronos, duels, offs] = await Promise.all([
    supabase.rpc("leaderboard", { ...argLigue(ligueId), p_until: jour }),
    seancesJusqua(jour),
    chronosJusqua(jour),
    duelsJusqua(jour),
    joursOffJusqua(jour),
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

  const mvps = construitMvps(rows, noms, stats, seancesParJoueur, premiersParJoueur);

  const moi = rows.find((r) => r.player_id === playerId);
  const statsMoi = stats.get(playerId);
  if (!moi || !statsMoi) return null;

  const totalExos = rows.reduce((s, r) => s + r.exos_done, 0);
  const lignesDuel = duels.error ? [] : (duels.data as DuelRow[]);

  return {
    joursFaits: diffDays(f.start, jour) + 1,
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
        joursFaits: diffDays(f.start, jour) + 1,
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

/**
 * Qui mène sur une mesure, à égalité comprise.
 *
 * Nommer tous les ex æquo plutôt qu'en départager un au hasard : dans un
 * groupe où trois personnes bouclent 18 séances, désigner « le » vainqueur
 * par l'ordre de la base est un mensonge que le concerné repère en trois
 * secondes. Rend une liste vide si personne n'a rien fait (0 partout) — une
 * distinction pour un score nul n'en est pas une.
 */
export function gagnants<T>(
  candidats: T[],
  cle: (c: T) => string,
  valeur: (c: T) => number,
): { ids: string[]; valeur: number } {
  let meilleure = 0;
  const ids: string[] = [];
  for (const c of candidats) {
    const v = valeur(c);
    if (v <= 0 || v < meilleure) continue;
    if (v > meilleure) {
      meilleure = v;
      ids.length = 0;
    }
    ids.push(cle(c));
  }
  return { ids, valeur: meilleure };
}

/** « Pierre », « Pierre et Léo », « Pierre, Léo et Doren ». */
export function joinNoms(noms: string[]): string {
  if (noms.length <= 1) return noms[0] ?? "";
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

function construitMvps(
  rows: LeaderboardRow[],
  noms: Map<string, string>,
  stats: Map<string, { bestStreak: number }>,
  seances: Map<string, number>,
  premiers: Map<string, number>,
): Mvp[] {
  const nomsDe = (ids: string[]) =>
    ids
      .map((id) => noms.get(id) ?? "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "fr"));

  const candidats = rows.map((r) => r.player_id);
  // `texte` reçoit le nombre d'ex æquo : à trois, « a bouclé 18 séances »
  // devient faux au premier coup d'œil, et rien ne décrédibilise plus vite
  // un écran de stats qu'une faute d'accord sur le nom des gens.
  const mesures: {
    emoji: string;
    valeur: (id: string) => number;
    texte: (v: number, plusieurs: boolean) => string;
  }[] = [
    {
      emoji: "🔥",
      valeur: (id) => stats.get(id)?.bestStreak ?? 0,
      // Espace insécable avant le deux-points : sans elle, le retour à la
      // ligne pose « : 21 jours » en tête de ligne. Typographie française.
      texte: (v, n) =>
        `${n ? "tiennent" : "tient"} la plus longue série : ${v} jours parfaits`,
    },
    {
      emoji: "🌅",
      valeur: (id) => premiers.get(id) ?? 0,
      texte: (v, n) =>
        n
          ? `ont été ${v} fois chacun le premier du jour à boucler son 3/3`
          : `a été ${v} fois le premier du jour à boucler son 3/3`,
    },
    {
      emoji: "💪",
      valeur: (id) => seances.get(id) ?? 0,
      texte: (v, n) =>
        `${n ? "ont bouclé" : "a bouclé"} ${v} séance${v > 1 ? "s" : ""} guidée${v > 1 ? "s" : ""}`,
    },
    {
      emoji: "⚡",
      valeur: (id) => rows.find((r) => r.player_id === id)?.bonus_points ?? 0,
      texte: (v, n) => `${n ? "ont raflé" : "a raflé"} ${fmtPoints(v)} pts de bonus`,
    },
  ];

  return mesures
    .map((m) => {
      const { ids, valeur } = gagnants(candidats, (id) => id, m.valeur);
      return {
        emoji: m.emoji,
        noms: nomsDe(ids),
        exploit: m.texte(valeur, ids.length > 1),
      };
    })
    .filter((mvp) => mvp.noms.length > 0);
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
  const serie = d.mvps.find((m) => m.emoji === "🔥");

  return [
    "⏱️ 100-100-100 — MI-TEMPS",
    `${d.joursFaits} jours faits, ${d.joursRestants} restants.`,
    "",
    ...d.top3.map((p, i) => `${medals[i]} ${p.name} — ${fmtPoints(p.points)} pts`),
    "",
    `L'équipe : ${frNum(d.totalExos)} exos validés, ${frNum(d.totalReps)} répétitions, ` +
      `${d.joursParfaitsCollectifs} jours parfaits, ${d.seances} séances guidées.`,
    ...(serie ? [`🔥 ${joinNoms(serie.noms)} ${serie.exploit}`] : []),
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

/** Les jours parfaits d'un joueur sur la première mi-temps, pour les tests
    et pour qui voudrait la mesure sans passer par le classement serveur. */
export function joursParfaitsJusqua(
  playerId: string,
  entries: Map<string, Entry>,
  depuis: string,
  jusqua: string,
): number {
  let n = 0;
  for (let d = depuis; d <= jusqua; d = addDays(d, 1)) {
    if (entryCount(entries.get(entryKey(playerId, d))) === 3) n++;
  }
  return n;
}
