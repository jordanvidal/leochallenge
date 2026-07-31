"use client";

// L'écran par défaut. Trois grosses cartes qui ne se cochent plus à la main :
// c'est la séance qui valide, et elle seule. Fermées, elles ouvrent le lanceur
// d'un tap ; séance lancée, elles affichent ce qui est fait.

import { useEffect, useState } from "react";
import { BonusCatalogItem, BonusState } from "@/lib/bonus";
import {
  daysLeft,
  frenchDate,
  parisToday,
  joursDeFenetre,
} from "@/lib/challenge";
import { Gamification } from "@/lib/gamification";
import { Entry, entryCount, entryKey, EXERCISES, Player } from "@/lib/types";
import BonusSection from "./BonusSection";
import EventBanner from "./EventBanner";
import NotifBanner from "./NotifBanner";
import RankLine from "./RankLine";
import { Avatar, ExoDots } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  liveChecks: Map<string, number>; // joueur → dernière coche reçue en direct (ms)
  gamification: Gamification | null;
  /** Le classement a renoncé (reprises épuisées) : la ligne de statut se
      tait au lieu de faire respirer un loader qui n'aboutira pas. */
  gamificationEnPanne: boolean;
  bonus: BonusState | null;
  /** L'événement du jour à annoncer, ou null s'il est déjà vu / absent.
      Un bandeau non bloquant, plus une modale à l'accueil. */
  showEvent: BonusCatalogItem | null;
  onOpenEvent: () => void;
  onDismissEvent: () => void;
  /** Une séance a été lancée aujourd'hui : sans ça, on ne coche rien. */
  sessionStarted: boolean;
  onStartWorkout: () => void;
  onClaimBonus: (item: BonusCatalogItem) => void;
  onUnclaimBonus: (item: BonusCatalogItem) => void;
  onInvite: () => void;
  onGoLeaderboard: () => void;
  showToast: (msg: string) => void;
};

