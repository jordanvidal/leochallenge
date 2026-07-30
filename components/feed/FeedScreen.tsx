"use client";

// Le fil : antéchronologique, groupé par jour. Personne n'écrit de
// post — le feed raconte ce qui s'est passé, le groupe réagit dessus.

import { useEffect, useRef, useState } from "react";
import { Feed } from "@/hooks/useFeed";
import { addDays } from "@/lib/challenge";
import { dayLabel, FeedEvent, parisDayOf } from "@/lib/feed";
import { Player } from "@/lib/types";
import FeedItem from "./FeedItem";
import WeekRecapCard from "./WeekRecapCard";
import { Skeleton } from "../ui";

type Props = {
  player: Player;
  players: Player[];
  feed: Feed;
  onGoLeaderboard: () => void;
  /** « En parler » : emmène le moment dans le tchat, cité. C'est ce
      rebond qui donne au salon de la matière dès le premier jour —
      personne n'a jamais à décider d'ouvrir une conversation. */
  onDiscuss: (events: FeedEvent[]) => void;
  /** Le moment qu'on vient rejoindre depuis sa citation dans le tchat.
      Le fil le cherche, remonte s'il le faut, l'amène au centre de
      l'écran et l'allume une fois. */
  focusEventId: string | null;
  onFocusDone: () => void;
  showToast: (msg: string) => void;
};

/** Pages qu'on accepte de charger en plus pour retrouver un moment cité.
    Quatre pages de 50, soit environ dix jours de vie du groupe : au-delà,
    on le dit plutôt que de faire tourner la roue en silence. */
const REMONTEES_MAX = 4;

/** Les lignes de bascule d'une semaine à l'autre : les duels, écrits par
    le job du lundi matin, et le récit, écrit par pg_cron à minuit. Elles
    sortent du flux normal : groupées, elles forment le bilan de la semaine. */
function isHebdo(e: FeedEvent): boolean {
  return e.kind === "duel_start" || e.kind === "duel_result" || e.kind === "recit";
}

/** La semaine CLOSE dont parle un événement hebdo — la clé de regroupement.
    `duel_start` ouvre la semaine suivante : sa carte est celle d'avant.
    Sans cette clé, un rattrapage qui écrit deux récits le même jour les
    empilerait dans une seule carte, trois semaines mélangées. */
function closedMondayOf(e: FeedEvent): string | null {
  const wm = e.payload.week_monday;
  if (!wm) return null;
  return e.kind === "duel_start" ? addDays(wm, -7) : wm;
}

