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
import {
  fetchGeneralRanks,
  fetchWeekLeaderboard,
  fmtPoints,
  frenchRank,
  LeaderboardRow,
} from "@/lib/gamification";
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
  result?: {
    winner: Player | null;
    loser: Player | null;
    score: string;
    /** Le départage aux points, vainqueur d'abord ("41,5–38"). Présent
        quand les deux ont fait le même nombre de jours parfaits : sans lui
        la ligne dit « bat » sur un 7–7 et ne s'explique pas. */
    pointsScore?: string;
    tiebreak?: boolean;
  };
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

/** Le rang au général de dimanche soir — celui qui a produit l'appariement.
    Muet si le classement n'a pas pu être lu, ou en semaine 1 où personne
    n'a encore de points : un rang sans points ne veut rien dire. */
function Rank({ n }: { n: number | undefined }) {
  if (!n) return null;
  return <span className="shrink-0 text-xs text-quiet">{frenchRank(n)}</span>;
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

  // Deux lectures pour deux choses différentes, en parallèle :
  //  - le classement DE LA SEMAINE close, qui donne le vainqueur ;
  //  - les rangs AU GÉNÉRAL au dimanche soir, qui sont ceux sur lesquels le
  //    job du lundi a apparié (lib/server/duels.ts) — sans eux la carte ne
  //    peut pas dire d'où sortent les duels de la semaine qui s'ouvre.
  // null = échec, on se tait plutôt que d'afficher un faux podium.
  const [rows, setRows] = useState<LeaderboardRow[] | null | undefined>(undefined);
  const [ranks, setRanks] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    if (!closedWeek) return;
    let cancelled = false;
    Promise.all([
      fetchWeekLeaderboard(closedWeek.from, closedWeek.until, ligueId),
      fetchGeneralRanks(closedWeek.until, ligueId),
    ]).then(([semaine, general]) => {
      if (cancelled) return;
      setRows(semaine);
      setRanks(general);
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
          pointsScore: e.payload.pointsScore,
          tiebreak: e.payload.tiebreak,
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
  settled.sort((x, y) => mine(x) - mine(y));

  // Les duels à venir, eux, se rangent par rang dès qu'on connaît les rangs :
  // c'est l'échelle qui explique le tirage (1er contre 2e, 3e contre 4e), et
  // elle ne se lit que dans l'ordre. Mon duel reste trouvable au premier coup
  // d'œil — il est le seul teinté à ma couleur. Sans les rangs (classement
  // illisible, semaine 1), on retombe sur mon duel d'abord.
  const bestRank = (p: Pair) =>
    Math.min(
      ranks?.get(p.a.id) ?? Number.MAX_SAFE_INTEGER,
      p.b ? (ranks?.get(p.b.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER,
    );
  fresh.sort(
    ranks && ranks.size > 0
      ? (x, y) => bestRank(x) - bestRank(y)
      : (x, y) => mine(x) - mine(y),
  );

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

      {/* Premier bloc : les faits de jeu de la semaine close, sans un seul
          duel. Le récit passe avant le podium — le podium redit le
          classement, le récit dit ce qu'il ne montre pas. */}
      {(recitLine || (winnerPlayer && winner)) && (
        <div
          className="mt-2 flex flex-col gap-2.5 rounded-2xl px-3 py-3"
          style={{ background: "var(--color-surface)" }}
        >
          {recitAuthor && recitLine && (
            <p className="text-sm leading-snug">
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
            <p className="text-sm leading-snug">
              <span aria-hidden>🏆</span> <Name p={winnerPlayer} me={me} /> rafle
              la semaine avec {fmtPoints(winner.points)} pts.
              {myRow && myRow.player_id !== winner.player_id && (
                <> Tu finis {frenchRank(myRow.rank)}.</>
              )}
            </p>
          )}
        </div>
      )}

      {/* Second bloc : TOUS les duels, réglés et à venir, dans la même
          fenêtre. Ce sont deux moments d'un même tournoi — les séparer en
          deux surfaces les faisait lire comme deux sujets sans rapport,
          alors que la deuxième liste sort du classement que la première
          vient de bouger. */}
      {(settled.length > 0 || fresh.length > 0) && (
        <div
          className="mt-2 flex flex-col gap-4 rounded-2xl px-3 py-3"
          style={{ background: "var(--color-surface)" }}
        >
          {settled.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted">
                <span aria-hidden>⚔️</span> Résultats des duels
                {closedWeek ? ` — semaine ${closedWeek.index}` : ""}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {settled.map((p) => (
                  <li key={`${p.a.id}-${p.b?.id}`} className="text-sm leading-snug">
                    {p.result?.winner && p.result.loser ? (
                      <>
                        <Name p={p.result.winner} me={me} /> bat{" "}
                        <Name p={p.result.loser} me={me} /> {p.result.score}
                        {/* Un 7–7 avec un vainqueur ne se lit pas tout seul :
                            le chiffre qui a tranché doit être dans la ligne,
                            sinon la carte a l'air de désigner au hasard. */}
                        {p.result.tiebreak && p.result.pointsScore && (
                          <span className="text-quiet">
                            {" "}
                            — départage aux points {p.result.pointsScore}
                          </span>
                        )}
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
            </div>
          )}

          {fresh.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted">
                <span aria-hidden>⚔️</span> Duels à venir
                {openedWeek ? ` — semaine ${openedWeek.index}` : ""}
              </p>
              {/* La règle de lecture de l'échelle, une fois. Le reste — qui
                  affronte qui, et pourquoi celui-là — est dit par la forme :
                  deux voisins partagent une boîte, l'exempt est seul dans la
                  sienne. Une phrase qui redirait ça ferait doublon. */}
              <p className="mt-1 text-xs leading-snug text-quiet">
                Le classement général de dimanche soir, redescendu en duels :
                deux voisins, un duel.
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {fresh.map((p) => {
                  const involved = p.a.id === me.id || p.b?.id === me.id;
                  // Dans une échelle, les rangs doivent se suivre : on remet
                  // les deux joueurs dans l'ordre du classement, quel que soit
                  // celui qui portait l'événement duel_start.
                  const duo = p.b
                    ? [p.a, p.b].sort(
                        (x, y) =>
                          (ranks?.get(x.id) ?? Number.MAX_SAFE_INTEGER) -
                          (ranks?.get(y.id) ?? Number.MAX_SAFE_INTEGER),
                      )
                    : [p.a];
                  return (
                    <li
                      key={`${p.a.id}-${p.b?.id ?? "bye"}`}
                      className="flex flex-col gap-0.5 rounded-xl px-2 py-1.5 text-sm"
                      style={{
                        background: involved
                          ? `color-mix(in oklch, ${me.color} 14%, transparent)`
                          : "var(--color-raised)",
                      }}
                    >
                      {duo.map((joueur, i) => (
                        <div key={joueur.id} className="flex items-center gap-2">
                          {/* Le mot que la forme ne dit pas : sans lui, un
                              lecteur d'écran énumère quatre personnes sans
                              jamais dire qui affronte qui. */}
                          {i > 0 && <span className="sr-only">contre</span>}
                          <Rank n={ranks?.get(joueur.id)} />
                          <Avatar
                            name={joueur.name}
                            color={joueur.color}
                            photo={joueur.photo}
                            size={20}
                          />
                          <Name p={joueur} me={me} serre />
                          {!p.b && <span className="text-muted">— exempt cette semaine</span>}
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
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
