// Couche séance guidée côté client : formats favoris (liste MRU),
// session serveur, helpers de format. La durée officielle vient du
// serveur (now() aux deux bouts) — le client ne transmet jamais un
// chrono, il le lit.

import { parisToday } from "./challenge";
import { supabase } from "./supabase";
import { Exercise, EXERCISES } from "./types";

export type WorkoutConfig = {
  rounds: number;
  reps: Record<Exercise, number>; // répétitions par exo et par tour
  restSeconds: number;
};

/** Le format canonique : 4 tours de 25/25/25, 2 min de repos. */
export const DEFAULT_CONFIG: WorkoutConfig = {
  rounds: 4,
  reps: { pushups: 25, abs: 25, squats: 25 },
  restSeconds: 120,
};

export type WorkoutPreset = {
  id: string;
  player_id: string;
  rounds: number;
  pushups_reps: number;
  abs_reps: number;
  squats_reps: number;
  rest_seconds: number;
  last_used_at: string;
};

export function presetToConfig(p: WorkoutPreset): WorkoutConfig {
  return {
    rounds: p.rounds,
    reps: { pushups: p.pushups_reps, abs: p.abs_reps, squats: p.squats_reps },
    restSeconds: p.rest_seconds,
  };
}

/** "4 × 25/25/25 · 2 min" */
export function configLabel(c: WorkoutConfig): string {
  return `${c.rounds} × ${c.reps.pushups}/${c.reps.abs}/${c.reps.squats} · ${formatRest(c.restSeconds)}`;
}

export function configEquals(a: WorkoutConfig, b: WorkoutConfig): boolean {
  return (
    a.rounds === b.rounds &&
    a.restSeconds === b.restSeconds &&
    EXERCISES.every(({ key }) => a.reps[key] === b.reps[key])
  );
}

/** Total prévu par exo sur toute la séance. */
export function configTotals(c: WorkoutConfig): Record<Exercise, number> {
  return {
    pushups: c.rounds * c.reps.pushups,
    abs: c.rounds * c.reps.abs,
    squats: c.rounds * c.reps.squats,
  };
}

/** Exos dont le total planifié couvre les 100 du challenge. */
export function coveredExos(c: WorkoutConfig): Exercise[] {
  const totals = configTotals(c);
  return EXERCISES.filter(({ key }) => totals[key] >= 100).map((e) => e.key);
}

/** Manques francs à annoncer avant de lancer : "80 pompes sur 100". */
export function coverageGaps(c: WorkoutConfig): string[] {
  const totals = configTotals(c);
  return EXERCISES.filter(({ key }) => totals[key] < 100).map(
    ({ key, label }) => `${totals[key]} ${label.toLowerCase()} sur 100`,
  );
}

// ---- Formats de durée ----

/** "22 min 14" / "48 s" — pour le partage et les phrases. */
export function formatDuration(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

/** "22:14" — pour les gros chiffres à l'écran. */
export function formatClock(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "2 min" / "1 min 30" / "45 s" — pour les libellés de repos. */
export function formatRest(total: number): string {
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, "0")}`;
}

/** Traduit une erreur des triggers séance en phrase humaine. */
export function humanWorkoutError(message: string): string {
  if (message.includes("SEANCE_FIGEE"))
    return "Une séance est déjà au chrono aujourd'hui — celle-ci ne comptera pas";
  if (message.includes("SEANCE_TROP_COURTE"))
    return "Moins de 5 min : trop rapide pour être vrai, chrono refusé";
  if (message.includes("SEANCE_INTROUVABLE"))
    return "Chrono non enregistré (hors ligne au départ ?)";
  return "Écriture échouée, la séance reste comptée localement";
}

// ---- Accès base ----

/** Formats du joueur, du plus récemment utilisé au plus ancien. */
export async function fetchPresets(playerId: string): Promise<WorkoutPreset[]> {
  const { data, error } = await supabase
    .from("workout_presets")
    .select("*")
    .eq("player_id", playerId)
    .order("last_used_at", { ascending: false });
  return error ? [] : (data as WorkoutPreset[]);
}

/** Mémorise le format utilisé (MRU auto-gérée en base, silencieux). */
export async function touchPreset(
  playerId: string,
  c: WorkoutConfig,
): Promise<void> {
  await supabase.from("workout_presets").upsert(
    {
      player_id: playerId,
      rounds: c.rounds,
      pushups_reps: c.reps.pushups,
      abs_reps: c.reps.abs,
      squats_reps: c.reps.squats,
      rest_seconds: c.restSeconds,
    },
    { onConflict: "player_id,rounds,pushups_reps,abs_reps,squats_reps,rest_seconds" },
  );
}

/** Ouvre la séance du jour côté serveur (départ = now() serveur).
    Renvoie le jour de la session, ou le message d'erreur. */
export async function startSession(
  playerId: string,
  c: WorkoutConfig,
): Promise<{ day: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .upsert(
      { player_id: playerId, day: parisToday(), config: c },
      { onConflict: "player_id,day" },
    )
    .select("day")
    .single();
  if (error || !data) return { day: null, error: error?.message ?? "inconnu" };
  return { day: data.day as string, error: null };
}

/** Clôt la séance : le serveur fixe la fin et calcule la durée. */
export async function finishSession(
  playerId: string,
  day: string,
): Promise<{ duration: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .update({ finished_at: new Date().toISOString() })
    .match({ player_id: playerId, day })
    .is("finished_at", null)
    .select("duration_seconds")
    .maybeSingle();
  if (error) return { duration: null, error: error.message };
  if (!data) return { duration: null, error: "SEANCE_INTROUVABLE" };
  return { duration: Number(data.duration_seconds), error: null };
}

/** Durée de la séance clôturée du jour (pour la ligne de partage). */
export async function fetchTodaySessionDuration(
  playerId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .select("duration_seconds")
    .match({ player_id: playerId, day: parisToday() })
    .not("finished_at", "is", null)
    .maybeSingle();
  if (error || !data) return null;
  return Number(data.duration_seconds);
}

export type DayBreakdown = { points: number; bonusPoints: number };

/** Points du jour d'un joueur, base et bonus séparés (RPC leaderboard
    bornée à un jour — la vue daily_points fait déjà le calcul, on lit). */
export async function fetchDayBreakdown(
  playerId: string,
  day: string,
): Promise<DayBreakdown | null> {
  const { data, error } = await supabase.rpc("leaderboard", {
    p_from: day,
    p_until: day,
  });
  if (error || !data) return null;
  const mine = (
    data as { player_id: string; points: number; bonus_points: number }[]
  ).find((r) => r.player_id === playerId);
  if (!mine) return null;
  return { points: Number(mine.points), bonusPoints: Number(mine.bonus_points) };
}
