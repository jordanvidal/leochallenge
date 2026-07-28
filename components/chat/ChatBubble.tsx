"use client";

// Une bulle. Des bulles et pas des cartes : PRODUCT.md range les cartes
// grises du côté du dashboard SaaS, et une conversation en cartes
// empilées est illisible.
//
// Mes messages à droite, à ma couleur, texte sombre — le motif accent
// déjà en place partout (BigButton, bouton d'envoi du fil). Contraste
// mesuré sur les 8 couleurs de la palette : 6,88:1 au pire (violet),
// contre 4,5 requis. Les autres à gauche sur `surface`, prénom coloré
// au-dessus : la couleur, c'est les joueurs, et c'est elle qui rend le
// salon lisible en diagonale.

import { useRef, useState } from "react";
import { apercu, ChatMessage, ChatReaction } from "@/lib/chat";
import { eventPhrase, FeedEvent, timeOf } from "@/lib/feed";
import { Player } from "@/lib/types";

/**
 * Le bloc cité, en tête d'une bulle : soit un message auquel on répond,
 * soit le moment du fil dont on est venu parler.
 *
 * Un aplat plus sombre et un prénom coloré. Surtout pas de liseré
 * latéral : c'est le réflexe pour « citation », et un aplat le dit
 * mieux sans ajouter de trait dans un écran qui en a déjà assez.
 */
function Cite({
  titre,
  couleur,
  texte,
  surAccent,
  onClick,
}: {
  titre: string;
  couleur: string;
  texte: string;
  /** Posé sur ma bulle : les contrastes se calculent sur du clair. */
  surAccent: boolean;
  onClick?: () => void;
}) {
  const Balise = onClick ? "button" : "div";
  return (
    <Balise
      onClick={onClick}
      className="mb-1.5 block w-full rounded-lg px-2 py-1 text-left"
      style={{ background: surAccent ? "oklch(0.15 0 0 / 0.16)" : "var(--color-bg)" }}
    >
      <span
        className="block text-[11px] font-bold"
        style={{ color: surAccent ? "oklch(0.15 0 0 / 0.75)" : couleur }}
      >
        {titre}
      </span>
      <span
        className="block truncate text-xs"
        style={{ color: surAccent ? "oklch(0.15 0 0 / 0.7)" : "var(--color-muted)" }}
      >
        {texte}
      </span>
    </Balise>
  );
}

/** Au-delà, le geste est une réponse et pas un défilement. */
const SWIPE_PX = 56;

type Props = {
  message: ChatMessage;
  author: Player | undefined;
  isMine: boolean;
  showAuthor: boolean;
  showTime: boolean;
  parent: ChatMessage | undefined;
  parentAuthor: Player | undefined;
  /** Le moment du fil d'où vient la conversation (« En parler »). */
  feedEvent: FeedEvent | undefined;
  feedEventAuthor: Player | undefined;
  reactions: ChatReaction[];
  myId: string;
  /** On vient de le rejoindre depuis une citation : il s'allume une fois. */
  flash: boolean;
  onOpenMenu: (m: ChatMessage) => void;
  onReply: (m: ChatMessage) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onJumpTo: (id: string) => void;
};

