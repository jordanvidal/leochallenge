"use client";

// Le fil : antéchronologique, groupé par jour. Personne n'écrit de
// post — le feed raconte ce qui s'est passé, le groupe réagit dessus.

import { useEffect } from "react";
import { Feed } from "@/hooks/useFeed";
import { dayLabel, FeedEvent, parisDayOf } from "@/lib/feed";
import { Player } from "@/lib/types";
import FeedItem from "./FeedItem";

type Props = {
  player: Player;
  players: Player[];
  feed: Feed;
};

/** Groupe les événements par jour civil Paris, ordre du fil conservé. */
function groupByDay(events: FeedEvent[]): { day: string; items: FeedEvent[] }[] {
  const groups: { day: string; items: FeedEvent[] }[] = [];
  for (const e of events) {
    const day = parisDayOf(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return groups;
}

// Une coche déclenche une cascade : le trigger SQL écrit la séance, puis
// /api/moments ajoute la prise de tête et le record une à quatre secondes
// plus tard. Trois lignes en base, mais un seul moment vécu. La fenêtre
// couvre aussi la visite complète (« je coche, puis je déclare mes bonus »),
// qui tient en moins de deux minutes dans les données réelles.
const BURST_MS = 120_000;

/** Regroupe les événements consécutifs d'un même joueur tombés ensemble.
    La fenêtre part du premier du groupe : un groupe ne s'étire donc jamais
    au-delà de 2 min, même si les événements s'enchaînent un par un. */
function groupBursts(events: FeedEvent[]): FeedEvent[][] {
  const bursts: FeedEvent[][] = [];
  for (const e of events) {
    const last = bursts[bursts.length - 1];
    const head = last?.[0];
    const together =
      head &&
      head.player_id === e.player_id &&
      Math.abs(
        new Date(head.created_at).getTime() - new Date(e.created_at).getTime(),
      ) <= BURST_MS;
    if (together) last.push(e);
    else bursts.push([e]);
  }
  return bursts;
}

export default function FeedScreen({ player, players, feed }: Props) {
  const byId = new Map(players.map((p) => [p.id, p]));

  // L'onglet est ouvert : tout est vu, la pastille s'éteint.
  const { markSeen } = feed;
  useEffect(() => {
    markSeen();
  }, [markSeen]);

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      <h1 className="mt-4 text-2xl font-bold">Feed</h1>

      {feed.events === null && (
        <p className="mt-4 animate-pulse text-muted">Chargement…</p>
      )}

      {feed.events !== null && feed.events.length === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Rien encore. Le fil s&apos;écrit tout seul : séances terminées,
          bonus déclarés, prises de tête au classement.
        </p>
      )}

      {feed.events !== null &&
        groupByDay(feed.events).map(({ day, items }) => (
          <section key={day}>
            <h2 className="mt-5 mb-2 text-sm font-bold text-muted">
              {dayLabel(day)}
            </h2>
            <ul className="flex flex-col gap-2">
              {groupBursts(items).map((burst) => (
                <FeedItem
                  key={burst[0].id}
                  events={burst}
                  me={player}
                  byId={byId}
                  // Réactions et commentaires de tout le groupe : chacun
                  // porte son event_id, donc rien ne se perd au passage.
                  reactions={burst.flatMap((e) => feed.reactions.get(e.id) ?? [])}
                  comments={burst.flatMap((e) => feed.comments.get(e.id) ?? [])}
                  onToggleReaction={feed.toggleReaction}
                  onAddComment={feed.addComment}
                />
              ))}
            </ul>
          </section>
        ))}

      {feed.hasMore && (
        <button
          onClick={feed.loadMore}
          disabled={feed.loadingMore}
          className="mx-auto my-4 min-h-12 rounded-full bg-surface px-6 text-sm font-bold text-muted disabled:opacity-40"
        >
          {feed.loadingMore ? "Chargement…" : "Voir plus"}
        </button>
      )}
      <div className="pb-4" />
    </div>
  );
}
