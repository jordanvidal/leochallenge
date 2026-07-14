"use client";

// Rangée compacte des 3 toggles d'exos. Sert au rattrapage et à
// l'édition d'un jour depuis l'historique. Même vocabulaire partout.

import { Entry, Exercise, EXERCISES } from "@/lib/types";

type Props = {
  entry: Entry | undefined;
  color: string;
  onToggle: (exo: Exercise) => void;
  disabled?: boolean;
};

export default function ExoToggles({ entry, color, onToggle, disabled }: Props) {
  return (
    <div className="flex gap-2">
      {EXERCISES.map(({ key, label }) => {
        const done = entry?.[key] ?? false;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            aria-pressed={done}
            onClick={() => {
              navigator.vibrate?.(10);
              onToggle(key);
            }}
            className="min-h-11 flex-1 rounded-xl text-sm font-bold transition-colors disabled:opacity-40"
            style={
              done
                ? {
                    background: `color-mix(in oklch, ${color} 24%, var(--color-surface))`,
                    color,
                    boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${color} 60%, transparent)`,
                  }
                : {
                    background: "var(--color-surface)",
                    color: "var(--color-muted)",
                    boxShadow: "inset 0 0 0 1px var(--color-line)",
                  }
            }
          >
            {done ? "✓ " : ""}
            {label}
          </button>
        );
      })}
    </div>
  );
}
