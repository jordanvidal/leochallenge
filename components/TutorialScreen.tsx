"use client";

// Tuto de première connexion : 4 cartes qu'on tape pour avancer.
// Une idée par carte, dans l'esprit « on frappe l'écran au pouce ».
// Le tour des onglets a été retiré : cinq lignes pour nommer cinq
// onglets déjà visibles en bas de l'écran, personne ne les lisait.
// Le barème est calqué mot pour mot sur PlayerBreakdown (mini-barème) :
// une seule source de vérité pour les règles. Montré une fois
// (flag localStorage), ou rouvert depuis « Revoir les règles ».

import { useState } from "react";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";

type Props = {
  player: Player;
  /** Rouvert manuellement : le bouton final dit « Fermer » au lieu de « C'est parti ». */
  replay?: boolean;
  onDone: () => void;
};

/** Une ligne du barème : montant à gauche, ce qu'il récompense à droite. */
function Rule({ amount, children }: { amount: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="num-display w-16 shrink-0 text-ink">{amount}</dt>
      <dd className="text-muted">{children}</dd>
    </div>
  );
}

/** Une ligne d'événement : emoji + explication courte. */
function EventRow({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
        {emoji}
      </span>
      <span className="text-sm text-muted">{children}</span>
    </div>
  );
}

export default function TutorialScreen({ player, replay = false, onDone }: Props) {
  const cards = [
    // 1 — Le principe
    <div key="principe">
      <p className="num-display text-4xl" style={{ color: player.color }}>
        100·100·100
      </p>
      <h1 className="mt-4 text-2xl font-bold">Chaque jour, jusqu&apos;au 31 août</h1>
      <p className="mt-3 text-muted">
        100 pompes, 100 abdos, 100 squats. Tu lances ta séance, tu les fais,
        tu coches. Les trois cartes restent fermées tant que la séance
        n&apos;est pas partie.
      </p>
      <p className="mt-3 text-muted">
        Et tout le groupe voit qui a coché quoi. La pression, c&apos;est le jeu.
      </p>
    </div>,

    // 2 — Comment on marque
    <div key="score">
      <h1 className="text-2xl font-bold">Comment on marque</h1>
      <dl className="mt-5 space-y-3">
        <Rule amount="1 pt">par exo coché</Rule>
        <Rule amount="+2">journée parfaite (3 exos sur 3)</Rule>
        <Rule amount="×1,5">série de 3 jours parfaits</Rule>
        <Rule amount="×2">série de 7 jours parfaits, et ça ne monte plus</Rule>
      </dl>
      <p className="mt-6 border-t border-line pt-4 text-muted">
        Un seul malus dans tout le jeu : perdre son duel de la semaine, −3.
        Pour le reste, tes pastilles vides suffisent — tout le monde les voit.
      </p>
    </div>,

    // 3 — Les bonus
    <div key="bonus">
      <h1 className="text-2xl font-bold">Les bonus, par-dessus</h1>
      <p className="mt-3 text-muted">Des points en plus qui s&apos;empilent sur ta base :</p>
      <dl className="mt-5 space-y-3">
        <Rule amount="🥇">premier à finir son 3/3 dans la journée</Rule>
        <Rule amount="💪">séance guidée bouclée</Rule>
        <Rule amount="＋">exos en plus que tu déclares toi-même</Rule>
      </dl>
    </div>,

    // 4 — Les événements du jour
    <div key="events">
      <h1 className="text-2xl font-bold">L&apos;événement du jour</h1>
      <p className="mt-3 text-muted">
        Tiré au hasard, un max par jour. Certains jours, rien. D&apos;autres :
      </p>
      <div className="mt-5 space-y-2.5">
        <EventRow emoji="🎲">
          pompes double : ta coche pompes et tes bonus pompes comptent double
        </EventRow>
        <EventRow emoji="🎰">
          quitte ou double : ton 3/3 double ta base du jour. Raté, rien ne
          bouge.
        </EventRow>
        <EventRow emoji="🪞">jour miroir : le dernier au général prend +8</EventRow>
        <EventRow emoji="👊">boss du dimanche : 200 pompes au total → +10</EventRow>
      </div>
    </div>,
  ];

  const [i, setI] = useState(0);
  const last = i === cards.length - 1;

  function next() {
    if (last) onDone();
    else setI((v) => v + 1);
  }

  return (
    <main className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      {/* En-tête : progression + passer. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {cards.map((_, n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{
                background:
                  n <= i ? player.color : "var(--color-line)",
              }}
            />
          ))}
        </div>
        <button
          onClick={onDone}
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          {replay ? "Fermer" : "Passer"}
        </button>
      </div>

      {/* Zone de tap : tape n'importe où pour avancer. */}
      <button
        onClick={next}
        aria-label={last ? "Terminer" : "Carte suivante"}
        className="flex flex-1 flex-col justify-center px-8 text-left"
      >
        <div key={i} className="rise-in">
          {cards[i]}
        </div>
      </button>

      {/* Pied : bouton net sur la dernière carte, sinon indice de tap. */}
      <div className="px-6 pb-3">
        {last ? (
          <BigButton onClick={onDone}>
            {replay ? "Fermer" : "C'est parti"}
          </BigButton>
        ) : (
          <p className="py-3 text-center text-sm text-faint">
            Tape pour continuer
          </p>
        )}
      </div>
    </main>
  );
}
