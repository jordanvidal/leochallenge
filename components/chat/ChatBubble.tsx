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
import { apercu, ChatMessage, ChatReaction, segmentsOf } from "@/lib/chat";
import { eventPhrase, FeedEvent, timeOf } from "@/lib/feed";
import { Player } from "@/lib/types";

/**
 * Le message cité, posé AU-DESSUS de la réponse et non dedans.
 *
 * C'est le geste iMessage, et il dit quelque chose que la citation
 * enfermée dans la bulle ne disait pas : les deux messages sont de même
 * nature. Un bloc encastré ressemble à une pièce jointe ; deux bulles
 * empilées ressemblent à une conversation.
 *
 * Trois réglages font tout le travail, et ils vont ensemble :
 *  · la bulle citée garde le style de SON auteur (accent si c'est moi,
 *    neutre sinon) — c'est ce qui permet de savoir à qui on répond sans
 *    lire le prénom ;
 *  · elle est plus petite, estompée, et rentrée d'un cran du côté aligné,
 *    donc elle passe manifestement au second plan ;
 *  · l'espace qui la sépare de la réponse est plus serré que celui entre
 *    deux messages, ce qui les fait lire comme un seul bloc.
 */
function BulleCitee({
  auteur,
  couleur,
  texte,
  deSonAuteur,
  aDroite,
  onClick,
}: {
  auteur: string;
  couleur: string;
  texte: string;
  /** La citation appartient au joueur courant : elle prend l'accent. */
  deSonAuteur: boolean;
  /** Alignée à droite, comme la réponse qu'elle précède. */
  aDroite: boolean;
  onClick?: () => void;
}) {
  const Balise = onClick ? "button" : "div";
  return (
    <Balise
      onClick={onClick}
      className={`-mb-0.5 max-w-[72%] rounded-2xl px-3 py-1.5 text-left ${
        aDroite ? "mr-3" : "ml-3"
      }`}
      style={{
        background: deSonAuteur
          ? "color-mix(in oklch, var(--pc) 26%, var(--color-bg))"
          : "var(--color-surface)",
        opacity: 0.72,
      }}
    >
      <span className="block text-[11px] font-bold" style={{ color: couleur }}>
        {auteur}
      </span>
      <span className="line-clamp-2 block text-xs text-muted">{texte}</span>
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
  /** Pour repérer et colorer les mentions. Le rendu lit la MÊME fonction
      que la route de notification : ce qui est surligné est ce qui a
      prévenu quelqu'un, jamais autre chose. */
  players: Player[];
  byId: Map<string, Player>;
  /** On vient de le rejoindre depuis une citation : il s'allume une fois. */
  flash: boolean;
  onOpenMenu: (m: ChatMessage) => void;
  onReply: (m: ChatMessage) => void;
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
  players,
  byId,
  flash,
  onOpenMenu,
  onReply,
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

  // Les emojis distincts, dans l'ordre où ils sont tombés. Trois au plus :
  // au-delà, la pastille devient plus large que le message qu'elle
  // commente, et c'est la conversation qu'on n'arrive plus à lire.
  const emojis = [...new Set(reactions.map((r) => r.emoji))].slice(0, 3);
  const jyAiReagi = reactions.some((r) => r.player_id === myId);
  // Le compte ne s'affiche que s'il apporte quelque chose : deux emojis
  // différents disent déjà « deux personnes », le chiffre serait du bruit.
  const compteUtile = reactions.length > emojis.length ? reactions.length : 0;

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
      {/* La citation vient AVANT le prénom de l'auteur de la réponse :
          au-dessus, le prénom se lirait comme l'étiquette de la citation
          et non comme celle de la réponse. */}
      {parent && (
        <BulleCitee
          auteur={parentAuthor?.name ?? "Message"}
          couleur={parentAuthor?.color ?? "var(--color-muted)"}
          texte={parent.deleted_at ? "Message supprimé" : apercu(parent.body, 120)}
          deSonAuteur={parent.player_id === myId}
          aDroite={isMine}
          onClick={() => onJumpTo(parent.id)}
        />
      )}

      {feedEvent && (
        // Le moment du fil suit le même traitement : c'est aussi « ce
        // message parle de ça ». La phrase vient d'eventPhrase(), la même
        // qui rend la carte dans le fil — jamais une reformulation.
        <BulleCitee
          auteur={`${eventPhrase(feedEvent).emoji} ${feedEventAuthor?.name ?? "Le fil"}`}
          couleur={feedEventAuthor?.color ?? "var(--color-muted)"}
          texte={apercu(eventPhrase(feedEvent).text, 120)}
          deSonAuteur={feedEvent.player_id === myId}
          aDroite={isMine}
        />
      )}

      {showAuthor && !isMine && (
        <span
          className="mb-0.5 ml-1 text-xs font-bold"
          style={{ color: couleur }}
        >
          {author?.name ?? "?"}
        </span>
      )}

      <div
        // La marge du haut réserve la place que la pastille prend en
        // débordant : sans elle, elle irait mordre le message précédent.
        className={`relative max-w-[78%] ${emojis.length > 0 ? "mt-5" : ""}`}
      >
      <div
        className="rounded-2xl px-3.5 py-2"
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
        <p
          className={`text-[15px] leading-snug break-words whitespace-pre-wrap ${
            supprime ? "italic" : ""
          }`}
        >
          {supprime
            ? "Message supprimé"
            : segmentsOf(message.body, players).map((seg, i) =>
                seg.playerId ? (
                  // La mention devient une étiquette : c'est ce qui la
                  // distingue d'un prénom écrit au fil de la phrase, et
                  // donc ce qui dit « celui-là a été prévenu ».
                  <span
                    key={i}
                    className="rounded px-0.5 font-bold"
                    style={
                      isMine
                        ? {
                            color: "oklch(0.15 0 0)",
                            background: "oklch(0.15 0 0 / 0.14)",
                          }
                        : {
                            color: byId.get(seg.playerId)?.color ?? "inherit",
                            background: `color-mix(in oklch, ${
                              byId.get(seg.playerId)?.color ?? "transparent"
                            } 16%, transparent)`,
                          }
                    }
                  >
                    {seg.texte}
                  </span>
                ) : (
                  <span key={i}>{seg.texte}</span>
                ),
              )}
        </p>
        </div>

        {emojis.length > 0 && (
          // Le tapback : posé SUR la bulle, du côté opposé à son auteur —
          // à droite d'une bulle de gauche, à gauche d'une bulle de
          // droite. C'est là que se trouve la place libre, et c'est ce qui
          // fait que la pastille n'écrase jamais le début d'une phrase.
          //
          // Posée et non empilée dessous, elle ne pousse plus rien vers le
          // bas : réagir à un vieux message ne fait plus sauter la
          // conversation sous le pouce de celui qui est en train de lire.
          <button
            onClick={() => onOpenMenu(message)}
            aria-label={`Réactions : ${emojis.join(" ")}${
              compteUtile ? `, ${compteUtile} en tout` : ""
            }`}
            // -top-5 pour une pastille haute de 24 px : elle ne déborde
            // sur la bulle que de 4 px, soit moins que ses 8 px de marge
            // intérieure. Elle en effleure donc le coin arrondi et ne
            // touche jamais le texte — c'était le défaut du premier
            // réglage, où elle se posait en plein sur le premier mot.
            className={`absolute -top-5 flex min-h-6 items-center gap-0.5 rounded-full px-1.5 ${
              isMine ? "-left-1.5" : "-right-1.5"
            }`}
            style={{
              background: jyAiReagi
                ? "color-mix(in oklch, var(--pc) 22%, var(--color-raised))"
                : "var(--color-raised)",
              // Le détourage à la couleur du fond détache la pastille de la
              // bulle sur laquelle elle mord. Sans lui, les deux formes se
              // touchent et la pastille a l'air d'une excroissance.
              boxShadow: jyAiReagi
                ? "0 0 0 2px var(--color-bg), inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 60%, transparent)"
                : "0 0 0 2px var(--color-bg)",
            }}
          >
            {emojis.map((e) => (
              <span key={e} className="text-[13px] leading-none">
                {e}
              </span>
            ))}
            {compteUtile > 0 && (
              <span className="ml-0.5 text-[11px] font-bold text-muted">
                {compteUtile}
              </span>
            )}
          </button>
        )}
      </div>

      {showTime && !enVol && (
        <span className={`mt-0.5 text-[10px] text-faint ${isMine ? "mr-1" : "ml-1"}`}>
          {timeOf(message.created_at)}
        </span>
      )}
    </li>
  );
}
