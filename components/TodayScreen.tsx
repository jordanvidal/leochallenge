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
  /** Ouvre « Ma séance » sur l'onglet bonus. Absent = catalogue pas chargé. */
  onPlanBonus?: () => void;
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
  onPlanBonus,
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

  // Les potes en colonne : un par ligne, avatar + nom, les trois pastilles
  // alignées à droite. On lit qui a fini d'un seul regard au lieu de longer
  // une bande du pouce — à huit, deux têtes sortaient de l'écran sans que
  // rien ne le dise.
  //
  // Cette forme est née le 31/07 pour la seule journée bouclée, où la bande
  // horizontale laissait 270 px de vide. Le même vide existait dans l'état
  // lanceur (330 px de noir entre les potes et les bonus) : il venait des
  // trois cartes de 96 px remplacées par un bouton, et personne n'avait
  // réattribué la place. Une seule forme dans tous les états, et c'est du
  // contenu qui remplit l'écran — pas un ressort.
  const lesPotes =
    others.length > 0 ? (
      <>
        <h2 className="mb-2 text-xs font-bold tracking-wide text-faint uppercase">
          Les potes aujourd&apos;hui
        </h2>
        <ul className="flex flex-col">
          {others.map((p) => {
            const live = liveAt(p.id);
            // 48 px de ligne : à huit potes, la colonne tient l'écran sans
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
                  <Avatar
                    name={p.name}
                    color={p.color}
                    photo={p.photo}
                    size={36}
                  />
                </div>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {p.name}
                </span>
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

            fermé    — aucune séance lancée : série, groupe, et un lanceur
            en cours — séance ouverte, journée pas bouclée : l'état des trois
                       exos s'ajoute, et le lanceur dit « Reprendre »
            bouclé   — 3/3 : le lanceur s'en va, le groupe prend toute la
                       place parce que c'est ce qu'on vient voir, et la
                       seule action restante mène aux bonus (01/08)

          L'état des trois exos vit en une rangée de pastilles. Elle n'est
          pas tappable et ne le sera jamais : ce serait rouvrir le chemin
          d'écriture manuel fermé le 21/07.

          Deux corrections le 01/08, après un écran vu en vrai.

          Le bouton faisait 176 px de haut. Il était seul sur l'écran — rien
          à battre du pouce, donc la taille n'achetait aucune vitesse de tap,
          juste 61 000 px² d'aplat saturé dans une chambre à 23 h. Il tombe à
          60 px et descend en bas de page : l'action principale vit dans la
          zone du pouce (Thumb-Zone Rule), pas dans le tiers haut. C'est la
          seule couleur pleine de l'écran, elle reste impossible à rater.

          La rangée d'état ne s'affiche plus qu'en séance. Avant le lancement
          rien ne peut être coché : elle annonçait trois cercles vides et les
          mêmes trois mots que le titre juste au-dessus. Elle ne dit quelque
          chose qu'une fois la séance ouverte, au moment où « il me reste
          quoi ? » se pose vraiment — juste avant « Reprendre ».

          La phrase « Les coches s'ouvrent quand la séance démarre » est
          partie avec les cartes verrouillées qu'elle expliquait : depuis le
          31/07 il n'y a plus une seule coche sur cet écran.
      ------------------------------------------------------------------- */}
      {!over && !perfect && sessionStarted && (
        <div
          className="mt-5 flex items-center justify-between px-1"
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
                  className={`text-sm ${done ? "font-bold" : "font-medium"}`}
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
      )}

      {over && (
        <div className="mt-8 flex-1">
          <p className="text-lg text-muted">
            {joursDeFenetre(f)} jours, c&apos;est plié. Va voir les stats pour
            le bilan.
          </p>
        </div>
      )}

      {/* Les potes, avant les bonus : la ligne des potes fait tenir le truc,
          les bonus sont l'assaisonnement — l'ordre disait l'inverse. Même
          bloc dans les deux états depuis le 01/08, la journée bouclée n'a
          plus sa mise en page à part. */}
      {!over && <section className="mt-5">{lesPotes}</section>}

      {/* Ce qui reste d'espace tombe ici. À huit potes la colonne le mange
          en entier et ce ressort vaut zéro ; à deux, il pousse les bonus et
          le lanceur en bas plutôt que de laisser un trou sous eux. */}
      {!over && <div className="flex-1" />}

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

      {/* Le lanceur, dernier de la page et collé au pouce. 60 px et non 176,
          texte au pas « title » du système : c'est un bouton, plus une dalle.
          `mb-3` le décolle de la barre d'onglets — sans ça un tap un peu bas
          part au Tchat. */}
      {!over && !perfect && (
        <button
          onClick={() => {
            navigator.vibrate?.(8);
            onStartWorkout();
          }}
          className="mt-3 mb-3 flex min-h-15 w-full items-center justify-center gap-2.5 rounded-2xl text-lg font-bold transition-transform active:scale-[0.98]"
          style={{ background: player.color, color: "oklch(0.15 0 0)" }}
        >
          <span aria-hidden>▶</span>
          {sessionStarted ? "Reprendre ma séance" : "Lancer ma séance"}
        </button>
      )}

      {/* Journée bouclée : le contrat est rempli, il n'y a plus de séance à
          lancer — mais il reste des bonus à prendre. Ce bouton n'ouvre
          aucune séance serveur et ne coche aucun exo du contrat : il mène
          au planificateur, et rien d'autre. C'est ce qui le distingue de
          « Refaire un tour », retiré le 31/07 parce qu'il promettait une
          série et rouvrait une séance que le serveur refusait ensuite.
          Discret, parce que la journée est déjà gagnée. */}
      {!over && perfect && onPlanBonus && (
        <button
          onClick={() => {
            navigator.vibrate?.(8);
            onPlanBonus();
          }}
          className="mt-3 mb-3 flex min-h-15 w-full items-center justify-center gap-2.5 rounded-2xl text-lg font-bold transition-transform active:scale-[0.98]"
          style={{
            background: `color-mix(in oklch, ${player.color} 12%, var(--color-surface))`,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 45%, transparent)`,
            color: player.color,
          }}
        >
          <span aria-hidden>＋</span> Enchaîner des bonus
        </button>
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
