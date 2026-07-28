"use client";

// État du tchat : messages paginés, réactions, temps réel, non-lus,
// présence, préférence de notification.
//
// Deux régimes, et c'est toute la subtilité du fichier :
//
//  · `enabled` faux (le tchat n'est pas à l'écran) — on ne charge RIEN
//    sauf le compteur de la pastille, qui est une requête de comptage
//    sans lignes. La règle des 10 secondes de CLAUDE.md n'admet pas
//    qu'ouvrir l'app pour cocher traîne un salon derrière elle.
//  · `enabled` vrai — page courante, abonnement temps réel, battement
//    de présence. Tout s'arrête à la sortie de l'onglet : une PWA qui
//    garde un WebSocket ouvert en fond mange la batterie pour rien.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  beatPresence,
  ChatMessage,
  ChatReaction,
  countUnread,
  deleteChatReaction,
  deleteMessage,
  fetchChatPage,
  fetchChatReactions,
  fetchLastRead,
  fetchMessages,
  fetchNotifyPref,
  humanChatError,
  insertChatReaction,
  insertMessage,
  markRead,
  notifyChatMessage,
  NotifyPref,
  setNotifyPref,
} from "@/lib/chat";
import { supabase } from "@/lib/supabase";

/** Le rythme du battement de présence. Le serveur tolère 90 s, soit
    trois battements : un de perdu ne coupe pas les notifications. */
const BEAT_MS = 30_000;

/** Remplace un message par son id, ou l'ajoute en gardant l'ordre
    chronologique. Le temps réel et la réponse de l'insert peuvent
    livrer la même ligne dans n'importe quel ordre ; dédupliquer par id
    est la seule défense qui tienne dans les deux sens. */
function upsert(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const copy = [...list];
    copy[i] = m;
    return copy;
  }
  // Presque toujours le plus récent : on teste la fin avant de trier.
  const last = list[list.length - 1];
  if (!last || last.created_at <= m.created_at) return [...list, m];
  return [...list, m].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

