// Clôture hebdo du dimanche 21h (Paris) : le moment « dernières heures ».
// Le compteur de la semaine repart de zéro à minuit — on annonce qui mène,
// où chacun se situe, et qu'il reste une soirée pour renverser la table.
// Le récap du lundi matin racontera le résultat ; ici on crée l'urgence.

import {
  CHALLENGE_END,
  CHALLENGE_START,
  mondayOf,
  weekdayIndex,
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

export async function sendWeeklyClose(): Promise<{
  skipped?: string;
  notified: number;
  sent: number;
}> {
  const today = parisToday();
  if (today < CHALLENGE_START || today > CHALLENGE_END) {
    return { skipped: "hors challenge", notified: 0, sent: 0 };
  }
  // Garde anti-cron mal réglé : ce push n'a de sens qu'un dimanche soir.
  if (weekdayIndex(today) !== 6) {
    return { skipped: "pas un dimanche", notified: 0, sent: 0 };
  }

  const monday = mondayOf(today);
  const supabase = serverSupabase();
  const [week, players] = await Promise.all([
    supabase.rpc("leaderboard", { p_from: monday, p_until: today }),
    supabase.from("players").select("id, name"),
  ]);
  if (week.error || players.error) {
    throw new Error("lecture Supabase échouée");
  }

  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Leader(s) de la semaine en cours : rang 1 avec des points. Égalité possible.
  const rows = week.data as LbRow[];
  const leaders = rows.filter((r) => Number(r.rank) === 1 && Number(r.points) > 0);
  if (leaders.length === 0) {
    return { skipped: "semaine sans points", notified: 0, sent: 0 };
  }
  const leaderIds = new Set(leaders.map((l) => l.player_id));
  const leaderPts = fmtPoints(Number(leaders[0].points));
  const leaderNames = leaders
    .map((l) => names.get(l.player_id) ?? "Quelqu'un")
    .join(" et ");

  const title = "⏳ 100 · 100 · 100";
  let sent = 0;
  let notified = 0;
  for (const row of rows) {
    if (!names.has(row.player_id)) continue;
    notified++;
    const lines = leaderIds.has(row.player_id)
      ? [
          `🏆 Tu mènes la semaine avec ${leaderPts} pts.`,
          "Tiens jusqu'à minuit : le compteur repart à zéro et tout le monde te court après dès demain.",
        ]
      : [
          `${leaderNames} ${leaders.length > 1 ? "mènent" : "mène"} la semaine avec ${leaderPts} pts. Tu es ${frenchRank(Number(row.rank))} avec ${fmtPoints(Number(row.points))} pts.`,
          "Dernières heures pour marquer — à minuit, le compteur repart à zéro.",
        ];
    sent += await sendToPlayers([row.player_id], {
      title,
      body: lines.join("\n"),
    });
  }

  return { notified, sent };
}
