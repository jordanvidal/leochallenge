"use client";

// Modale « événement du jour » : montrée une fois par jour, le matin,
// quand un événement a été tiré (pas les jours « rien »). Met en valeur
// l'événement du groupe — emoji géant, ce qu'il faut faire, le gain.
// Style calqué sur TutorialScreen : plein écran, une idée, un pouce.

import { BonusCatalogItem } from "@/lib/bonus";
import { fmtPoints } from "@/lib/gamification";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";

type Props = {
  player: Player;
  event: BonusCatalogItem; // jamais « rien » : l'appelant garantit un événement
  onClose: () => void;
};

/** Copie soignée par événement : ce qu'il faut faire, aujourd'hui. Le
    montant, lui, reste lu au catalogue (source de vérité). */
const COPY: Record<string, { howto: string }> = {
  pompes_double: {
    howto: "Aujourd'hui, tes pompes comptent double. Fais ta séance pour en profiter.",
  },
  happy_hour: {
    howto: "Termine ta séance entre 18h et 20h pour empocher le bonus.",
  },
  leve_tot: {
    howto: "Termine ta séance avant 7h du matin. Le lève-tôt est récompensé.",
  },
  quitte_ou_double: {
    howto:
      "Boucle ton 3/3 aujourd'hui et TOUS tes points du jour comptent double. Si tu rates, rien ne change — aucune perte.",
  },
  jour_miroir: {
    howto:
      "Le dernier du classement général reçoit un coup de pouce pour se relancer. Le bas de tableau a sa chance.",
  },
  boss_dimanche: {
    howto:
      "200 pompes au total dans la journée. À déclarer dans le bandeau de l'écran Aujourd'hui.",
  },
};

export default function DailyEventModal({ player, event, onClose }: Props) {
  const accent = { "--pc": player.color } as React.CSSProperties;
  const howto = COPY[event.key]?.howto ?? event.label;
  // Le quitte ou double n'a pas de montant fixe : c'est un multiplicateur.
  const badge =
    event.key === "quitte_ou_double"
      ? "×2"
      : event.points > 0
        ? `+${fmtPoints(event.points)}`
        : null;

  return (
    <main
      style={accent}
      className="fixed inset-0 z-[60] flex flex-col bg-bg pt-safe pb-safe"
    >
      {/* En-tête discret : le kicker + fermer. Hors du gros bouton. */}
      <div className="flex items-center justify-between px-6 py-3">
        <span className="text-xs font-bold tracking-wide text-faint uppercase">
          Événement du jour
        </span>
        <button
          onClick={onClose}
          aria-label="Fermer"
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          Fermer
        </button>
      </div>

      {/* Cœur : emoji géant, nom mis en valeur, ce qu'il faut faire. */}
      <div className="flex flex-1 flex-col justify-center px-8">
        <div className="rise-in">
          <p
            className="text-[5.5rem] leading-none"
            aria-hidden
            style={{
              filter: `drop-shadow(0 8px 24px color-mix(in oklch, ${player.color} 45%, transparent))`,
            }}
          >
            {event.emoji}
          </p>

          <div className="mt-6 flex items-center gap-3">
            <h1 className="text-3xl font-bold">{event.label.split(" : ")[0]}</h1>
            {badge && (
              <span
                className="num-display shrink-0 rounded-full px-3 py-1 text-lg font-bold"
                style={{
                  background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                  color: player.color,
                  boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 55%, transparent)`,
                }}
              >
                {badge}
              </span>
            )}
          </div>

          <p className="mt-4 text-lg text-muted">{howto}</p>

          <p className="mt-6 border-t border-line pt-4 text-sm text-faint">
            L&apos;événement est le même pour tout le groupe aujourd&apos;hui.
            Un seul par jour — profites-en.
          </p>
        </div>
      </div>

      {/* Pied : un bouton net, couleur du joueur. */}
      <div className="px-6 pb-3">
        <BigButton onClick={onClose}>C&apos;est parti</BigButton>
      </div>
    </main>
  );
}
