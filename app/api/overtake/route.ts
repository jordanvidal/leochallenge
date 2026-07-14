// Détection de dépassement au classement, appelée par l'app après une coche.
// "Sam vient de te passer." — le meilleur levier de mauvaise foi du groupe.

import { NextResponse } from "next/server";
import { sendToPlayers, serverSupabase } from "@/lib/server/push";

export const dynamic = "force-dynamic";

type LbRow = { player_id: string; rank: number; points: number };
type Snap = { player_id: string; rank: number };

export async function POST(request: Request) {
  const { actorId } = (await request.json().catch(() => ({}))) as {
    actorId?: string;
  };
  if (!actorId) {
    return NextResponse.json({ error: "actorId requis" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const [lb, snaps, players] = await Promise.all([
    supabase.rpc("leaderboard"),
    supabase.from("rank_snapshots").select("player_id, rank"),
    supabase.from("players").select("id, name"),
  ]);
  if (lb.error || snaps.error || players.error) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }

  const newRanks = new Map(
    (lb.data as LbRow[]).map((r) => [r.player_id, Number(r.rank)]),
  );
  const oldRanks = new Map(
    (snaps.data as Snap[]).map((s) => [s.player_id, Number(s.rank)]),
  );
  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Dépassés par l'acteur : ils étaient devant, ils sont maintenant derrière.
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

  // On fige le nouvel état, y compris pour les joueurs sans snapshot.
  const upserts = (lb.data as LbRow[]).map((r) => ({
    player_id: r.player_id,
    rank: r.rank,
    points: r.points,
    updated_at: new Date().toISOString(),
  }));
  await supabase
    .from("rank_snapshots")
    .upsert(upserts, { onConflict: "player_id" });

  return NextResponse.json({ overtaken: overtaken.length, sent });
}
