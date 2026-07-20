"use client";

// Un moment du fil : avatar, une ou plusieurs phrases, heure, rangée de
// réactions, commentaires repliés. Tout se passe inline — pas de modale.
//
// Une carte peut porter plusieurs événements : une coche écrit la séance,
// la prise de tête et le record à deux secondes d'intervalle, et ça reste
// un seul moment. Les lignes en base ne bougent pas — c'est le journal ;
// seul l'affichage les rassemble. Le premier événement du groupe sert
// d'ancre : c'est lui qui porte les nouvelles réactions et commentaires.
//
// Réactions et commentaires vivent dans Interactions, partagé avec la
// carte de bilan du lundi.

import {
  eventPhrase,
  FeedComment,
  FeedEvent,
  FeedReaction,
  timeOf,
} from "@/lib/feed";
import { Player } from "@/lib/types";
import { Avatar } from "../ui";
import Interactions from "./Interactions";

type Props = {
  events: FeedEvent[]; // 1..n, même joueur, même moment. events[0] = l'ancre.
  me: Player;
  byId: Map<string, Player>;
  reactions: FeedReaction[]; // du groupe entier
  comments: FeedComment[]; // du groupe entier
  onToggleReaction: (event: FeedEvent, emoji: string) => void;
  onAddComment: (event: FeedEvent, body: string) => void;
};

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
        <Interactions
          events={events}
          me={me}
          byId={byId}
          reactions={reactions}
          comments={comments}
          onToggleReaction={onToggleReaction}
          onAddComment={onAddComment}
        />
      </div>
    </li>
  );
}
