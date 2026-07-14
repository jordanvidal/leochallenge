"use client";

// L'orchestrateur : porte → joueur → rattrapage → installation → l'app.
// Tout l'état d'identité vit en localStorage, la donnée vit dans Supabase.

import { useEffect, useMemo, useState } from "react";
import { useBonus } from "@/hooks/useBonus";
import { useChallengeData } from "@/hooks/useChallengeData";
import { useGamification } from "@/hooks/useGamification";
import { backfillDays, backfillOpen, parisToday } from "@/lib/challenge";
import { notifyOvertake } from "@/lib/gamification";
import { shareInvite, shareWeekFlow } from "@/lib/share";
import { Exercise, Player, entryKey } from "@/lib/types";
import BackfillScreen from "./BackfillScreen";
import HistoryScreen from "./HistoryScreen";
import LeaderboardScreen from "./LeaderboardScreen";
import InstallScreen, { InstallPromptEvent } from "./InstallScreen";
import PasswordGate from "./PasswordGate";
import PlayerSelect from "./PlayerSelect";
import StatsScreen from "./StatsScreen";
import TabBar, { Tab } from "./TabBar";
import TodayScreen from "./TodayScreen";
import WorkoutMode from "./workout/WorkoutMode";
import { Toast } from "./ui";

const GATE_KEY = "lc100.gate";
const PLAYER_KEY = "lc100.playerId";
const LATER_KEY = "lc100.installLater"; // sessionStorage : revient à chaque ouverture

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
  const [mounted, setMounted] = useState(false);
  const [gateOk, setGateOk] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [installLater, setInstallLater] = useState(false);
  const [standalone, setStandalone] = useState(true); // vrai par défaut : pas de flash
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const [tab, setTab] = useState<Tab>("today");
  const [workoutOpen, setWorkoutOpen] = useState(false);

  // Lecture du contexte local une fois monté (pas de SSR ici).
  useEffect(() => {
    setGateOk(localStorage.getItem(GATE_KEY) === "1");
    setPlayerId(localStorage.getItem(PLAYER_KEY));
    setInstallLater(sessionStorage.getItem(LATER_KEY) === "1");
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);
    setMounted(true);

    const onPrompt = (e: Event) => {
      e.preventDefault(); // on déclenchera le prompt nous-mêmes
      setInstallPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setStandalone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const player: Player | undefined = useMemo(
    () => (data.players ?? []).find((p) => p.id === playerId),
    [data.players, playerId],
  );

  // Gamification (phase 2) : chargée seulement une fois le joueur connu.
  const { gamification, reloadGamification } = useGamification(!!player);

  // Bonus : catalogue, événement du jour, déclarations. Chaque
  // déclaration recalcule aussi le classement (onScored).
  const { bonus, claim, unclaim } = useBonus(
    !!player,
    data.showToast,
    reloadGamification,
  );

  /** Coche + recalcul du classement + détection de dépassement. */
  async function toggleAndScore(day: string, exo: Exercise) {
    if (!player) return;
    await data.toggleExercise(player.id, day, exo);
    reloadGamification();
    notifyOvertake(player.id);
  }

  /** Fin (ou abandon) de séance guidée : les exos couverts passent à
      fait par le chemin d'écriture existant, puis recalcul du score. */
  async function validateWorkout(exos: Exercise[]) {
    if (!player) return false;
    const ok = await data.setExercisesDone(player.id, parisToday(), exos);
    if (ok && exos.length > 0) {
      reloadGamification();
      notifyOvertake(player.id);
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

  function selectPlayer(p: Player) {
    localStorage.setItem(PLAYER_KEY, p.id);
    setPlayerId(p.id);
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

  // ---- Aiguillage des écrans ----

  if (!mounted) return <Splash />;

  if (!gateOk)
    return (
      <PasswordGate
        onPass={() => {
          localStorage.setItem(GATE_KEY, "1");
          setGateOk(true);
        }}
      />
    );

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
        onSelect={selectPlayer}
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

  if (!standalone && !installLater) {
    return (
      <div style={accent}>
        <InstallScreen
          installPrompt={installPrompt}
          onLater={() => {
            sessionStorage.setItem(LATER_KEY, "1");
            setInstallLater(true);
          }}
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
      {data.offline && (
        <p className="bg-raised py-1.5 text-center text-xs font-medium text-muted">
          Hors ligne — dernier état connu
        </p>
      )}
      <div className="flex flex-1 flex-col">
        {tab === "today" && (
          <TodayScreen
            player={player}
            players={data.players}
            entries={data.entries}
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
        {tab === "leaderboard" && (
          <LeaderboardScreen
            player={player}
            players={data.players}
            gamification={gamification}
          />
        )}
        {tab === "history" && (
          <HistoryScreen
            player={player}
            players={data.players}
            entries={data.entries}
            onToggle={toggleAndScore}
            showToast={data.showToast}
          />
        )}
        {tab === "stats" && (
          <StatsScreen
            player={player}
            players={data.players}
            entries={data.entries}
            gamification={gamification}
            onShareWeek={shareWeek}
          />
        )}
      </div>
      <div className="px-5 pb-1 text-center">
        <button
          onClick={() => {
            localStorage.removeItem(PLAYER_KEY);
            setPlayerId(null);
          }}
          className="min-h-8 text-[11px] text-faint"
        >
          Ce n&apos;est pas moi ({player.name})
        </button>
      </div>
      <TabBar tab={tab} onChange={setTab} />
      <Toast message={data.toast} />
    </div>
  );
}
