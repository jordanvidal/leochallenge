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

import { useEffect, useState } from "react";
import { addDays, challengeWeeks, mondayOf } from "@/lib/challenge";
import { fetchWeekLeaderboard, fmtPoints, frenchRank, LeaderboardRow } from "@/lib/gamification";
import { FeedEvent } from "@/lib/feed";
import { Player } from "@/lib/types";
import { Avatar } from "../ui";

type Props = {
  events: FeedEvent[]; // les duel_start / duel_result d'un même lundi
  me: Player;
  byId: Map<string, Player>;
  onGoLeaderboard: () => void;
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

function Name({ p, me }: { p: Player; me: Player }) {
  return (
    <span className="truncate font-bold" style={{ color: p.color }}>
      {label(p, me)}
    </span>
  );
}

export default function WeekRecapCard({ events, me, byId, onGoLeaderboard }: Props) {
  const starts = events.filter((e) => e.kind === "duel_start");
  const results = events.filter((e) => e.kind === "duel_result");

  // Le lundi qui s'ouvre : porté par les duel_start. Sans eux (dernière
  // semaine du challenge, plus d'appariement) on le déduit des résultats.
  const openedMonday =
    starts[0]?.payload.week_monday ??
    (results[0]?.payload.week_monday
      ? addDays(results[0].payload.week_monday, 7)
      : null);
  const closedMonday = openedMonday ? addDays(openedMonday, -7) : null;

  const weeks = challengeWeeks();
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
    fetchWeekLeaderboard(closedWeek.from, closedWeek.until).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [closedWeek?.from, closedWeek?.until]);

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

  if (fresh.length === 0 && settled.length === 0) return null;

  return (
    <li
      className="rounded-2xl px-4 py-4"
      style={{ background: "var(--color-raised)" }}
      aria-label="Bilan de la semaine"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-faint">
        📊 {closedWeek ? `Semaine ${closedWeek.index} bouclée` : "Semaine bouclée"}
      </p>

      {/* Le podium de la semaine close. Muet tant qu'il n'est pas chargé —
          mieux vaut une carte plus courte qu'un chiffre faux. */}
      {winnerPlayer && winner && (
        <p className="mt-2 text-sm leading-snug">
          🏆 <Name p={winnerPlayer} me={me} /> rafle la semaine avec{" "}
          {fmtPoints(winner.points)} pts.
          {myRow && myRow.player_id !== winner.player_id && (
            <> Tu finis {frenchRank(myRow.rank)}.</>
          )}
        </p>
      )}

      {settled.length > 0 && (
        <>
          <p className="mt-4 text-xs font-bold text-muted">⚔️ Les duels sont réglés</p>
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
            ⚔️ Les duels de la semaine{openedWeek ? ` ${openedWeek.index}` : ""}
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
                  <Avatar name={p.a.name} color={p.a.color} size={24} />
                  <Name p={p.a} me={me} />
                  {p.b ? (
                    <>
                      <span className="shrink-0 text-faint" aria-label="contre">
                        ⚔️
                      </span>
                      <Name p={p.b} me={me} />
                      <Avatar name={p.b.name} color={p.b.color} size={24} />
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
        className="mt-3 min-h-11 text-sm font-bold"
        style={{ color: "var(--pc)" }}
      >
        Voir les scores en direct →
      </button>
    </li>
  );
}
