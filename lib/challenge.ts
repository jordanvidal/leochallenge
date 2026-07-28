// Constantes du challenge + helpers de dates en heure de Paris.
// Toutes les dates manipulées ici sont des chaînes 'YYYY-MM-DD' (jour civil Paris).
//
// Les dates viennent de l'env pour qu'une deuxième bande de copains puisse
// tourner sur le MÊME code, déployé sur un autre projet Vercel + une autre base
// Supabase. Sans variable posée, on retombe sur le challenge d'origine
// (13/07 → 31/08/2026) : l'instance existante ne bouge pas d'un octet.
//
// Attention : ces valeurs sont figées au build par Next.js (préfixe NEXT_PUBLIC_).
// Changer une date en prod = redéployer. Et il faut aussi adapter les contraintes
// CHECK côté SQL (voir supabase/README-nouvelle-instance.md) — l'env ne pilote
// que le front, la base a ses propres garde-fous.

/**
 * Lit un jour 'YYYY-MM-DD' depuis l'env. Je throw plutôt que de retomber
 * silencieusement sur le fallback : une date mal tapée doit casser le build,
 * pas donner une instance qui se croit terminée depuis un an.
 */
function readDayFromEnv(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} doit être au format YYYY-MM-DD, reçu : "${value}"`);
  }
  // Round-trip : élimine les dates syntaxiquement valides mais inexistantes
  // (2026-02-31, que Date accepte en la décalant au 3 mars).
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} n'est pas une date réelle : "${value}"`);
  }
  return value;
}

export const CHALLENGE_START = readDayFromEnv(
  process.env.NEXT_PUBLIC_CHALLENGE_START,
  "2026-07-13",
  "NEXT_PUBLIC_CHALLENGE_START",
);
export const CHALLENGE_END = readDayFromEnv(
  process.env.NEXT_PUBLIC_CHALLENGE_END,
  "2026-08-31",
  "NEXT_PUBLIC_CHALLENGE_END",
);

if (CHALLENGE_START > CHALLENGE_END) {
  throw new Error(
    `Challenge à l'envers : début ${CHALLENGE_START} après fin ${CHALLENGE_END}.`,
  );
}

// Bascule de la saison 3 (nouveau barème + écran de lancement). Configurable
// par env comme les bornes du challenge : une autre bande n'a pas la même
// histoire de saisons, elle posera sa propre date (ou aucune).
export const SAISON3_START = readDayFromEnv(
  process.env.NEXT_PUBLIC_SAISON3_START,
  "2026-07-27",
  "NEXT_PUBLIC_SAISON3_START",
);

// Fenêtre d'édition : le jour en cours uniquement. On ne déclare ses exos
// que le jour même — ni rattrapage, ni fenêtre glissante sur les jours passés.
export const EDIT_WINDOW_DAYS = 0;

// Nombre total de jours du challenge, début et fin compris. Déduit des deux
// dates : c'est le dénominateur des "X / N jours parfaits" du Bilan et du
// partage, il doit suivre la config sinon il ment.
export const CHALLENGE_DAYS = diffDays(CHALLENGE_START, CHALLENGE_END) + 1;

// ---- La fenêtre d'une ligue ----
//
// Ce module ne décide plus quelles sont les dates du jeu : il les reçoit. Une
// `Fenetre`, c'est le début, la fin et la bascule de barème d'UNE ligue. Les
// constantes ci-dessus n'en sont plus qu'un cas particulier — celui du
// challenge d'origine — servi par défaut à qui ne précise rien.
//
// Sans ce paramètre, chaque fonction plus bas raisonnait sur un challenge de 50
// jours allant du 13/07 au 31/08 : `elapsedDays()` rendait les jours du
// challenge d'origine même pour une ligue d'une semaine en mars, et
// `challengeWeeks()` numérotait ses semaines à partir de juillet. Rien de tout
// ça ne se voit aujourd'hui, puisqu'il n'y a qu'une ligue et que c'est la
// sienne — mais c'est exactement ce qui casserait à la deuxième.

