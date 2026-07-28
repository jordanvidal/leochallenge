"use client";

// Le salon. Le fil raconte ce qui s'est passé, ici on en parle.
//
// L'écran défile avec la page, comme tous les autres : une zone de
// défilement imbriquée demanderait une hauteur bornée jusqu'à la racine
// (`min-h-dvh` deviendrait `h-dvh`), donc de refaire le défilement de
// tous les écrans de l'app. La barre de saisie est collée en bas et le
// clavier est géré par --kb, c'est tout ce qu'il fallait.

import { useCallback, useEffect, useRef, useState } from "react";
import { Chat } from "@/hooks/useChat";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { apercu, buildRows, ChatMessage } from "@/lib/chat";
import { eventPhrase, FeedEvent } from "@/lib/feed";
import { Player } from "@/lib/types";
import ChatBubble from "./ChatBubble";
import ChatComposer, { Citation } from "./ChatComposer";
import { MessageSheet, NotifySheet } from "./ChatSheets";
import { Skeleton } from "../ui";

/** Marge sous laquelle on considère qu'on lit le bas du fil. Assez large
    pour couvrir la hauteur de la saisie : sinon un message qui arrive
    pendant qu'on écrit déclencherait la pastille alors qu'on le voit. */
const BAS_PX = 160;

type Props = {
  player: Player;
  players: Player[];
  chat: Chat;
  onGoFeed: () => void;
  /** Le moment du fil sur lequel on vient d'appuyer « En parler ». Il
      attend dans la saisie, cité, jusqu'à l'envoi ou l'annulation. */
  seed: FeedEvent | null;
  onSeedUsed: () => void;
};

