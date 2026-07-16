"use client";

// Un moment du fil : avatar, une ou plusieurs phrases, heure, rangée de
// réactions, commentaires repliés. Tout se passe inline — pas de modale.
//
// Une carte peut porter plusieurs événements : une coche écrit la séance,
// la prise de tête et le record à deux secondes d'intervalle, et ça reste
// un seul moment. Les lignes en base ne bougent pas — c'est le journal ;
// seul l'affichage les rassemble. Le premier événement du groupe sert
// d'ancre : c'est lui qui porte les nouvelles réactions et commentaires.

import { useEffect, useRef, useState } from "react";
import {
  eventPhrase,
  FeedComment,
  FeedEvent,
  FeedReaction,
  REACTION_EMOJIS,
  timeOf,
} from "@/lib/feed";
import { Player } from "@/lib/types";
import { Avatar } from "../ui";

type Props = {
  events: FeedEvent[]; // 1..n, même joueur, même moment. events[0] = l'ancre.
  me: Player;
  byId: Map<string, Player>;
  reactions: FeedReaction[]; // du groupe entier
  comments: FeedComment[]; // du groupe entier
  onToggleReaction: (event: FeedEvent, emoji: string) => void;
  onAddComment: (event: FeedEvent, body: string) => void;
};

/**
 * Une pastille emoji + compteur. Tap = ajoute, retap = enlève.
 * Appui long = qui a réagi (petit popover des collègues).
 */
