"use client";

// L'orchestrateur : porte → joueur → installation → l'app.
// Tout l'état d'identité vit en localStorage, la donnée vit dans Supabase.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBonus } from "@/hooks/useBonus";
import { useChallengeData } from "@/hooks/useChallengeData";
import { useChat } from "@/hooks/useChat";
import { useFeed } from "@/hooks/useFeed";
import { useGamification } from "@/hooks/useGamification";
import { useIdentity } from "@/hooks/useIdentity";
import {
  empiler,
  useCoucheRetour,
  useGesteRetour,
  useRetour,
  viderSauts,
} from "@/hooks/useRetour";
import { useTodaySession } from "@/hooks/useTodaySession";
import {
  addDays,
  aUneBasculeDeBareme,
  challengeIsOver,
  parisToday,
  saison3Started,
} from "@/lib/challenge";
import { FeedEvent } from "@/lib/feed";
import { useFenetre } from "./ligue/LigueContexte";
import { notifyMoments, resyncPush } from "@/lib/gamification";
import {
  shareFinalFlow,
  shareInvite,
  shareRematch,
  shareWeekFlow,
} from "@/lib/share";
import { Exercise, Player, entryKey } from "@/lib/types";
import BilanScreen from "./BilanScreen";
import ChatScreen from "./chat/ChatScreen";
import DailyEventModal from "./DailyEventModal";
import FeedScreen from "./feed/FeedScreen";
import LeaderboardScreen from "./LeaderboardScreen";
import InstallScreen from "./InstallScreen";
import PasswordGate from "./PasswordGate";
import PlayerSelect from "./PlayerSelect";
import StatsScreen from "./StatsScreen";
import TabBar, { Tab } from "./TabBar";
import TodayScreen from "./TodayScreen";
import LaunchS3Screen from "./LaunchS3Screen";
import TutorialScreen from "./TutorialScreen";
import WorkoutMode from "./workout/WorkoutMode";
import { Toast } from "./ui";

function Splash() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="num-display animate-pulse text-4xl text-faint">
        100 · 100 · 100
      </p>
    </main>
  );
}

