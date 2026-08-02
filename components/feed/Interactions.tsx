"use client";

// Réactions et commentaires, partagés par tout ce qui vit dans le fil :
// les moments (FeedItem) et le bilan du lundi (WeekRecapCard). Extrait de
// FeedItem quand la carte de bilan a eu besoin des mêmes gestes — la
// logique de dédup et de ciblage était trop subtile pour être recopiée.
//
// Au repos, la rangée ne montre que les emojis qui portent au moins une
// réaction, plus une pastille « + » qui déploie la palette complète. C'est
// le modèle du tchat (ChatBubble.tsx), qui l'avait d'ailleurs copié d'ici
// avant de le corriger : une réaction affichée est une réaction que
// quelqu'un a posée, jamais une invitation. Cinq pastilles permanentes
// faisaient de la rangée l'objet le plus bruyant de chaque carte — 44 px
// de boutons sous 14 px de récit — et débordaient du cadre à 360 px.
// La palette se déploie EN PLACE, dans la même rangée : un menu flottant
// se ferait rogner par la première carte qui découpe, une feuille serait
// un étage de trop pour choisir parmi cinq emojis.
//
// Le bloc porte plusieurs événements : une coche en écrit trois, le job du
// lundi en écrit huit. Les lignes en base ne bougent pas, seul l'affichage
// les rassemble. events[0] est l'ancre : c'est elle qui reçoit les
// nouvelles réactions, et c'est elle que « En parler » cite dans le tchat.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  FeedComment,
  FeedEvent,
  FeedReaction,
  REACTION_EMOJIS,
} from "@/lib/feed";
import { Player } from "@/lib/types";

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
        <span>{emoji}</span>
        {count > 0 && (
          <span
            className="text-xs font-bold"
            style={{ color: mine ? "var(--pc)" : "var(--color-muted)" }}
          >
            {count}
          </span>
        )}
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
}: {
  events: FeedEvent[];
  byId: Map<string, Player>;
  comments: FeedComment[];
  onDiscuss: (events: FeedEvent[]) => void;
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

  // La palette est déployée : toutes les pastilles sont visibles, même à
  // zéro, le temps d'en choisir une.
  const [choisir, setChoisir] = useState(false);
  const rangee = useRef<HTMLDivElement>(null);

  // La palette se replie au prochain tap ailleurs, au scroll ou à Échap —
  // même contrat de fermeture que le popover « qui a réagi » au-dessus.
  useEffect(() => {
    if (!choisir) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && rangee.current?.contains(e.target))
        return; // un tap dans la rangée a déjà son geste
      setChoisir(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChoisir(false);
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
  }, [choisir]);

  // La rangée entière, calculée une fois par changement de réaction et pas
  // une fois par rendu. Elle coûtait cinq balayages complets de `reactions`
  // plus cinq Set intermédiaires par carte ; multiplié par toutes les
  // cartes chargées, à chaque re-rendu d'`App`. Mémoïser les éléments eux-
  // mêmes suffit : React réutilise le sous-arbre quand la référence ne
  // bouge pas, sans qu'aucune pastille ait besoin d'un `memo`.
  const { pastilles, manque } = useMemo(() => {
    const rendus: React.ReactNode[] = [];
    // Au moins un emoji est absent de la rangée : c'est ce qui donne au
    // « + » une raison d'exister. Tous posés = tout est déjà tapable.
    let manque = false;
    for (const e of REACTION_EMOJIS) {
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
      if (who.length === 0 && !choisir) {
        manque = true;
        continue;
      }
      const mine = reactions.find(
        (r) => r.emoji === e && r.player_id === me.id,
      );
      // Retirer : sur l'événement qui porte VRAIMENT ma réaction,
      // sinon le retap en ajouterait une deuxième ailleurs.
      // Ajouter : toujours sur l'ancre.
      const target = mine
        ? (events.find((ev) => ev.id === mine.event_id) ?? anchor)
        : anchor;
      rendus.push(
        <ReactionPill
          key={e}
          emoji={e}
          count={who.length}
          mine={!!mine}
          who={who}
          onTap={() => {
            setChoisir(false);
            onToggleReaction(target, e);
          }}
          pillBg={pillBg}
        />,
      );
    }
    return { pastilles: rendus, manque };
  }, [reactions, byId, me.id, events, anchor, onToggleReaction, pillBg, choisir]);

  return (
    <>
      {/* `flex-wrap` : la palette déployée peut dépasser la largeur d'une
          carte sur les petits écrans ; elle passe alors à la ligne au lieu
          de sortir du cadre. Le gap se resserre déployée, pour qu'elle
          tienne d'un bloc à 360 px. */}
      <div
        ref={rangee}
        className={`${gap} flex flex-wrap ${choisir ? "gap-1" : "gap-1.5"}`}
      >
        {pastilles}
        {/* Le « + » reste monté pendant le choix : il sert alors à refermer
            sans réagir, et le focus clavier ne tombe pas dans le vide. */}
        {(choisir || manque) && (
          <button
            onClick={() => setChoisir((c) => !c)}
            aria-expanded={choisir}
            aria-label={choisir ? "Refermer la palette" : "Ajouter une réaction"}
            className="flex min-h-11 min-w-11 select-none items-center justify-center rounded-full px-2 text-base font-bold text-muted transition-transform active:scale-95"
            style={{ background: pillBg }}
          >
            <span
              aria-hidden
              className="transition-transform"
              style={choisir ? { transform: "rotate(45deg)" } : undefined}
            >
              +
            </span>
          </button>
        )}
      </div>
      <Echanges
        events={events}
        byId={byId}
        comments={comments}
        onDiscuss={onDiscuss}
      />
    </>
  );
}