export default function TodayScreen({
  player,
  players,
  entries,
  liveChecks,
  gamification,
  gamificationEnPanne,
  bonus,
  showEvent,
  onOpenEvent,
  onDismissEvent,
  sessionStarted,
  onStartWorkout,
  onClaimBonus,
  onUnclaimBonus,
  onInvite,
  onGoLeaderboard,
  showToast,
}: Props) {
  const f = useFenetre();
  const today = parisToday();
  const over = today > f.end;
  const left = daysLeft(f);
  const mine = entries.get(entryKey(player.id, today));
  const perfect = entryCount(mine) === 3;
  const others = players.filter((p) => p.id !== player.id);

  // Le beat du 3/3 vivait ici, déclenché par le tap qui complétait la
  // journée. C'est la séance qui valide maintenant, et elle a sa propre
  // célébration sur son écran de fin — l'état a été retiré plutôt que
  // laissé à zéro pour toujours.

  // « à l'instant » vieillit : re-rendu léger toutes les 30 s tant qu'une
  // coche récente est affichée, pour que le libellé disparaisse tout seul.
  const LIVE_WINDOW_MS = 3 * 60 * 1000;
  const [, setNowTick] = useState(0);
  useEffect(() => {
    if (liveChecks.size === 0) return;
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [liveChecks]);
  const liveAt = (playerId: string): number | null => {
    const at = liveChecks.get(playerId);
    return at && Date.now() - at < LIVE_WINDOW_MS ? at : null;
  };

  // Emojis des bonus déclarés aujourd'hui par un joueur (anti-triche :
  // ce qu'on déclare, tout le monde le voit).
  const emojiByKey = new Map(
    (bonus?.catalog ?? []).map((c) => [c.key, c.emoji]),
  );
  const claimedEmojis = (playerId: string): string =>
    (bonus?.todayClaims ?? [])
      .filter((c) => c.player_id === playerId)
      .map((c) => emojiByKey.get(c.bonus_key) ?? "")
      .join(" ");

  return (
    <div
      className={`flex flex-1 flex-col px-5 pt-safe ${perfect ? "celebrate-bg" : ""}`}
    >
      {/* Date + compte à rebours */}
      <header className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-muted first-letter:uppercase">
            {frenchDate(today)}
          </p>
          {over ? (
            <p className="num-display mt-1 text-4xl">Challenge terminé 🏁</p>
          ) : perfect ? (
            <p
              className="rise-in num-display mt-1 text-4xl"
              style={{ color: player.color }}
            >
              Jour parfait ✓
            </p>
          ) : (
            <p className="mt-1 text-2xl font-bold">100 · 100 · 100</p>
          )}
        </div>
        {!over && (
          <div className="text-right">
            <p className="num-display text-6xl">{left}</p>
            <p className="-mt-0.5 text-xs font-medium text-muted">
              jour{left > 1 ? "s" : ""} restant{left > 1 ? "s" : ""}
            </p>
          </div>
        )}
      </header>

      {/* L'événement du jour, annoncé sans bloquer. Tap → la roue et le
          détail ; ✕ → écarté pour la journée. */}
      {!over && showEvent && (
        <EventBanner
          event={showEvent}
          onOpen={onOpenEvent}
          onDismiss={onDismissEvent}
        />
      )}

      {/* La ligne de statut : rang + série, et la série seule quand elle
          est en jeu. C'est cette phrase qui fait faire les pompes. */}
      {!over && (
        <RankLine
          player={player}
          players={players}
          entries={entries}
          gamification={gamification}
          enPanne={gamificationEnPanne}
          perfect={perfect}
          onGoLeaderboard={onGoLeaderboard}
        />
      )}

      {/* Les trois cartes. Fermées, elles ouvrent le lanceur d'un tap — elles
          ne râlent jamais. Séance lancée, elles deviennent un affichage : le
          seul chemin d'écriture de la journée passe par la séance. */}
      {!over && (
        <div className="mt-5 flex flex-1 flex-col gap-3">
          {EXERCISES.map(({ key, label }) => {
            const done = mine?.[key] ?? false;

            // Verrouillée, la carte reste en retrait — c'est la règle du
            // 21/07 et elle ne bouge pas. Ce qui bouge, c'est l'endroit où
            // vit le retrait : dans le fond, et plus dans une opacité posée
            // sur toute la carte. Composer l'ensemble à 50 % éteignait aussi
            // le libellé (2,4:1) et l'anneau (1,03:1) — les trois cartes ne
            // se percevaient plus comme des surfaces, et l'objet qui disait
            // le plus fort « indisponible » était en fait le raccourci
            // principal. Le fond recule, le texte et le cadenas restent nets.
            const fond = done
              ? {
                  background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                  boxShadow: `inset 0 0 0 2px color-mix(in oklch, ${player.color} 65%, transparent)`,
                }
              : {
                  background: sessionStarted
                    ? "var(--color-surface)"
                    : "color-mix(in oklch, var(--color-surface) 55%, var(--color-bg))",
                  boxShadow: "inset 0 0 0 1px var(--color-line)",
                };

            const classe =
              "exo-card flex min-h-24 flex-1 items-center justify-between rounded-3xl px-6 text-left";

            const contenu = (
              <>
                <span
                  className="text-2xl font-bold"
                  style={{
                    color: done
                      ? player.color
                      : sessionStarted
                        ? "var(--color-ink)"
                        : "var(--color-muted)",
                  }}
                >
                  {label}
                </span>
                {done ? (
                  <span
                    className="check-pop flex size-12 items-center justify-center rounded-full text-2xl font-bold"
                    style={{ background: player.color, color: "oklch(0.15 0 0)" }}
                    aria-hidden
                  >
                    ✓
                  </span>
                ) : sessionStarted ? (
                  <span className="num-display text-4xl text-faint" aria-hidden>
                    100
                  </span>
                ) : (
                  <span className="text-2xl" aria-hidden>
                    🔒
                  </span>
                )}
              </>
            );

            // Séance lancée : la carte n'est plus une commande, c'est un
            // affichage — donc plus un bouton du tout. Un `<button disabled>`
            // portant `aria-pressed` s'annonce « coché, bouton, non
            // disponible » : ça décrit un contrôle cassé, pas un exercice
            // fait. Le ✓ étant aria-hidden, l'état passe par un texte.
            if (sessionStarted) {
              return (
                <div key={key} className={classe} style={fond}>
                  {contenu}
                  <span className="sr-only">
                    {done ? "fait" : "pas encore fait"}
                  </span>
                </div>
              );
            }

            // Verrouillée : là, c'est bien un bouton, et son seul rôle est
            // d'ouvrir le lanceur. Pas d'`aria-pressed` — il n'y a rien à
            // basculer ici, et le nom dit ce que le tap va faire.
            return (
              <button
                key={key}
                aria-label={`${label} — verrouillé, lancer ma séance pour ouvrir les coches`}
                onClick={() => {
                  navigator.vibrate?.(8);
                  onStartWorkout();
                }}
                className={classe}
                style={fond}
              >
                {contenu}
              </button>
            );
          })}
        </div>
      )}

      {/* Ce bouton fait foi : c'est lui qui ouvre la journée. Tant que la
          séance n'est pas partie, il est l'action principale ; une fois
          lancée, il redevient discret (relancer un tour de plus). */}
      {!over && (!perfect || !sessionStarted) && (
        <div className="mt-3">
          {!sessionStarted && (
            <p className="mb-2 text-center text-[13px] text-muted">
              Les coches s&apos;ouvrent quand la séance démarre.
            </p>
          )}
          <button
            onClick={onStartWorkout}
            className="flex min-h-13 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-bold transition-transform active:scale-[0.98]"
            style={
              sessionStarted
                ? {
                    background: `color-mix(in oklch, ${player.color} 12%, var(--color-surface))`,
                    boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 45%, transparent)`,
                    color: player.color,
                  }
                : { background: player.color, color: "oklch(0.15 0 0)" }
            }
          >
            <span aria-hidden>▶</span> Lancer ma séance
          </button>
        </div>
      )}

      {over && (
        <div className="mt-8 flex-1">
          <p className="text-lg text-muted">
            {joursDeFenetre(f)} jours, c&apos;est plié. Va voir les stats pour
            le bilan.
          </p>
        </div>
      )}

      {/* Bonus : bandeau événement + puces déclaratives. L'assaisonnement,
          pas le plat — la séance de base reste le héros. */}
      {!over && (
        <BonusSection
          player={player}
          bonus={bonus}
          onClaim={onClaimBonus}
          onUnclaim={onUnclaimBonus}
          showToast={showToast}
        />
      )}

      {/* La ligne des potes : c'est ça qui fait tenir le truc. */}
      <section className="mt-5 mb-3">
        {others.length > 0 ? (
          <>
            <h2 className="mb-2 text-xs font-bold tracking-wide text-faint uppercase">
              Les potes aujourd&apos;hui
            </h2>
            <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1">
              {others.map((p) => {
                const live = liveAt(p.id);
                return (
                  <div
                    key={p.id}
                    className="flex shrink-0 flex-col items-center gap-1.5"
                  >
                    <div
                      key={live ?? undefined}
                      className={live ? "live-pulse" : undefined}
                      style={{ "--lc": p.color } as React.CSSProperties}
                    >
                      <Avatar name={p.name} color={p.color} photo={p.photo} size={46} />
                    </div>
                    <span className="max-w-16 truncate text-xs font-medium text-muted">
                      {p.name}
                    </span>
                    <ExoDots
                      entry={entries.get(entryKey(p.id, today))}
                      color={p.color}
                    />
                    {live ? (
                      <span
                        className="text-[11px] font-bold leading-none"
                        style={{ color: p.color }}
                      >
                        à l&apos;instant
                      </span>
                    ) : (
                      claimedEmojis(p.id) && (
                        <span
                          className="text-[11px] leading-none"
                          title="Bonus déclarés aujourd'hui"
                        >
                          {claimedEmojis(p.id)}
                        </span>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <button
            onClick={onInvite}
            className="w-full rounded-2xl border border-dashed border-line p-4 text-left"
          >
            <p className="font-bold">Tu es seul pour l&apos;instant</p>
            <p className="mt-1 text-sm text-muted">
              Envoie le lien au groupe, la pression sociale fait le reste →
            </p>
          </button>
        )}
      </section>

      <NotifBanner player={player} onDone={showToast} />

      {/* Le partage vivait ici en plus de celui des Stats — deux boutons,
          le même `shareWeek()`. DoneScreen.tsx documente la suppression de
          exactement cette duplication, pour exactement cette raison ; la
          troisième instance avait survécu. C'est celle des Stats qui reste :
          partager sa semaine se décide en regardant sa semaine. */}
    </div>
  );
}
