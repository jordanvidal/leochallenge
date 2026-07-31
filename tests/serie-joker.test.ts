// La série calculée côté client doit compter comme celle du serveur.
//
// Le RPC `leaderboard` ne construit pas la série sur des jours parfaits mais
// sur des îlots de jours **conservés** — parfaits OU sauvés par le joker
// (supabase/migration38-app-scoring.sql, CTE `kept` → `islands` → `streaks`),
// et il ne numérote que les jours parfaits à l'intérieur de l'îlot.
// `computeStats` ignorait le joker : tout jour non parfait cassait la série.
// Résultat observé en prod le 31/07 : 🔥17 au Classement, « 9 j » aux Stats,
// pour le même joueur au même instant.
//
// Ces tests tiennent la règle recopiée. Fenêtre d'une semaine civile, loin du
// challenge d'origine, pour que `elapsedDays` soit déterministe.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fenetre } from "@/lib/challenge";
import { computeStats } from "@/lib/stats";
import { Entry, entryKey } from "@/lib/types";

const MOI = "hichem";
const SEMAINE = fenetre("2026-03-02", "2026-03-08");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-08T10:00:00Z")); // midi à Paris
});
afterEach(() => {
  vi.useRealTimers();
});

/** Une map d'entrées : les jours donnés sont parfaits, les autres vierges. */
function parfaits(jours: string[]): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const day of jours) {
    m.set(entryKey(MOI, day), {
      player_id: MOI,
      day,
      pushups: true,
      abs: true,
      squats: true,
    });
  }
  return m;
}

// Six jours parfaits, un trou le 05.
const AVEC_TROU = parfaits([
  "2026-03-02",
  "2026-03-03",
  "2026-03-04",
  "2026-03-06",
  "2026-03-07",
  "2026-03-08",
]);

describe("computeStats et le joker", () => {
  it("sans joker, un jour manqué casse la série", () => {
    // Le comportement d'avant, qui reste juste quand il n'y a pas de joker.
    const s = computeStats(MOI, AVEC_TROU, SEMAINE);
    expect(s.streak).toBe(3); // 06, 07, 08
    expect(s.bestStreak).toBe(3);
  });

  it("le joker pontifie le trou : la chaîne tient de bout en bout", () => {
    const s = computeStats(MOI, AVEC_TROU, SEMAINE, "2026-03-05");
    // L'îlot couvre les 7 jours, mais seuls les 6 parfaits sont numérotés —
    // exactement ce que fait `streak_pos` côté SQL.
    expect(s.streak).toBe(6);
    expect(s.bestStreak).toBe(6);
  });

  it("le jour du joker ne devient pas un jour parfait", () => {
    const s = computeStats(MOI, AVEC_TROU, SEMAINE, "2026-03-05");
    expect(s.perfectDays).toBe(6);
    // Il reste un jour à zéro : il l'est. Le joker sauve la série, il ne
    // réécrit pas l'historique — c'est pour ça que la grille le marque.
    expect(s.zeroDays).toBe(1);
  });

  it("un joker ne rattrape qu'un seul trou", () => {
    // Trous les 05 ET 06, joker sur le 05 : la chaîne casse quand même sur
    // le 06. Le joker recolle deux morceaux, il ne ressuscite pas.
    const deuxTrous = parfaits([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-07",
      "2026-03-08",
    ]);
    const s = computeStats(MOI, deuxTrous, SEMAINE, "2026-03-05");
    expect(s.streak).toBe(2); // 07, 08
    expect(s.bestStreak).toBe(3); // 02, 03, 04
  });

  it("un joker posé sur un jour parfait ne change rien", () => {
    // Cas impossible en base, mais la fonction ne doit pas compter double.
    const tousParfaits = parfaits([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    const s = computeStats(MOI, tousParfaits, SEMAINE, "2026-03-04");
    expect(s.streak).toBe(7);
    expect(s.bestStreak).toBe(7);
    expect(s.perfectDays).toBe(7);
  });

  it("le joker d'un autre joueur ne sauve pas ma série", () => {
    const s = computeStats("pierre", AVEC_TROU, SEMAINE, "2026-03-05");
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(0);
  });

  it("bestStreak ne peut plus être inférieur à la série en cours", () => {
    // L'invariant que la prod violait : une *meilleure* série plus courte que
    // la série *courante* est arithmétiquement impossible.
    for (const joker of [null, "2026-03-05"]) {
      const s = computeStats(MOI, AVEC_TROU, SEMAINE, joker);
      expect(s.bestStreak).toBeGreaterThanOrEqual(s.streak);
    }
  });
});
