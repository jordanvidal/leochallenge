"use client";

// Le bilan du lundi, épinglé dans le fil. Il remplace les 4 à 8 lignes de
// duel que le job du lundi matin écrit d'un coup : dispersées, elles se
// noyaient entre les séances et les bonus. Groupées, elles racontent la
// bascule d'une semaine à l'autre — exactement ce que dit la notif push,
// mais qui reste consultable.
//
// Figé, jamais vivant : le fil est un journal, une carte qui muterait toute
// la semaine ne dirait plus jeudi ce qu'elle disait lundi. Les scores en
// direct vivent dans DuelCard, en haut du Classement — d'où le lien en bas.
//
// Le classement de la semaine close est recalculé à la demande (RPC
// leaderboard), comme l'historique du Classement. Jamais stocké.

import { memo, useEffect, useId, useState } from "react";
import { addDays, challengeWeeks, mondayOf } from "@/lib/challenge";
import { fetchWeekLeaderboard, fmtPoints, frenchRank, LeaderboardRow } from "@/lib/gamification";
import { eventPhrase, FeedComment, FeedEvent, FeedReaction } from "@/lib/feed";
import { Player } from "@/lib/types";
import { Avatar } from "../ui";
import Interactions from "./Interactions";
import { useLigueCourante } from "@/components/ligue/LigueContexte";
import { useFenetre } from "@/components/ligue/LigueContexte";

type Props = {
  events: FeedEvent[]; // le récit + les duel_start / duel_result d'une même semaine
  me: Player;
  byId: Map<string, Player>;
  reactions: FeedReaction[];
  comments: FeedComment[];
  onToggleReaction: (event: FeedEvent, emoji: string) => void;
  onDiscuss: (events: FeedEvent[]) => void;
  onGoLeaderboard: () => void;
  /** Rejointe depuis une citation du tchat : le bilan se cite comme
      n'importe quel moment, il se retrouve donc pareil. */
  vise?: boolean;
};

/** Un appariement prêt à afficher, résolu ou non. */
type Pair = {
  a: Player;
  b: Player | null; // null = exempt
  /** Renseigné seulement pour les duels réglés. */
  result?: { winner: Player | null; loser: Player | null; score: string };
};

/** "Toi" quand c'est moi — le fil s'adresse au joueur, pas à un public. */
function label(p: Player, me: Player): string {
  return p.id === me.id ? "Toi" : p.name;
}

/** `serre` : le nom vit dans une rangée flex et doit pouvoir rétrécir.
    Ailleurs il vit dans une phrase, où `truncate` était un non-sens —
    `overflow` et `text-overflow` ne s'appliquent pas à un span en ligne,
    donc seul `nowrap` passait et un prénom long débordait au lieu de
    revenir à la ligne. Sans `min-w-0` en revanche, un élément flex refuse
    de rétrécir sous son contenu et pousse le second avatar hors de la carte. */
function Name({ p, me, serre }: { p: Player; me: Player; serre?: boolean }) {
  return (
    <span
      className={serre ? "min-w-0 truncate font-bold" : "font-bold"}
      style={{ color: p.color }}
    >
      {label(p, me)}
    </span>
  );
}

