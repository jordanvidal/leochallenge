// Le job duels du lundi matin, appelé par /api/cron/weekly-recap juste
// avant le récap. Trois responsabilités, AUCUN point écrit (la vue
// duel_results a déjà tout résolu à minuit) :
//   1. raconter les duels de la semaine écoulée (feed + lignes push) ;
//   2. apparier la nouvelle semaine (rangs voisins parmi les actifs,
//      exempt tournant si impair) ;
//   3. rendre les lignes push par joueur, que le récap embarque dans
//      SA notification — un seul push le lundi, pas deux.
// Rejouable sans dégât : l'appariement saute si la semaine existe déjà,
// le feed est dédupliqué par (player_id, kind, dedupe_key), et les
// lignes sont toujours reconstruites depuis l'état en base.

import { addDays, CHALLENGE_END, weekdayIndex } from "@/lib/challenge";
import { DUEL_POINTS, DUELS_FROM } from "@/lib/duels";
import { parisToday, serverSupabase } from "./push";

type DuelRow = { week_monday: string; player_a: string; player_b: string | null };
type ResultRow = {
  week_monday: string;
  player_a: string;
  player_b: string;
  perfect_a: number;
  perfect_b: number;
  points_a: number; // numeric Postgres : renvoyé en string, Number() au lu
  points_b: number;
  winner: string | null;
  loser: string | null;
  tiebreak_used: boolean;
};
type FeedInsert = {
  player_id: string;
  kind: "duel_start" | "duel_result";
  dedupe_key: string;
  payload: Record<string, unknown>;
};

/** Lignes à appendre au push du récap, par joueur. */
export type DuelLines = Map<string, string[]>;

function pushLine(lines: DuelLines, playerId: string, line: string): void {
  lines.set(playerId, [...(lines.get(playerId) ?? []), line]);
}

/** Points sans décimale inutile (23 plutôt que 23.0). */
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "3 jours parfaits à 2" ou "2–2, départage aux points 23,5–19". */
function scoreLabel(myP: number, theirP: number, myPts: number, theirPts: number): string {
  if (myP !== theirP) return `${myP} jours parfaits à ${theirP}`;
  return `${myP}–${theirP}, départage aux points ${fmt(myPts)}–${fmt(theirPts)}`;
}

export async function runWeeklyDuels(): Promise<{
  skipped?: string;
  resolved: number;
  created: number;
  feedInserted: number;
  lines: DuelLines;
}> {
  const today = parisToday();
  const none = { resolved: 0, created: 0, feedInserted: 0, lines: new Map() };
  if (today > CHALLENGE_END) return { skipped: "challenge terminé", ...none };
  // Le workflow a un déclencheur manuel : hors lundi, on ne touche à rien.
  if (weekdayIndex(today) !== 0) return { skipped: "pas lundi", ...none };

  const supabase = serverSupabase();
  const players = await supabase.from("players").select("id, name");
  if (players.error) throw new Error("lecture players échouée");
  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );
  const name = (id: string) => names.get(id) ?? "Quelqu'un";

  const lines: DuelLines = new Map();
  const events: FeedInsert[] = [];

  // ---- 1. La semaine écoulée : raconter ce que la vue a résolu ----
  let resolved = 0;
  const playedMonday = addDays(today, -7);
  if (playedMonday >= DUELS_FROM) {
    const res = await supabase
      .from("duel_results")
      .select(
        "week_monday, player_a, player_b, perfect_a, perfect_b, points_a, points_b, winner, loser, tiebreak_used",
      )
      .eq("week_monday", playedMonday);
    if (res.error) throw new Error("lecture duel_results échouée");

    for (const raw of res.data as ResultRow[]) {
      const r = { ...raw, points_a: Number(raw.points_a), points_b: Number(raw.points_b) };
      resolved++;
      if (r.winner && r.loser) {
        const wIsA = r.winner === r.player_a;
        const wP = wIsA ? r.perfect_a : r.perfect_b;
        const lP = wIsA ? r.perfect_b : r.perfect_a;
        const wPts = wIsA ? r.points_a : r.points_b;
        const lPts = wIsA ? r.points_b : r.points_a;
        events.push({
          player_id: r.winner,
          kind: "duel_result",
          dedupe_key: r.week_monday,
          payload: {
            week_monday: r.week_monday,
            opponent: name(r.loser),
            opponent_id: r.loser,
            score: `${wP}–${lP}`,
            pointsScore: `${fmt(wPts)}–${fmt(lPts)}`,
            outcome: "win",
            tiebreak: r.tiebreak_used,
            points: DUEL_POINTS,
          },
        });
        pushLine(
          lines,
          r.winner,
          `⚔️ Duel gagné contre ${name(r.loser)} (${scoreLabel(wP, lP, wPts, lPts)}) : +${DUEL_POINTS} pts pris dans sa poche.`,
        );
        pushLine(
          lines,
          r.loser,
          `⚔️ Duel perdu contre ${name(r.winner)} (${scoreLabel(lP, wP, lPts, wPts)}) : il te prend ${DUEL_POINTS} pts. Vengeance ?`,
        );
      } else {
        events.push({
          player_id: r.player_a,
          kind: "duel_result",
          dedupe_key: r.week_monday,
          payload: {
            week_monday: r.week_monday,
            opponent: name(r.player_b),
            opponent_id: r.player_b,
            score: `${r.perfect_a}–${r.perfect_b}`,
            pointsScore: `${fmt(r.points_a)}–${fmt(r.points_b)}`,
            outcome: "draw",
          },
        });
        pushLine(
          lines,
          r.player_a,
          `⚔️ Duel nul contre ${name(r.player_b)} — personne ne lâche, aucun point ne bouge.`,
        );
        pushLine(
          lines,
          r.player_b,
          `⚔️ Duel nul contre ${name(r.player_a)} — personne ne lâche, aucun point ne bouge.`,
        );
      }
    }
  }

  // ---- 2. La nouvelle semaine : apparier (sauf si déjà fait) ----
  let created = 0;
  // Le 31/08 (dernier jour) : la semaine n'irait pas jusqu'à dimanche,
  // pas de nouvel appariement — on ne fait que résoudre la précédente.
  if (today >= DUELS_FROM && addDays(today, 6) <= CHALLENGE_END) {
    const existing = await supabase
      .from("duels")
      .select("week_monday, player_a, player_b")
      .eq("week_monday", today);
    if (existing.error) throw new Error("lecture duels échouée");

    let weekDuels = existing.data as DuelRow[];
    if (weekDuels.length === 0) {
      weekDuels = await createPairings(supabase, today);
      created = weekDuels.length;
    }

    for (const d of weekDuels) {
      if (d.player_b === null) {
        events.push({
          player_id: d.player_a,
          kind: "duel_start",
          dedupe_key: today,
          payload: { week_monday: today, bye: true },
        });
        pushLine(lines, d.player_a, "⚔️ Exempt cette semaine — profite, ça ne durera pas.");
      } else {
        events.push({
          player_id: d.player_a,
          kind: "duel_start",
          dedupe_key: today,
          payload: {
            week_monday: today,
            opponent: name(d.player_b),
            opponent_id: d.player_b,
            points: DUEL_POINTS,
          },
        });
        const line = (opp: string) =>
          `⚔️ Nouveau duel : toi contre ${opp}. Le plus de jours parfaits d'ici dimanche rafle ${DUEL_POINTS} pts.`;
        pushLine(lines, d.player_a, line(name(d.player_b)));
        pushLine(lines, d.player_b, line(name(d.player_a)));
      }
    }
  }

  // ---- 3. Feed : dédupliqué en base, un rejeu n'insère rien ----
  let feedInserted = 0;
  if (events.length > 0) {
    const { data } = await supabase
      .from("feed_events")
      .upsert(events, {
        onConflict: "player_id,kind,dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");
    feedInserted = data?.length ?? 0;
  }

  return { resolved, created, feedInserted, lines };
}

