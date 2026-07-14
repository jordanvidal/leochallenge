// Les "moments" : appelée après chaque coche, compare l'état calculé
// (classement, badges, séries) à l'état stocké et insère ce qui a
// changé dans le feed. Étend l'ancien /api/overtake : la détection de
// dépassement (push "Sam vient de te passer") vit toujours ici.
// L'unicité (player_id, kind, dedupe_key) rend tout ré-exécutable :
// un appel raté est rattrapé au suivant, jamais de doublon.

import { NextResponse } from "next/server";
import { addDays } from "@/lib/challenge";
import { parisToday, sendToPlayers, serverSupabase } from "@/lib/server/push";

export const dynamic = "force-dynamic";

type LbRow = { player_id: string; rank: number; points: number };
type Snap = { player_id: string; rank: number };
type BadgeRow = { player_id: string; badge: string };
type StreakRow = { player_id: string; day: string; streak_pos: number };
type FeedInsert = {
  player_id: string;
  kind: "lead" | "badge" | "record" | "milestone";
  dedupe_key: string;
  payload: Record<string, unknown>;
};

const MILESTONES = [7, 14, 21, 30];

/** 📈 records et ⚡ milestones, dérivés des streak_pos de daily_points.
    Un seul record par série (dedupe = jour de départ de la série) :
    battre son record de 1 chaque matin ne spamme pas le fil. */
function streakMoments(rows: StreakRow[], today: string): FeedInsert[] {
  const byPlayer = new Map<string, StreakRow[]>();
  for (const r of rows) {
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }

  const out: FeedInsert[] = [];
  for (const [playerId, days] of byPlayer) {
    days.sort((a, b) => (a.day < b.day ? -1 : 1));
    const last = days[days.length - 1];
    // Série en cours seulement : dernier jour parfait = aujourd'hui ou hier
    // (même convention que current_streak dans leaderboard()).
    if (last.day < addDays(today, -1)) continue;

    const streak = Number(last.streak_pos);
    const islandStart = addDays(last.day, -(streak - 1));
    // Meilleure série AVANT celle en cours (0 si première série).
    const best = days
      .filter((d) => d.day < islandStart)
      .reduce((max, d) => Math.max(max, Number(d.streak_pos)), 0);

    // Record perso : uniquement à partir de 3 jours, sinon tout est un record.
    if (streak >= 3 && streak > best) {
      out.push({
        player_id: playerId,
        kind: "record",
        dedupe_key: islandStart,
        payload: { streak },
      });
    }
    for (const m of MILESTONES) {
      if (streak >= m) {
        out.push({
          player_id: playerId,
          kind: "milestone",
          dedupe_key: `${islandStart}:${m}`,
          payload: { streak: m },
        });
      }
    }
  }
  return out;
}

export async function POST(request: Request) {
  const { actorId } = (await request.json().catch(() => ({}))) as {
    actorId?: string;
  };
  if (!actorId) {
    return NextResponse.json({ error: "actorId requis" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const [lb, snaps, players, badges, streaks] = await Promise.all([
    supabase.rpc("leaderboard"),
    supabase.from("rank_snapshots").select("player_id, rank"),
    supabase.from("players").select("id, name"),
    supabase.from("player_badges").select("player_id, badge"),
    supabase
      .from("daily_points")
      .select("player_id, day, streak_pos")
      .gt("streak_pos", 0),
  ]);
  if (lb.error || snaps.error || players.error || badges.error || streaks.error) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }

  const lbRows = lb.data as LbRow[];
  const newRanks = new Map(lbRows.map((r) => [r.player_id, Number(r.rank)]));
  const oldRanks = new Map(
    (snaps.data as Snap[]).map((s) => [s.player_id, Number(s.rank)]),
  );
  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // 📉 Dépassés par l'acteur : ils étaient devant, ils sont derrière.
  const actorOld = oldRanks.get(actorId);
  const actorNew = newRanks.get(actorId);
  const overtaken: string[] = [];
  if (actorOld !== undefined && actorNew !== undefined) {
    for (const [pid, oldRank] of oldRanks) {
      if (pid === actorId) continue;
      const newRank = newRanks.get(pid);
      if (newRank === undefined) continue;
      if (oldRank < actorOld && newRank > actorNew) overtaken.push(pid);
    }
  }
  let sent = 0;
  if (overtaken.length > 0) {
    sent = await sendToPlayers(overtaken, {
      title: "📉 Tu viens de te faire doubler",
      body: `${names.get(actorId) ?? "Quelqu'un"} vient de te passer au classement.`,
    });
  }

  // ---- Événements du feed ----
  const today = parisToday();
  const moments: FeedInsert[] = [];

  // 👑 Prise de la 1re place : rang 1 maintenant, pas rang 1 avant.
  // points > 0 évite le "tout le monde prend la tête" du jour 1.
  for (const r of lbRows) {
    const old = oldRanks.get(r.player_id);
    if (
      Number(r.rank) === 1 &&
      Number(r.points) > 0 &&
      old !== undefined &&
      old > 1
    ) {
      moments.push({
        player_id: r.player_id,
        kind: "lead",
        dedupe_key: today,
        payload: { day: today },
      });
    }
  }

  // 🏅 Badges : on pousse tout, l'unicité en base ne garde que les nouveaux.
  for (const b of badges.data as BadgeRow[]) {
    moments.push({
      player_id: b.player_id,
      kind: "badge",
      dedupe_key: b.badge,
      payload: { badge: b.badge },
    });
  }

  // 📈⚡ Records et milestones de série.
  moments.push(...streakMoments(streaks.data as StreakRow[], today));

  if (moments.length > 0) {
    await supabase.from("feed_events").upsert(moments, {
      onConflict: "player_id,kind,dedupe_key",
      ignoreDuplicates: true,
    });
  }

  // On fige le nouvel état des rangs, y compris pour les sans-snapshot.
  const upserts = lbRows.map((r) => ({
    player_id: r.player_id,
    rank: r.rank,
    points: r.points,
    updated_at: new Date().toISOString(),
  }));
  await supabase
    .from("rank_snapshots")
    .upsert(upserts, { onConflict: "player_id" });

  return NextResponse.json({
    overtaken: overtaken.length,
    sent,
    moments: moments.length,
  });
}
