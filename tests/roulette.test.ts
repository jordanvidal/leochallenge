// La roulette des points de l'écran de fin.
//
// Un motif de vibration mal formé ne se voit pas : navigator.vibrate()
// avale un tableau invalide sans rien dire, et l'écran ne se revoit qu'à
// la séance suivante. Ces tests tiennent les trois propriétés qui font
// qu'une roulette est une roulette :
//   · le chiffre part de 0 et arrive pile sur sa valeur
//   · les crans ralentissent — écarts strictement croissants
//   · le motif reste lisible par navigator.vibrate() dans tous les cas

import { describe, expect, it } from "vitest";
import {
  CRANS_MAX,
  courbe,
  crans,
  IMPULSION_MS,
  motifHaptique,
  ROULETTE_MS,
} from "../lib/roulette";

describe("courbe", () => {
  it("part de 0 et arrive à 1", () => {
    expect(courbe(0)).toBe(0);
    expect(courbe(1)).toBe(1);
  });

  it("est une sortie : plus de la moitié du chemin à la moitié du temps", () => {
    expect(courbe(0.5)).toBeGreaterThan(0.5);
  });

  it("borne les instants hors course plutôt que de les extrapoler", () => {
    // Une frame en retard donnerait t > 1 et un chiffre au-dessus de la
    // valeur serveur — un point de plus que ce qui est en base.
    expect(courbe(1.4)).toBe(1);
    expect(courbe(-0.2)).toBe(0);
  });
});

describe("crans", () => {
  it("pose un cran par point entier", () => {
    expect(crans(9)).toHaveLength(9);
  });

  it("plafonne — au-delà la main n'entend qu'un buzz", () => {
    expect(crans(40)).toHaveLength(CRANS_MAX);
  });

  it("garde une secousse d'arrivée même sous le point entier", () => {
    expect(crans(0.5)).toHaveLength(1);
  });

  it("ne pose rien quand il n'y a rien à compter", () => {
    expect(crans(0)).toEqual([]);
    expect(crans(-3)).toEqual([]);
  });

  it("fait tomber le dernier cran avec le chiffre", () => {
    const c = crans(9);
    expect(c[c.length - 1]).toBeCloseTo(ROULETTE_MS, 6);
  });

  it("ralentit : les écarts sont strictement croissants", () => {
    const c = crans(9);
    const ecarts = c.map((t, i) => t - (c[i - 1] ?? 0));
    for (let i = 1; i < ecarts.length; i++) {
      expect(ecarts[i]).toBeGreaterThan(ecarts[i - 1]);
    }
  });
});

describe("motifHaptique", () => {
  it("ouvre sur une impulsion nulle — un motif commence par une vibration", () => {
    const motif = motifHaptique(crans(9));
    expect(motif[0]).toBe(0);
    expect(motif[1]).toBeGreaterThan(0);
  });

  it("compte une impulsion par cran", () => {
    const motif = motifHaptique(crans(9));
    const impulsions = motif.filter((v) => v === IMPULSION_MS);
    expect(impulsions).toHaveLength(9);
  });

  it("n'émet que des entiers positifs — le reste est ignoré par l'API", () => {
    for (const valeur of [0.5, 1, 4.5, 9, 12.5, 40]) {
      for (const v of motifHaptique(crans(valeur))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("tient dans la durée du défilé", () => {
    const total = motifHaptique(crans(9)).reduce((s, v) => s + v, 0);
    expect(total).toBeLessThanOrEqual(ROULETTE_MS + IMPULSION_MS);
  });

  it("rend un motif vide quand il n'y a pas de crans", () => {
    expect(motifHaptique([])).toEqual([]);
  });

  it("colle deux crans trop serrés plutôt que de décaler la suite", () => {
    // 12 crans sur 900 ms : les premiers sont à quelques ms l'un de
    // l'autre, sous la longueur d'une impulsion.
    const motif = motifHaptique(crans(CRANS_MAX));
    expect(motif.some((v) => v === 0)).toBe(true);
    expect(motif.every((v) => v >= 0)).toBe(true);
  });
});