export type Fenetre = {
  /** Premier jour, 'YYYY-MM-DD' (jour civil Paris). */
  start: string;
  /** Dernier jour, inclus. */
  end: string;
  /** Jour de bascule du barème S3. Une ligue neuve naît en S3 : sa bascule est
      son premier jour. Le challenge d'origine, lui, a changé de barème en
      cours de route, d'où une date distincte. */
  saison3: string;
};

/** La fenêtre du challenge d'origine, telle que l'env la décrit. */
export const FENETRE_ENV: Fenetre = {
  start: CHALLENGE_START,
  end: CHALLENGE_END,
  saison3: SAISON3_START,
};

/**
 * Fabrique une fenêtre depuis les dates d'une ligue, en refusant l'absurde.
 * Je throw plutôt que de corriger en silence : une ligue à l'envers vient d'une
 * ligne en base ou d'un formulaire, c'est un bug à voir, pas à absorber.
 */
export function fenetre(start: string, end: string, saison3: string = start): Fenetre {
  if (start > end) {
    throw new Error(`Ligue à l'envers : début ${start} après fin ${end}.`);
  }
  return { start, end, saison3 };
}

/** Nombre de jours d'une fenêtre, début et fin compris. */
export function joursDeFenetre(f: Fenetre): number {
  return diffDays(f.start, f.end) + 1;
}

// Formateur figé sur Europe/Paris. en-CA donne directement 'YYYY-MM-DD'.
const parisDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Simulation de date, dev uniquement. Permet de voir le Bilan avant le 1er
 * septembre : `?date=2026-09-01` dans l'URL, ou NEXT_PUBLIC_SIM_DATE en env.
 * Jamais actif en production : aucun risque de tuer l'onglet Aujourd'hui trop tôt.
 */
export function simulatedToday(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const isDay = (v: string | null | undefined): v is string =>
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (typeof window !== "undefined") {
    const fromUrl = new URLSearchParams(window.location.search).get("date");
    if (isDay(fromUrl)) return fromUrl;
  }
  const fromEnv = process.env.NEXT_PUBLIC_SIM_DATE;
  return isDay(fromEnv) ? fromEnv : null;
}

/** Jour civil actuel à Paris, quel que soit le fuseau du téléphone. */
export function parisToday(): string {
  return simulatedToday() ?? parisDayFmt.format(new Date());
}

/** Ajoute n jours à un jour 'YYYY-MM-DD'. Midi UTC pour ignorer les DST. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Comparaison de jours : les chaînes ISO se comparent lexicalement. */
export function isBefore(a: string, b: string): boolean {
  return a < b;
}

/** Premier jour encore éditable en régime normal (aujourd'hui - 2). */
export function editableFrom(): string {
  return addDays(parisToday(), -EDIT_WINDOW_DAYS);
}

/** Un jour est-il éditable ? Avec EDIT_WINDOW_DAYS = 0 : le jour même, et
    rien d'autre — ni la veille, ni le futur, ni après la fin de la ligue. */
export function isEditable(day: string, f: Fenetre = FENETRE_ENV): boolean {
  const today = parisToday();
  return day >= editableFrom() && day <= today && day <= f.end;
}

/** Jours restants avant la fin, jour J compris. 0 si la ligue est finie. */
export function daysLeft(f: Fenetre = FENETRE_ENV): number {
  const today = parisToday();
  if (today > f.end) return 0;
  const from = today < f.start ? f.start : today;
  return diffDays(from, f.end) + 1;
}

