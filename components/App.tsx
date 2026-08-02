"use client";

// L'orchestrateur : porte → joueur → installation → l'app.
// Tout l'état d'identité vit en localStorage, la donnée vit dans Supabase.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppBadge } from "@/hooks/useAppBadge";
import { useBonus } from "@/hooks/useBonus";
import { useChallengeData } from "@/hooks/useChallengeData";
import { useChat } from "@/hooks/useChat";
import { useFeed } from "@/hooks/useFeed";
import { useGamification } from "@/hooks/useGamification";
import { useIdentity } from "@/hooks/useIdentity";
import { useGestePage } from "@/hooks/useGestePage";
import { useHistoriqueOnglets } from "@/hooks/useHistoriqueOnglets";
import { useCoucheRetour, useRetour } from "@/hooks/useRetour";
import { useTodaySession } from "@/hooks/useTodaySession";
import {
  addDays,
  aUneBasculeDeBareme,
  challengeIsOver,
  parisToday,
  saison3Started,
  saison4Started,
  SAISON4_START,
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
import LaunchS4Screen from "./LaunchS4Screen";
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
  // L'ordre dans lequel on a vu les écrans, pas celui de la barre : c'est
  // lui que le glissé remonte.
  const { tab, aller: setTab, reculer, avancer } = useHistoriqueOnglets(
    challengeIsOver(f) ? "bilan" : "today",
  );
  // « Aujourd'hui » n'existe plus après le 31/08 : on le renvoie sur le Bilan.
  const effTab: Tab = over && tab === "today" ? "bilan" : tab;
  const [workoutOpen, setWorkoutOpen] = useState(false);
  // Ouverture directe sur l'onglet bonus (entrée « Enchaîner des bonus »).
  const [workoutOnBonus, setWorkoutOnBonus] = useState(false);
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

  // ---- Navigation ----
  // L'historique du navigateur ne sert qu'aux couches posées par-dessus
  // l'écran (feuilles, modales, mode séance), pour le bouton retour
  // d'Android et le glissé natif de Safari. Les écrans, eux, ont leur
  // propre historique (useHistoriqueOnglets) : deux notions distinctes,
  // et les mêler ferait quitter l'app en voulant revenir au Feed.
  useRetour();
  const scene = useRef<HTMLDivElement>(null);
  // Le sens du dernier changement d'onglet, quand il vient du glissé :
  // c'est lui qui décide du côté par lequel l'écran entre.
  const sensEntree = useRef<1 | -1 | 0>(0);

  /** Un glissé vers la droite remonte l'historique, un glissé vers la
      gauche le redescend — le geste d'un navigateur, appliqué aux écrans
      qu'on a vraiment vus. Au bout, rien : rien à défaire ni à refaire. */
  useGestePage((sens) => {
    const bouge = sens === -1 ? reculer() : avancer();
    if (bouge) sensEntree.current = sens;
  });

  // L'écran entre par le côté d'où il vient. Court et de faible
  // amplitude : on accompagne le doigt, on ne joue pas une transition.
  useEffect(() => {
    const sens = sensEntree.current;
    sensEntree.current = 0;
    if (sens === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    scene.current?.animate(
      [
        { transform: `translateX(${sens * 26}px)`, opacity: 0.55 },
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

  // Le même chiffre que les pastilles d'onglets, posé sur l'icône de
  // l'écran d'accueil. C'est ce qui fait rouvrir l'app quand elle est
  // fermée — et ça s'éteint tout seul dès qu'on a tout lu.
  useAppBadge(feed.unread + chat.unread);

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

  // Événement du jour : plus d'ouverture forcée à l'accueil. Un bandeau non
  // bloquant l'annonce dans TodayScreen (EventBanner) ; la modale — la roue,
  // le détail — devient une destination qu'on ouvre au tap, jamais une porte
  // sur le chemin de la coche. `eventSeen` pilote la visibilité du bandeau :
  // vrai tant qu'on ne sait pas (pas de flash), recalculé dès l'événement connu.
  const [eventSeen, setEventSeen] = useState(true);
  useEffect(() => {
    if (!player || !bonus?.event) return;
    setEventSeen(localStorage.getItem("lc100.eventSeenDay") === parisToday());
  }, [player, bonus?.event]);

  /**
   * L'écran de lancement de la saison en cours (S3, puis S4 à partir du
   * 03/08) ne s'affiche jamais à quelqu'un qui n'a jamais joué — et on le
   * marque vu, pour qu'il ne lui tombe pas dessus non plus le jour où il
   * commence.
   *
   * C'est un diff de saison : « Bilan S2 », « Ce qui arrive », « Ce qui
   * dégage », « le double d'avant ». Six écrans qui racontent un changement
   * à quelqu'un qui n'a pas d'avant — et qui lui montrent au passage son
   * bilan de la saison 2, c'est-à-dire des zéros.
   *
   * C'est le pire endroit possible pour ça : les données disent que quatre
   * inscrits sur neuf n'ont jamais eu de jour 1. Le barème en vigueur, lui,
   * est déjà enseigné par le tutoriel, qui lit le même drapeau `s3`.
   *
   * `entries` arrive dans le même `Promise.all` que `players`, donc la
   * réponse est fiable dès que les joueurs sont là. Hors ligne, on ne
   * conclut rien : une liste vide serait un échec de chargement, pas une
   * absence de jeu.
   */
  useEffect(() => {
    if (!player || data.players === null || data.offline) return;
    const s4 = saison4Started(f);
    if (s4 ? id.launchS4Seen : id.launchS3Seen) return;
    const aDejaJoue = [...data.entries.values()].some(
      (e) => e.player_id === player.id && (e.pushups || e.abs || e.squats),
    );
    if (aDejaJoue) return;
    if (s4) id.markLaunchS4Seen();
    else id.markLaunchS3Seen();
  }, [player, id, data.players, data.entries, data.offline, f]);

  /** Événement vu pour la journée : ferme la modale si ouverte et retire le
      bandeau. Appelé par le ✕ du bandeau comme par la fermeture de la roue. */
  function dismissEventModal() {
    localStorage.setItem("lc100.eventSeenDay", parisToday());
    setEventSeen(true);
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

  // Écran de lancement de la saison en cours : une fois à partir du 27/07
  // (S3), puis du 03/08 (S4), ou en aperçu manuel (?lancement=1) / rejeu.
  // Passe avant l'install pour ouvrir sur du positif.
  //
  // Une seule porte pour les deux saisons, jamais deux carrousels à la
  // suite : dès que la S4 est là, c'est elle qui parle. Le diff de la S3
  // n'a plus rien à apprendre à personne — ses règles sont en vigueur
  // depuis une semaine, et le tutoriel les enseigne déjà.
  //
  // `aDejaJoue` garde la porte : l'effet plus haut marque l'écran vu pour un
  // nouveau, mais le rendu ne doit pas l'afficher une seule frame en
  // attendant. L'aperçu manuel et « Revoir le lancement » passent toujours —
  // eux sont demandés.
  const s4 = saison4Started(f);
  const aDejaJoue = [...data.entries.values()].some(
    (e) => e.player_id === player.id && (e.pushups || e.abs || e.squats),
  );
  const lancementDu = s4
    ? !id.launchS4Seen
    : saison3Started(f) && aUneBasculeDeBareme(f) && !id.launchS3Seen;
  if (!over && (forceLaunch || replayLaunch || (lancementDu && aDejaJoue))) {
    const marquerVu = () => {
      if (s4) id.markLaunchS4Seen();
      else id.markLaunchS3Seen();
      setReplayLaunch(false);
      setForceLaunch(false);
    };
    return (
      <div style={accent}>
        {s4 ? (
          <LaunchS4Screen
            player={player}
            replay={replayLaunch}
            onLaunchSession={() => {
              marquerVu();
              setTab("today");
              setWorkoutOpen(true);
            }}
            onDone={marquerVu}
          />
        ) : (
          <LaunchS3Screen
            player={player}
            players={data.players}
            replay={replayLaunch}
            onLaunchSession={() => {
              marquerVu();
              setTab("today");
              setWorkoutOpen(true);
            }}
            onDone={marquerVu}
          />
        )}
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
          players={data.players}
          todayEntry={data.entries.get(entryKey(player.id, parisToday()))}
          bonus={bonus}
          leaderboard={gamification?.total ?? null}
          onClaimBonus={(item) => claim(player.id, item)}
          startOnBonus={workoutOnBonus}
          onValidate={validateWorkout}
          streak={myStreak}
          onSessionStart={session.markStarted}
          onClose={() => {
            setWorkoutOpen(false);
            setWorkoutOnBonus(false);
          }}
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
            showEvent={!eventSeen && bonus?.event ? bonus.event : null}
            onOpenEvent={() => setShowEventModal(true)}
            onDismissEvent={dismissEventModal}
            sessionStarted={session.started}
            onStartWorkout={() => {
              setWorkoutOnBonus(false);
              setWorkoutOpen(true);
            }}
            onPlanBonus={() => {
              setWorkoutOnBonus(true);
              setWorkoutOpen(true);
            }}
            onClaimBonus={(item) => claim(player.id, item)}
            onUnclaimBonus={(item) => unclaim(player.id, item)}
            onInvite={invite}
            onGoLeaderboard={() => setTab("leaderboard")}
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
            onGoHistory={() => setTab("stats")}
          />
        )}
        {effTab === "feed" && (
          <FeedScreen
            player={player}
            players={data.players}
            feed={feed}
            onGoLeaderboard={() => setTab("leaderboard")}
            onDiscuss={(events) => {
              // events[0] est l'ancre de la salve : c'est la ligne que le
              // fil affiche en tête, donc celle qu'on cite.
              setChatSeed(events[0]);
              setTab("chat");
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
            showToast={data.showToast}
            onGoFeed={() => setTab("feed")}
            onGoFeedEvent={(eventId) => {
              setFeedFocus(eventId);
              setTab("feed");
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
            joursOff={bonus?.joursOff}
            gamification={gamification}
            gamificationEnPanne={gamificationEnPanne}
            onShareWeek={shareWeek}
            onSetPhoto={data.setPhoto}
            showToast={data.showToast}
            onReplayTuto={() => setReplayTuto(true)}
            onReplayLaunch={
              // La fenêtre du lien suit la saison en cours : sept jours
              // après le 03/08 pour la S4, comme elle l'a été après le
              // 27/07 pour la S3. Passé ce délai, un carrousel de
              // lancement n'est plus une nouvelle, c'est une archive —
              // et les règles vivent au mini-barème.
              (
                s4
                  ? parisToday() <= addDays(SAISON4_START, 6)
                  : saison3Started(f) &&
                    aUneBasculeDeBareme(f) &&
                    parisToday() <= addDays(f.saison3, 6)
              )
                ? () => setReplayLaunch(true)
                : null
            }
            onForget={id.forgetPlayer}
          />
        )}
      </div>
      {/* Les trois liens d'aide et d'identité vivaient ici, sous la barre
          d'onglets, donc sur TOUS les écrans — y compris le chemin des dix
          secondes, où ils n'ont rien à faire. Ils sont descendus dans Stats,
          qui porte déjà le profil : « revoir les règles » et « ce n'est pas
          moi » sont des gestes de profil, pas des gestes de tous les soirs.
          L'ancien bloc restait par ailleurs masqué à la main sur le tchat,
          preuve qu'il n'était pas à sa place. */}
      <TabBar
        tab={effTab}
        onChange={setTab}
        feedUnread={feed.unread}
        chatUnread={chat.unread}
        over={over}
      />
      <Toast message={data.toast} />
    </div>
  );
}
