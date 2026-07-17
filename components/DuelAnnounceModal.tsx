"use client";

// Annonce one-shot des duels, en deux cartes façon tuto : le pitch,
// puis le rituel du lundi. Tape pour avancer, une idée par carte.
// Montrée une seule fois par appareil (flag localStorage posé par
// l'appelant), en avant-première avant le premier lundi.

import { useState } from "react";
import { frenchDayMonth, parisToday } from "@/lib/challenge";
import { DUEL_POINTS, DUELS_FROM } from "@/lib/duels";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";

type Props = {
  player: Player;
  onClose: () => void;
};

/** Une ligne de la mécanique : emoji + explication, comme le tuto. */
function Row({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-7 shrink-0 text-center text-xl" aria-hidden>
        {emoji}
      </span>
      <p className="text-base text-muted">{children}</p>
    </div>
  );
}

export default function DuelAnnounceModal({ player, onClose }: Props) {
  const glow = {
    filter: `drop-shadow(0 8px 24px color-mix(in oklch, ${player.color} 45%, transparent))`,
  };
  const before = parisToday() < DUELS_FROM;

  const cards = [
    // 1 — Le pitch, respirant : trois phrases, pas une de plus.
    <div key="pitch">
      <p className="text-7xl" aria-hidden style={glow}>
        ⚔️
      </p>
      <h1 className="mt-6 text-3xl font-bold">Les duels</h1>
      <p className="mt-2 text-lg font-medium" style={{ color: player.color }}>
        {before
          ? `Premier tirage lundi ${frenchDayMonth(DUELS_FROM)}, 10h.`
          : "Ton adversaire de la semaine t'attend au Classement."}
      </p>
      <p className="mt-5 text-lg text-muted">
        Chaque semaine, un face-à-face contre ton voisin de classement.
      </p>
      <p className="mt-3 text-lg text-muted">
        Le plus de journées parfaites — les 3 exos cochés — l&apos;emporte, et
        prend {DUEL_POINTS} pts à l&apos;autre.
      </p>
    </div>,

    // 2 — Le rituel du lundi et les cas limites.
    <div key="rituel">
      <h1 className="text-2xl font-bold">Le rendez-vous du lundi</h1>
      <div className="mt-6 space-y-5">
        <Row emoji="🤝">
          Chaque lundi à 10h : le verdict de ton duel, puis ton nouvel
          adversaire. Un duel par semaine, jusqu&apos;à la fin.
        </Row>
        <Row emoji="⚖️">
          Égalité en journées parfaites ? Le total d&apos;exos de la semaine
          tranche. Toujours égalité : match nul, personne ne perd rien.
        </Row>
        <Row emoji="📍">
          Ton duel vit en haut du Classement, score en direct. Nombre impair
          de joueurs : un exempt, à tour de rôle.
        </Row>
      </div>
    </div>,
  ];

  const [i, setI] = useState(0);
  const last = i === cards.length - 1;

  function next() {
    if (last) onClose();
    else setI((v) => v + 1);
  }

  return (
    <main
      style={{ "--pc": player.color } as React.CSSProperties}
      className="fixed inset-0 z-[60] flex flex-col bg-bg pt-safe pb-safe"
    >
      {/* En-tête : progression + passer, hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
          style={{
            background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
            color: player.color,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 55%, transparent)`,
          }}
        >
          Nouveau
        </span>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {cards.map((_, n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: n <= i ? player.color : "var(--color-line)" }}
            />
          ))}
        </div>
        <button
          onClick={onClose}
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          Passer
        </button>
      </div>

      {/* Tape n'importe où pour avancer. */}
      <button
        onClick={next}
        aria-label={last ? "Fermer" : "Carte suivante"}
        className="flex flex-1 flex-col justify-center px-8 text-left"
      >
        <div key={i} className="rise-in">
          {cards[i]}
        </div>
      </button>

      <div className="px-6 pb-3">
        {last ? (
          <BigButton onClick={onClose}>Qu&apos;ils viennent</BigButton>
        ) : (
          <p className="py-3 text-center text-sm text-faint">
            Tape pour continuer
          </p>
        )}
      </div>
    </main>
  );
}
