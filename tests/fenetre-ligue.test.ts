// `lib/challenge.ts` ne décide plus des dates du jeu : il les reçoit.
//
// Neuf fonctions se refermaient sur CHALLENGE_START/END/DAYS. Tant qu'il n'y a
// qu'une ligue c'est invisible ; à la deuxième, `elapsedDays()` rendrait les
// jours du challenge d'origine à une ligue d'une semaine en mars, et
// `challengeWeeks()` numéroterait ses semaines depuis juillet.
//
// Ce fichier tient les deux moitiés :
//   * sans argument, chaque fonction se comporte EXACTEMENT comme avant — les
//     écrans d'aujourd'hui ne bougent pas d'un pixel ;
//   * avec une fenêtre, elles répondent sur cette fenêtre-là. C'est ce qui
//     était impossible avant.
//
// L'horloge est fausse mais le chemin est vrai : on avance la date système
// plutôt que de poser NEXT_PUBLIC_SIM_DATE, pour que parisToday() fasse son
// vrai travail de conversion de fuseau.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allChallengeDays,
  bilanProvisoire,
  CHALLENGE_DAYS,
  CHALLENGE_END,
  CHALLENGE_START,
  challengeIsOver,
  challengeWeeks,
  daysLeft,
  elapsedDays,
  fenetre,
  FENETRE_ENV,
  frenchDayMonth,
  isEditable,
  joursDeFenetre,
  saison3Started,
} from "../lib/challenge";

