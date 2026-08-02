"use client";

// Opt-in aux notifications push, une seule fois, sans harceler.
// Masqué si le push n'est pas possible ici (iOS sans PWA installée).

import { useEffect, useState } from "react";
import { pushSupported, subscribePush } from "@/lib/gamification";
import { Player } from "@/lib/types";

const DISMISS_KEY = "lc100.notifDismissed";
/** Marqué à la première apparition : le bandeau ne se propose qu'une fois. */
const VU_KEY = "lc100.notifVu";

export default function NotifBanner({
  player,
  onDone,
}: {
  player: Player;
  onDone: (msg: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Au premier lancement, et là seulement. Le bandeau occupait l'accueil
  // tous les soirs tant que personne n'avait tranché — sur le chemin des
  // dix secondes, pour une demande de permission qui ne se pose qu'une
  // fois. On le montre à la première ouverture, on note qu'il a été vu,
  // et l'accueil lui est rendu pour toujours.
  useEffect(() => {
    const proposable =
      pushSupported() &&
      Notification.permission === "default" &&
      localStorage.getItem(DISMISS_KEY) !== "1";
    const dejaVu = localStorage.getItem(VU_KEY) === "1";
    setVisible(proposable && !dejaVu);
    if (proposable && !dejaVu) localStorage.setItem(VU_KEY, "1");
  }, []);

  if (!visible) return null;

  async function enable() {
    setBusy(true);
    const ok = await subscribePush(player.id);
    setBusy(false);
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, "1");
    onDone(
      ok
        ? "Rappels activés. Rendez-vous à 20h 🔔"
        : "Notifications refusées — tant pis pour toi",
    );
  }

  function later() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="mt-3 rounded-2xl bg-surface p-4">
      <p className="font-bold">Un rappel à 20h si t&apos;as rien coché ?</p>
      <p className="mt-0.5 text-sm text-muted">
        Avec le nombre de potes qui ont déjà fini. La pression, la vraie.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={enable}
          disabled={busy}
          className="min-h-11 flex-1 rounded-xl font-bold disabled:opacity-40"
          style={{ background: player.color, color: "oklch(0.15 0 0)" }}
        >
          {busy ? "…" : "Activer les rappels"}
        </button>
        <button
          onClick={later}
          className="min-h-11 rounded-xl px-4 text-sm font-medium text-faint"
        >
          Non merci
        </button>
      </div>
    </div>
  );
}
