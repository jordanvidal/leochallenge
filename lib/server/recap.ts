// Récap hebdo du lundi matin : LE push positif de la semaine.
// Le classement hebdo vient de se réinitialiser — on raconte la semaine
// écoulée (gagnant, place gagnée ou perdue au général) et on annonce
// que la course repart. Jamais de reproche : c'est le beat narratif,
// pas un nag de plus.

import {
  addDays,
  CHALLENGE_END,
  CHALLENGE_START,
  mondayOf,
} from "@/lib/challenge";
import { parisToday, sendToPlayers, serverSupabase } from "./push";

type LbRow = { player_id: string; points: number; rank: number };

/** "1er", "2e", "3e"… (dupliqué de lib/gamification pour le serveur). */
function frenchRank(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

/** Points sans décimale inutile (31 plutôt que 31.0). */
function fmtPoints(p: number): string {
  const n = Number(p);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Première ligne : la place au général et le mouvement de la semaine. */
function rankLine(rank: number, before: number | undefined): string {
  const place = frenchRank(rank);
  if (before === undefined) return `Tu finis ${place}.`;
  const delta = before - rank; // positif = des places gagnées
  if (delta > 0) return `Tu finis ${place} (↑${delta}).`;
  if (delta < 0) {
    return `Tu finis ${place} (↓${-delta}) — la nouvelle course repart maintenant.`;
  }
  return `Tu restes ${place} — tu tiens ta place.`;
}

export async function sendWeeklyRecap(
  // Lignes duels par joueur (runWeeklyDuels), appendues au corps du push :
  // un seul envoi le lundi matin, le récap porte tout.
  duelLines?: Map<string, string[]>,
): Promise<{
  skipped?: string;
  notified: number;
  sent: number;
}> {
  const today = parisToday();
  if (today > CHALLENGE_END) {
    return { skipped: "challenge terminé", notified: 0, sent: 0 };
  }

  // La semaine écoulée : du lundi dernier au dimanche d'hier.
  const monday = mondayOf(today);
  const lastMonday = addDays(monday, -7);
  const lastSunday = addDays(monday, -1);
  if (lastSunday < CHALLENGE_START) {
    // Tout premier lundi : pas de semaine écoulée à raconter.
    return { skipped: "pas de semaine écoulée", notified: 0, sent: 0 };
  }

  const supabase = serverSupabase();
  const [week, general, generalBefore, players] = await Promise.all([
    supabase.rpc("leaderboard", { p_from: lastMonday, p_until: lastSunday }),
    supabase.rpc("leaderboard", { p_until: lastSunday }),
    supabase.rpc("leaderboard", { p_until: addDays(lastSunday, -7) }),
    supabase.from("players").select("id, name"),
  ]);
  if (week.error || general.error || generalBefore.error || players.error) {
    throw new Error("lecture Supabase échouée");
  }

  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Gagnant(s) de la semaine : rang 1 avec des points. Égalité possible.
  const weekRows = week.data as LbRow[];
  const winners = weekRows.filter(
    (r) => Number(r.rank) === 1 && Number(r.points) > 0,
  );
  const winnerIds = new Set(winners.map((w) => w.player_id));
  const winnerPts = winners.length > 0 ? fmtPoints(Number(winners[0].points)) : "";
  const winnerNames = winners
    .map((w) => names.get(w.player_id) ?? "Quelqu'un")
    .join(" et ");

  // Mouvement au général : rang à dimanche dernier vs dimanche d'avant.
  // Même convention que lastWeekRanks côté client : si personne n'avait
  // de points à la borne précédente, la variation n'a pas de sens.
  const generalRows = general.data as LbRow[];
  const beforeRows = generalBefore.data as LbRow[];
  const beforeMeaningful = beforeRows.some((r) => Number(r.points) > 0);
  const ranksBefore = new Map(
    beforeMeaningful
      ? beforeRows.map((r) => [r.player_id, Number(r.rank)] as [string, number])
      : [],
  );

  const title = "📊 100 · 100 · 100";
  let sent = 0;
  for (const row of generalRows) {
    const line1 = winnerIds.has(row.player_id)
      ? `🏆 Tu as gagné la semaine avec ${winnerPts} pts !`
      : `📊 Semaine bouclée. ${rankLine(Number(row.rank), ranksBefore.get(row.player_id))}`;
    const lines = [line1];
    if (winners.length > 0 && !winnerIds.has(row.player_id)) {
      const verb = winners.length > 1 ? "ont raflé" : "a raflé";
      lines.push(`${winnerNames} ${verb} la semaine avec ${winnerPts} pts.`);
    }
    if (winnerIds.has(row.player_id)) {
      lines.push(rankLine(Number(row.rank), ranksBefore.get(row.player_id)));
      lines.push("Nouveau classement hebdo — remets ça dès aujourd'hui.");
    } else {
      lines.push("Nouveau classement hebdo — ça repart, à toi de jouer.");
    }
    lines.push(...(duelLines?.get(row.player_id) ?? []));
    sent += await sendToPlayers([row.player_id], {
      title,
      body: lines.join("\n"),
    });
  }

  return { notified: generalRows.length, sent };
}
