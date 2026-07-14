// Push quand quelqu'un réagit ou commente sur TON événement.
// Groupé : une notif max par événement et par quart d'heure — le
// verrou est un update conditionnel de last_notified_at (atomique :
// deux appels simultanés, un seul passe).

import { NextResponse } from "next/server";
import { sendToPlayers, serverSupabase } from "@/lib/server/push";

export const dynamic = "force-dynamic";

const QUARTER_HOUR_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const { eventId } = (await request.json().catch(() => ({}))) as {
    eventId?: string;
  };
  if (!eventId) {
    return NextResponse.json({ error: "eventId requis" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const cutoff = new Date(Date.now() - QUARTER_HOUR_MS).toISOString();

  // Le verrou : ne passe que si aucune notif depuis 15 min sur cet événement.
  const { data: ev, error } = await supabase
    .from("feed_events")
    .update({ last_notified_at: new Date().toISOString() })
    .eq("id", eventId)
    .or(`last_notified_at.is.null,last_notified_at.lt.${cutoff}`)
    .select("id, player_id")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "verrou échoué" }, { status: 500 });
  }
  if (!ev) {
    return NextResponse.json({ sent: 0, throttled: true });
  }

  // La dernière activité de quelqu'un d'autre : elle donne le texte.
  const [reac, com, players] = await Promise.all([
    supabase
      .from("feed_reactions")
      .select("player_id, emoji, created_at")
      .eq("event_id", eventId)
      .neq("player_id", ev.player_id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("feed_comments")
      .select("player_id, body, created_at")
      .eq("event_id", eventId)
      .neq("player_id", ev.player_id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("players").select("id, name"),
  ]);
  if (reac.error || com.error || players.error) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }

  const lastReaction = reac.data?.[0] as
    | { player_id: string; emoji: string; created_at: string }
    | undefined;
  const lastComment = com.data?.[0] as
    | { player_id: string; body: string; created_at: string }
    | undefined;
  if (!lastReaction && !lastComment) {
    return NextResponse.json({ sent: 0 });
  }

  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );
  const useComment =
    !!lastComment &&
    (!lastReaction || lastComment.created_at >= lastReaction.created_at);
  const body = useComment
    ? `${names.get(lastComment!.player_id) ?? "Quelqu'un"} : « ${lastComment!.body} »`
    : `${names.get(lastReaction!.player_id) ?? "Quelqu'un"} a réagi ${lastReaction!.emoji} à ton moment`;

  const sent = await sendToPlayers([ev.player_id], {
    title: "💬 Ton moment fait parler",
    body,
  });
  return NextResponse.json({ sent });
}
