// Détail des points d'un joueur : lecture de la RPC player_breakdown
// (par source) et de la vue daily_points (jour par jour). Aucun calcul
// ici — la RPC et la vue sont la seule vérité, elles rejouent la même
// logique que le classement. On ne fait que trier pour l'affichage.

import { supabase } from "./supabase";

export type BreakdownRow = {
  category: "base" | "bonus";
  item_key: string;
  emoji: string;
  label: string;
  cnt: number;
  points: number;
};

export type Breakdown = {
  base: BreakdownRow[]; // exos, journées parfaites, série (ordre fixe)
  bonus: BreakdownRow[]; // par points décroissants
  baseTotal: number;
  bonusTotal: number;
};

// Ordre d'affichage de la base : socle → parfait → série.
const BASE_ORDER = ["exos", "perfect", "streak"];

/** Charge le détail d'un joueur sur la fenêtre demandée (null = tout). */
export async function fetchBreakdown(
  playerId: string,
  from?: string | null,
  until?: string | null,
): Promise<Breakdown | null> {
  const { data, error } = await supabase.rpc("player_breakdown", {
    p_player: playerId,
    p_from: from ?? null,
    p_until: until ?? null,
  });
  if (error || !data) return null;

  const rows = (data as BreakdownRow[]).map((r) => ({
    ...r,
    cnt: Number(r.cnt),
    points: Number(r.points),
  }));

  const base = rows
    .filter((r) => r.category === "base")
    .sort((a, b) => BASE_ORDER.indexOf(a.item_key) - BASE_ORDER.indexOf(b.item_key));
  const bonus = rows
    .filter((r) => r.category === "bonus")
    .sort((a, b) => b.points - a.points);

  const sum = (rs: BreakdownRow[]) => rs.reduce((s, r) => s + r.points, 0);
  return {
    base,
    bonus,
    baseTotal: sum(base),
    bonusTotal: sum(bonus),
  };
}

export type DayPoints = {
  day: string; // "2026-07-14"
  exos: number; // 0..3
  perfect: boolean;
  multiplier: number; // 1 | 1.5 | 2
  points: number; // total du jour
  bonusPoints: number; // dont bonus
};

/** Points jour par jour d'un joueur, du plus récent au plus ancien.
    Lecture directe de la vue daily_points (déjà par jour) — même
    calcul que le classement, on ne garde que les jours qui comptent. */
export async function fetchDays(
  playerId: string,
  from?: string | null,
  until?: string | null,
): Promise<DayPoints[] | null> {
  let q = supabase
    .from("daily_points")
    .select("day, exos, perfect, multiplier, points, bonus_points")
    .eq("player_id", playerId)
    .order("day", { ascending: false });
  if (from) q = q.gte("day", from);
  if (until) q = q.lte("day", until);

  const { data, error } = await q;
  if (error || !data) return null;

  return (data as Record<string, unknown>[])
    .map((r) => ({
      day: r.day as string,
      exos: Number(r.exos),
      perfect: Boolean(r.perfect),
      multiplier: Number(r.multiplier),
      points: Number(r.points),
      bonusPoints: Number(r.bonus_points),
    }))
    .filter((d) => d.points !== 0 || d.exos > 0);
}