/** Se place à midi (Paris) le jour donné. */
function onEstLe(jour: string) {
  vi.setSystemTime(new Date(`${jour}T10:00:00Z`));
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// Une ligue courte, très loin des dates du challenge d'origine : si une
// fonction retombait sur les constantes d'env, l'écart sauterait aux yeux.
// Lundi 2 mars → dimanche 8 mars 2026, 7 jours pile.
const SPRINT = fenetre("2026-03-02", "2026-03-08");

describe("la fenêtre par défaut reste celle du challenge d'origine", () => {
  it("FENETRE_ENV reprend les constantes d'env", () => {
    expect(FENETRE_ENV).toEqual({
      start: CHALLENGE_START,
      end: CHALLENGE_END,
      saison3: "2026-07-27",
    });
    expect(joursDeFenetre(FENETRE_ENV)).toBe(CHALLENGE_DAYS);
  });

  it("appelées sans argument, les fonctions répondent comme avant", () => {
    onEstLe("2026-07-28");
    // Les mêmes valeurs qu'avec la fenêtre passée explicitement : c'est la
    // preuve que le défaut n'a pas dérivé.
    expect(daysLeft()).toBe(daysLeft(FENETRE_ENV));
    expect(elapsedDays()).toEqual(elapsedDays(FENETRE_ENV));
    expect(allChallengeDays()).toEqual(allChallengeDays(FENETRE_ENV));
    expect(challengeWeeks()).toEqual(challengeWeeks(FENETRE_ENV));
    expect(challengeIsOver()).toBe(challengeIsOver(FENETRE_ENV));
    expect(saison3Started()).toBe(saison3Started(FENETRE_ENV));
    expect(bilanProvisoire()).toBe(bilanProvisoire(FENETRE_ENV));
    expect(isEditable("2026-07-28")).toBe(isEditable("2026-07-28", FENETRE_ENV));
  });

  it("garde les repères connus du challenge d'origine", () => {
    onEstLe("2026-07-28");
    expect(CHALLENGE_DAYS).toBe(50);
    expect(allChallengeDays()).toHaveLength(50);
    expect(allChallengeDays()[0]).toBe("2026-07-13");
    expect(allChallengeDays()[49]).toBe("2026-08-31");
    expect(daysLeft()).toBe(35); // du 28/07 au 31/08 inclus
    expect(challengeIsOver()).toBe(false);
    expect(saison3Started()).toBe(true); // bascule le 27/07
  });
});

describe("une ligue d'une semaine vit sur ses propres dates", () => {
  it("compte ses jours, pas ceux du challenge d'origine", () => {
    expect(joursDeFenetre(SPRINT)).toBe(7);
    expect(allChallengeDays(SPRINT)).toEqual([
      "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05",
      "2026-03-06", "2026-03-07", "2026-03-08",
    ]);
  });

  it("ne rend que les jours écoulés de SA fenêtre", () => {
    onEstLe("2026-03-04"); // mercredi, 3e jour
    expect(elapsedDays(SPRINT)).toEqual(["2026-03-04", "2026-03-03", "2026-03-02"]);
    expect(daysLeft(SPRINT)).toBe(5); // du 4 au 8 inclus
  });

  it("est vide avant son premier jour, et finie après son dernier", () => {
    onEstLe("2026-02-28");
    expect(elapsedDays(SPRINT)).toEqual([]);
    expect(challengeIsOver(SPRINT)).toBe(false);
    expect(daysLeft(SPRINT)).toBe(7); // pas encore entamée

    onEstLe("2026-03-09");
    expect(challengeIsOver(SPRINT)).toBe(true);
    expect(daysLeft(SPRINT)).toBe(0);
    expect(elapsedDays(SPRINT)).toHaveLength(7);
  });

  it("ne laisse pas cocher après sa fin, même si le challenge d'origine tourne encore", () => {
    onEstLe("2026-03-09");
    expect(isEditable("2026-03-09", SPRINT)).toBe(false); // hors fenêtre de la ligue
    expect(isEditable("2026-03-08", SPRINT)).toBe(false); // la veille, jamais éditable
  });

  it("naît en saison 3 : sa bascule est son premier jour", () => {
    onEstLe("2026-03-02");
    expect(SPRINT.saison3).toBe("2026-03-02");
    expect(saison3Started(SPRINT)).toBe(true);
  });

  it("n'a qu'une seule semaine, bornée à ses dates", () => {
    onEstLe("2026-03-08");
    const semaines = challengeWeeks(SPRINT);
    expect(semaines).toEqual([
      { index: 1, from: "2026-03-02", until: "2026-03-08", current: true },
    ]);
  });

  it("borne la semaine quand la ligue démarre un jeudi", () => {
    // Jeudi 5 mars → mercredi 11 mars : à cheval sur deux semaines civiles.
    const cheval = fenetre("2026-03-05", "2026-03-11");
    onEstLe("2026-03-11");
    expect(challengeWeeks(cheval)).toEqual([
      // S1 tronquée : commence au jeudi, pas au lundi 2.
      { index: 1, from: "2026-03-05", until: "2026-03-08", current: false },
      // S2 tronquée : s'arrête au mercredi, pas au dimanche 15.
      { index: 2, from: "2026-03-09", until: "2026-03-11", current: true },
    ]);
  });
});

describe("fenetre()", () => {
  it("refuse une ligue à l'envers plutôt que de la corriger en douce", () => {
    expect(() => fenetre("2026-03-08", "2026-03-02")).toThrow(/à l'envers/);
  });

  it("accepte une ligue d'un seul jour", () => {
    const f = fenetre("2026-03-02", "2026-03-02");
    expect(joursDeFenetre(f)).toBe(1);
    expect(allChallengeDays(f)).toEqual(["2026-03-02"]);
  });

  it("laisse préciser une bascule de barème distincte, comme le challenge d'origine", () => {
    const f = fenetre("2026-07-13", "2026-08-31", "2026-07-27");
    expect(f).toEqual(FENETRE_ENV);
  });
});

describe("frenchDayMonth", () => {
  it("dit « 1er » et pas « 1 » pour le premier du mois", () => {
    // Intl ne fait pas l'ordinal. Une ligue qui finit un 1er l'annonce dans
    // l'aperçu WhatsApp de son lien : « du 29 juillet au 1er septembre ».
    expect(frenchDayMonth("2026-09-01")).toBe("1er septembre");
    expect(frenchDayMonth("2026-08-01")).toBe("1er août");
  });

  it("laisse les autres jours tels quels", () => {
    expect(frenchDayMonth("2026-07-29")).toBe("29 juillet");
    expect(frenchDayMonth("2026-08-31")).toBe("31 août");
    // Le 11 et le 21 commencent par « 1 » et « 2 » : pas d'ordinal pour eux.
    expect(frenchDayMonth("2026-08-11")).toBe("11 août");
  });
});
