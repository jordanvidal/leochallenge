"use client";

// L'identité locale et le contexte d'installation PWA : porte,
// joueur choisi, mode standalone, prompt d'installation. Tout vit
// en localStorage/sessionStorage — la donnée, elle, est dans Supabase.

import { useEffect, useState } from "react";
import { InstallPromptEvent } from "@/components/InstallScreen";

const GATE_KEY = "lc100.gate";
const PLAYER_KEY = "lc100.playerId";
const LATER_KEY = "lc100.installLater"; // sessionStorage : revient à chaque ouverture
const TUTO_KEY = "lc100.tutorialSeen"; // localStorage : le tuto ne s'impose qu'une fois
const LAUNCH_S3_KEY = "lc100.launchS3Seen"; // localStorage : l'écran de lancement S3, une fois
const LAUNCH_S4_KEY = "lc100.launchS4Seen"; // localStorage : idem pour la S4, clé distincte
const MI_TEMPS_KEY = "lc100.miTempsSeen"; // localStorage : la mi-temps, une fois et une seule

export function useIdentity() {
  const [mounted, setMounted] = useState(false);
  const [gateOk, setGateOk] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [tutorialSeen, setTutorialSeen] = useState(true); // vrai par défaut : pas de flash
  const [launchS3Seen, setLaunchS3Seen] = useState(true); // vrai par défaut : pas de flash
  const [launchS4Seen, setLaunchS4Seen] = useState(true); // vrai par défaut : pas de flash
  const [miTempsSeen, setMiTempsSeen] = useState(true); // vrai par défaut : pas de flash
  const [installLater, setInstallLater] = useState(false);
  const [standalone, setStandalone] = useState(true); // vrai par défaut : pas de flash
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );

  // Lecture du contexte local une fois monté (pas de SSR ici).
  useEffect(() => {
    setGateOk(localStorage.getItem(GATE_KEY) === "1");
    setPlayerId(localStorage.getItem(PLAYER_KEY));
    setTutorialSeen(localStorage.getItem(TUTO_KEY) === "1");
    setLaunchS3Seen(localStorage.getItem(LAUNCH_S3_KEY) === "1");
    setLaunchS4Seen(localStorage.getItem(LAUNCH_S4_KEY) === "1");
    setMiTempsSeen(localStorage.getItem(MI_TEMPS_KEY) === "1");
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

  /** Tuto vu : mémorisé pour toujours, il ne s'imposera plus. */
  function markTutorialSeen() {
    localStorage.setItem(TUTO_KEY, "1");
    setTutorialSeen(true);
  }

  /** Écran de lancement S3 vu : mémorisé pour toujours, il ne s'imposera plus. */
  function markLaunchS3Seen() {
    localStorage.setItem(LAUNCH_S3_KEY, "1");
    setLaunchS3Seen(true);
  }

  /** Idem pour la S4. Deux clés plutôt qu'une : celui qui a vu le carrousel
      de la S3 doit quand même voir celui de la S4, et l'inverse ne se
      produira plus — la S3 est passée. */
  function markLaunchS4Seen() {
    localStorage.setItem(LAUNCH_S4_KEY, "1");
    setLaunchS4Seen(true);
  }

  /** Mi-temps vue : un événement one-shot, il ne revient jamais. Clé à part
      des lancements de saison — celui qui a vu les trois carrousels de saison
      doit quand même recevoir la mi-temps le 7 au matin. */
  function markMiTempsSeen() {
    localStorage.setItem(MI_TEMPS_KEY, "1");
    setMiTempsSeen(true);
  }

  return {
    mounted,
    gateOk,
    playerId,
    tutorialSeen,
    launchS3Seen,
    launchS4Seen,
    miTempsSeen,
    installLater,
    standalone,
    installPrompt,
    openGate,
    choosePlayer,
    forgetPlayer,
    installLaterOnce,
    markTutorialSeen,
    markLaunchS3Seen,
    markLaunchS4Seen,
    markMiTempsSeen,
  };
}
