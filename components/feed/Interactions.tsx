"use client";

// Réactions et commentaires, partagés par tout ce qui vit dans le fil :
// les moments (FeedItem) et le bilan du lundi (WeekRecapCard). Extrait de
// FeedItem quand la carte de bilan a eu besoin des mêmes gestes — la
// logique de dédup et de ciblage était trop subtile pour être recopiée.
//
// Le bloc porte plusieurs événements : une coche en écrit trois, le job du
// lundi en écrit huit. Les lignes en base ne bougent pas, seul l'affichage
// les rassemble. events[0] est l'ancre : c'est elle qui reçoit les
// nouvelles réactions, et c'est elle que « En parler » cite dans le tchat.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  FeedComment,
  FeedEvent,
  FeedReaction,
  REACTION_EMOJIS,
} from "@/lib/feed";
import { Player } from "@/lib/types";
import { Sheet } from "../ui";

/**
 * Une réaction posée : l'emoji et le nombre de gens derrière. Tap = j'ajoute
 * la mienne, retap = je la retire. Appui long = qui a réagi, en raccourci —
 * la même information vit dans la feuille, qui elle est découvrable.
 *
 * Elle ne s'affiche jamais vide : un emoji que personne n'a posé n'a pas de
 * pastille. C'est la feuille qui sert à en poser un nouveau.
 */
