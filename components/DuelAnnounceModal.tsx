"use client";

// Annonce one-shot des duels : plein écran, une idée, un pouce — même
// gabarit que la modale d'événement, sans la roue. Montrée une seule
// fois par appareil (flag localStorage posé par l'appelant), en avant-
// première avant le premier lundi puis en découverte après.

import { frenchDayMonth, parisToday } from "@/lib/challenge";
import { DUEL_POINTS, DUELS_FROM } from "@/lib/duels";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";

type Props = {
  player: Player;
  onClose: () => void;
};

export default function DuelAnnounceModal({ player, onClose }: Props) {
  const accent = { "--pc": player.color } as React.CSSProperties;
  const glow = {
    filter: `drop-shadow(0 8px 24px color-mix(in oklch, ${player.color} 45%, transparent))`,
  };
  const before = parisToday() < DUELS_FROM;

  const rules: { emoji: string; text: string }[] = [
    {
      emoji: "🤝",
      text: "Chaque lundi matin, l'app t'apparie avec ton voisin de classement. Course serrée garantie.",
    },
    {
      emoji: "✅",
      text: "Le plus de jours parfaits d'ici dimanche gagne. Égalité ? Le total d'exos départage.",
    },
    {
      emoji: "⚔️",
      text: `Le gagnant prend ${DUEL_POINTS} pts au perdant. Pas de lot de consolation.`,
    },
  ];

  return (
    <main
      style={accent}
      className="fixed inset-0 z-[60] flex flex-col bg-bg pt-safe pb-safe"
    >
      <div className="flex items-center justify-between px-6 py-3">
        <span className="text-xs font-bold tracking-wide text-faint uppercase">
          Nouveau
        </span>
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          Fermer
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center px-8">
        <p className="text-7xl" aria-hidden style={glow}>
          ⚔️
        </p>
        <div className="rise-in">
          <h1 className="mt-6 text-3xl font-bold">Les duels</h1>
          <p className="mt-2 text-lg font-medium" style={{ color: player.color }}>
            {before
              ? `Premier tirage lundi ${frenchDayMonth(DUELS_FROM)}, 10h.`
              : "Ton adversaire de la semaine t'attend au Classement."}
          </p>

          <ul className="mt-6 space-y-4">
            {rules.map((r) => (
              <li key={r.emoji} className="flex items-start gap-3">
                <span className="text-xl" aria-hidden>
                  {r.emoji}
                </span>
                <p className="text-base text-muted">{r.text}</p>
              </li>
            ))}
          </ul>

          <p className="mt-6 border-t border-line pt-4 text-sm text-faint">
            Ton duel vit en haut de l&apos;onglet Classement, score en direct.
            Verdict chaque lundi matin, dans le feed et sur ton téléphone.
          </p>
        </div>
      </div>

      <div className="px-6 pb-3">
        <BigButton onClick={onClose}>Qu&apos;ils viennent</BigButton>
      </div>
    </main>
  );
}
