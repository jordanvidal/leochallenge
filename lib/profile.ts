// Le profil d'un joueur : ce que l'app sait de lui et n'affichait nulle part.
// Chaque validation est horodatée depuis le premier jour, chaque séance guidée
// est chronométrée — deux gisements qui ne servaient qu'une fois, à la seconde
// où ils étaient écrits.
//
// Chargé à la demande, seulement quand l'onglet Stats s'ouvre : ces colonnes
// n'ont rien à faire dans le payload du chemin critique.

import { supabase } from "./supabase";

export type Profile = {
  /** Heure de Paris (0-23) de chaque journée bouclée. Une entrée = une heure. */
  hours: number[];
  /** La séance guidée la plus courte, en secondes. null si aucune chronométrée. */
  fastestSeconds: number | null;
};

/**
 * Heure de Paris d'un timestamp ISO, 0 à 23. null si illisible.
 *
 * Deux pièges, tous les deux vécus :
 *
 * 1. Ne JAMAIS passer par format(). En fr-FR il rend « 21 h », espace et
 *    lettre compris, et Number("21 h") vaut NaN. On extrait donc la part
 *    `hour` via formatToParts, qui ne dépend pas de la locale. (L'app est
 *    en français, mais ici on lit un nombre, pas une phrase.)
 * 2. hour12:false rend « 24 » à minuit dans certaines locales, d'où le %24.
 *
 * Un NaN qui passe empoisonne tout en silence : cells[NaN]++ n'incrémente
 * rien, la bande reste plate et le libellé affiche « NaN h ». On renvoie
 * null et l'appelant jette la ligne.
 */
const parisHourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  hour12: false,
});
function parisHour(iso: string): number | null {
  const d = new Date(iso);
  // formatToParts LÈVE sur une date invalide (RangeError), il ne rend pas
  // NaN. Sans ce test, une seule ligne malformée ferait rejeter tout
  // fetchProfiles et vider la page pour tout le monde.
  if (Number.isNaN(d.getTime())) return null;
  const part = parisHourFmt.formatToParts(d).find((p) => p.type === "hour");
  const h = part ? Number(part.value) : NaN;
  return Number.isInteger(h) && h >= 0 && h <= 24 ? h % 24 : null;
}

/**
 * Profils de tous les joueurs, en deux lectures. Les deux tables sont
 * minuscules (8 joueurs × 50 jours au pire), on agrège côté client plutôt
 * que d'ajouter une vue à maintenir.
 *
 * Erreur réseau : on rend une map vide. La page se dégrade en cachant le
 * créneau et le chrono, elle ne casse pas.
 */
export async function fetchProfiles(): Promise<Map<string, Profile>> {
  const [entries, sessions] = await Promise.all([
    supabase
      .from("entries")
      .select("player_id, completed_at")
      .not("completed_at", "is", null),
    supabase
      .from("workout_sessions")
      .select("player_id, duration_seconds")
      .not("finished_at", "is", null),
  ]);

  const out = new Map<string, Profile>();
  const get = (id: string): Profile => {
    const found = out.get(id);
    if (found) return found;
    const fresh: Profile = { hours: [], fastestSeconds: null };
    out.set(id, fresh);
    return fresh;
  };

  for (const r of (entries.data ?? []) as {
    player_id: string;
    completed_at: string;
  }[]) {
    const h = parisHour(r.completed_at);
    if (h !== null) get(r.player_id).hours.push(h);
  }

  for (const r of (sessions.data ?? []) as {
    player_id: string;
    duration_seconds: number | null;
  }[]) {
    if (r.duration_seconds === null) continue;
    const p = get(r.player_id);
    if (p.fastestSeconds === null || r.duration_seconds < p.fastestSeconds) {
      p.fastestSeconds = r.duration_seconds;
    }
  }

  return out;
}

/** Répartition des validations sur 24 h : un compteur par heure. */
export function hourCounts(hours: number[]): number[] {
  const cells = new Array(24).fill(0);
  for (const h of hours) cells[h]++;
  return cells;
}

/** « le soir · 17 h–22 h ». null tant qu'il n'y a rien à décrire. */
export function slotLabel(
  hours: number[],
): { moment: string; range: string } | null {
  if (hours.length === 0) return null;
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  const mid = hours.reduce((a, b) => a + b, 0) / hours.length;
  const moment =
    mid < 11
      ? "le matin"
      : mid < 15
        ? "le midi"
        : mid < 19
          ? "l'après-midi"
          : "le soir";
  return { moment, range: `${lo} h–${hi} h` };
}

/** "12:37" — mêmes minutes:secondes que l'écran de fin de séance. */
export function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
