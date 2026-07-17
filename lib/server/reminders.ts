// Les rappels quotidiens : la pression sociale à heure fixe.
// 17h — série en danger : celui qui a une série et rien coché a encore
//       toute la soirée pour la sauver. À 22h30 le message arrivait
//       trop tard pour changer la décision.
// 20h / 22h30 — "Marc et Léo ont fini. Pas toi." — c'est ça qui fait
//       faire les pompes.
// 21h30 — dernier debout : le seul encore à 0/3 reçoit la phrase qui
//       pique. Elle n'existe que quand elle est vraie.

import { addDays, CHALLENGE_END, CHALLENGE_START } from "@/lib/challenge";
import { parisToday, sendToPlayers, serverSupabase } from "./push";

type Entry = {
  player_id: string;
  day: string;
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};

type PlayerRow = { id: string; name: string };
type LbRow = { player_id: string; current_streak: number };

// Seuil où le multiplicateur de série est actif : en dessous, rien à perdre.
const STREAK_AT_RISK = 3;

/** Hors des dates du challenge, aucun rappel ne part. */
function offSeason(today: string): boolean {
  return today < CHALLENGE_START || today > CHALLENGE_END;
}

function doneCount(e: Entry | undefined): number {
  return e ? (e.pushups ? 1 : 0) + (e.abs ? 1 : 0) + (e.squats ? 1 : 0) : 0;
}

/** Joueurs + coches sur 7 jours glissants : le socle de tous les rappels.
    `count` = exos cochés aujourd'hui ; `active` = au moins une coche sur
    la fenêtre (les inscrits fantômes ne comptent pas dans la bande). */
async function loadToday() {
  const supabase = serverSupabase();
  const today = parisToday();
  const [players, entries] = await Promise.all([
    supabase.from("players").select("id, name"),
    supabase
      .from("entries")
      .select("player_id, day, pushups, abs, squats")
      .gte("day", addDays(today, -6))
      .lte("day", today),
  ]);
  if (players.error || entries.error) {
    throw new Error("lecture Supabase échouée");
  }
  const rows = entries.data as Entry[];
  const byPlayer = new Map(
    rows.filter((e) => e.day === today).map((e) => [e.player_id, e]),
  );
  const activeIds = new Set(
    rows.filter((e) => doneCount(e) > 0).map((e) => e.player_id),
  );
  return {
    supabase,
    today,
    players: players.data as PlayerRow[],
    count: (p: PlayerRow) => doneCount(byPlayer.get(p.id)),
    active: (p: PlayerRow) => activeIds.has(p.id),
  };
}

/** Rappels de 20h (social) et 22h30 (dernier appel), pour les 0/3. */
export async function sendReminders(final: boolean): Promise<{
  notified: number;
  sent: number;
}> {
  const { today, players, count } = await loadToday();
  if (offSeason(today)) return { notified: 0, sent: 0 };

  // Cibles : rien coché aujourd'hui (0/3). Les 1/3 et 2/3 ont déjà ouvert l'app.
  const slackers = players.filter((p) => count(p) === 0);
  const finishers = players.filter((p) => count(p) === 3);
  if (slackers.length === 0) return { notified: 0, sent: 0 };

  const names = finishers.map((f) => f.name);
  let body: string;
  if (final) {
    body = "22h30. Dernier appel pour les 300. Demain il sera trop tard.";
  } else if (names.length === 0) {
    body = "Personne n'a encore fini aujourd'hui. Sois le premier.";
  } else if (names.length === 1) {
    body = `${names[0]} a fini. Pas toi.`;
  } else if (names.length === 2) {
    body = `${names[0]} et ${names[1]} ont fini. Pas toi.`;
  } else {
    body = `${names[0]}, ${names[1]} et ${names.length - 2} autre${names.length > 3 ? "s" : ""} ont fini. Pas toi.`;
  }

  const sent = await sendToPlayers(
    slackers.map((s) => s.id),
    { title: "💪 100 · 100 · 100", body },
  );
  return { notified: slackers.length, sent };
}

/** Message "série en danger" : personnalisé, court, il fait mal gentiment. */
function streakBody(streak: number): string {
  if (streak >= 7) {
    return `${streak} jours parfaits d'affilée et rien de coché aujourd'hui. Ton ×2 saute à minuit.`;
  }
  return `Ta série de ${streak} jours tombe à minuit. 3 exos ce soir et elle tient.`;
}

/** 17h — la série en danger. La série vient du RPC leaderboard
    (current_streak reflète la série jusqu'à hier tant qu'aujourd'hui
    n'est pas parfait — exactement ce qui est en jeu). */
export async function sendStreakRisk(): Promise<{
  notified: number;
  sent: number;
}> {
  const { supabase, today, players, count } = await loadToday();
  if (offSeason(today)) return { notified: 0, sent: 0 };

  const lb = await supabase.rpc("leaderboard");
  if (lb.error) throw new Error("lecture leaderboard échouée");
  const streaks = new Map(
    (lb.data as LbRow[]).map((r) => [r.player_id, Number(r.current_streak)]),
  );

  const atRisk = players.filter(
    (p) => count(p) === 0 && (streaks.get(p.id) ?? 0) >= STREAK_AT_RISK,
  );

  // Envoi individuel : le message porte le nombre de jours de chacun.
  let sent = 0;
  for (const p of atRisk) {
    sent += await sendToPlayers([p.id], {
      title: "🔥 Ta série est en jeu",
      body: streakBody(streaks.get(p.id) ?? 0),
    });
  }
  return { notified: atRisk.length, sent };
}

/** 21h30 — le dernier debout. Un seul joueur ACTIF à 0/3 pendant que
    tous les autres ont avancé : lui seul reçoit le message. Deux
    retardataires ou plus → silence, la phrase perdrait sa vérité. Les
    inscrits fantômes (aucune coche sur 7 jours) ne comptent pas — sinon
    la notif ne partirait jamais. */
export async function sendLastStanding(): Promise<{
  notified: number;
  sent: number;
}> {
  const { today, players, count, active } = await loadToday();
  if (offSeason(today)) return { notified: 0, sent: 0 };

  const band = players.filter(active);
  if (band.length < 2) return { notified: 0, sent: 0 };
  const slackers = band.filter((p) => count(p) === 0);
  if (slackers.length !== 1) return { notified: 0, sent: 0 };

  const sent = await sendToPlayers([slackers[0].id], {
    title: "🕯️ Dernier debout",
    body: "Tout le monde a coché aujourd'hui. Sauf toi.",
  });
  return { notified: 1, sent };
}
