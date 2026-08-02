"use client";

// Classement : podium, liste, variation de rang depuis la semaine dernière.
// La semaine est LA compétition : le compteur repart de zéro chaque lundi
// 00h, la vue hebdo est donc l'onglet par défaut. Le général reste là pour
// la course de fond, et l'historique (S1, S2…) garde la trace de chaque
// semaine — recalculée à la demande, jamais stockée.

import { useEffect, useState } from "react";
import {
  ChallengeWeek,
  challengeWeeks,
  diffDays,
  elapsedDays,
  frenchDayMonth,
  parisToday,
} from "@/lib/challenge";
import {
  fetchLastWeekRanks,
  fetchWeekLeaderboard,
  fmtPoints,
  frenchRank,
  Gamification,
  LeaderboardRow,
  ordonneClassement,
} from "@/lib/gamification";
import { Entry, Player } from "@/lib/types";
import DuelCard from "./DuelCard";
import { BaremeSheet } from "./MiniBareme";
import PlayerBreakdown from "./PlayerBreakdown";
import { Avatar, IconJoker, Skeleton } from "./ui";
import { useLigueCourante } from "./ligue/LigueContexte";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  gamification: Gamification | null;
  /** Les reprises automatiques ont abandonné : on le dit, au lieu de
      laisser « Calcul en cours… » tourner dans le vide. */
  enPanne: boolean;
  onRetry: () => void;
};

