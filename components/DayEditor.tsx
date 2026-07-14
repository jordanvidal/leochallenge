"use client";

// Feuille d'édition d'un jour depuis l'historique : les 3 exos, rien d'autre.
// Uniquement sa propre colonne, uniquement dans la fenêtre des 48h.

import { useEffect } from "react";
import { frenchDate } from "@/lib/challenge";
import { Entry, Exercise, Player } from "@/lib/types";
import ExoToggles from "./ExoToggles";

type Props = {
  day: string;
  player: Player;
  entry: Entry | undefined;
  onToggle: (exo: Exercise) => void;
  onClose: () => void;
};

export default function DayEditor({
  day,
  player,
  entry,
  onToggle,
  onClose,
}: Props) {
  // Échap pour fermer (desktop / clavier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Éditer le ${frenchDate(day)}`}
    >
      <div
        className="rise-in rounded-t-3xl bg-raised px-5 pt-4 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden />
        <p className="mb-4 text-lg font-bold first-letter:uppercase">
          {frenchDate(day)}
        </p>
        <ExoToggles entry={entry} color={player.color} onToggle={onToggle} />
        <button
          onClick={onClose}
          className="mt-4 mb-2 min-h-12 w-full rounded-2xl bg-surface font-bold"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
