"use client";

// Historique : joueurs en colonnes, jours en lignes, du plus récent au 13/07.
// Façon graphe de contributions GitHub, en plus lisible sur mobile.
// Sa colonne + fenêtre 48h = éditable. Le reste : lecture seule, toujours.

import { useState } from "react";
import { elapsedDays, isEditable } from "@/lib/challenge";
import { Entry, entryCount, entryKey, Exercise, Player } from "@/lib/types";
import DayEditor from "./DayEditor";
import { Avatar } from "./ui";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  onToggle: (day: string, exo: Exercise) => void;
  showToast: (msg: string) => void;
};

/** Remplissage d'une case selon le nombre d'exos (0 à 3). */
function cellStyle(count: number, color: string): React.CSSProperties {
  if (count === 0)
    return { boxShadow: "inset 0 0 0 1px var(--color-line)" };
  const pct = count === 1 ? 30 : count === 2 ? 60 : 100;
  return {
    background: `color-mix(in oklch, ${color} ${pct}%, var(--color-surface))`,
  };
}

const dayFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

export default function HistoryScreen({
  player,
  players,
  entries,
  onToggle,
  showToast,
}: Props) {
  const days = elapsedDays();
  const [editing, setEditing] = useState<string | null>(null);

  // L'ordre des colonnes : soi d'abord, les autres ensuite.
  const columns = [player, ...players.filter((p) => p.id !== player.id)];

  return (
    <div className="flex min-h-full flex-col px-5 pt-safe">
      <h1 className="mt-4 mb-4 text-2xl font-bold">Historique</h1>

      {days.length === 0 ? (
        <p className="text-muted">Le challenge n&apos;a pas encore commencé.</p>
      ) : (
        <div className="-mx-5 flex-1 overflow-x-auto px-5">
          <table className="border-separate border-spacing-1.5">
            <thead>
              <tr>
                <th aria-label="Jour" />
                {columns.map((p) => (
                  <th key={p.id} className="pb-1">
                    <div className="flex flex-col items-center gap-0.5">
                      <Avatar name={p.name} color={p.color} size={30} />
                      <span className="max-w-12 truncate text-[10px] font-medium text-muted">
                        {p.id === player.id ? "toi" : p.name}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <td className="pr-2 text-right text-xs whitespace-nowrap text-muted">
                    {dayFmt.format(new Date(`${day}T12:00:00Z`))}
                  </td>
                  {columns.map((p) => {
                    const count = entryCount(entries.get(entryKey(p.id, day)));
                    const isMine = p.id === player.id;
                    const editable = isMine && isEditable(day);
                    return (
                      <td key={p.id}>
                        <button
                          disabled={!isMine}
                          aria-label={`${p.name}, ${day} : ${count}/3`}
                          onClick={() =>
                            editable
                              ? setEditing(day)
                              : showToast("Ce jour est verrouillé 🔒")
                          }
                          className="relative block size-11 rounded-lg"
                          style={cellStyle(count, p.color)}
                        >
                          {/* cadenas discret sur sa propre colonne hors fenêtre */}
                          {isMine && !editable && (
                            <span
                              className="absolute right-0.5 bottom-0.5 text-[9px] opacity-50"
                              aria-hidden
                            >
                              🔒
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <DayEditor
          day={editing}
          player={player}
          entry={entries.get(entryKey(player.id, editing))}
          onToggle={(exo) => onToggle(editing, exo)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
