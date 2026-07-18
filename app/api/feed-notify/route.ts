// Push quand quelqu'un réagit ou commente sur un moment du feed.
// Groupé : une notif max par événement et par quart d'heure — le
// verrou est un update conditionnel de last_notified_at (atomique :
// deux appels simultanés, un seul passe).
//
// Destinataires :
//  - une réaction ne prévient que l'auteur du moment ;
//  - un commentaire prévient l'auteur du moment ET tous les autres
//    participants au fil (ceux qui ont déjà commenté), pour que la
//    conversation vive. L'auteur du commentaire (actorId) est toujours
//    exclu — on ne se notifie pas soi-même.

import { NextResponse } from "next/server";
import {
  isAuthorizedApp,
  sendToPlayers,
  serverSupabase,
} from "@/lib/server/push";

export const dynamic = "force-dynamic";

const QUARTER_HOUR_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  if (!isAuthorizedApp(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const { eventId, actorId } = (await request.json().catch(() => ({}))) as {
    eventId?: string;
    actorId?: string;
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

  const owner = ev.player_id as string;

  // La dernière activité de quelqu'un d'autre que l'auteur du commentaire :
  // elle donne le texte. Les commentaires servent aussi à lister les
  // participants au fil.
  const [reac, com, players] = await Promise.all([
    supabase
      .from("feed_reactions")
      .select("player_id, emoji, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("feed_comments")
      .select("player_id, body, created_at")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false }),
    supabase.from("players").select("id, name"),
  ]);
  if (reac.error || com.error || players.error) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }

  const comments = (com.data ?? []) as {
    player_id: string;
    body: string;
    created_at: string;
  }[];
  const lastReaction = reac.data?.[0] as
    | { player_id: string; emoji: string; created_at: string }
    | undefined;
  const lastComment = comments[0];
  if (!lastReaction && !lastComment) {
    return NextResponse.json({ sent: 0 });
  }

  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // Commentaire si le fil a au moins un commentaire au moins aussi récent
  // que la dernière réaction — c'est la dernière chose qui s'est dite.
  const useComment =
    !!lastComment &&
    (!lastReaction || lastComment.created_at >= lastReaction.created_at);

  // Auteur du texte affiché. Sans actorId (client ancien), on retombe sur
  // l'auteur de la dernière activité, comme avant.
  const textAuthor = useComment ? lastComment.player_id : lastReaction!.player_id;
  const actor = actorId ?? textAuthor;
  const actorName = names.get(actor) ?? "Quelqu'un";

  let totalSent = 0;

  if (useComment) {
    // Destinataires : auteur du moment + participants au fil, moins l'auteur
    // du commentaire (lui vient d'écrire, il n'a rien à recevoir).
    const participants = new Set<string>([owner, ...comments.map((c) => c.player_id)]);
    participants.delete(actor);

    const body = `${actorName} : « ${lastComment.body} »`;

    // L'auteur du moment garde son titre à lui ; les autres participants
    // ("ton moment" ne les concerne pas) reçoivent un titre neutre.
    const ownerTarget = participants.has(owner) ? [owner] : [];
    const others = [...participants].filter((id) => id !== owner);

    if (ownerTarget.length > 0) {
      totalSent += await sendToPlayers(ownerTarget, {
        title: "💬 Ton moment fait parler",
        body,
      });
    }
    if (others.length > 0) {
      totalSent += await sendToPlayers(others, {
        title: "💬 Ça discute",
        body,
      });
    }
  } else {
    // Réaction : seul l'auteur du moment est concerné (et jamais lui-même).
    if (owner !== actor) {
      totalSent += await sendToPlayers([owner], {
        title: "💬 Ton moment fait parler",
        body: `${actorName} a réagi ${lastReaction!.emoji} à ton moment`,
      });
    }
  }

  return NextResponse.json({ sent: totalSent });
}