/** ↑2 / ↓1 / = depuis la semaine dernière. */
function Variation({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  const label = delta > 0 ? `↑${delta}` : delta < 0 ? `↓${-delta}` : "=";
  const color =
    delta > 0 ? "var(--pc)" : delta < 0 ? "var(--color-danger)" : "var(--color-faint)";
  return (
    <span
      className="min-w-8 text-right text-sm font-bold"
      style={{ color }}
      aria-label={`variation : ${label}`}
    >
      {label}
    </span>
  );
}

/** Le classement pendant le calcul : le podium et les lignes à leur place
    exacte. Trois RPC tournent derrière, ça se compte en centaines de ms —
    autant montrer la forme de la page plutôt qu'une phrase qui bouge. */
function ClassementEnAttente({ lignes }: { lignes: number }) {
  return (
    <div role="status" aria-label="Classement en cours de calcul">
      <div className="mt-5 flex items-end justify-center gap-6">
        {[48, 64, 48].map((taille, i) => (
          <div key={i} className="flex flex-col items-center gap-1 p-1">
            <Skeleton w={taille} h={taille} radius={taille / 2} />
            <Skeleton w={taille} h={14} radius={7} />
            <Skeleton w={taille - 12} h={taille === 64 ? 32 : 22} radius={8} />
          </div>
        ))}
      </div>
      <ul className="mt-6 flex flex-col gap-2 pb-4">
        {Array.from({ length: lignes }, (_, i) => (
          <li key={i}>
            <Skeleton h={60} radius={16} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LeaderboardScreen({
  player,
  players,
  entries,
  gamification,
  enPanne,
  onRetry,
}: Props) {
  const f = useFenetre();
  const ligueId = useLigueCourante()?.id ?? null;
  const [view, setView] = useState<"total" | "week">("week");
  const weeks = challengeWeeks(f);
  const currentWeek = weeks.find((w) => w.current) ?? null;
  // Semaine affichée dans la vue hebdo. Par défaut : celle en cours.
  const [weekIdx, setWeekIdx] = useState<number | null>(null);
  // Classements des semaines passées, chargés à la demande puis gardés.
  // null = échec de chargement (retenté quand on revient sur la semaine).
  const [history, setHistory] = useState<Map<number, LeaderboardRow[] | null>>(
    () => new Map(),
  );
  // Joueur dont on regarde le détail des points (overlay), null = fermé.
  const [detail, setDetail] = useState<LeaderboardRow | null>(null);
  // Le barème, ouvert depuis l'en-tête. Il vivait tout en bas du détail
  // d'un joueur : pour lire les règles il fallait taper sur quelqu'un,
  // ouvrir son détail et descendre au pied d'un panneau qui parle des
  // points d'un autre. C'est ici qu'on se pose la question.
  const [bareme, setBareme] = useState(false);
  // Rangs au dimanche dernier : uniquement les flèches ↑↓ du Général, donc
  // chargés à l'ouverture de cet onglet et pas avant. undefined = pas encore
  // demandé, null = échec (retenté en revenant sur l'onglet).
  const [lastWeekRanks, setLastWeekRanks] = useState<
    Map<string, number> | null | undefined
  >(undefined);

  const selectedWeek: ChallengeWeek | null =
    view === "week"
      ? (weekIdx === null ? currentWeek : weeks.find((w) => w.index === weekIdx) ?? currentWeek)
      : null;
  const isPastWeek = selectedWeek !== null && !selectedWeek.current;

  useEffect(() => {
    if (view !== "week" || !selectedWeek || selectedWeek.current) return;
    if (history.get(selectedWeek.index)) return; // déjà chargée
    let cancelled = false;
    fetchWeekLeaderboard(selectedWeek.from, selectedWeek.until, ligueId).then((rows) => {
      if (cancelled) return;
      setHistory((h) => new Map(h).set(selectedWeek.index, rows));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedWeek?.index]);

  // Les flèches ↑↓ n'existent que dans le Général : on ne paie l'appel
  // qu'en y entrant. `null` (échec) est retenté au retour sur l'onglet.
  useEffect(() => {
    if (view !== "total" || lastWeekRanks) return;
    let cancelled = false;
    fetchLastWeekRanks(ligueId).then((m) => {
      if (!cancelled) setLastWeekRanks(m);
    });
    return () => {
      cancelled = true;
    };
  }, [view, lastWeekRanks, ligueId]);

  const byId = new Map(players.map((p) => [p.id, p]));

  if (!gamification) {
    return (
      <div className="flex flex-1 flex-col px-5 pt-safe">
        <h1 className="mt-4 text-2xl font-bold">Classement</h1>
        {enPanne ? (
          <>
            <p className="mt-4 text-muted">
              Impossible de charger le classement. Ta séance est bien
              enregistrée — c&apos;est l&apos;affichage qui coince.
            </p>
            <button
              onClick={onRetry}
              className="mt-4 min-h-11 self-start rounded-xl px-6 font-bold"
              style={{
                background: "var(--color-raised)",
                color: "var(--color-ink)",
              }}
            >
              Réessayer
            </button>
          </>
        ) : (
          <ClassementEnAttente lignes={Math.max(players.length, 3)} />
        )}
      </div>
    );
  }

  // Dénominateur de complétion : jours écoulés de la fenêtre affichée.
  const today = parisToday();
  const nDays = Math.max(
    selectedWeek
      ? diffDays(selectedWeek.from, selectedWeek.until < today ? selectedWeek.until : today) + 1
      : elapsedDays(f).length,
    1,
  );

  const rawRows =
    view === "total"
      ? gamification.total
      : isPastWeek
        ? history.get(selectedWeek.index)
        : gamification.week;
  // Trié explicitement : le RPC n'a pas d'`order by`, donc jusqu'ici le
  // classement s'affichait dans l'ordre où Postgres rendait ses lignes, et
  // `podium[0]` était supposé premier sans que rien ne l'impose.
  const rows = ordonneClassement(
    (rawRows ?? []).filter((r) => byId.has(r.player_id)),
    new Map(players.map((p) => [p.id, p.name])),
  );
  const podium = rows.filter((r) => r.rank <= 3).slice(0, 3);
  // ordre visuel du podium : 2e, 1er, 3e
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean);

  const variation = (r: LeaderboardRow): number | null => {
    if (view !== "total") return null;
    const old = lastWeekRanks?.get(r.player_id);
    if (old === undefined) return null;
    return old - r.rank;
  };

  // Fenêtre passée au détail des points, alignée sur la vue affichée.
  const breakdownWindow =
    view === "total"
      ? { from: null, until: null, label: "Depuis le début" }
      : isPastWeek
        ? {
            from: selectedWeek.from,
            until: selectedWeek.until,
            label: `Semaine ${selectedWeek.index}`,
          }
        : { from: currentWeek?.from ?? null, until: null, label: "Cette semaine" };

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">Classement</h1>
        <button
          onClick={() => setBareme(true)}
          className="-mr-2 min-h-11 px-2 text-sm font-medium text-quiet"
        >
          Comment on marque
        </button>
      </div>

      <DuelCard
        player={player}
        players={players}
        entries={entries}
        gamification={gamification}
      />

      {/* Semaine / Général */}
      <div className="mt-3 flex gap-1 rounded-xl bg-surface p-1" role="tablist">
        {(
          [
            ["week", "Semaine"],
            ["total", "Général"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            // min-h-11 : 44 px de cible, le plancher du pouce (DESIGN.md).
            className="min-h-11 flex-1 rounded-lg text-sm font-bold transition-colors"
            style={
              view === key
                ? { background: "var(--color-raised)", color: "var(--color-ink)" }
                : { color: "var(--color-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Historique : une puce par semaine. Visible dès la 2e semaine. */}
      {view === "week" && weeks.length > 1 && (
        <div
          className="scrollbar-none -mx-5 mt-3 flex gap-2 overflow-x-auto px-5"
          role="tablist"
          aria-label="Choisir la semaine"
        >
          {weeks.map((w) => {
            const active = selectedWeek?.index === w.index;
            return (
              <button
                key={w.index}
                role="tab"
                aria-selected={active}
                onClick={() => setWeekIdx(w.current ? null : w.index)}
                // min-h-11 : 36 px rataient le plancher des 44 px. Le rayon
                // plein rond ne change pas, seule la cible grandit.
                className="min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-colors"
                style={
                  active
                    ? { background: "var(--color-raised)", color: "var(--color-ink)" }
                    : { background: "var(--color-surface)", color: "var(--color-muted)" }
                }
              >
                {w.current ? "En cours" : `S${w.index}`}
              </button>
            );
          })}
        </div>
      )}

      {isPastWeek && rawRows === undefined && (
        <ClassementEnAttente lignes={Math.max(players.length, 3)} />
      )}
      {isPastWeek && rawRows === null && (
        <p className="mt-6 text-muted">
          Impossible de charger cette semaine. Change de semaine et reviens.
        </p>
      )}

      {rawRows != null && (
        <>
          {/* Podium */}
          <div className="mt-5 flex items-end justify-center gap-6">
            {podiumOrder.map((r) => {
              const p = byId.get(r.player_id)!;
              const first = r.rank === 1;
              // Le 🏆 du gagnant est du texte visuel : sans le reprendre dans
              // le label du bouton, VoiceOver ignorait la victoire.
              const gagnant = isPastWeek && first && r.points > 0;
              return (
                <button
                  key={r.player_id}
                  onClick={() => setDetail(r)}
                  aria-label={`Voir le détail des points de ${p.name}${
                    gagnant ? ", a gagné la semaine" : ""
                  }`}
                  className="flex flex-col items-center gap-1 rounded-xl p-1 transition-transform active:scale-95"
                >
                  <Avatar name={p.name} color={p.color} photo={p.photo} size={first ? 64 : 48} />
                  <span className="max-w-20 truncate text-sm font-bold">
                    {gagnant ? "🏆 " : ""}
                    {p.name}
                  </span>
                  <span
                    className={`num-display ${first ? "text-4xl" : "text-2xl"}`}
                    style={{ color: p.color }}
                  >
                    {fmtPoints(r.points)}
                  </span>
                  <span className="text-[11px] font-medium text-quiet">
                    {frenchRank(r.rank)} · pts
                  </span>
                </button>
              );
            })}
          </div>

          {/* Liste complète */}
          <ul className="mt-6 flex flex-col gap-2 pb-4">
            {rows.map((r) => {
              const p = byId.get(r.player_id)!;
              const me = r.player_id === player.id;
              const completion = Math.round((r.exos_done / (nDays * 3)) * 100);
              return (
                <li key={r.player_id}>
                  <button
                    onClick={() => setDetail(r)}
                    aria-label={`Voir le détail des points de ${me ? "toi" : p.name}`}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-transform active:scale-[0.99]"
                    style={{
                      background: me
                        ? `color-mix(in oklch, ${p.color} 12%, var(--color-surface))`
                        : "var(--color-surface)",
                    }}
                  >
                    <span className="num-display w-8 text-2xl text-faint">{r.rank}</span>
                    <Avatar name={p.name} color={p.color} photo={p.photo} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">
                        {me ? "Toi" : p.name}
                      </p>
                      <p className="text-xs text-muted">
                        {/* current_streak = série d'aujourd'hui : hors sujet
                            sur une semaine passée, on ne l'affiche pas. */}
                        {!isPastWeek && r.current_streak > 0
                          ? `🔥 ${r.current_streak} · `
                          : ""}
                        {/* Le joker : visible d'avance, sinon la règle passe
                            pour de la triche le jour où elle sauve quelqu'un.
                            Muet tant que la migration 24 n'est pas en prod
                            (joker_day absent ⇒ undefined ⇒ rien). */}
                        {!isPastWeek && r.joker_day !== undefined && (
                          <span
                            className={r.joker_day ? "opacity-35" : undefined}
                            title={
                              r.joker_day
                                ? `Joker brûlé le ${frenchDayMonth(r.joker_day)}`
                                : "Joker de série disponible"
                            }
                          >
                            {/* Une bouée et pas un bouclier : c'est le symbole
                                qu'affichent les Stats, l'Historique, le fil et
                                les règles du jeu. Un joueur qui cherche « sa
                                bouée » ne doit pas trouver autre chose ici.
                                Dessinée depuis le 31/07 — l'emoji 🛟 est un
                                anneau sombre, invisible à 12 px sur ce fond. */}
                            <IconJoker size={13} className="inline-block align-[-2px]" />
                            {/* Le title d'un span non focusable est muet en
                                VoiceOver : l'état du joker passe en sr-only. */}
                            <span className="sr-only">
                              {r.joker_day
                                ? `Joker brûlé le ${frenchDayMonth(r.joker_day)}`
                                : "Joker de série disponible"}
                            </span>
                            {" · "}
                          </span>
                        )}
                        {completion}% de complétion
                        {r.bonus_points > 0
                          ? ` · dont ${fmtPoints(r.bonus_points)} pts bonus`
                          : ""}
                      </p>
                    </div>
                    <span className="num-display text-xl">{fmtPoints(r.points)}</span>
                    <Variation delta={variation(r)} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {detail && byId.has(detail.player_id) && (
        <PlayerBreakdown
          player={byId.get(detail.player_id)!}
          row={detail}
          from={breakdownWindow.from}
          until={breakdownWindow.until}
          label={breakdownWindow.label}
          onClose={() => setDetail(null)}
        />
      )}

      {bareme && <BaremeSheet onClose={() => setBareme(false)} />}
    </div>
  );
}
