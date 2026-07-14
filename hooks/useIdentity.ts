"use client";

// L'identité locale et le contexte d'installation PWA : porte,
// joueur choisi, mode standalone, prompt d'installation. Tout vit
// en localStorage/sessionStorage — la donnée, elle, est dans Supabase.

import { useEffect, useState } from "react";
import { InstallPromptEvent } from "@/components/InstallScreen";

const GATE_KEY = "lc100.gate";
const PLAYER_KEY = "lc100.playerId";
const LATER_KEY = "lc100.installLater"; // sessionStorage : revient à chaque ouverture

export function useIdentity() {
  const [mounted, setMounted] = useState(false);
  const [gateOk, setGateOk] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [installLater, setInstallLater] = useState(false);
  const [standalone, setStandalone] = useState(true); // vrai par défaut : pas de flash
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );

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

  /** La porte est passée : mémorisé pour toujours. */
  function openGate() {
    localStorage.setItem(GATE_KEY, "1");
    setGateOk(true);
  }

  /** Choix du joueur, persisté. */
  function choosePlayer(id: string) {
    localStorage.setItem(PLAYER_KEY, id);
    setPlayerId(id);
  }

  /** "Ce n'est pas moi" : on oublie l'identité, pas les données. */
  function forgetPlayer() {
    localStorage.removeItem(PLAYER_KEY);
    setPlayerId(null);
  }

  /** "Plus tard" sur l'installation : jusqu'à la prochaine ouverture. */
  function installLaterOnce() {
    sessionStorage.setItem(LATER_KEY, "1");
    setInstallLater(true);
  }

  return {
    mounted,
    gateOk,
    playerId,
    installLater,
    standalone,
    installPrompt,
    openGate,
    choosePlayer,
    forgetPlayer,
    installLaterOnce,
  };
}