export default function App() {
  // La fenêtre de la ligue courante — celle des variables d'env en groupe
  // unique. Tout ce qui date dans cet écran passe par elle.
  const f = useFenetre();
  const data = useChallengeData();
  const id = useIdentity();
  const { playerId } = id;
  // Challenge terminé (1er sept.+) : le Bilan remplace « Aujourd'hui » et
  // devient l'onglet par défaut. Garde stable sur toute la session.
  const over = challengeIsOver(f);
  const [tab, setTab] = useState<Tab>(() =>
    challengeIsOver(f) ? "bilan" : "today",
  );
  // « Aujourd'hui » n'existe plus après le 31/08 : on le renvoie sur le Bilan.
  const effTab: Tab = over && tab === "today" ? "bilan" : tab;
  const [workoutOpen, setWorkoutOpen] = useState(false);
  // Rouvrir le tuto à la demande (« Revoir les règles »), même déjà vu.
  const [replayTuto, setReplayTuto] = useState(false);
  // Idem pour l'écran de lancement S3. forceLaunch = aperçu manuel hors date
  // (revue avant le 27/07) via ?lancement=1, lu après montage (pas d'hydratation).
  const [replayLaunch, setReplayLaunch] = useState(false);
  const [forceLaunch, setForceLaunch] = useState(false);
  // Modale « événement du jour » : montrée une fois par jour si un
  // événement a été tiré (pas les jours « rien »).
  const [showEventModal, setShowEventModal] = useState(false);
  // « En parler » : le moment du fil qui attend dans la saisie du tchat.
  // Il vit ici et pas dans le tchat parce qu'il naît sur un autre écran.
  const [chatSeed, setChatSeed] = useState<FeedEvent | null>(null);

  // Les identifiants des joueurs de la ligue : le tchat s'en sert pour
  // ignorer le temps réel des autres ligues.
  const joueursDeLaLigue = useMemo(
    () => (data.players ? new Set(data.players.map((p) => p.id)) : null),
    [data.players],
  );

  // ---- Retour arrière ----
  // Le gestionnaire d'historique et le glissé depuis le bord gauche.
  useRetour();
  useGesteRetour();
  // L'écran qui arrive après un retour s'annonce : sans ce signal, une
  // barre d'onglets qui change toute seule ressemble à un bug.
  const scene = useRef<HTMLDivElement>(null);
  const revenu = useRef(false);

  /** Un saut que l'app fait pour le joueur — « En parler » ouvre le tchat,
      « Voir les scores » ouvre le classement. Il devient annulable ; un
      tap sur un onglet, lui, n'empile rien. */
  function sauter(vers: Tab) {
    const avant = effTab;
    if (avant === vers) return;
    setTab(vers);
    empiler(() => {
      revenu.current = true;
      setTab(avant);
    }, true);
  }

  useEffect(() => {
    if (!revenu.current) return;
    revenu.current = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // L'écran entre par la gauche : c'est le sens du retour. Court et de
    // faible amplitude — on remet le joueur où il était, on ne lui joue
    // pas une transition.
    scene.current?.animate(
      [
        { transform: "translateX(-22px)", opacity: 0.55 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [effTab]);

  // Les couches que cet écran possède. Le mode séance a la sienne, posée
  // chez lui : y revenir doit passer par la confirmation d'abandon, que
  // seul WorkoutMode connaît.
  useCoucheRetour(() => dismissEventModal(), showEventModal);
  useCoucheRetour(() => setReplayTuto(false), replayTuto);
  useCoucheRetour(() => setReplayLaunch(false), replayLaunch);
  // Le chemin retour : le moment que le fil doit retrouver et montrer,
  // demandé depuis une citation du tchat. Même raison de vivre ici.
  const [feedFocus, setFeedFocus] = useState<string | null>(null);
  // Stable : le fil s'en sert dans une dépendance d'effet, une fonction
  // recréée à chaque rendu y relancerait la recherche en boucle.
  const clearFeedFocus = useCallback(() => setFeedFocus(null), []);

  const player: Player | undefined = useMemo(
    () => (data.players ?? []).find((p) => p.id === playerId),
    [data.players, playerId],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setForceLaunch(params.get("lancement") === "1");
    // `?tab=chat` : c'est par là qu'arrive un tap sur une notification de
    // tchat quand l'app était fermée.
    if (params.get("tab") === "chat") setTab("chat");
  }, []);

  // App déjà ouverte au moment du tap : le service worker ne peut pas la
  // recharger sans perdre son état, il lui dit où aller. Sans ça, une
  // notification de tchat retombe sur l'accueil et il faut retrouver
  // l'onglet soi-même.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; url?: string } | null;
      if (msg?.type !== "navigate" || !msg.url) return;
      const cible = new URL(msg.url, window.location.origin).searchParams.get("tab");
      if (cible === "chat") setTab("chat");
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Gamification (phase 2) : chargée seulement une fois le joueur connu.
  const { gamification, gamificationEnPanne, reloadGamification } =
    useGamification(!!player);

  // Le portier : aucune coche du jour tant que la séance n'est pas lancée.
  const session = useTodaySession(playerId);

  // Le fil : événements générés, réactions, commentaires, non-lus.
  const feed = useFeed(!!player, playerId, data.showToast);
  const { reload: reloadFeed } = feed;

  // Le tchat. Le premier argument est le seul qui compte : hors de
  // l'onglet, le hook ne charge que le compteur de la pastille, pas une
  // ligne de message. Ouvrir l'app pour cocher ne traîne pas un salon
  // derrière elle (docs/spec-tchat.md §3).
  const chat = useChat(effTab === "chat", playerId, data.showToast, joueursDeLaLigue);

  /** Après toute écriture qui compte : classement rechargé, moments
      détectés côté serveur (/api/moments), puis fil rafraîchi. */
  const rescore = useCallback(
    (actorId: string) => {
      reloadGamification();
      notifyMoments(actorId).finally(reloadFeed);
    },
    [reloadGamification, reloadFeed],
  );

  // Bonus : catalogue, événement du jour, déclarations. Chaque
  // déclaration recalcule aussi le classement (onScored).
  const onBonusScored = useCallback(() => {
    if (playerId) rescore(playerId);
  }, [playerId, rescore]);
  const { bonus, claim, unclaim } = useBonus(
    !!player,
    data.showToast,
    onBonusScored,
  );

  // Souscription push re-synchronisée à chaque ouverture, en silence. Un
  // endpoint périmé (PWA réinstallée) redevient vivant tout seul ; sans
  // ça il ne se répare jamais, le bandeau d'opt-in ne revenant pas.
  useEffect(() => {
    if (playerId) resyncPush(playerId);
  }, [playerId]);

  // Ménage ponctuel : le badge d'icône a existé une soirée (feature/badge-pwa,
  // revertée depuis). Le revert a emporté le code qui l'effaçait, donc le
  // chiffre posé sur l'écran d'accueil y reste gravé pour toujours. On l'efface
  // une fois par appareil. À supprimer quand tout le monde aura rouvert l'app.
  useEffect(() => {
    if (localStorage.getItem("lc100.badgeCleared")) return;
    navigator.clearAppBadge?.().catch(() => {});
    localStorage.setItem("lc100.badgeCleared", "1");
  }, []);

  // Un événement a été tiré aujourd'hui et on ne l'a pas encore vu : on
  // ouvre la modale. Le flag est daté, donc elle revient chaque matin.
  useEffect(() => {
    if (!player || !bonus?.event) return;
    if (localStorage.getItem("lc100.eventSeenDay") !== parisToday()) {
      setShowEventModal(true);
    }
  }, [player, bonus?.event]);

  /** Modale d'événement fermée : mémorisé pour la journée. */
  function dismissEventModal() {
    localStorage.setItem("lc100.eventSeenDay", parisToday());
    setShowEventModal(false);
  }

  // L'annonce one-shot des duels vivait ici : deux cartes montrées une
  // fois par appareil avant le premier lundi de duels. Tout le groupe
  // les a vues, la règle est au mini-barème du Classement — un écran de
  // moins sur le chemin d'un joueur qui réinstalle.

  /** Fin (ou abandon) de séance guidée : les exos couverts passent à
      fait par le chemin d'écriture existant, puis recalcul du score. */
  async function validateWorkout(exos: Exercise[]) {
    if (!player) return false;
    const ok = await data.setExercisesDone(player.id, parisToday(), exos);
    if (ok && exos.length > 0) {
      rescore(player.id);
    }
    return ok;
  }

  async function shareWeek() {
    if (!player) return;
    const channel = await shareWeekFlow(
      player,
      data.entries,
      gamification,
      bonus,
    );
    if (channel === "clipboard")
      data.showToast("Copié ! Colle-le dans WhatsApp 💬");
  }

  async function invite() {
    const channel = await shareInvite();
    if (channel === "clipboard") data.showToast("Lien copié, envoie-le au groupe");
  }

  async function shareFinal() {
    if (!gamification) return;
    const channel = await shareFinalFlow(
      data.players ?? [],
      gamification.total,
      data.entries,
    );
    if (channel === "clipboard")
      data.showToast("Copié ! Colle-le dans WhatsApp 💬");
  }

  async function rematch() {
    const channel = await shareRematch();
    if (channel === "clipboard") data.showToast("Copié ! Envoie-le au groupe 💬");
  }

  // ---- Aiguillage des écrans ----

  if (!id.mounted) return <Splash />;

  if (!id.gateOk) return <PasswordGate onPass={id.openGate} />;

  if (data.players === null) return <Splash />;

  if (!player) {
    // Identité stockée introuvable hors ligne : on ne détruit rien.
    if (data.offline && playerId) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-2 px-8 text-center">
          <p className="text-lg font-bold">Hors ligne</p>
          <p className="text-muted">
            Impossible de charger les joueurs. Réessaie avec du réseau.
          </p>
        </main>
      );
    }
    return (
      <PlayerSelect
        players={data.players}
        entries={data.entries}
        onSelect={(p) => id.choosePlayer(p.id)}
        onCreate={data.createPlayer}
        onDelete={data.deletePlayer}
        onSetPhoto={data.setPhoto}
      />
    );
  }

  // À partir d'ici, la couleur du joueur teinte toute l'app (--pc).
  const accent = { "--pc": player.color } as React.CSSProperties;

  // Tuto de première connexion : une fois après le choix du joueur, ou
  // rouvert à la demande. Passe avant l'install : on apprend le jeu, puis
  // on installe pour ne pas perdre son profil.
  if (!id.tutorialSeen || replayTuto) {
    return (
      <div style={accent}>
        <TutorialScreen
          player={player}
          replay={replayTuto}
          onDone={() => {
            id.markTutorialSeen();
            setReplayTuto(false);
          }}
        />
        <Toast message={data.toast} />
      </div>
    );
  }

  // Écran de lancement S3 : une fois à partir du 27/07, ou en aperçu manuel
  // (?lancement=1) / rejeu. Passe avant l'install pour ouvrir sur du positif.
  if (
    !over &&
    (forceLaunch || replayLaunch || (saison3Started(f) && aUneBasculeDeBareme(f) && !id.launchS3Seen))
  ) {
    return (
      <div style={accent}>
        <LaunchS3Screen
          player={player}
          players={data.players}
          replay={replayLaunch}
          onLaunchSession={() => {
            id.markLaunchS3Seen();
            setReplayLaunch(false);
            setForceLaunch(false);
            setTab("today");
            setWorkoutOpen(true);
          }}
          onDone={() => {
            id.markLaunchS3Seen();
            setReplayLaunch(false);
            setForceLaunch(false);
          }}
        />
        <Toast message={data.toast} />
      </div>
    );
  }

  if (!id.standalone && !id.installLater) {
    return (
      <div style={accent}>
        <InstallScreen
          installPrompt={id.installPrompt}
          onLater={id.installLaterOnce}
        />
      </div>
    );
  }

  // Série serveur du joueur : la même valeur que celle de la ligne de
  // statut, pour que l'écran de fin de séance ne raconte pas autre chose.
  const myStreak =
    gamification?.total.find((r) => r.player_id === player.id)
      ?.current_streak ?? 0;

  // Mode séance guidée : plein écran, par-dessus tabs et contenu.
  if (workoutOpen) {
    return (
      <div style={accent}>
        <WorkoutMode
          player={player}
          todayEntry={data.entries.get(entryKey(player.id, parisToday()))}
          onValidate={validateWorkout}
          streak={myStreak}
          onSessionStart={session.markStarted}
          onClose={() => setWorkoutOpen(false)}
          showToast={data.showToast}
        />
        <Toast message={data.toast} />
      </div>
    );
  }

  return (
    <div style={accent} className="flex min-h-dvh flex-col">
      {showEventModal && bonus?.event && (
        <DailyEventModal
          player={player}
          event={bonus.event}
          catalog={bonus.catalog}
          onClose={dismissEventModal}
        />
      )}
      {data.offline && (
        <p className="bg-raised py-1.5 text-center text-xs font-medium text-muted">
          Hors ligne — dernier état connu
        </p>
      )}
      <div ref={scene} className="flex flex-1 flex-col">
        {!over && effTab === "today" && (
          <TodayScreen
            player={player}
            players={data.players}
            entries={data.entries}
            liveChecks={data.liveChecks}
            gamification={gamification}
            gamificationEnPanne={gamificationEnPanne}
            bonus={bonus}
            sessionStarted={session.started}
            onStartWorkout={() => setWorkoutOpen(true)}
            onClaimBonus={(item) => claim(player.id, item)}
            onUnclaimBonus={(item) => unclaim(player.id, item)}
            onShareWeek={shareWeek}
            onInvite={invite}
            onGoLeaderboard={() => sauter("leaderboard")}
            showToast={data.showToast}
          />
        )}
        {over && effTab === "bilan" && (
          <BilanScreen
            player={player}
            players={data.players}
            entries={data.entries}
            gamification={gamification}
            onShareFinal={shareFinal}
            onRematch={rematch}
            onGoHistory={() => sauter("stats")}
          />
        )}
        {effTab === "feed" && (
          <FeedScreen
            player={player}
            players={data.players}
            feed={feed}
            onGoLeaderboard={() => sauter("leaderboard")}
            onDiscuss={(events) => {
              // events[0] est l'ancre de la salve : c'est la ligne que le
              // fil affiche en tête, donc celle qu'on cite.
              setChatSeed(events[0]);
              sauter("chat");
            }}
            focusEventId={feedFocus}
            onFocusDone={clearFeedFocus}
            showToast={data.showToast}
          />
        )}
        {effTab === "chat" && (
          <ChatScreen
            player={player}
            players={data.players}
            chat={chat}
            onGoFeed={() => sauter("feed")}
            onGoFeedEvent={(eventId) => {
              setFeedFocus(eventId);
              sauter("feed");
            }}
            seed={chatSeed}
            onSeedUsed={() => setChatSeed(null)}
          />
        )}
        {effTab === "leaderboard" && (
          <LeaderboardScreen
            player={player}
            players={data.players}
            entries={data.entries}
            gamification={gamification}
            enPanne={gamificationEnPanne}
            onRetry={reloadGamification}
          />
        )}
        {effTab === "stats" && (
          <StatsScreen
            player={player}
            players={data.players}
            entries={data.entries}
            gamification={gamification}
            gamificationEnPanne={gamificationEnPanne}
            onShareWeek={shareWeek}
            onSetPhoto={data.setPhoto}
            showToast={data.showToast}
          />
        )}
      </div>
      {/* Masqué sur le tchat : la barre de saisie est collée juste
          au-dessus des onglets, et ces trois liens se glisseraient entre
          les deux. Une conversation n'est de toute façon pas l'endroit
          où l'on revoit les règles. */}
      <div
        className={`items-center justify-center gap-4 px-5 pb-1 ${
          effTab === "chat" ? "hidden" : "flex"
        }`}
      >
        <button
          onClick={() => setReplayTuto(true)}
          className="min-h-8 text-[11px] text-faint"
        >
          Revoir les règles
        </button>
        {saison3Started(f) && aUneBasculeDeBareme(f) && parisToday() <= addDays(f.saison3, 6) && (
          <>
            <span className="text-[11px] text-faint" aria-hidden>
              ·
            </span>
            <button
              onClick={() => setReplayLaunch(true)}
              className="min-h-8 text-[11px] text-faint"
            >
              Revoir le lancement
            </button>
          </>
        )}
        <span className="text-[11px] text-faint" aria-hidden>
          ·
        </span>
        <button
          onClick={id.forgetPlayer}
          className="min-h-8 text-[11px] text-faint"
        >
          Ce n&apos;est pas moi ({player.name})
        </button>
      </div>
      <TabBar
        tab={effTab}
        onChange={(cible) => {
          // Choisir un onglet à la main annule les sauts en attente :
          // revenir en arrière ramènerait dans un écran qu'on vient de
          // quitter volontairement.
          viderSauts();
          setTab(cible);
        }}
        feedUnread={feed.unread}
        chatUnread={chat.unread}
        over={over}
      />
      <Toast message={data.toast} />
    </div>
  );
}