export default function ChatScreen({
  player,
  players,
  chat,
  onGoFeed,
  seed,
  onSeedUsed,
}: Props) {
  useKeyboardInset(true);

  const byId = new Map(players.map((p) => [p.id, p]));
  // Se mentionner soi-même ne prévient personne : on ne se propose pas.
  const autres = players.filter((p) => p.id !== player.id);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<ChatMessage | null>(null);
  const [reglages, setReglages] = useState(false);
  const [nouveaux, setNouveaux] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const { messages, send, remove, toggleReaction, messageById } = chat;
  const premierRendu = useRef(true);
  const dernierVu = useRef<string | null>(null);

  const enBas = useCallback(
    () =>
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - BAS_PX,
    [],
  );

  const allerEnBas = useCallback((doux: boolean) => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: doux ? "smooth" : "auto",
    });
  }, []);

  // À l'ouverture : ancré en bas, sans animation. On arrive sur le
  // dernier message, pas sur un défilement qu'on regarde passer.
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    const id = messages[messages.length - 1].id;
    if (premierRendu.current) {
      premierRendu.current = false;
      dernierVu.current = id;
      allerEnBas(false);
      return;
    }
    if (id === dernierVu.current) return;
    const mien = messages[messages.length - 1].player_id === player.id;
    dernierVu.current = id;
    // Si je viens d'écrire, on suit toujours. Sinon on ne suit que si
    // l'autre lisait déjà le bas : voler le défilement de quelqu'un qui
    // remonte le fil est la faute la plus agaçante d'un tchat.
    if (mien || enBas()) {
      allerEnBas(true);
      setNouveaux(0);
    } else {
      setNouveaux((n) => n + 1);
    }
  }, [messages, player.id, enBas, allerEnBas]);

  // Revenu en bas par ses propres moyens : la pastille n'a plus lieu d'être.
  useEffect(() => {
    if (nouveaux === 0) return;
    const onScroll = () => {
      if (enBas()) setNouveaux(0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [nouveaux, enBas]);

  /** Rejoint un message cité et l'allume une fois : sans ce signal, on
      ne sait pas où on vient d'atterrir. */
  function rejoindre(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1000);
  }

  const rows = messages ? buildRows(messages) : [];

  // Une seule citation à la fois dans la saisie. Répondre l'emporte sur
  // le moment venu du fil : c'est le geste le plus récent, et empiler
  // les deux donnerait une bulle qui cite deux choses sans qu'on sache
  // à laquelle elle répond.
  const seedAuthor = seed ? byId.get(seed.player_id) : undefined;
  const replyAuthor = reply ? byId.get(reply.player_id) : undefined;
  const citation: Citation | null = reply
    ? {
        titre: `Réponse à ${replyAuthor?.name ?? "un message"}`,
        couleur: replyAuthor?.color ?? "var(--color-muted)",
        texte: reply.deleted_at ? "Message supprimé" : apercu(reply.body, 70),
        onCancel: () => setReply(null),
      }
    : seed
      ? {
          titre: `${eventPhrase(seed).emoji} ${seedAuthor?.name ?? "Le fil"}`,
          couleur: seedAuthor?.color ?? "var(--color-muted)",
          texte: apercu(eventPhrase(seed).text, 70),
          onCancel: onSeedUsed,
        }
      : null;

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tchat</h1>
        <button
          onClick={() => setReglages(true)}
          aria-label="Notifications du tchat"
          className="flex size-11 items-center justify-center rounded-full text-muted"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M13.7 20a2 2 0 0 1-3.4 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {messages === null && (
        <ul className="mt-4 flex flex-col gap-3" role="status" aria-label="Tchat en cours de chargement">
          {[
            { w: "62%", mine: false },
            { w: "44%", mine: true },
            { w: "72%", mine: false },
            { w: "38%", mine: false },
          ].map((s, i) => (
            <li key={i} className={s.mine ? "flex justify-end" : ""}>
              <Skeleton w={s.w} h={40} radius={16} />
            </li>
          ))}
        </ul>
      )}

      {messages !== null && messages.length === 0 && (
        <div className="mt-8 flex flex-col items-start">
          <p className="text-lg font-bold">Personne n&apos;a encore parlé.</p>
          <p className="mt-1 max-w-[42ch] text-sm leading-relaxed text-muted">
            Le fil raconte ce qui se passe : séances terminées, records,
            prises de tête au classement. Ici, on en parle.
          </p>
          <button
            onClick={onGoFeed}
            className="mt-4 min-h-12 rounded-2xl bg-surface px-5 text-sm font-bold"
          >
            Voir le fil →
          </button>
        </div>
      )}

      {messages !== null && messages.length > 0 && (
        <>
          {chat.hasMore && (
            <button
              onClick={chat.loadMore}
              disabled={chat.loadingMore}
              className="mx-auto mt-4 min-h-12 rounded-full bg-surface px-6 text-sm font-bold text-muted disabled:opacity-40"
            >
              {chat.loadingMore ? "Chargement…" : "Messages plus anciens"}
            </button>
          )}
          <ul className="mt-3 flex flex-col gap-1">
            {rows.map((row) =>
              row.kind === "day" ? (
                <li
                  key={row.key}
                  className="my-3 text-center text-[11px] font-bold text-faint"
                >
                  {row.label}
                </li>
              ) : (
                <ChatBubble
                  key={row.key}
                  message={row.message}
                  author={byId.get(row.message.player_id)}
                  isMine={row.message.player_id === player.id}
                  showAuthor={row.showAuthor}
                  showTime={row.showTime}
                  parent={messageById(row.message.reply_to)}
                  parentAuthor={byId.get(
                    messageById(row.message.reply_to)?.player_id ?? "",
                  )}
                  feedEvent={chat.feedEventById(row.message.feed_event_id)}
                  feedEventAuthor={byId.get(
                    chat.feedEventById(row.message.feed_event_id)?.player_id ?? "",
                  )}
                  reactions={chat.reactions.get(row.message.id) ?? []}
                  myId={player.id}
                  players={players}
                  byId={byId}
                  flash={flash === row.message.id}
                  onOpenMenu={setMenu}
                  onReply={setReply}
                  onJumpTo={rejoindre}
                />
              ),
            )}
          </ul>
        </>
      )}

      {/* Le ressort. `sticky` ne colle un élément en bas que si la page
          déborde ; tant qu'elle tient dans l'écran, il se pose à sa place
          naturelle — donc au milieu du vide, juste sous l'état vide.
          Ce vide-là prend toute la hauteur restante et l'y pousse. Quand
          la conversation est longue, il retombe à zéro tout seul. */}
      {/* `min-h` et pas `h` : quand la conversation déborde, le ressort
          retombe à sa hauteur minimale et laisse quand même respirer le
          dernier horodatage, qui sinon touche la bordure de la saisie. */}
      <div aria-hidden className="min-h-2 flex-1" />

      <ChatComposer
        citation={citation}
        mentionnables={autres}
        onSend={(body) => {
          send(body, {
            replyTo: reply?.id ?? null,
            feedEventId: reply ? null : (seed?.id ?? null),
          });
          setReply(null);
          onSeedUsed();
        }}
      />

      {nouveaux > 0 && (
        <button
          onClick={() => {
            allerEnBas(true);
            setNouveaux(0);
          }}
          className="toast-in fixed left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-xs font-bold shadow-lg shadow-black/40"
          style={{
            bottom: "calc(max(var(--tabbar-h), var(--kb)) + 4.5rem)",
            background: "var(--pc)",
            color: "oklch(0.15 0 0)",
          }}
        >
          ↓ {nouveaux} nouveau{nouveaux > 1 ? "x" : ""} message
          {nouveaux > 1 ? "s" : ""}
        </button>
      )}

      {menu && (
        <MessageSheet
          mine={menu.player_id === player.id}
          supprime={menu.deleted_at !== null}
          reactions={chat.reactions.get(menu.id) ?? []}
          byId={byId}
          myId={player.id}
          onReact={(e) => toggleReaction(menu.id, e)}
          onReply={() => setReply(menu)}
          onDelete={() => remove(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}

      {reglages && (
        <NotifySheet
          value={chat.pref}
          onChange={chat.changePref}
          onClose={() => setReglages(false)}
        />
      )}
    </div>
  );
}
