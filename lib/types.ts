// Types partagés, miroir du schéma Supabase.

export type Player = {
  id: string;
  name: string;
  color: string; // couleur d'accent oklch(), auto-assignée à la création
  created_at: string;
  // La colonne players.backfill_closed_at existe toujours en base (vestige du
  // rattrapage initial, retiré par migration9-jour-en-cours.sql). Plus rien ne
  // la lit ni ne l'écrit : elle n'est pas typée ici exprès.
};

export type Exercise = "pushups" | "abs" | "squats";

export const EXERCISES: { key: Exercise; label: string }[] = [
  { key: "pushups", label: "Pompes" },
  { key: "abs", label: "Abdos" },
  { key: "squats", label: "Squats" },
];

export type Entry = {
  player_id: string;
  day: string; // 'YYYY-MM-DD'
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};

/** Clé de map pour retrouver une entrée. */
export function entryKey(playerId: string, day: string): string {
  return `${playerId}|${day}`;
}

/** Nombre d'exos validés sur une entrée (0 à 3). */
export function entryCount(e: Entry | undefined): number {
  if (!e) return 0;
  return (e.pushups ? 1 : 0) + (e.abs ? 1 : 0) + (e.squats ? 1 : 0);
}
