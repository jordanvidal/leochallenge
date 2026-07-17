"use client";

// État du fil : événements paginés, réactions et commentaires,
// compteur de non-lus (localStorage du dernier événement vu).
// Écritures optimistes comme partout : l'écran d'abord, rollback
// + toast si la base dit non.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteReaction,
  FeedComment,
  FeedEvent,
  FeedReaction,
  fetchFeedAnnex,
  fetchFeedPage,
  humanFeedError,
  insertComment,
  insertReaction,
  notifyFeedActivity,
} from "@/lib/feed";

const SEEN_KEY = "lc100.feedSeen";

type AnnexMaps = {
  reactions: Map<string, FeedReaction[]>;
  comments: Map<string, FeedComment[]>;
};

/** Regroupe réactions et commentaires par événement. */
function groupAnnex(
  reactions: FeedReaction[],
  comments: FeedComment[],
): AnnexMaps {
  const r = new Map<string, FeedReaction[]>();
  const c = new Map<string, FeedComment[]>();
  for (const x of reactions) r.set(x.event_id, [...(r.get(x.event_id) ?? []), x]);
  for (const x of comments) c.set(x.event_id, [...(c.get(x.event_id) ?? []), x]);
  return { reactions: r, comments: c };
}

export function useFeed(
  enabled: boolean,
  myId: string | null,
  showToast: (msg: string) => void,
) {
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [annex, setAnnex] = useState<AnnexMaps>({
    reactions: new Map(),
    comments: new Map(),
  });
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [seenAt, setSeenAt] = useState("");
  const inflight = useRef(false);

  useEffect(() => {
    setSeenAt(localStorage.getItem(SEEN_KEY) ?? "");
  }, []);

  /** Recharge la première page (et repart de zéro côté pagination). */
  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const page = await fetchFeedPage(0);
      if (!page) return;
      const extra = await fetchFeedAnnex(page.events.map((e) => e.id));
      if (!extra) return;
      setEvents(page.events);
      setHasMore(page.hasMore);
      setAnnex(groupAnnex(extra.reactions, extra.comments));
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, reload]);

  /** Page suivante (« voir plus »), dédupliquée par id. */
  const loadMore = useCallback(async () => {
    if (loadingMore || events === null) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeedPage(events.length);
      if (!page) return;
      const known = new Set(events.map((e) => e.id));
      const fresh = page.events.filter((e) => !known.has(e.id));
      const extra = await fetchFeedAnnex(fresh.map((e) => e.id));
      setEvents([...events, ...fresh]);
      setHasMore(page.hasMore);
      if (extra) {
        setAnnex((prev) => {
          const add = groupAnnex(extra.reactions, extra.comments);
          return {
            reactions: new Map([...prev.reactions, ...add.reactions]),
            comments: new Map([...prev.comments, ...add.comments]),
          };
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [events, loadingMore]);

  /** Ajoute/retire une réaction dans l'état local. */
  const patchReaction = useCallback((rx: FeedReaction, add: boolean) => {
    setAnnex((prev) => {
      const list = prev.reactions.get(rx.event_id) ?? [];
      const next = add
        ? [...list, rx]
        : list.filter(
            (r) => !(r.player_id === rx.player_id && r.emoji === rx.emoji),
          );
      return {
        ...prev,
        reactions: new Map(prev.reactions).set(rx.event_id, next),
      };
    });
  }, []);

  /** Un tap ajoute, un retap enlève. Optimiste. */
  const toggleReaction = useCallback(
    async (event: FeedEvent, emoji: string) => {
      if (!myId) return;
      const list = annex.reactions.get(event.id) ?? [];
      const mine = list.some((r) => r.player_id === myId && r.emoji === emoji);
      const rx: FeedReaction = { event_id: event.id, player_id: myId, emoji };
      patchReaction(rx, !mine);
      navigator.vibrate?.(10);
      const err = mine
        ? await deleteReaction(event.id, myId, emoji)
        : await insertReaction(event.id, myId, emoji);
      if (err) {
        // double-tap trop rapide : la ligne existe déjà, l'écran est déjà bon
        if (err.includes("duplicate")) return;
        patchReaction(rx, mine);
        showToast(humanFeedError(err));
      } else if (!mine && event.player_id !== myId) {
        notifyFeedActivity(event.id, myId);
      }
    },
    [annex.reactions, myId, patchReaction, showToast],
  );

  /** Poste un commentaire. Optimiste, rollback visible si refus. */
  const addComment = useCallback(
    async (event: FeedEvent, body: string) => {
      const text = body.trim();
      if (!myId || !text) return;
      const optimistic: FeedComment = {
        id: `tmp-${Date.now()}`,
        event_id: event.id,
        player_id: myId,
        body: text,
        created_at: new Date().toISOString(),
      };
      setAnnex((prev) => ({
        ...prev,
        comments: new Map(prev.comments).set(event.id, [
          ...(prev.comments.get(event.id) ?? []),
          optimistic,
        ]),
      }));
      const err = await insertComment(event.id, myId, text);
      if (err) {
        setAnnex((prev) => ({
          ...prev,
          comments: new Map(prev.comments).set(
            event.id,
            (prev.comments.get(event.id) ?? []).filter(
              (c) => c.id !== optimistic.id,
            ),
          ),
        }));
        showToast(humanFeedError(err));
      } else {
        // Toujours notifier : l'auteur du moment ET les autres
        // participants au fil. Commenter son propre moment prévient
        // donc ceux qui ont déjà commenté (le serveur exclut l'auteur
        // du commentaire, et n'envoie rien s'il n'y a personne à prévenir).
        notifyFeedActivity(event.id, myId);
      }
    },
    [myId, showToast],
  );

  // Non-lus : les événements des autres, plus récents que le dernier vu.
  // C'est la pastille de l'onglet — elle fait revenir.
  const unread = useMemo(() => {
    if (!events) return 0;
    return events.filter(
      (e) => e.player_id !== myId && e.created_at > seenAt,
    ).length;
  }, [events, myId, seenAt]);

  /** À l'ouverture de l'onglet : tout est vu, la pastille s'éteint. */
  const markSeen = useCallback(() => {
    if (!events || events.length === 0) return;
    const newest = events[0].created_at;
    localStorage.setItem(SEEN_KEY, newest);
    setSeenAt((prev) => (newest > prev ? newest : prev));
  }, [events]);

  return {
    events,
    reactions: annex.reactions,
    comments: annex.comments,
    hasMore,
    loadingMore,
    unread,
    reload,
    loadMore,
    toggleReaction,
    addComment,
    markSeen,
  };
}

export type Feed = ReturnType<typeof useFeed>;