export default function ChatBubble({
  message,
  author,
  isMine,
  showAuthor,
  showTime,
  parent,
  parentAuthor,
  feedEvent,
  feedEventAuthor,
  reactions,
  myId,
  flash,
  onOpenMenu,
  onReply,
  onToggleReaction,
  onJumpTo,
}: Props) {
  const [dx, setDx] = useState(0);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const presse = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consomme = useRef(false);

  const supprime = message.deleted_at !== null;
  // L'optimiste porte un id temporaire tant que la base n'a pas répondu.
  const enVol = message.id.startsWith("tmp-");
  const couleur = author?.color ?? "var(--color-muted)";

  function annulerAppui() {
    if (presse.current) {
      clearTimeout(presse.current);
      presse.current = null;
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (enVol) return;
    consomme.current = false;
    depart.current = { x: e.clientX, y: e.clientY };
    // Même durée et même vibration que l'appui long des réactions du fil
    // (components/feed/Interactions.tsx) : un seul geste dans l'app.
    annulerAppui();
    presse.current = setTimeout(() => {
      consomme.current = true;
      navigator.vibrate?.(12);
      onOpenMenu(message);
    }, 450);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!depart.current || consomme.current) return;
    const ex = e.clientX - depart.current.x;
    const ey = e.clientY - depart.current.y;
    // Dès que le doigt bouge, ce n'est plus un appui long.
    if (Math.abs(ex) > 8 || Math.abs(ey) > 8) annulerAppui();
    // Le geste ne prend la main que s'il est franchement horizontal :
    // sinon on volerait le défilement de quelqu'un qui remonte le fil.
    if (Math.abs(ey) > Math.abs(ex) || supprime) return;
    setDx(Math.max(0, Math.min(ex, SWIPE_PX + 12)));
  }

  function onPointerUp() {
    annulerAppui();
    if (dx >= SWIPE_PX && !consomme.current) {
      navigator.vibrate?.(10);
      onReply(message);
    }
    setDx(0);
    depart.current = null;
  }

  const mesEmojis = new Set(
    reactions.filter((r) => r.player_id === myId).map((r) => r.emoji),
  );
  // Une pastille par emoji présent, comptée en personnes.
  const parEmoji = [...new Set(reactions.map((r) => r.emoji))].map((emoji) => ({
    emoji,
    count: reactions.filter((r) => r.emoji === emoji).length,
    mine: mesEmojis.has(emoji),
  }));

  return (
    <li
      id={`msg-${message.id}`}
      className={`flex flex-col ${isMine ? "items-end" : "items-start"} ${
        flash ? "chat-flash" : ""
      }`}
      style={{
        transform: dx ? `translateX(${dx}px)` : undefined,
        transition: dx ? "none" : "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      {showAuthor && !isMine && (
        <span
          className="mb-0.5 ml-1 text-xs font-bold"
          style={{ color: couleur }}
        >
          {author?.name ?? "?"}
        </span>
      )}

      <div
        className="max-w-[78%] rounded-2xl px-3.5 py-2"
        style={{
          background: supprime
            ? "transparent"
            : isMine
              ? "var(--pc)"
              : "var(--color-surface)",
          boxShadow: supprime ? "inset 0 0 0 1px var(--color-line)" : undefined,
          color: supprime
            ? "var(--color-faint)"
            : isMine
              ? "oklch(0.15 0 0)"
              : "var(--color-ink)",
          opacity: enVol ? 0.6 : 1,
        }}
      >
        {parent && (
          <Cite
            titre={parentAuthor?.name ?? "Message"}
            couleur={parentAuthor?.color ?? "var(--color-muted)"}
            texte={parent.deleted_at ? "Message supprimé" : apercu(parent.body)}
            surAccent={isMine}
            onClick={() => onJumpTo(parent.id)}
          />
        )}

        {feedEvent && (
          // La phrase du moment est fabriquée par eventPhrase(), la même
          // qui rend la carte dans le fil : la citation dit exactement ce
          // qu'on a lu là-bas, jamais une reformulation qui diverge.
          <Cite
            titre={`${eventPhrase(feedEvent).emoji} ${feedEventAuthor?.name ?? "Le fil"}`}
            couleur={feedEventAuthor?.color ?? "var(--color-muted)"}
            texte={apercu(eventPhrase(feedEvent).text, 70)}
            surAccent={isMine}
          />
        )}

        <p
          className={`text-[15px] leading-snug break-words whitespace-pre-wrap ${
            supprime ? "italic" : ""
          }`}
        >
          {supprime ? "Message supprimé" : message.body}
        </p>
      </div>

      {parEmoji.length > 0 && (
        <div className={`mt-1 flex gap-1 ${isMine ? "mr-1" : "ml-1"}`}>
          {parEmoji.map(({ emoji, count, mine }) => (
            <button
              key={emoji}
              onClick={() => onToggleReaction(message.id, emoji)}
              aria-pressed={mine}
              aria-label={`${emoji} ${count}`}
              className="flex min-h-8 items-center gap-1 rounded-full px-2 text-xs"
              style={{
                background: mine
                  ? "color-mix(in oklch, var(--pc) 20%, var(--color-surface))"
                  : "var(--color-surface)",
                boxShadow: mine
                  ? "inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 55%, transparent)"
                  : undefined,
              }}
            >
              <span>{emoji}</span>
              {count > 1 && (
                <span className="font-bold text-muted">{count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {showTime && !enVol && (
        <span className={`mt-0.5 text-[10px] text-faint ${isMine ? "mr-1" : "ml-1"}`}>
          {timeOf(message.created_at)}
        </span>
      )}
    </li>
  );
}
