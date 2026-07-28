// Les trois modules purs qui raisonnaient encore sur le challenge d'origine :
// `stats` (jours écoulés, ligne du temps), `share` (le bloc à coller dans
// WhatsApp) et `duels` (le premier lundi d'appariement).
//
// Le plus visible des trois est le partage. Sur une ligue d'une semaine en
// mars, `buildWeekShare` bornait chaque jour à « entre le 13/07 et le 31/08 » :
// aucun jour ne passait le filtre, la grille sortait entièrement blanche, et
// le pied de message annonçait les jours restants du challenge d'origine. Un
// joueur parfait aurait partagé sept cases vides.
//
// Ces tests tiennent les deux moitiés : le défaut ne bouge pas, et une fenêtre
// explicite est réellement suivie.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fenetre, FENETRE_ENV } from "../lib/challenge";
import { duelsFrom, DUELS_FROM } from "../lib/duels";
import { buildFinalShare, buildWeekShare } from "../lib/share";
import { computeStats, groupTimeline } from "../lib/stats";
import { Entry, entryKey, Player } from "../lib/types";

function onEstLe(jour: string) {
  vi.setSystemTime(new Date(`${jour}T10:00:00Z`)); // midi à Paris en été
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const LEO: Player = {
  id: "leo",
  name: "Léo",
  color: "#0f0",
  created_at: "2026-03-02T00:00:00Z",
};

/** Un joueur parfait sur tous les jours donnés. */
function parfaitSur(jours: string[]): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const day of jours) {
    m.set(entryKey(LEO.id, day), {
      player_id: LEO.id,
      day,
      pushups: true,
      abs: true,
      squats: true,
    });
  }
  return m;
}

// Lundi 2 mars → dimanche 8 mars 2026. Sept jours, une semaine civile pleine,
// très loin du 13/07 → 31/08.
const SPRINT = fenetre("2026-03-02", "2026-03-08");
const JOURS_SPRINT = [
  "2026-03-02", "2026-03-03", "2026-03-04",
  "2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08",
];

describe("computeStats", () => {
  it("ne compte que les jours écoulés de la ligue", () => {
    onEstLe("2026-03-04"); // 3e jour du sprint
    const s = computeStats(LEO.id, parfaitSur(JOURS_SPRINT), SPRINT);
    // Trois jours écoulés, tous parfaits — et pas 50 jours dont 47 à zéro.
    expect(s.perfectDays).toBe(3);
    expect(s.completion).toBe(100);
    expect(s.streak).toBe(3);
    expect(s.zeroDays).toBe(0);
  });

  it("sans fenêtre, garde le comportement du challenge d'origine", () => {
    onEstLe("2026-07-28");
    const entries = parfaitSur(["2026-07-27", "2026-07-28"]);
    expect(computeStats(LEO.id, entries)).toEqual(
      computeStats(LEO.id, entries, FENETRE_ENV),
    );
  });
});

describe("groupTimeline", () => {
  it("rend une case par jour de la ligue, pas 50", () => {
    onEstLe("2026-03-08");
    const cells = groupTimeline([LEO], parfaitSur(JOURS_SPRINT), SPRINT);
    expect(cells).toHaveLength(7);
    expect(cells[0].day).toBe("2026-03-02");
    expect(cells[6].day).toBe("2026-03-08");
    expect(cells.every((c) => c.perfect === 1)).toBe(true);
  });
});

describe("buildWeekShare", () => {
  it("remplit la grille d'une ligue de mars, au lieu de sept cases blanches", () => {
    onEstLe("2026-03-04"); // mercredi
    const msg = buildWeekShare(
      LEO, parfaitSur(JOURS_SPRINT), null, undefined, null, SPRINT,
    );
    // Lundi, mardi, mercredi joués et parfaits ; le reste est à venir.
    expect(msg).toContain("🟩 🟩 🟩 ⬜ ⬜ ⬜ ⬜");
    expect(msg).toContain("3/3 jours parfaits");
    expect(msg).toContain("Semaine du 2 mars");
    expect(msg).toContain("Plus que 5 jours"); // du 4 au 8 inclus
  });

  it("aurait tout laissé blanc avec la fenêtre du challenge d'origine", () => {
    // Le bug, montré plutôt que raconté : mêmes données, fenêtre par défaut.
    onEstLe("2026-03-04");
    const msg = buildWeekShare(LEO, parfaitSur(JOURS_SPRINT));
    expect(msg).toContain("⬜ ⬜ ⬜ ⬜ ⬜ ⬜ ⬜");
  });

  it("annonce la fin quand la ligue est terminée", () => {
    onEstLe("2026-03-09");
    const msg = buildWeekShare(
      LEO, parfaitSur(JOURS_SPRINT), null, undefined, null, SPRINT,
    );
    expect(msg).toContain("Challenge terminé 🏁");
  });
});

describe("buildFinalShare", () => {
  const rows = [
    { player_id: "leo", points: 42, rank: 1, perfect_days: 7, exos_done: 21,
      current_streak: 7, bonus_points: 0 },
  ];

  it("titre le bilan avec les dates de la ligue", () => {
    onEstLe("2026-03-09");
    const msg = buildFinalShare([LEO], rows, parfaitSur(JOURS_SPRINT), SPRINT);
    expect(msg).toContain("2 mars → 8 mars · 7 jours");
    expect(msg).not.toContain("50 jours");
  });

  it("sans fenêtre, titre toujours avec le challenge d'origine", () => {
    onEstLe("2026-09-01");
    const msg = buildFinalShare([LEO], rows, parfaitSur(JOURS_SPRINT));
    expect(msg).toContain("13 juillet → 31 août · 50 jours");
  });
});

describe("duelsFrom", () => {
  it("place le premier appariement au lundi de la 2e semaine de la ligue", () => {
    expect(duelsFrom(SPRINT)).toBe("2026-03-09");
  });

  it("garde la valeur historique par défaut", () => {
    expect(duelsFrom()).toBe(DUELS_FROM);
    expect(DUELS_FROM).toBe("2026-07-20");
  });

  it("tombe hors ligue sur un sprint d'une semaine — donc aucun duel", () => {
    // Ce n'est pas un bug : il faut une semaine pleine APRÈS la première pour
    // apparier sur un classement. Une ligue d'une semaine n'en a pas.
    expect(duelsFrom(SPRINT) > SPRINT.end).toBe(true);
  });
});
