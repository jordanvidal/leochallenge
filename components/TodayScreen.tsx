"use client";

// L'écran par défaut, en trois temps : lanceur tant que la séance n'est pas
// partie, reprise tant qu'elle n'est pas finie, tableau du groupe une fois la
// journée bouclée. C'est la séance qui valide, et elle seule — l'accueil ne
// coche rien, il met en séance et il montre où en est le groupe.

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

  // Journée bouclée : les potes ne sont plus une bande qu'on longe du
  // pouce, ils sont le contenu. En colonne, un par ligne, avec leurs trois
  // pastilles alignées à droite — on lit qui a fini d'un seul regard au
  // lieu de faire défiler. C'est aussi ce qui remplit l'écran une fois le
  // lanceur parti : la bande horizontale y laissait 270 px de vide.
  const potesEnColonne = (
    <ul className="flex flex-col">
      {others.map((p) => {
        const live = liveAt(p.id);
        // 48 px de ligne : à sept potes, la colonne tient l'écran sans
        // déborder sous la barre d'onglets. Ces lignes ne sont pas des
        // cibles, leur hauteur est du rythme — le plancher des 44 px ne
        // s'y applique pas.
        return (
          <li key={p.id} className="flex min-h-12 items-center gap-3">
            <div
              key={live ?? undefined}
              className={live ? "live-pulse" : undefined}
              style={{ "--lc": p.color } as React.CSSProperties}
            >
              <Avatar name={p.name} color={p.color} photo={p.photo} size={36} />
            </div>
            <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
            {live ? (
              <span
                className="text-[11px] font-bold"
                style={{ color: p.color }}
              >
                à l&apos;instant
              </span>
            ) : (
              claimedEmojis(p.id) && (
                <span
                  className="text-[11px]"
                  title="Bonus déclarés aujourd'hui"
                >
                  {claimedEmojis(p.id)}
                </span>
              )
            )}
            <ExoDots
              entry={entries.get(entryKey(p.id, today))}
              color={p.color}
            />
          </li>
        );
      })}
    </ul>
  );

  // La ligne des potes, montée en variable : selon le temps de la journée
  // elle n'est pas au même endroit de l'écran, ni de la même forme.
  const lesPotes =
    others.length > 0 ? (
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
    );

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

      {/* ------------------------------------------------------------------
          Les trois temps de la journée (31/07).

          Avant : trois cartes de 96 px empilées, hautes comme les deux tiers
          de l'écran, et « Lancer ma séance » en barre de 52 px en dessous.
          Les trois plus gros objets de l'écran étaient donc ceux qu'on ne
          peut pas utiliser — depuis le 21/07, la séance est le seul chemin
          d'écriture, les cartes n'écrivent plus rien. L'accueil demandait
          530 px sur 844 pour ne rien faire faire, et dépassait la hauteur de
          l'écran.

          Maintenant l'écran change de métier selon le moment :

            fermé    — aucune séance lancée : c'est un lanceur, un seul objet
            en cours — séance ouverte, journée pas bouclée : « Reprendre »
            bouclé   — 3/3 : les cartes disparaissent, les potes prennent
                       leur place, parce que c'est ce qu'on vient voir

          L'état des trois exos descend sous le bouton en une rangée de
          pastilles. Elle n'est pas tappable et ne le sera jamais : ce serait
          rouvrir le chemin d'écriture manuel fermé le 21/07.
      ------------------------------------------------------------------- */}
      {!over && !perfect && (
        <div className="mt-5">
          <button
            onClick={() => {
              navigator.vibrate?.(8);
              onStartWorkout();
            }}
            className="flex min-h-44 w-full items-center justify-center gap-3 rounded-3xl text-2xl font-bold transition-transform active:scale-[0.98]"
            style={{ background: player.color, color: "oklch(0.15 0 0)" }}
          >
            <span aria-hidden>▶</span>
            {sessionStarted ? "Reprendre ma séance" : "Lancer ma séance"}
          </button>

          {/* L'état du jour : trois pastilles, pas trois cibles. */}
          <div
            className="mt-4 flex items-center justify-between px-1"
            aria-label="Ton état du jour"
          >
            {EXERCISES.map(({ key, label }) => {
              const done = mine?.[key] ?? false;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={
                      done
                        ? { background: player.color }
                        : { boxShadow: "inset 0 0 0 1.5px var(--color-line)" }
                    }
                    aria-hidden
                  />
                  <span
                    className="text-sm font-medium"
                    style={{
                      color: done ? player.color : "var(--color-muted)",
                    }}
                  >
                    {label}
                  </span>
                  <span className="sr-only">
                    {done ? "fait" : "pas encore fait"}
                  </span>
                </div>
              );
            })}
          </div>

          {!sessionStarted && (
            <p className="mt-3 text-center text-[13px] text-muted">
              Les coches s&apos;ouvrent quand la séance démarre.
            </p>
          )}
        </div>
      )}

      {/* Bouclé : les potes deviennent le contenu de l'écran, en colonne.
          La célébration, elle, appartient à DoneScreen — on ne refait pas
          la fête ici, on constate. */}
      {!over && perfect && others.length > 0 && (
        <section className="mt-4">
          <h2 className="mb-1 text-xs font-bold tracking-wide text-faint uppercase">
            Les potes aujourd&apos;hui
          </h2>
          {potesEnColonne}
        </section>
      )}
      {!over && perfect && others.length === 0 && (
        <section className="mt-5">{lesPotes}</section>
      )}

      {over && (
        <div className="mt-8 flex-1">
          <p className="text-lg text-muted">
            {joursDeFenetre(f)} jours, c&apos;est plié. Va voir les stats pour
            le bilan.
          </p>
        </div>
      )}

      {/* Les potes, à leur place habituelle tant que la journée n'est pas
          bouclée — mais AVANT les bonus maintenant. La ligne des potes fait
          tenir le truc, les bonus sont l'assaisonnement : l'ordre disait
          l'inverse. */}
      {!over && !perfect && <section className="mt-6">{lesPotes}</section>}

      {/* Ce qui reste d'espace tombe ici : les bonus se posent en bas, à
          portée de pouce. Pas dans l'état bouclé : la colonne des potes
          remplit déjà l'écran, et pousser encore ferait passer « Refaire un
          tour » sous la barre d'onglets. */}
      {!perfect && <div className="flex-1" />}

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

      {/* Journée bouclée : plus de lanceur, comme avant le 31/07.
          « Refaire un tour » y avait été ajouté et c'était une erreur, sur
          les deux plans.
          Le mot d'abord : un « tour » est déjà une série DANS la séance
          (l'écran de bloc affiche « Tour 3/4 »), donc le libellé promettait
          une série et ouvrait une séance entière.
          Le comportement surtout : `guard_session_update` refuse toute
          relance d'une séance déjà clôturée (SEANCE_FIGEE, migration37 —
          « la première séance clôturée du jour fait foi »). Or `launch()`
          place le joueur dans les blocs AVANT la réponse serveur. Celui qui
          avait fini sa séance atterrissait donc sur Tour 1/4 avec un toast
          « celle-ci ne comptera pas », libre de dérouler douze blocs pour
          rien. Un bouton qui mène à ça ne vaut mieux pas exister. */}

      <NotifBanner player={player} onDone={showToast} />

      {/* Le partage vivait ici en plus de celui des Stats — deux boutons,
          le même `shareWeek()`. DoneScreen.tsx documente la suppression de
          exactement cette duplication, pour exactement cette raison ; la
          troisième instance avait survécu. C'est celle des Stats qui reste :
          partager sa semaine se décide en regardant sa semaine. */}
    </div>
  );
}