export function useChat(
  enabled: boolean,
  myId: string | null,
  showToast: (msg: string) => void,
) {
  // Chronologique : le plus ancien en tête, le plus récent en queue.
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [reactions, setReactions] = useState<Map<string, ChatReaction[]>>(
    new Map(),
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pref, setPref] = useState<NotifyPref>("tous");
  const lastRead = useRef<string | null>(null);
  const inflight = useRef(false);

  // ---- La pastille, même tchat fermé ----

  const refreshUnread = useCallback(async () => {
    if (!myId) return;
    const since = await fetchLastRead(myId);
    lastRead.current = since;
    setUnread(await countUnread(myId, since));
  }, [myId]);

  useEffect(() => {
    if (!myId) return;
    refreshUnread();
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshUnread();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [myId, refreshUnread]);

  useEffect(() => {
    if (!myId) return;
    fetchNotifyPref(myId).then(setPref);
  }, [myId]);

  // ---- Le contenu, tchat ouvert seulement ----

  const groupReactions = useCallback((list: ChatReaction[]) => {
    const m = new Map<string, ChatReaction[]>();
    for (const r of list) {
      m.set(r.message_id, [...(m.get(r.message_id) ?? []), r]);
    }
    return m;
  }, []);

  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const page = await fetchChatPage(0);
      if (!page) return;
      const chrono = [...page.messages].reverse();
      const rx = await fetchChatReactions(chrono.map((m) => m.id));
      setMessages(chrono);
      setHasMore(page.hasMore);
      if (rx) setReactions(groupReactions(rx));
    } finally {
      inflight.current = false;
    }
  }, [groupReactions]);

  useEffect(() => {
    if (!enabled || !myId) return;
    reload();
    const onVisible = () => {
      // Un WebSocket qui a dormi pendant que le téléphone était
      // verrouillé a perdu des messages, toujours. Le temps réel ne
      // remplace pas le rechargement, il le complète.
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, myId, reload]);

  // ---- Temps réel ----

  useEffect(() => {
    if (!enabled || !myId) return;
    const canal = supabase
      .channel("tchat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (p) => setMessages((prev) => (prev ? upsert(prev, p.new as ChatMessage) : prev)),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_messages" },
        (p) => setMessages((prev) => (prev ? upsert(prev, p.new as ChatMessage) : prev)),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_reactions" },
        (p) => {
          const r = p.new as ChatReaction;
          setReactions((prev) => {
            const list = prev.get(r.message_id) ?? [];
            if (list.some((x) => x.player_id === r.player_id && x.emoji === r.emoji))
              return prev;
            return new Map(prev).set(r.message_id, [...list, r]);
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_reactions" },
        (p) => {
          // `replica identity full` (migration 41) : sans elle, `old` ne
          // porterait que l'id et on ne saurait pas quelle pastille retirer.
          const r = p.old as Partial<ChatReaction>;
          if (!r.message_id) return;
          setReactions((prev) => {
            const list = prev.get(r.message_id!) ?? [];
            return new Map(prev).set(
              r.message_id!,
              list.filter(
                (x) => !(x.player_id === r.player_id && x.emoji === r.emoji),
              ),
            );
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [enabled, myId]);

  // ---- Présence ----

  useEffect(() => {
    if (!enabled || !myId) return;
    const battre = () => {
      if (document.visibilityState === "visible") beatPresence(myId);
    };
    battre();
    const id = setInterval(battre, BEAT_MS);
    document.addEventListener("visibilitychange", battre);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", battre);
    };
  }, [enabled, myId]);

  // ---- Lu ----

  const dernier = messages?.[messages.length - 1]?.created_at ?? null;

  useEffect(() => {
    // Tchat ouvert et visible : ce qui est à l'écran est lu. On date la
    // lecture sur le `created_at` d'un vrai message et jamais sur
    // l'heure du téléphone — les deux se comparent ensuite à des
    // horodatages serveur.
    if (!enabled || !myId || !dernier) return;
    if (document.visibilityState !== "visible") return;
    if (lastRead.current && lastRead.current >= dernier) return;
    lastRead.current = dernier;
    setUnread(0);
    markRead(myId, dernier);
  }, [enabled, myId, dernier]);

  // ---- Pagination ----

  const loadMore = useCallback(async () => {
    if (loadingMore || !messages) return;
    setLoadingMore(true);
    try {
      const page = await fetchChatPage(messages.length);
      if (!page) return;
      const connus = new Set(messages.map((m) => m.id));
      const frais = [...page.messages].reverse().filter((m) => !connus.has(m.id));
      const rx = await fetchChatReactions(frais.map((m) => m.id));
      setMessages([...frais, ...messages]);
      setHasMore(page.hasMore);
      if (rx) {
        setReactions((prev) => new Map([...prev, ...groupReactions(rx)]));
      }
    } finally {
      setLoadingMore(false);
    }
  }, [messages, loadingMore, groupReactions]);

  /** Les parents cités tombés hors de la page : chargés à la demande
      pour que la citation ne s'affiche jamais vide. */
  const [parents, setParents] = useState<Map<string, ChatMessage>>(new Map());
  useEffect(() => {
    if (!messages) return;
    const connus = new Set(messages.map((m) => m.id));
    const manquants = [
      ...new Set(
        messages
          .map((m) => m.reply_to)
          .filter((id): id is string => !!id && !connus.has(id) && !parents.has(id)),
      ),
    ];
    if (manquants.length === 0) return;
    fetchMessages(manquants).then((rows) => {
      if (!rows) return;
      setParents((prev) => {
        const next = new Map(prev);
        for (const r of rows) next.set(r.id, r);
        return next;
      });
    });
  }, [messages, parents]);

  /** Retrouve un message cité, qu'il soit dans la page ou hors d'elle. */
  const messageById = useCallback(
    (id: string | null): ChatMessage | undefined => {
      if (!id) return undefined;
      return messages?.find((m) => m.id === id) ?? parents.get(id);
    },
    [messages, parents],
  );

  // ---- Écriture ----

  const send = useCallback(
    async (
      body: string,
      opts: { replyTo?: string | null; feedEventId?: string | null } = {},
    ) => {
      const texte = body.trim();
      if (!myId || !texte) return;
      const tmpId = `tmp-${Date.now()}`;
      const optimiste: ChatMessage = {
        id: tmpId,
        player_id: myId,
        body: texte,
        reply_to: opts.replyTo ?? null,
        feed_event_id: opts.feedEventId ?? null,
        created_at: new Date().toISOString(),
        deleted_at: null,
      };
      setMessages((prev) => (prev ? [...prev, optimiste] : [optimiste]));

      const res = await insertMessage(myId, texte, opts);
      if ("error" in res) {
        setMessages((prev) => prev?.filter((m) => m.id !== tmpId) ?? prev);
        showToast(humanChatError(res.error));
        return;
      }
      // Le temps réel a pu livrer la vraie ligne avant nous : on retire
      // l'optimiste puis on dédoublonne par id.
      setMessages((prev) =>
        prev ? upsert(prev.filter((m) => m.id !== tmpId), res.message) : prev,
      );
      notifyChatMessage(res.message.id, myId);
    },
    [myId, showToast],
  );

  const remove = useCallback(
    async (id: string) => {
      const avant = messages;
      setMessages(
        (prev) =>
          prev?.map((m) =>
            m.id === id
              ? { ...m, body: "", deleted_at: new Date().toISOString() }
              : m,
          ) ?? prev,
      );
      const err = await deleteMessage(id);
      if (err) {
        setMessages(avant);
        showToast(humanChatError(err));
      }
    },
    [messages, showToast],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!myId) return;
      const list = reactions.get(messageId) ?? [];
      const mienne = list.some((r) => r.player_id === myId && r.emoji === emoji);
      const r: ChatReaction = { message_id: messageId, player_id: myId, emoji };
      setReactions((prev) => {
        const l = prev.get(messageId) ?? [];
        return new Map(prev).set(
          messageId,
          mienne
            ? l.filter((x) => !(x.player_id === myId && x.emoji === emoji))
            : [...l, r],
        );
      });
      navigator.vibrate?.(10);
      const err = mienne
        ? await deleteChatReaction(messageId, myId, emoji)
        : await insertChatReaction(messageId, myId, emoji);
      if (err && !err.includes("duplicate")) {
        setReactions((prev) => {
          const l = prev.get(messageId) ?? [];
          return new Map(prev).set(
            messageId,
            mienne
              ? [...l, r]
              : l.filter((x) => !(x.player_id === myId && x.emoji === emoji)),
          );
        });
        showToast(humanChatError(err));
      }
    },
    [myId, reactions, showToast],
  );

  const changePref = useCallback(
    async (next: NotifyPref) => {
      if (!myId) return;
      const avant = pref;
      setPref(next);
      const err = await setNotifyPref(myId, next);
      if (err) {
        setPref(avant);
        showToast("Réglage non enregistré, réessaie");
      }
    },
    [myId, pref, showToast],
  );

  return useMemo(
    () => ({
      messages,
      reactions,
      hasMore,
      loadingMore,
      unread,
      pref,
      loadMore,
      messageById,
      send,
      remove,
      toggleReaction,
      changePref,
    }),
    [
      messages,
      reactions,
      hasMore,
      loadingMore,
      unread,
      pref,
      loadMore,
      messageById,
      send,
      remove,
      toggleReaction,
      changePref,
    ],
  );
}

export type Chat = ReturnType<typeof useChat>;