function WeekRecapCard({
  events,
  me,
  byId,
  reactions,
  comments,
  onToggleReaction,
  onDiscuss,
  onGoLeaderboard,
  vise,
}: Props) {
  const titreId = useId();
  const f = useFenetre();
  const ligueId = useLigueCourante()?.id ?? null;
  const starts = events.filter((e) => e.kind === "duel_start");
  const results = events.filter((e) => e.kind === "duel_result");
  const recit = events.find((e) => e.kind === "recit") ?? null;

  // Le lundi qui s'ouvre : porté par les duel_start. Sans eux (dernière
  // semaine du challenge, plus d'appariement) on le déduit des résultats.
  const openedMonday =
    starts[0]?.payload.week_monday ??
    (results[0]?.payload.week_monday
      ? addDays(results[0].payload.week_monday, 7)
      : null);
  // Le récit nomme directement la semaine dont il parle : c'est la source
  // la plus sûre, et la seule d'une carte rattrapée sans duels.
  const closedMonday =
    recit?.payload.week_monday ?? (openedMonday ? addDays(openedMonday, -7) : null);

  const weeks = challengeWeeks(f);
  const closedWeek = closedMonday
    ? (weeks.find((w) => mondayOf(w.from) === closedMonday) ?? null)
    : null;
  const openedWeek = openedMonday
    ? (weeks.find((w) => mondayOf(w.from) === openedMonday) ?? null)
    : null;

  // Classement de la semaine close, chargé une fois. null = échec, on se
  // tait plutôt que d'afficher un faux podium.
  const [rows, setRows] = useState<LeaderboardRow[] | null | undefined>(undefined);
  useEffect(() => {
    if (!closedWeek) return;
    let cancelled = false;
    fetchWeekLeaderboard(closedWeek.from, closedWeek.until, ligueId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [closedWeek?.from, closedWeek?.until, ligueId]);

  const winner = rows?.find((r) => r.rank === 1) ?? null;
  const winnerPlayer = winner ? (byId.get(winner.player_id) ?? null) : null;
  const myRow = rows?.find((r) => r.player_id === me.id) ?? null;

  // Les duels réglés de la semaine close.
  const settled: Pair[] = results.flatMap((e) => {
    const a = byId.get(e.player_id);
    const oppId = e.payload.opponent_id;
    const b = oppId ? byId.get(oppId) : undefined;
    if (!a || !b) return [];
    // player_id porte le vainqueur (ou player_a en cas de nul).
    const draw = e.payload.outcome === "draw";
    return [
      {
        a,
        b,
        result: {
          winner: draw ? null : a,
          loser: draw ? null : b,
          score: e.payload.score ?? "",
        },
      },
    ];
  });

  // Les appariements de la semaine qui s'ouvre.
  const fresh: Pair[] = starts.flatMap((e): Pair[] => {
    const a = byId.get(e.player_id);
    if (!a) return [];
    if (e.payload.bye) return [{ a, b: null }];
    const oppId = e.payload.opponent_id;
    const b = oppId ? byId.get(oppId) : undefined;
    if (!b) return [];
    return [{ a, b }];
  });

  // Mon duel d'abord : c'est celui qu'on cherche des yeux.
  const mine = (p: Pair) => (p.a.id === me.id || p.b?.id === me.id ? 0 : 1);
  fresh.sort((x, y) => mine(x) - mine(y));
  settled.sort((x, y) => mine(x) - mine(y));

  if (fresh.length === 0 && settled.length === 0 && !recit) return null;

  // Le récit passe avant le podium : le podium redit le classement, le
  // récit dit ce qu'il ne montre pas. Prénom réel et non « Toi » — la
  // phrase est à la troisième personne, comme partout dans le fil.
  const recitAuthor = recit ? (byId.get(recit.player_id) ?? null) : null;
  const recitLine = recit ? eventPhrase(recit) : null;

  return (
    <li
      id={vise ? "moment-vise" : undefined}
      className={`flex flex-col rounded-2xl px-4 py-4 ${vise ? "moment-vise" : ""}`}
      style={{ background: "var(--color-raised)" }}
      // `aria-label` sur un `<li>` nu est ignoré : l'élément n'a pas de rôle
      // qui accepte un nom. Le titre de la carte existe déjà, on pointe
      // dessus — et il devient un vrai titre plutôt qu'un paragraphe.
      aria-labelledby={titreId}
    >
      <h3
        id={titreId}
        className="text-xs font-bold uppercase tracking-wide text-quiet"
      >
        <span aria-hidden>📊</span>{" "}
        {closedWeek ? `Semaine ${closedWeek.index} bouclée` : "Semaine bouclée"}
      </h3>

      {recitAuthor && recitLine && (
        <p className="mt-2 text-sm leading-snug">
          <span aria-hidden>{recitLine.emoji}</span>{" "}
          <span className="font-bold" style={{ color: recitAuthor.color }}>
            {recitAuthor.name}
          </span>{" "}
          {recitLine.text}
        </p>
      )}

      {/* Le podium de la semaine close. Muet tant qu'il n'est pas chargé —
          mieux vaut une carte plus courte qu'un chiffre faux. */}
      {winnerPlayer && winner && (
        <p className="mt-2 text-sm leading-snug">
          <span aria-hidden>🏆</span> <Name p={winnerPlayer} me={me} /> rafle la
          semaine avec {fmtPoints(winner.points)} pts.
          {myRow && myRow.player_id !== winner.player_id && (
            <> Tu finis {frenchRank(myRow.rank)}.</>
          )}
        </p>
      )}

      {settled.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold text-muted">
            <span aria-hidden>⚔️</span> Les duels sont réglés
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {settled.map((p) => (
              <li key={`${p.a.id}-${p.b?.id}`} className="text-sm leading-snug">
                {p.result?.winner && p.result.loser ? (
                  <>
                    <Name p={p.result.winner} me={me} /> bat{" "}
                    <Name p={p.result.loser} me={me} /> {p.result.score}
                  </>
                ) : (
                  <>
                    <Name p={p.a} me={me} /> et <Name p={p.b!} me={me} /> se
                    quittent sur un nul {p.result?.score}
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {fresh.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold text-muted">
            <span aria-hidden>⚔️</span> Les duels de la semaine
            {openedWeek ? ` ${openedWeek.index}` : ""}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {fresh.map((p) => {
              const involved = p.a.id === me.id || p.b?.id === me.id;
              return (
                <li
                  key={`${p.a.id}-${p.b?.id ?? "bye"}`}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm"
                  style={
                    involved
                      ? {
                          background: `color-mix(in oklch, ${me.color} 14%, transparent)`,
                        }
                      : undefined
                  }
                >
                  <Avatar name={p.a.name} color={p.a.color} photo={p.a.photo} size={24} />
                  <Name p={p.a} me={me} serre />
                  {p.b ? (
                    <>
                      {/* `aria-label` sur un span sans rôle est ignoré : le
                          lecteur d'écran annonçait l'emoji brut. Le mot est
                          maintenant dit, et le glyphe se tait. */}
                      <span className="shrink-0 text-quiet" aria-hidden>
                        ⚔️
                      </span>
                      <span className="sr-only">contre</span>
                      <Name p={p.b} me={me} serre />
                      <Avatar name={p.b.name} color={p.b.color} photo={p.b.photo} size={24} />
                    </>
                  ) : (
                    <span className="text-muted">— exempt cette semaine</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <button
        onClick={onGoLeaderboard}
        className="mt-3 min-h-11 self-start text-sm font-bold"
        style={{ color: "var(--pc)" }}
      >
        Voir les scores en direct →
      </button>

      {/* Le bilan fait parler : on réagit et on commente dessus comme sur
          n'importe quel moment. Au-dessus ce qui s'est passé, en dessous ce
          qu'on en dit — la coupure se fait à l'espace. Un filet ferait le
          même travail, mais ce système n'a qu'un seul trait de séparation
          et il est sous la barre d'onglets ; en ajouter un ici pour une
          respiration, c'est ouvrir la porte à tous les autres. */}
      <div className="mt-4">
        <Interactions
          events={events}
          me={me}
          byId={byId}
          reactions={reactions}
          comments={comments}
          onToggleReaction={onToggleReaction}
          onDiscuss={onDiscuss}
          pillBg="var(--color-surface)"
        />
      </div>
    </li>
  );
}

// Même raison que `FeedItem` : la carte refait sinon ses filtres, ses tris
// et son calcul de semaines à chaque re-rendu d'`App`, pour un contenu qui
// est figé par définition — c'est un bilan, il ne bouge plus.
export default memo(WeekRecapCard);