/** Groupe les événements par jour civil Paris, ordre du fil conservé. */
function groupByDay(events: FeedEvent[]): { day: string; items: FeedEvent[] }[] {
  const groups: { day: string; items: FeedEvent[] }[] = [];
  for (const e of events) {
    const day = parisDayOf(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }
  return groups;
}

// Une coche déclenche une cascade : le trigger SQL écrit la séance, puis
// /api/moments ajoute la prise de tête et le record une à quatre secondes
// plus tard. Trois lignes en base, mais un seul moment vécu. La fenêtre
// couvre aussi la visite complète (« je coche, puis je déclare mes bonus »),
// qui tient en moins de deux minutes dans les données réelles.
const BURST_MS = 120_000;

/** Regroupe les événements consécutifs d'un même joueur tombés ensemble.
    La fenêtre part du premier du groupe : un groupe ne s'étire donc jamais
    au-delà de 2 min, même si les événements s'enchaînent un par un. */
function groupBursts(events: FeedEvent[]): FeedEvent[][] {
  const bursts: FeedEvent[][] = [];
  for (const e of events) {
    const last = bursts[bursts.length - 1];
    const head = last?.[0];
    const together =
      head &&
      head.player_id === e.player_id &&
      Math.abs(
        new Date(head.created_at).getTime() - new Date(e.created_at).getTime(),
      ) <= BURST_MS;
    if (together) last.push(e);
    else bursts.push([e]);
  }
  return bursts;
}

/** Le contenu d'une journée, prêt à rendre : les moments habituels et,
    le lundi, le bilan. Tout est reclassé antéchronologiquement — le bilan
    se pose donc à l'heure où le job a tourné, pas en tête arbitrairement. */
type Block =
  | { kind: "burst"; at: string; events: FeedEvent[] }
  | { kind: "recap"; at: string; events: FeedEvent[] };

function blocksOf(items: FeedEvent[]): Block[] {
  const blocks: Block[] = groupBursts(items.filter((e) => !isHebdo(e))).map(
    (events) => ({ kind: "burst", at: events[0].created_at, events }),
  );

  // Un bilan par semaine close, jamais deux semaines dans la même carte.
  const semaines = new Map<string, FeedEvent[]>();
  for (const e of items.filter(isHebdo)) {
    const key = closedMondayOf(e) ?? e.id; // sans date, l'événement reste seul
    const deja = semaines.get(key);
    if (deja) deja.push(e);
    else semaines.set(key, [e]);
  }
  for (const events of semaines.values()) {
    // Le job insère tout d'un bloc : le plus récent donne l'heure du bilan.
    const at = events.reduce((m, e) => (e.created_at > m ? e.created_at : m), events[0].created_at);
    blocks.push({ kind: "recap", at, events });
  }

  return blocks.sort((a, b) => (a.at > b.at ? -1 : 1));
}

export default function FeedScreen({
  player,
  players,
  feed,
  onGoLeaderboard,
  onDiscuss,
  focusEventId,
  onFocusDone,
  showToast,
}: Props) {
  const byId = new Map(players.map((p) => [p.id, p]));

  // On ouvre le fil pour voir ce qui vient de se passer, jamais pour
  // reprendre là où on s'était arrêté. Or la page défile dans la fenêtre,
  // et la fenêtre garde sa position d'un onglet à l'autre : revenir au
  // fil rouvrait sur un moment d'il y a deux jours, avec le plus récent
  // hors champ au-dessus. On remonte donc en tête à l'ouverture — sauf
  // quand on arrive du tchat pour rejoindre un moment cité, qui a son
  // propre défilement et gagne.
  const citation = useRef(focusEventId);
  useEffect(() => {
    if (citation.current) return;
    window.scrollTo(0, 0);
  }, []);

  // Le moment allumé en ce moment. Distinct de focusEventId : la consigne
  // vient d'ailleurs et se consomme, l'allumage est à nous et s'éteint.
  const [vise, setVise] = useState<string | null>(null);
  const remontees = useRef(0);

  // L'onglet est ouvert : tout est vu, la pastille s'éteint.
  const { markSeen } = feed;
  useEffect(() => {
    markSeen();
  }, [markSeen]);

  // La recherche du moment cité. La première page couvre le cas courant ;
  // pour un moment plus vieux, on remonte le fil page par page. L'effet se
  // rejoue à chaque page reçue, donc la boucle s'écrit toute seule — d'où
  // le compteur, qui l'empêche de tourner indéfiniment.
  const { events, hasMore, loadingMore, loadMore } = feed;
  useEffect(() => {
    // On attend la page en cours : sans ce garde-fou, chaque rendu de
    // l'écran pendant le chargement compterait une remontée de plus et
    // le budget serait mangé avant d'avoir tourné une seule page.
    if (!focusEventId || events === null || loadingMore) return;
    if (events.some((e) => e.id === focusEventId)) {
      remontees.current = 0;
      setVise(focusEventId);
      onFocusDone();
      return;
    }
    if (hasMore && remontees.current < REMONTEES_MAX) {
      remontees.current += 1;
      loadMore();
      return;
    }
    remontees.current = 0;
    onFocusDone();
    showToast("Ce moment est trop loin dans le fil");
  }, [focusEventId, events, hasMore, loadingMore, loadMore, onFocusDone, showToast]);

  // Trouvé : on l'amène au centre. Le défilement est doux — arriver d'un
  // autre écran et se retrouver déjà ailleurs dans le fil, sans mouvement,
  // donne l'impression d'avoir raté quelque chose.
  useEffect(() => {
    if (!vise) return;
    const sobre = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("moment-vise")?.scrollIntoView({
      block: "center",
      behavior: sobre ? "auto" : "smooth",
    });
    const t = setTimeout(() => setVise(null), 1400);
    return () => clearTimeout(t);
  }, [vise]);

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      <h1 className="mt-4 text-2xl font-bold">Feed</h1>

      {feed.events === null && (
        <div role="status" aria-label="Fil en cours de chargement">
          <Skeleton className="mt-5" w={110} h={16} radius={8} />
          <ul className="mt-2 flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i}>
                <Skeleton h={72} radius={16} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {feed.events !== null && feed.events.length === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Rien encore. Le fil s&apos;écrit tout seul : séances terminées,
          bonus déclarés, prises de tête au classement.
        </p>
      )}

      {feed.events !== null &&
        groupByDay(feed.events).map(({ day, items }) => (
          <section key={day}>
            <h2 className="mt-5 mb-2 text-sm font-bold text-muted">
              {dayLabel(day)}
            </h2>
            <ul className="flex flex-col gap-2">
              {blocksOf(items).map((block) =>
                block.kind === "recap" ? (
                  <WeekRecapCard
                    key={block.events[0].id}
                    events={block.events}
                    me={player}
                    byId={byId}
                    reactions={block.events.flatMap((e) => feed.reactions.get(e.id) ?? [])}
                    comments={block.events.flatMap((e) => feed.comments.get(e.id) ?? [])}
                    onToggleReaction={feed.toggleReaction}
                    onDiscuss={onDiscuss}
                    onGoLeaderboard={onGoLeaderboard}
                    vise={block.events.some((e) => e.id === vise)}
                  />
                ) : (
                  <FeedItem
                    key={block.events[0].id}
                    events={block.events}
                    me={player}
                    byId={byId}
                    // Réactions et commentaires de tout le groupe : chacun
                    // porte son event_id, donc rien ne se perd au passage.
                    reactions={block.events.flatMap((e) => feed.reactions.get(e.id) ?? [])}
                    comments={block.events.flatMap((e) => feed.comments.get(e.id) ?? [])}
                    onToggleReaction={feed.toggleReaction}
                    onDiscuss={onDiscuss}
                    // Le moment cité peut être n'importe lequel de la
                    // salve, pas seulement l'ancre : c'est la carte
                    // entière qu'on allume.
                    vise={block.events.some((e) => e.id === vise)}
                  />
                ),
              )}
            </ul>
          </section>
        ))}

      {feed.hasMore && (
        <button
          onClick={feed.loadMore}
          disabled={feed.loadingMore}
          className="mx-auto my-4 min-h-12 rounded-full bg-surface px-6 text-sm font-bold text-muted disabled:opacity-40"
        >
          {feed.loadingMore ? "Chargement…" : "Voir plus"}
        </button>
      )}
      <div className="pb-4" />
    </div>
  );
}