function ReactionPill({
  emoji,
  count,
  mine,
  who,
  onTap,
  pillBg,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  who: Player[];
  onTap: () => void;
  pillBg: string;
}) {
  const [showWho, setShowWho] = useState(false);
  const quiId = useId();
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

  // Ferme le popover au prochain tap ailleurs (ou au scroll). Échap ferme
  // aussi : au clavier, il n'y a ni tap ailleurs ni scroll à produire.
  useEffect(() => {
    if (!showWho) return;
    const close = () => setShowWho(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowWho(false);
    };
    document.addEventListener("keydown", onKey);
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", close);
      document.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("keydown", onKey);
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
          {/* Posé sur `raised`, `faint` tombait à 2,3:1 — et c'est le titre
              de l'infobulle, la phrase qui dit de quoi elle parle. */}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-quiet">
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
        // Qui a réagi ne s'ouvrait qu'au maintien de 450 ms — un geste
        // qu'un lecteur d'écran n'émet pas, sur un popover que rien ne
        // référençait. L'information était donc inatteignable par toute
        // autre route que l'œil. Elle est maintenant dans la description
        // du bouton, sans geste à produire.
        aria-describedby={who.length > 0 ? quiId : undefined}
        className="flex min-h-11 min-w-11 select-none items-center justify-center gap-1 rounded-full px-2 text-sm transition-transform active:scale-95"
        style={
          mine
            ? {
                background: "color-mix(in oklch, var(--pc) 18%, var(--color-surface))",
                boxShadow: "inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 55%, transparent)",
              }
            : { background: pillBg }
        }
      >
        {/* Plus d'`opacity-45` : une pastille n'existe que si quelqu'un l'a
            posée, donc plus aucune n'est éteinte. C'était la moitié du
            problème d'un 💀 à 45 % sur `raised` — une tache sombre à côté
            d'un 🔥 parfaitement lisible. */}
        <span>{emoji}</span>
        <span
          className="text-xs font-bold"
          style={{ color: mine ? "var(--pc)" : "var(--color-muted)" }}
        >
          {count}
        </span>
      </button>
      {who.length > 0 && (
        <span id={quiId} className="sr-only">
          {who.map((p) => p.name).join(", ")}
        </span>
      )}
    </div>
  );
}

/**
 * Ce qui se dit autour d'un moment. Depuis le 28/07, on ne l'écrit plus
 * ici : « Commenter » est devenu « En parler », qui emmène la carte dans
 * le tchat.
 *
 * La raison est entière dans docs/spec-tchat.md §9. Laisser les deux
 * ouverts donnerait le pire scénario possible pour un groupe de six : la
 * vanne se répartit entre les commentaires du fil et le salon, aucun des
 * deux n'atteint la masse critique, et les deux meurent. Le fil raconte,
 * le tchat discute.
 *
 * Rien n'est effacé. Les commentaires déjà écrits restent lisibles, la
 * table et sa policy d'insertion sont intactes en base : on cesse
 * d'écrire, on ne détruit pas.
 */
function Echanges({
  events,
  byId,
  comments,
  onDiscuss,
  avant,
}: {
  events: FeedEvent[];
  byId: Map<string, Player>;
  comments: FeedComment[];
  onDiscuss: (events: FeedEvent[]) => void;
  /** Le bouton « + » quand la carte n'a encore aucune réaction : il se
      range sur cette ligne plutôt que d'occuper une rangée pour lui seul. */
  avant?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const blocId = useId();

  // Les commentaires viennent de plusieurs événements : on les remet dans
  // l'ordre où ils ont été écrits, pas dans celui des événements porteurs.
  // Replié — l'état par défaut de presque toutes les cartes — on ne trie
  // rien du tout.
  const ordonnes = useMemo(
    () =>
      open
        ? [...comments].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        : comments,
    [comments, open],
  );

  return (
    <div className="mt-0.5 flex flex-col">
      {/* Les deux vraies actions de la carte. Elles étaient à 32 px sans
          marge horizontale, donc plus étroites que leur texte : la seule
          sortie du fil vers le tchat se ratait au pouce. Le `-mx-2` rend
          les 8 px pris en padding, l'alignement du bloc ne bouge pas. */}
      <div className="-mx-2 flex items-center">
        {avant}
        <button
          onClick={() => onDiscuss(events)}
          className="min-h-11 px-2 text-sm font-bold"
          style={{ color: "var(--pc)" }}
        >
          En parler →
        </button>
        {comments.length > 0 && (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={blocId}
            className="min-h-11 px-2 text-xs font-medium text-quiet"
          >
            {comments.length === 1
              ? "1 commentaire"
              : `${comments.length} commentaires`}
          </button>
        )}
      </div>

      {open && (
        <div id={blocId} className="mt-1.5 flex flex-col gap-1.5">
          {ordonnes.map((c) => {
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
          <p className="text-[11px] text-quiet">
            Les commentaires sont fermés. La suite se passe dans le tchat.
          </p>
        </div>
      )}
    </div>
  );
}

/** Un emoji réellement posé sur ce moment, et par qui. */
type Pose = { emoji: string; who: Player[]; mine: boolean };

/**
 * Le choix d'une réaction, et qui a déjà réagi. Une feuille montante et pas
 * une rangée permanente : les cinq emojis n'ont pas à occuper chaque carte
 * du fil pour rester à un geste. C'est aussi ce qui rend « qui a réagi »
 * atteignable autrement que par un maintien de 450 ms — un geste
 * indécouvrable, et qu'aucun lecteur d'écran n'émet.
 *
 * Même grammaire que la feuille d'actions du tchat : mêmes carrés de 56 px,
 * même anneau sur ce qu'on a déjà posé, même liste de prénoms en dessous.
 */
function ReactionSheet({
  parEmoji,
  me,
  onReact,
  onClose,
}: {
  parEmoji: Pose[];
  me: Player;
  onReact: (emoji: string) => void;
  onClose: () => void;
}) {
  const miens = new Set(parEmoji.filter((p) => p.mine).map((p) => p.emoji));

  return (
    <Sheet onClose={onClose} label="Réagir à ce moment">
      <div className="flex justify-between gap-1">
        {REACTION_EMOJIS.map((e) => {
          const deja = miens.has(e);
          return (
            <button
              key={e}
              onClick={() => {
                onReact(e);
                onClose();
              }}
              aria-pressed={deja}
              aria-label={deja ? `Retirer ${e}` : `Réagir ${e}`}
              className="flex size-14 items-center justify-center rounded-2xl text-2xl transition-transform active:scale-95"
              style={{
                background: deja
                  ? "color-mix(in oklch, var(--pc) 22%, var(--color-surface))"
                  : "var(--color-surface)",
                boxShadow: deja
                  ? "inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 60%, transparent)"
                  : undefined,
              }}
            >
              {e}
            </button>
          );
        })}
      </div>

      {parEmoji.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {parEmoji.map(({ emoji, who }) => (
            <li key={emoji} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0" aria-hidden>
                {emoji}
              </span>
              <span className="min-w-0">
                {who.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span className="text-quiet">, </span>}
                    <span className="font-bold" style={{ color: p.color }}>
                      {p.id === me.id ? "toi" : p.name}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

type Props = {
  events: FeedEvent[]; // 1..n ; events[0] = l'ancre
  me: Player;
  byId: Map<string, Player>;
  reactions: FeedReaction[]; // du groupe entier
  comments: FeedComment[]; // du groupe entier
  onToggleReaction: (event: FeedEvent, emoji: string) => void;
  /** Emmène le moment dans le tchat, cité. Remplace l'ancien commentaire. */
  onDiscuss: (events: FeedEvent[]) => void;
  /** Marge au-dessus de la rangée d'emojis. La carte de bilan respire plus. */
  gap?: string;
  /** Fond des pastilles non cochées. À passer plus sombre quand le bloc
      porteur est déjà sur `raised` — sinon les pastilles s'y fondent. */
  pillBg?: string;
};

export default function Interactions({
  events,
  me,
  byId,
  reactions,
  comments,
  onToggleReaction,
  onDiscuss,
  gap = "mt-2",
  pillBg = "var(--color-raised)",
}: Props) {
  const anchor = events[0];
  const [feuille, setFeuille] = useState(false);

  // Qui a mis quoi, calculé une fois par changement de réaction — et pas
  // une fois par rendu. C'était cinq balayages complets de `reactions` plus
  // cinq Set intermédiaires PAR CARTE, rejoués à chaque re-rendu d'`App`.
  //
  // Seuls les emojis que quelqu'un a réellement posés survivent au filtre :
  // c'est tout le changement de cette rangée. Les cinq pastilles permanentes
  // faisaient 244 px de large pour 240 disponibles à 360 px, et posaient
  // 44 px de commandes sous 14 px de récit — l'invitation à réagir criait
  // plus fort que ce qui s'était passé. Le tchat rend déjà ses réactions
  // comme ça (`ChatBubble`), et son commentaire cite ce fichier comme
  // précédent : l'amélioration n'était jamais revenue dans l'autre sens.
  const parEmoji = useMemo(
    () =>
      REACTION_EMOJIS.map((e) => {
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
        return {
          emoji: e,
          who,
          mine: reactions.some((r) => r.emoji === e && r.player_id === me.id),
        };
      }).filter((x) => x.who.length > 0),
    [reactions, byId, me.id],
  );

  // Retirer : sur l'événement qui porte VRAIMENT ma réaction, sinon le
  // retap en ajouterait une deuxième ailleurs. Ajouter : toujours sur
  // l'ancre. Partagé par la rangée et par la feuille — les deux posent la
  // même réaction, elles doivent viser la même ligne.
  const reagir = useCallback(
    (emoji: string) => {
      const mine = reactions.find(
        (r) => r.emoji === emoji && r.player_id === me.id,
      );
      const target = mine
        ? (events.find((ev) => ev.id === mine.event_id) ?? anchor)
        : anchor;
      onToggleReaction(target, emoji);
    },
    [reactions, me.id, events, anchor, onToggleReaction],
  );

  const plus = (
    <button
      onClick={() => setFeuille(true)}
      aria-label="Ajouter une réaction"
      className="flex size-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
      style={{ background: pillBg, color: "var(--color-quiet)" }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 5.5v13M5.5 12h13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );

  return (
    <>
      {parEmoji.length > 0 && (
        <div className={`${gap} flex flex-wrap gap-1.5`}>
          {parEmoji.map(({ emoji, who, mine }) => (
            <ReactionPill
              key={emoji}
              emoji={emoji}
              count={who.length}
              mine={mine}
              who={who}
              onTap={() => reagir(emoji)}
              pillBg={pillBg}
            />
          ))}
          {plus}
        </div>
      )}
      <Echanges
        events={events}
        byId={byId}
        comments={comments}
        onDiscuss={onDiscuss}
        // Aucune réaction : le « + » se range sur la ligne d'« En parler »
        // et la carte ne porte plus qu'une seule rangée de commandes.
        avant={parEmoji.length === 0 ? <div className="px-2">{plus}</div> : undefined}
      />
      {feuille && (
        <ReactionSheet
          parEmoji={parEmoji}
          me={me}
          onReact={reagir}
          onClose={() => setFeuille(false)}
        />
      )}
    </>
  );
}
