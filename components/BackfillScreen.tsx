"use client";

// "Rattrape ton historique" — une seule fois, juste après l'inscription.
// Quelques jours à cocher, un raccourci "tout parfait", puis verrouillage.
//
// ÉCRAN DORMANT : backfillDays() renvoie [] depuis la migration 9, donc
// App.tsx ne monte jamais ce composant. Conservé tel quel au cas où le
// rattrapage rouvrirait — à supprimer si la décision se confirme.

import { useState } from "react";
import { backfillDays, frenchDateShort } from "@/lib/challenge";
import { Entry, entryKey, Exercise, Player } from "@/lib/types";
import ExoToggles from "./ExoToggles";
import { BigButton } from "./ui";

type Props = {
  player: Player;
  entries: Map<string, Entry>;
  onToggle: (day: string, exo: Exercise) => void;
  onAllPerfect: (days: string[]) => Promise<void>;
  onLock: () => Promise<boolean>;
};

export default function BackfillScreen({
  player,
  entries,
  onToggle,
  onAllPerfect,
  onLock,
}: Props) {
  const days = backfillDays(); // jours écoulés hors aujourd'hui
  const [locking, setLocking] = useState(false);

  async function lock() {
    setLocking(true);
    const ok = await onLock();
    if (!ok) setLocking(false);
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-safe pb-safe">
      <header className="mt-8">
        <h1 className="text-3xl font-bold">Rattrape ton historique</h1>
        <p className="mt-2 text-muted">
          Le challenge a démarré le 13 juillet. Coche ce que tu as vraiment
          fait, puis verrouille : on n&apos;y reviendra plus.
        </p>
      </header>

      <button
        type="button"
        onClick={() => onAllPerfect(days)}
        className="mt-6 min-h-12 rounded-2xl font-bold"
        style={{
          background: `color-mix(in oklch, ${player.color} 20%, var(--color-surface))`,
          color: player.color,
        }}
      >
        ⚡ Tout parfait, j&apos;ai rien raté
      </button>

      <div className="mt-4 flex flex-col gap-4">
        {days.map((day) => (
          <div key={day}>
            <p className="mb-1.5 text-sm font-medium text-muted first-letter:uppercase">
              {frenchDateShort(day)}
            </p>
            <ExoToggles
              entry={entries.get(entryKey(player.id, day))}
              color={player.color}
              onToggle={(exo) => onToggle(day, exo)}
            />
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 mt-8 bg-bg pt-3 pb-safe">
        <BigButton onClick={lock} disabled={locking}>
          {locking ? "…" : "C'est bon, je verrouille"}
        </BigButton>
        <p className="mt-2 text-center text-xs text-faint">
          Définitif. Ensuite, on ne coche plus que le jour même.
        </p>
      </div>
    </main>
  );
}