/** Apparie la semaine `monday` : rangs voisins parmi les actifs, exempt
    tournant si impair. Écrit les lignes en un seul insert et les renvoie. */
async function createPairings(
  supabase: ReturnType<typeof serverSupabase>,
  monday: string,
): Promise<DuelRow[]> {
  // Actifs = au moins une coche sur [lundi-6, lundi] (sémantique reminders).
  const [entries, ranks, byes] = await Promise.all([
    supabase
      .from("entries")
      .select("player_id, pushups, abs, squats")
      .gte("day", addDays(monday, -6))
      .lte("day", monday),
    // Rangs figés à dimanche soir : déterministes au rejeu, et ils
    // intègrent déjà le transfert du duel tout juste résolu.
    supabase.rpc("leaderboard", { p_until: addDays(monday, -1) }),
    supabase.from("duels").select("week_monday, player_a").is("player_b", null),
  ]);
  if (entries.error || ranks.error || byes.error) {
    throw new Error("lecture appariement échouée");
  }

  const activeIds = new Set(
    (entries.data as { player_id: string; pushups: boolean; abs: boolean; squats: boolean }[])
      .filter((e) => e.pushups || e.abs || e.squats)
      .map((e) => e.player_id),
  );
  if (activeIds.size < 2) return [];

  // Classés du 1er au dernier ; player_id en départage d'ex-æquo pour
  // que deux rejeux le même jour donnent le même ordre.
  const ranked = (ranks.data as { player_id: string; rank: number }[])
    .filter((r) => activeIds.has(r.player_id))
    .sort((a, b) => a.rank - b.rank || a.player_id.localeCompare(b.player_id));

  let pool = ranked.map((r) => r.player_id);
  const rows: DuelRow[] = [];

  if (pool.length % 2 === 1) {
    // L'exempt tourne : jamais exempt d'abord, puis bye le plus ancien.
    // À historique égal, le moins bien classé souffle. Et jamais deux
    // fois de suite quand il y a une alternative.
    const lastBye = new Map<string, string>();
    for (const b of byes.data as { week_monday: string; player_a: string }[]) {
      const prev = lastBye.get(b.player_a);
      if (!prev || b.week_monday > prev) lastBye.set(b.player_a, b.week_monday);
    }
    const rankOf = new Map(pool.map((id, i) => [id, i]));
    const candidates = [...pool].sort((a, b) => {
      const byeA = lastBye.get(a) ?? "";
      const byeB = lastBye.get(b) ?? "";
      if (byeA !== byeB) return byeA < byeB ? -1 : 1;
      return (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0);
    });
    let exempt = candidates[0];
    if (lastBye.get(exempt) === addDays(monday, -7) && candidates.length > 1) {
      exempt = candidates[1];
    }
    pool = pool.filter((id) => id !== exempt);
    rows.push({ week_monday: monday, player_a: exempt, player_b: null });
  }

  for (let i = 0; i + 1 < pool.length; i += 2) {
    rows.push({ week_monday: monday, player_a: pool[i], player_b: pool[i + 1] });
  }

  const { error } = await supabase.from("duels").insert(rows);
  if (error) throw new Error(`écriture duels échouée : ${error.message}`);
  return rows;
}
