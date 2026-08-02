"use client";

// Bandeau « événement du jour », non bloquant, en tête de TodayScreen.
// Il a remplacé la modale qui s'ouvrait à l'accueil : l'événement s'annonce,
// il n'intercepte plus le chemin de la coche (PRODUCT.md — « une destination,
// jamais une interception »). La roue et le détail restent à un tap ; le ✕
// écarte l'annonce pour la journée. La couleur du joueur (--pc) le teinte,
// comme la modale.

import { BonusCatalogItem } from "@/lib/bonus";
import { fmtPoints } from "@/lib/gamification";

export default function EventBanner({
  event,
  onOpen,
  onDismiss,
}: {
  event: BonusCatalogItem;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  // Même titre que la modale (avant le « : » de description).
  const title = event.label.split(" : ")[0];
  // Même badge que la modale, MÊME EXPRESSION : le « s? » couvre
  // `bonus_doubles`, au pluriel, qui porte 0 point au catalogue et
  // n'affichait donc aucun badge avec un simple endsWith("_double").
  const badge = /_doubles?$/.test(event.key)
    ? "×2"
    : event.points > 0
      ? `+${fmtPoints(event.points)}`
      : null;

  return (
    <div
      className="mt-4 flex items-center gap-2 rounded-2xl px-3 py-2.5"
      style={{
        background: "color-mix(in oklch, var(--pc) 14%, var(--color-surface))",
        boxShadow: "inset 0 0 0 1px color-mix(in oklch, var(--pc) 32%, transparent)",
      }}
    >
      <button
        onClick={onOpen}
        aria-label={`Événement du jour : ${title}. Voir le détail.`}
        className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left transition-transform active:scale-[0.99]"
      >
        <span aria-hidden className="shrink-0 text-xl">
          {event.emoji}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate font-bold">{title}</span>
            {badge && (
              <span
                className="num-display shrink-0 text-xs font-bold"
                style={{ color: "var(--pc)" }}
              >
                {badge}
              </span>
            )}
          </span>
          <span className="block text-xs text-muted">
            Événement du jour · voir
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-muted">
          ›
        </span>
      </button>
      <button
        onClick={onDismiss}
        aria-label="Masquer l'événement pour aujourd'hui"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm text-faint"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-line)" }}
      >
        ✕
      </button>
    </div>
  );
}
