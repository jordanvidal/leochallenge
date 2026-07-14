"use client";

// L'orchestrateur : porte → joueur → rattrapage → installation → l'app.
// Tout l'état d'identité vit en localStorage, la donnée vit dans Supabase.

import { useEffect, useMemo, useState } from "react";
import { useChallengeData } from "@/hooks/useChallengeData";
import { backfillDays, backfillOpen } from "@/lib/challenge";
import { buildWeekShare, shareText } from "@/lib/share";
import { Player } from "@/lib/types";
import BackfillScreen from "./BackfillScreen";
import HistoryScreen from "./HistoryScreen";
import InstallScreen, { InstallPromptEvent } from "./InstallScreen";
import PasswordGate from "./PasswordGate";
import PlayerSelect from "./PlayerSelect";
import StatsScreen from "./StatsScreen";
import TabBar, { Tab } from "./TabBar";
import TodayScreen from "./TodayScreen";
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
    const channel = await shareText(buildWeekShare(player, data.entries));
    if (channel === "clipboard")
      data.showToast("Copié ! Colle-le dans WhatsApp 💬");
  }

  async function invite() {
    const url = window.location.origin;
    if (navigator.share) {
      try {
        await navigator.share({ url });
        return;
      } catch {
        /* annulé */
      }
    }
    await navigator.clipboard.writeText(url);
    data.showToast("Lien copié, envoie-le au groupe");
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
            onToggle={(day, exo) => data.toggleExercise(player.id, day, exo)}
            onShareWeek={shareWeek}
            onInvite={invite}
          />
        )}
        {tab === "history" && (
          <HistoryScreen
            player={player}
            players={data.players}
            entries={data.entries}
            onToggle={(day, exo) => data.toggleExercise(player.id, day, exo)}
            showToast={data.showToast}
          />
        )}
        {tab === "stats" && (
          <StatsScreen
            player={player}
            players={data.players}
            entries={data.entries}
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
