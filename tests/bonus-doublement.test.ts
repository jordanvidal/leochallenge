// Ce que la feuille de déclaration promet pour un ×2, et ce que le rang
// « Déclarer un bonus » annonce en dessous, doivent être le même chiffre.
//
// La promesse est vérifiable : migration33 ajoute les points des puces
// doublées une seconde fois, hors multiplicateur de série. Le facteur est
// donc exactement 2, et ces tests tiennent ce 2. Si un jour la base passe
// à autre chose (un ×1,5, un doublement qui suit la série), ils tombent —
// et c'est exactement ce qu'on veut : une puce qui affiche « +2 » quand
// elle en rapporte 1,5 est un mensonge affiché à six personnes.

import { describe, expect, it } from "vitest";
import {
  BonusCatalogItem,
  BonusState,
  pointsToday,
  todayClaimPoints,
} from "../lib/bonus";

const MOI = "jordan";
const AUTRE = "doren";

const SQUATS_100: BonusCatalogItem = {
  key: "squats_100",
  kind: "exercise",
  emoji: "🦵",
  label: "+100 squats",
  points: 5,
  sort: 5,
  ladder: "squats",
  family: "jambes",
  double_event: "squats_double",
};

const POMPES_50: BonusCatalogItem = {
  key: "pompes_50",
  kind: "exercise",
  emoji: "💪",
  label: "+50 pompes",
  points: 4,
  sort: 1,
  ladder: "pompes",
  family: "haut",
  double_event: "pompes_double",
};

/** Hors doublement : aucun tirage ne la nomme. */
const GAINAGE: BonusCatalogItem = {
  key: "gainage_3min",
  kind: "exercise",
  emoji: "🧱",
  label: "3 min de gainage",
  points: 3,
  sort: 9,
  ladder: null,
  family: "abdos",
  double_event: null,
};

const TIRAGE_SQUATS: BonusCatalogItem = {
  key: "squats_double",
  kind: "event",
  emoji: "🎲",
  label: "Les squats comptent double",
  points: 1,
  sort: 40,
  ladder: null,
  family: null,
  double_event: null,
};

function etat(
  event: BonusCatalogItem | null,
  claims: Array<[joueur: string, item: BonusCatalogItem]> = [],
): BonusState {
  return {
    catalog: [SQUATS_100, POMPES_50, GAINAGE, TIRAGE_SQUATS],
    event,
    todayClaims: claims.map(([player_id, item]) => ({
      player_id,
      bonus_key: item.key,
      day: "2026-07-27",
      // La base fige les points du catalogue dans la déclaration : le
      // doublement n'y est pas, il vit dans le calcul du score.
      points: item.points,
    })),
    weekClaims: [],
  };
}

describe("ce qu'une puce rapporte aujourd'hui", () => {
  it("double la puce que le tirage du jour nomme", () => {
    expect(pointsToday(etat(TIRAGE_SQUATS), SQUATS_100)).toBe(10);
  });

  it("laisse les autres puces à leur valeur de catalogue", () => {
    const state = etat(TIRAGE_SQUATS);
    expect(pointsToday(state, POMPES_50)).toBe(4);
    expect(pointsToday(state, GAINAGE)).toBe(3);
  });

  it("ne double rien les jours sans tirage", () => {
    expect(pointsToday(etat(null), SQUATS_100)).toBe(5);
  });
});

describe("le total du rang « Déclarer un bonus »", () => {
  it("compte le double des puces doublées", () => {
    const state = etat(TIRAGE_SQUATS, [
      [MOI, SQUATS_100],
      [MOI, GAINAGE],
    ]);
    expect(todayClaimPoints(state, MOI)).toBe(13); // 5×2 + 3
  });

  it("ne compte que les déclarations du joueur", () => {
    const state = etat(TIRAGE_SQUATS, [
      [MOI, GAINAGE],
      [AUTRE, SQUATS_100],
    ]);
    expect(todayClaimPoints(state, MOI)).toBe(3);
  });

  it("retombe sur la somme brute sans tirage", () => {
    const state = etat(null, [
      [MOI, SQUATS_100],
      [MOI, GAINAGE],
    ]);
    expect(todayClaimPoints(state, MOI)).toBe(8);
  });

  it("survit à une déclaration dont la puce a quitté le catalogue", () => {
    // Une puce retirée du catalogue laisse ses déclarations en base : le
    // total doit rester juste plutôt que de sauter une ligne.
    const state = etat(TIRAGE_SQUATS, [[MOI, GAINAGE]]);
    state.catalog = state.catalog.filter((c) => c.key !== GAINAGE.key);
    expect(todayClaimPoints(state, MOI)).toBe(3);
  });
});
