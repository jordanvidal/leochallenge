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

import { memo } from "react";
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
  onDiscuss: (events: FeedEvent[]) => void;
  /** On vient d'arriver dessus depuis une citation du tchat. L'id est
      unique dans la page : c'est lui que le fil vise pour défiler. */
  vise?: boolean;
};

function FeedItem({
  events,
  me,
  byId,
  reactions,
  comments,
  onToggleReaction,
  onDiscuss,
  vise,
}: Props) {
  const anchor = events[0];
  const author = byId.get(anchor.player_id);

  return (
    <li
      id={vise ? "moment-vise" : undefined}
      className={`flex gap-3 rounded-2xl bg-surface px-4 py-3 ${
        vise ? "moment-vise" : ""
      }`}
    >
      {author && <Avatar name={author.name} color={author.color} photo={author.photo} size={36} />}
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
        {/* L'heure d'un moment est une information, pas du décor : c'est
            la seule chose sur la carte qui dise quand. `faint` la posait à
            2,6:1 — le tchat a déjà eu cette correction sur le même appel. */}
        <p className="mt-0.5 text-[11px] text-quiet">{timeOf(anchor.created_at)}</p>
        <Interactions
          events={events}
          me={me}
          byId={byId}
          reactions={reactions}
          comments={comments}
          onToggleReaction={onToggleReaction}
          onDiscuss={onDiscuss}
        />
      </div>
    </li>
  );
}

// Le fil est monté dans `App`, qui se re-rend à chaque message du tchat, à
// chaque battement de présence, à chaque toast. Sans ce `memo`, chacun de
// ces rendus retraversait toutes les cartes chargées et recalculait leurs
// réactions. `FeedScreen` garde l'identité des props en face.
export default memo(FeedItem);
