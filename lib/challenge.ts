// Constantes du challenge + helpers de dates en heure de Paris.
// Les dates sont volontairement en dur : elles ne changeront pas.
// Toutes les dates manipulées ici sont des chaînes 'YYYY-MM-DD' (jour civil Paris).

export const CHALLENGE_START = "2026-07-13";
export const CHALLENGE_END = "2026-08-31";

// Fenêtre d'édition glissante : aujourd'hui, hier, avant-hier.
export const EDIT_WINDOW_DAYS = 2;

// Formateur figé sur Europe/Paris. en-CA donne directement 'YYYY-MM-DD'.
const parisDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil actuel à Paris, quel que soit le fuseau du téléphone. */
export function parisToday(): string {
  return parisDayFmt.format(new Date());
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

/** Un jour est-il éditable en régime normal ? (fenêtre 48h, pas de futur) */
export function isEditable(day: string): boolean {
  const today = parisToday();
  return day >= editableFrom() && day <= today && day <= CHALLENGE_END;
}

/** Jours restants avant la fin, jour J compris. 0 si le challenge est fini. */
export function daysLeft(): number {
  const today = parisToday();
  if (today > CHALLENGE_END) return 0;
  const from = today < CHALLENGE_START ? CHALLENGE_START : today;
  return diffDays(from, CHALLENGE_END) + 1;
}

/** Nombre de jours entre deux jours ISO (b - a). */
export function diffDays(a: string, b: string): number {
  const ms =
    new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** Tous les jours du challenge écoulés (du plus récent au plus ancien). */
export function elapsedDays(): string[] {
  const today = parisToday();
  const last = today > CHALLENGE_END ? CHALLENGE_END : today;
  if (last < CHALLENGE_START) return [];
  const days: string[] = [];
  for (let d = last; d >= CHALLENGE_START; d = addDays(d, -1)) days.push(d);
  return days;
}

/** Jours à rattraper à l'inscription : tous les jours écoulés sauf aujourd'hui. */
export function backfillDays(): string[] {
  return elapsedDays().filter((d) => d !== parisToday());
}

/** Le rattrapage initial d'un joueur est-il encore ouvert ? (48h max) */
export function backfillOpen(p: {
  created_at: string;
  backfill_closed_at: string | null;
}): boolean {
  if (p.backfill_closed_at !== null) return false;
  const deadline = new Date(p.created_at).getTime() + 48 * 3600 * 1000;
  return Date.now() < deadline;
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
