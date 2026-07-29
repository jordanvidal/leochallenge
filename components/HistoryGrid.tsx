"use client";

// Historique : joueurs en colonnes, jours en lignes, du plus récent au 13/07.
// Façon graphe de contributions GitHub, en plus lisible sur mobile.
// Lecture seule intégrale : depuis que la séance est le seul chemin de
// validation, plus aucune case ne s'édite ici. On montre, on ne coche pas.
//
// C'était un onglet à part jusqu'au 28/07 ; c'est maintenant la dernière
// section de l'écran Stats — le tchat avait besoin du cinquième slot, et de
// tous les onglets, ces deux-là étaient les seuls à regarder le passé.
// Elle vient en dernier et pas en tête : 50 jours de 44 px font le bloc le
// plus haut de l'app, et Stats doit s'ouvrir sur le profil, pas sur un tableau.

import { elapsedDays, isEditable } from "@/lib/challenge";
import { Gamification } from "@/lib/gamification";
import { Entry, entryCount, entryKey, Player } from "@/lib/types";
import { Avatar } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  gamification: Gamification | null;
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

export default function HistoryGrid({
  player,
  players,
  entries,
  gamification,
  showToast,
}: Props) {
  const f = useFenetre();
  const days = elapsedDays(f);

  // L'ordre des colonnes : soi d'abord, les autres ensuite.
  const columns = [player, ...players.filter((p) => p.id !== player.id)];

  // Le jour où chaque joueur a brûlé son joker (null/absent = intact). La
  // case correspondante est vide côté coches — c'est justement le jour
  // sauvé — mais on la marque 🛟 pour qu'elle ne se confonde pas avec un
  // simple jour manqué.
  const jokerDayByPlayer = new Map(
    (gamification?.total ?? []).map((r) => [r.player_id, r.joker_day ?? null]),
  );

  return (
    <section aria-label="Historique jour par jour">
      <h2 className="mt-6 mb-2 text-xs font-bold tracking-wide text-faint uppercase">
        Historique · jour par jour
      </h2>

      {days.length === 0 ? (
        <p className="text-muted">Le challenge n&apos;a pas encore commencé.</p>
      ) : (
        // Le débord négatif rend la largeur de l'écran au tableau : sans lui
        // la grille se scrolle dans une fenêtre amputée des 20 px de marge de
        // Stats, et la dernière colonne reste coincée sous le bord.
        <div className="-mx-5 overflow-x-auto px-5">
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
                    const editable = isMine && isEditable(day, f);
                    const isJoker = jokerDayByPlayer.get(p.id) === day;
                    return (
                      <td key={p.id}>
                        <button
                          disabled={!isMine && !isJoker}
                          aria-label={
                            isJoker
                              ? `${p.name}, ${day} : jour manqué sauvé par le joker`
                              : `${p.name}, ${day} : ${count}/3`
                          }
                          onClick={() =>
                            showToast(
                              isJoker
                                ? "🛟 Joker : la série a tenu malgré ce jour manqué"
                                : editable
                                  ? "C'est ta séance qui coche ▶"
                                  : "Ce jour est verrouillé 🔒",
                            )
                          }
                          className="relative flex size-11 items-center justify-center rounded-lg"
                          style={cellStyle(count, p.color)}
                        >
                          {isJoker && (
                            <span className="text-base" aria-hidden>
                              🛟
                            </span>
                          )}
                        </button>
                        {/* Le cadenas a disparu : il marquait les cases
                            fermées quand certaines s'ouvraient encore. Tout
                            étant verrouillé, le signaler neuf fois par colonne
                            n'informe plus, ça décore. Le tap explique. Le 🛟
                            reste, lui : un jour sauvé n'est pas un jour manqué. */}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