/** Nombre de jours entre deux jours ISO (b - a). */
export function diffDays(a: string, b: string): number {
  const ms =
    new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Tous les jours écoulés de la ligue (du plus récent au plus ancien). */
export function elapsedDays(f: Fenetre = FENETRE_ENV): string[] {
  const today = parisToday();
  const last = today > f.end ? f.end : today;
  if (last < f.start) return [];
  const days: string[] = [];
  for (let d = last; d >= f.start; d = addDays(d, -1)) days.push(d);
  return days;
}

/** Tous les jours de la ligue, du début à la fin, dans l'ordre chronologique. */
export function allChallengeDays(f: Fenetre = FENETRE_ENV): string[] {
  const days: string[] = [];
  for (let i = 0; i < joursDeFenetre(f); i++) days.push(addDays(f.start, i));
  return days;
}

/** La ligue est-elle terminée ? Vrai dès le lendemain du dernier jour (Paris).
    C'est la garde qui fait apparaître le Bilan et disparaître « Aujourd'hui ». */
export function challengeIsOver(f: Fenetre = FENETRE_ENV): boolean {
  return parisToday() > f.end;
}

/** La saison 3 a-t-elle commencé ? Garde de l'écran de lancement et repère
    d'affichage. Vrai à partir du jour de bascule (Paris) inclus. */
export function saison3Started(f: Fenetre = FENETRE_ENV): boolean {
  return parisToday() >= f.saison3;
}

/** Le bilan est-il encore provisoire ? Vrai tant que le dernier jour tombe dans
    la fenêtre d'édition. Avec EDIT_WINDOW_DAYS = 0, uniquement le jour même. */
export function bilanProvisoire(f: Fenetre = FENETRE_ENV): boolean {
  return isEditable(f.end, f);
}

/** Heures restantes avant le verrouillage définitif du dernier jour, pour le
    bandeau provisoire. Basé sur l'horloge réelle ; en simulation de date,
    part de minuit du jour simulé. */
export function hoursUntilFinalLock(f: Fenetre = FENETRE_ENV): number {
  // Avec EDIT_WINDOW_DAYS = 0, le dernier jour se verrouille à minuit (Paris)
  // le lendemain. La formule suit la constante si elle rouvre un jour.
  const lockDay = addDays(f.end, EDIT_WINDOW_DAYS + 1);
  // +02:00 = CEST. Vrai pour un challenge qui finit entre avril et octobre.
  // Une bande qui jouerait l'hiver verrait ce compteur décalé d'une heure —
  // c'est un bandeau cosmétique, je n'ai pas sorti l'artillerie fuseau pour ça.
  const deadline = new Date(`${lockDay}T00:00:00+02:00`).getTime();
  const sim = simulatedToday();
  const now = sim ? new Date(`${sim}T00:00:00+02:00`).getTime() : Date.now();
  return Math.max(0, Math.ceil((deadline - now) / 3_600_000));
}

// ---- Libellés français ----

const frFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const frShortFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const frDayMonthFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "numeric",
  month: "long",
});

function noon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** "lundi 14 juillet" */
export function frenchDate(day: string): string {
  return frFmt.format(noon(day));
}

/** "lun. 14 juil." */
export function frenchDateShort(day: string): string {
  return frShortFmt.format(noon(day));
}

/** "20 juillet" */
export function frenchDayMonth(day: string): string {
  return frDayMonthFmt.format(noon(day));
}

/** Jour de semaine 0 = lundi … 6 = dimanche. */
export function weekdayIndex(day: string): number {
  return (noon(day).getUTCDay() + 6) % 7;
}

/** Lundi de la semaine du jour donné. */
export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

// ---- Semaines du challenge ----
// La compétition hebdo repart de zéro chaque lundi 00h (Paris). Ce découpage
// lundi→dimanche, borné aux dates du challenge, sert l'historique du
// classement : une semaine passée = un appel leaderboard(from, until).

export type ChallengeWeek = {
  index: number; // 1 = première semaine
  from: string; // max(lundi, début de la ligue)
  until: string; // min(dimanche, fin de la ligue)
  current: boolean;
};

/** Les semaines écoulées ou en cours, de S1 à aujourd'hui. Vide avant le début. */
export function challengeWeeks(f: Fenetre = FENETRE_ENV): ChallengeWeek[] {
  const today = parisToday();
  const last = today > f.end ? f.end : today;
  if (last < f.start) return [];
  const currentMonday = mondayOf(last);
  const weeks: ChallengeWeek[] = [];
  let monday = mondayOf(f.start);
  for (let i = 1; monday <= currentMonday; i++, monday = addDays(monday, 7)) {
    const sunday = addDays(monday, 6);
    weeks.push({
      index: i,
      from: monday < f.start ? f.start : monday,
      until: sunday > f.end ? f.end : sunday,
      current: monday === currentMonday,
    });
  }
  return weeks;
}
