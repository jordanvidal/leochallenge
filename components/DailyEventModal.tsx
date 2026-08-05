"use client";

// Modale « événement du jour » : montrée une fois par jour, le matin,
// quand un événement a été tiré (pas les jours « rien »). Met en valeur
// l'événement du groupe — roue qui tire l'emoji, ce qu'il faut faire, le
// gain. Style calqué sur TutorialScreen : plein écran, une idée, un pouce.
//
// La copie (consigne) et le badge ont déménagé dans lib/bonus.ts le 05/08 :
// le bandeau de l'accueil dit désormais la même chose, et deux textes qui
// disent la même règle finissent toujours par ne plus la dire pareil.

import { useMemo, useState } from "react";

import {
  badgeEvenement,
  BonusCatalogItem,
  consigneEvenement,
} from "@/lib/bonus";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";

type Props = {
  player: Player;
  event: BonusCatalogItem; // jamais « rien » : l'appelant garantit un événement
  catalog: BonusCatalogItem[]; // sert de vivier de leurres pour la roue
  onClose: () => void;
};

/** Nombre de leurres qui défilent avant le bon. Assez pour qu'on n'ait pas
    le temps de lire, pas assez pour qu'on s'ennuie. */
const DECOYS = 12;

/** Mélange une copie du tableau (Fisher-Yates). Sans ça, les leurres
    défilent toujours dans l'ordre du catalogue et la boucle se voit. */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function DailyEventModal({
  player,
  event,
  catalog,
  onClose,
}: Props) {
  // Roue coupée d'entrée si le système demande moins d'animation : on
  // affiche le résultat, point. Le CSS ne peut pas s'en charger seul —
  // une animation neutralisée laisserait la roue bloquée sur un leurre.
  const [spinning, setSpinning] = useState(
    () =>
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const accent = { "--pc": player.color } as React.CSSProperties;
  // La consigne au complet : le bandeau de l'accueil n'en montre que la
  // première phrase, la roue a la place de tout dire.
  const howto = consigneEvenement(event).join(" ");
  const glow = {
    filter: `drop-shadow(0 8px 24px color-mix(in oklch, ${player.color} 45%, transparent))`,
  };
  const badge = badgeEvenement(event);

  // La bande : des leurres puisés dans les autres événements tirables,
  // puis le bon en dernière position — c'est là que la roue s'arrête.
  const strip = useMemo(() => {
    const pool = shuffled(
      catalog
        .filter((c) => c.kind === "event" && c.key !== event.key)
        .map((c) => c.emoji),
    );
    if (pool.length === 0) return [event.emoji];
    const decoys = Array.from(
      { length: DECOYS },
      (_, i) => pool[i % pool.length],
    );
    return [...decoys, event.emoji];
  }, [catalog, event.key, event.emoji]);

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

      {/* Cœur : la roue s'arrête sur l'emoji, le reste suit. */}
      <div className="reel flex flex-1 flex-col justify-center px-8">
        {spinning ? (
          // La fenêtre rogne la bande ; le halo attendra l'arrêt.
          <div className="reel-window" aria-hidden>
            <div
              className="reel-strip"
              style={{ "--reel-steps": strip.length - 1 } as React.CSSProperties}
              onAnimationEnd={() => setSpinning(false)}
            >
              {strip.map((emoji, i) => (
                <span key={i} className="reel-item">
                  {emoji}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="reel-item reel-land" aria-hidden style={glow}>
            {event.emoji}
          </p>
        )}

        {/* Monté dès le départ mais masqué : sans ça, son arrivée
            recentrerait le bloc et ferait sauter l'emoji. */}
        <div className={spinning ? "invisible" : "rise-in"}>
          <div className="mt-6 flex items-center gap-3">
            <h1 className="text-3xl font-bold">{event.label.split(" : ")[0]}</h1>
            {badge && (
              // Le doublement prend l'aplat plein de l'or (DESIGN.md :
              // `badge-x2`), un forfait garde la teinte du joueur. C'est la
              // forme qui dit « ça multiplie », et elle est la même ici,
              // dans le bandeau de l'accueil et sur les puces de la feuille.
              <span
                className="num-display shrink-0 rounded-full px-3 py-1 text-lg font-bold"
                style={
                  badge === "×2"
                    ? {
                        background: "var(--color-x2)",
                        color: "var(--color-bg)",
                      }
                    : {
                        background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                        color: player.color,
                        boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 55%, transparent)`,
                      }
                }
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
