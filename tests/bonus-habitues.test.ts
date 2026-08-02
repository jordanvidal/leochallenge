// Les habitués : le chemin court de la feuille de déclaration.
//
// La feuille ouvre sur ce que le joueur déclare vraiment — ses 7 derniers
// jours, déjà chargés pour le plafond hebdo. Ces tests tiennent les trois
// propriétés qui font que le raccourci est un raccourci :
//   · le plus fréquent d'abord, le plus récent en départage
//   · seulement SES déclarations, et seulement des bonus déclarables
//   · au plus `max` puces — c'est un raccourci, pas un second catalogue

import { describe, expect, it } from "vitest";
import {
  BonusCatalogItem,
  BonusClaim,
  BonusState,
  frequentClaimables,
} from "../lib/bonus";

const MOI = "jordan";
const LEO = "leo";

const c = (key: string, kind: "exercise" | "event" = "exercise"): BonusCatalogItem => ({
  key,
  kind,
  emoji: "🔸",
  label: key,
  points: 4,
  sort: 0,
  ladder: null,
  family: null,
});

const CATALOGUE = [
  c("pas_10000"),
  c("gainage_3min"),
  c("pompes_50"),
  c("corde_10min"),
  c("burpees_30"),
  c("fentes_100"),
  c("boss_dimanche", "event"),
];

const claim = (
  player_id: string,
  day: string,
  bonus_key: string,
): BonusClaim => ({ player_id, day, bonus_key, points: 4 });

function etat(weekClaims: BonusClaim[]): BonusState {
  return { catalog: CATALOGUE, event: null, todayClaims: [], weekClaims };
}

describe("les habitués", () => {
  it("classe le plus fréquent d'abord, le plus récent en départage", () => {
    const state = etat([
      claim(MOI, "2026-07-27", "gainage_3min"),
      claim(MOI, "2026-07-28", "gainage_3min"),
      claim(MOI, "2026-07-28", "pas_10000"),
      claim(MOI, "2026-07-30", "pompes_50"),
    ]);
    expect(frequentClaimables(state, MOI).map((i) => i.key)).toEqual([
      "gainage_3min", // 2 fois
      "pompes_50", // 1 fois, le 30
      "pas_10000", // 1 fois, le 28
    ]);
  });

  it("ignore les déclarations des autres et les bonus non déclarables", () => {
    const state = etat([
      claim(LEO, "2026-07-28", "corde_10min"),
      claim(MOI, "2026-07-28", "boss_dimanche"), // un événement, pas une puce
      claim(MOI, "2026-07-29", "burpees_30"),
      claim(MOI, "2026-07-29", "inconnu_supprime"), // plus au catalogue
    ]);
    expect(frequentClaimables(state, MOI).map((i) => i.key)).toEqual([
      "burpees_30",
    ]);
  });

  it("rend au plus `max` puces, et rien sans historique", () => {
    const state = etat([
      claim(MOI, "2026-07-28", "pas_10000"),
      claim(MOI, "2026-07-28", "gainage_3min"),
      claim(MOI, "2026-07-28", "pompes_50"),
      claim(MOI, "2026-07-28", "corde_10min"),
      claim(MOI, "2026-07-28", "burpees_30"),
      claim(MOI, "2026-07-28", "fentes_100"),
    ]);
    expect(frequentClaimables(state, MOI)).toHaveLength(5);
    expect(frequentClaimables(state, MOI, 3)).toHaveLength(3);
    expect(frequentClaimables(etat([]), MOI)).toEqual([]);
  });
});
