"use client";

// L'orchestrateur : porte → joueur → rattrapage → installation → l'app.
// Tout l'état d'identité vit en localStorage, la donnée vit dans Supabase.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppBadge } from "@/hooks/useAppBadge";
import { useBonus } from "@/hooks/useBonus";
import { useChallengeData } from "@/hooks/useChallengeData";
import { useFeed } from "@/hooks/useFeed";
import { useGamification } from "@/hooks/useGamification";
import { useIdentity } from "@/hooks/useIdentity";
import {
  backfillDays,
  backfillOpen,
  challengeIsOver,
  parisToday,
} from "@/lib/challenge";
import { notifyMoments, resyncPush } from "@/lib/gamification";
import {
  shareFinalFlow,
  shareInvite,
  shareRematch,
  shareWeekFlow,
} from "@/lib/share";
import { Exercise, Player, entryKey } from "@/lib/types";
import BackfillScreen from "./BackfillScreen";
import BilanScreen from "./BilanScreen";
import DailyEventModal from "./DailyEventModal";
import FeedScreen from "./feed/FeedScreen";
import HistoryScreen from "./HistoryScreen";
import LeaderboardScreen from "./LeaderboardScreen";
import InstallScreen from "./InstallScreen";
import PasswordGate from "./PasswordGate";
import PlayerSelect from "./PlayerSelect";
import StatsScreen from "./StatsScreen";
import TabBar, { Tab } from "./TabBar";
import TodayScreen from "./TodayScreen";
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
  const data = useChallengeData();
  const id = useIdentity();
  const { playerId } = id;
  // Challenge terminé (1er sept.+) : le Bilan remplace « Aujourd'hui » et
  // devient l'onglet par défaut. Garde stable sur toute la session.
  const over = challengeIsOver();
  const [tab, setTab] = useState<Tab>(() =>
    challengeIsOver() ? "bilan" : "today",
  );
  // « Aujourd'hui » n'existe plus après le 31/08 : on le renvoie sur le Bilan.
  const effTab: Tab = over && tab === "today" ? "bilan" : tab;
  const [workoutOpen, setWorkoutOpen] = useState(false);
  // Rouvrir le tuto à la demande (« Revoir les règles »), même déjà vu.
  const [replayTuto, setReplayTuto] = useState(false);
  // Modale « événement du jour » : montrée une fois par jour si un
  // événement a été tiré (pas les jours « rien »).
  const [showEventModal, setShowEventModal] = useState(false);

  const player: Player | undefined = useMemo(
    () => (data.players ?? []).find((p) => p.id === playerId),
    [data.players, playerId],
  );

  // Gamification (phase 2) : chargée seulement une fois le joueur connu.
  const { gamification, reloadGamification } = useGamification(!!player);

  // Le fil : événements générés, réactions, commentaires, non-lus.
  const feed = useFeed(!!player, playerId, data.showToast);
  const { reload: reloadFeed } = feed;

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

  // Badge d'icône : les exos restants du jour, effacé au 3/3.
  useAppBadge(playerId, data.entries);

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

  /** Coche + recalcul du classement + détection des moments. */
  async function toggleAndScore(day: string, exo: Exercise) {
    if (!player) return;
    await data.toggleExercise(player.id, day, exo);
    rescore(player.id);
  }

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

  // Rattrapage sans aucun jour à rattraper (inscrit le jour 1) : on ferme direct.
  const needsBackfill = !!player && backfillOpen(player);
  useEffect(() => {
    if (needsBackfill && backfillDays().length === 0 && player) {
      data.closeBackfill(player.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsBackfill, player?.id]);

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
      />
    );
  }

  // À partir d'ici, la couleur du joueur teinte toute l'app (--pc).
  const accent = { "--pc": player.color } as React.CSSProperties;

  if (needsBackfill && backfillDays().length > 0) {
    return (
      <div style={accent}>
        <BackfillScreen
          player={player}
          entries={data.entries}
          onToggle={(day, exo) => data.toggleExercise(player.id, day, exo)}
          onAllPerfect={(days) => data.markAllPerfect(player.id, days)}
          onLock={() => data.closeBackfill(player.id)}
        />
        <Toast message={data.toast} />
      </div>
    );
  }

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

  // Mode séance guidée : plein écran, par-dessus tabs et contenu.
  if (workoutOpen) {
    return (
      <div style={accent}>
        <WorkoutMode
          player={player}
          todayEntry={data.entries.get(entryKey(player.id, parisToday()))}
          onValidate={validateWorkout}
          onShare={shareWeek}
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
      <div className="flex flex-1 flex-col">
        {!over && effTab === "today" && (
          <TodayScreen
            player={player}
            players={data.players}
            entries={data.entries}
            liveChecks={data.liveChecks}
            gamification={gamification}
            bonus={bonus}
            onToggle={toggleAndScore}
            onStartWorkout={() => setWorkoutOpen(true)}
            onClaimBonus={(item) => claim(player.id, item)}
            onUnclaimBonus={(item) => unclaim(player.id, item)}
            onShareWeek={shareWeek}
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
            onGoHistory={() => setTab("history")}
          />
        )}
        {effTab === "feed" && (
          <FeedScreen player={player} players={data.players} feed={feed} />
        )}
        {effTab === "leaderboard" && (
          <LeaderboardScreen
            player={player}
            players={data.players}
            entries={data.entries}
            gamification={gamification}
          />
        )}
        {effTab === "history" && (
          <HistoryScreen
            player={player}
            players={data.players}
            entries={data.entries}
            onToggle={toggleAndScore}
            showToast={data.showToast}
          />
        )}
        {effTab === "stats" && (
          <StatsScreen
            player={player}
            players={data.players}
            entries={data.entries}
            gamification={gamification}
            onShareWeek={shareWeek}
          />
        )}
      </div>
      <div className="flex items-center justify-center gap-4 px-5 pb-1">
        <button
          onClick={() => setReplayTuto(true)}
          className="min-h-8 text-[11px] text-faint"
        >
          Revoir les règles
        </button>
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
        onChange={setTab}
        feedUnread={feed.unread}
        over={over}
      />
      <Toast message={data.toast} />
    </div>
  );
}
