"use client";

// Petites pièces partagées : avatar, pastilles d'exos, toast, boutons.
// Un seul vocabulaire visuel sur tous les écrans.

import { Entry, EXERCISES } from "@/lib/types";

/** Initiale du prénom dans un rond à la couleur du joueur. */
export function Avatar({
  name,
  color,
  size = 44,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color,
        background: `color-mix(in oklch, ${color} 18%, var(--color-surface))`,
        boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${color} 55%, transparent)`,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Les 3 pastilles d'un jour (pompes, abdos, squats), pleines ou vides. */
export function ExoDots({
  entry,
  color,
  size = 10,
}: {
  entry: Entry | undefined;
  color: string;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {EXERCISES.map(({ key }) => {
        const done = entry?.[key] ?? false;
        return (
          <span
            key={key}
            className="rounded-full"
            style={{
              width: size,
              height: size,
              background: done ? color : "transparent",
              boxShadow: done
                ? "none"
                : `inset 0 0 0 1.5px var(--color-line)`,
            }}
          />
        );
      })}
    </span>
  );
}

/** Toast en bas d'écran : erreurs d'écriture, confirmations de copie. */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
      <div className="toast-in rounded-full bg-raised px-5 py-3 text-sm font-medium text-ink shadow-lg shadow-black/40">
        {message}
      </div>
    </div>
  );
}

/** Bouton plein largeur, l'action principale d'un écran. */
export function BigButton({
  children,
  onClick,
  disabled,
  tone = "accent",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "accent" | "neutral";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="min-h-14 w-full rounded-2xl px-5 text-base font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
      style={
        tone === "accent"
          ? {
              background: "var(--pc)",
              color: "oklch(0.15 0 0)",
            }
          : { background: "var(--color-raised)", color: "var(--color-ink)" }
      }
    >
      {children}
    </button>
  );
}