function ReactionPill({
  emoji,
  count,
  mine,
  who,
  onTap,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  who: Player[];
  onTap: () => void;
}) {
  const [showWho, setShowWho] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Un appui long ouvre le popover ; on gèle alors le clic qui suit
  // pour ne pas déclencher la réaction par-dessus.
  const longPressed = useRef(false);

  function clearTimer() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function onPointerDown() {
    longPressed.current = false;
    if (who.length === 0) return;
    clearTimer();
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setShowWho(true);
      navigator.vibrate?.(12);
    }, 450);
  }

  function handleClick() {
    if (longPressed.current) {
      longPressed.current = false;
      return; // l'appui long a déjà agi
    }
    onTap();
  }

  // Ferme le popover au prochain tap ailleurs (ou au scroll).
  useEffect(() => {
    if (!showWho) return;
    const close = () => setShowWho(false);
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", close);
      document.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [showWho]);

  useEffect(() => () => clearTimer(), []);

  return (
    <div className="relative">
      {showWho && (
        <div
          role="tooltip"
          className="absolute bottom-full left-1/2 z-10 mb-1.5 flex max-w-[60vw] -translate-x-1/2 flex-col gap-0.5 whitespace-nowrap rounded-xl px-3 py-2 shadow-lg"
          style={{ background: "var(--color-raised)" }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
            {emoji} {who.length === 1 ? "1 réaction" : `${who.length} réactions`}
          </span>
          {who.map((p) => (
            <span
              key={p.id}
              className="text-sm font-bold leading-snug"
              style={{ color: p.color }}
            >
              {p.name}
            </span>
          ))}
        </div>
      )}
      <button
        onClick={handleClick}
        onPointerDown={onPointerDown}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => e.preventDefault()}
        aria-pressed={mine}
        aria-label={`Réagir ${emoji}${count > 0 ? ` (${count})` : ""}`}
        className="flex min-h-11 min-w-11 select-none items-center justify-center gap-1 rounded-full px-2 text-sm transition-transform active:scale-95"
        style={
          mine
            ? {
                background: "color-mix(in oklch, var(--pc) 18%, var(--color-surface))",
                boxShadow: "inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 55%, transparent)",
              }
            : { background: "var(--color-raised)" }
        }
      >
        <span className={count === 0 && !mine ? "opacity-45" : undefined}>
          {emoji}
        </span>
        {count > 0 && (
          <span
            className="text-xs font-bold"
            style={{ color: mine ? "var(--pc)" : "var(--color-muted)" }}
          >
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

/** Zone commentaires : repliée sur un compteur, dépliée = liste + saisie. */
function Comments({
  event,
  byId,
  comments,
  onAddComment,
}: {
  event: FeedEvent;
  byId: Map<string, Player>;
  comments: FeedComment[];
  onAddComment: (event: FeedEvent, body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function send() {
    const text = draft.trim();
    if (!text) return;
    onAddComment(event, text);
    setDraft("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 min-h-8 self-start text-xs font-medium text-faint"
      >
        {comments.length === 0
          ? "Commenter"
          : comments.length === 1
            ? "1 commentaire"
            : `${comments.length} commentaires`}
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {comments.map((c) => {
        const author = byId.get(c.player_id);
        return (
          <p key={c.id} className="text-sm leading-snug">
            <span
              className="font-bold"
              style={{ color: author?.color ?? "var(--color-muted)" }}
            >
              {author?.name ?? "?"}
            </span>{" "}
            {c.body}
          </p>
        );
      })}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          maxLength={140}
          placeholder="Une pique, un bravo…"
          aria-label="Commenter cet événement"
          className="min-h-11 min-w-0 flex-1 rounded-full bg-raised px-4 text-base text-ink placeholder:text-muted focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--pc)" } as React.CSSProperties}
        />
        <button
          onClick={send}
          disabled={draft.trim().length === 0}
          aria-label="Envoyer le commentaire"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full font-bold transition-transform active:scale-95 disabled:opacity-40"
          style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12h13M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {draft.length > 110 && (
        <p className="text-right text-[11px] text-faint">
          {140 - draft.length} caractères restants
        </p>
      )}
    </div>
  );
}

export default function FeedItem({
  events,
  me,
  byId,
  reactions,
  comments,
  onToggleReaction,
  onAddComment,
}: Props) {
  const anchor = events[0];
  const author = byId.get(anchor.player_id);

  // Les commentaires viennent de plusieurs événements : on les remet dans
  // l'ordre où ils ont été écrits, pas dans celui des événements portants.
  const ordered = [...comments].sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  );

  return (
    <li className="flex gap-3 rounded-2xl bg-surface px-4 py-3">
      {author && <Avatar name={author.name} color={author.color} size={36} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Le prénom sur la première ligne seulement : les suivantes
            s'enchaînent dessus ("Jordan bat sa meilleure série / a validé
            ses 3 exos"). L'ordre du fil est conservé, donc le moment fort
            (prise de tête, record) mène et la séance suit. */}
        {events.map((e, i) => {
          const { emoji, text } = eventPhrase(e);
          return (
            <p key={e.id} className={i > 0 ? "mt-0.5 text-sm leading-snug" : "text-sm leading-snug"}>
              <span aria-hidden>{emoji}</span>{" "}
              {i === 0 && (
                <>
                  <span
                    className="font-bold"
                    style={{ color: author?.color ?? "var(--color-muted)" }}
                  >
                    {author?.name ?? "?"}
                  </span>{" "}
                </>
              )}
              {text}
            </p>
          );
        })}
        <p className="mt-0.5 text-[11px] text-faint">{timeOf(anchor.created_at)}</p>
        <div className="mt-2 flex gap-1.5">
          {REACTION_EMOJIS.map((e) => {
            // Un joueur qui a mis le même emoji sur deux événements du
            // groupe ne compte qu'une fois : on compte des gens, pas des
            // lignes.
            const who = [
              ...new Set(
                reactions.filter((r) => r.emoji === e).map((r) => r.player_id),
              ),
            ]
              .map((id) => byId.get(id))
              .filter((p): p is Player => Boolean(p));
            const mine = reactions.find(
              (r) => r.emoji === e && r.player_id === me.id,
            );
            // Retirer : sur l'événement qui porte VRAIMENT ma réaction,
            // sinon le retap en ajouterait une deuxième ailleurs.
            // Ajouter : toujours sur l'ancre.
            const target = mine
              ? (events.find((ev) => ev.id === mine.event_id) ?? anchor)
              : anchor;
            return (
              <ReactionPill
                key={e}
                emoji={e}
                count={who.length}
                mine={!!mine}
                who={who}
                onTap={() => onToggleReaction(target, e)}
              />
            );
          })}
        </div>
        <Comments
          event={anchor}
          byId={byId}
          comments={ordered}
          onAddComment={onAddComment}
        />
      </div>
    </li>
  );
}
