// Un seul déplacement par jour : 5 km, 10 km ou 10 000 pas.
//
// La règle vit dans movementLocked() et nulle part ailleurs — le composant
// ne fait que l'appeler. C'est donc ici qu'on la tient, et ces tests sont
// le filet de la release S3 : ils doivent tomber si quelqu'un rouvre le
// cumul, déplace la borne du 27/07, ou casse l'isolation entre joueurs.
//
// L'horloge est fausse mais le chemin est vrai : on avance la date système
// plutôt que de poser NEXT_PUBLIC_SIM_DATE, pour que parisToday() fasse son
// vrai travail de conversion de fuseau. Un test qui court-circuite la
// fonction qu'il teste ne prouve rien.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BonusCatalogItem, BonusState, movementLocked } from "../lib/bonus";

const MOI = "jordan";
const AUTRE = "doren";

/** Le catalogue d'exercices, réduit à ce dont ces tests ont besoin.
    Les valeurs sont celles de migration29 : le 10 km est une puce
    entière à +20, hors échelle, pas le palier haut du 5 km. */
const CATALOGUE: BonusCatalogItem[] = [
  { key: "pompes_50", kind: "exercise", emoji: "💪", label: "+50 pompes", points: 4, sort: 1, ladder: "pompes" , family: null },
  { key: "pompes_100", kind: "exercise", emoji: "💪", label: "+100 pompes", points: 7, sort: 2, ladder: "pompes" , family: null },
  { key: "course_5km", kind: "exercise", emoji: "🏃", label: "5 km de course", points: 8, sort: 7, ladder: null , family: null },
  { key: "course_10km", kind: "exercise", emoji: "🏃", label: "10 km de course", points: 20, sort: 8, ladder: null , family: null },
  { key: "gainage_3min", kind: "exercise", emoji: "🧱", label: "3 min de gainage", points: 3, sort: 9, ladder: null , family: null },
  { key: "marches_500", kind: "exercise", emoji: "🪜", label: "500 marches", points: 5, sort: 10, ladder: null , family: null },
  { key: "pas_10000", kind: "exercise", emoji: "🚶", label: "10 000 pas", points: 4, sort: 17, ladder: null , family: null },
];

/** Le catalogue de la prod avant que migration29 soit appliquée : pas de
    10 km. La règle doit tenir quand même — la preview tape sur la base
    réelle, et le 5 km y est seul jusqu'à lundi. */
const CATALOGUE_AVANT_M29 = CATALOGUE.filter((c) => c.key !== "course_10km");

function etat(
  claims: Array<[joueur: string, cle: string]>,
  catalog: BonusCatalogItem[] = CATALOGUE,
): BonusState {
  return {
    catalog,
    event: null,
    todayClaims: claims.map(([player_id, bonus_key]) => ({
      player_id,
      bonus_key,
      day: "2026-07-27",
      points: 0,
    })),
    weekClaims: [],
  };
}

/** La puce `cle` est-elle fermée pour moi, vu ce qui est déclaré ? */
function ferme(
  state: BonusState,
  cle: string,
  joueur: string = MOI,
): boolean {
  const item = state.catalog.find((c) => c.key === cle);
  if (!item) throw new Error(`Puce absente du catalogue de test : ${cle}`);
  return movementLocked(state, joueur, item);
}

/** Pose l'horloge à midi (Paris) du jour demandé. */
function onEstLe(jour: string) {
  vi.setSystemTime(new Date(`${jour}T10:00:00Z`)); // 12h à Paris en été
}

beforeEach(() => {
  vi.useFakeTimers();
  onEstLe("2026-07-27");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("les trois puces de déplacement s'excluent", () => {
  it("ne ferme rien tant que rien n'est déclaré", () => {
    const s = etat([]);
    expect(ferme(s, "course_5km")).toBe(false);
    expect(ferme(s, "course_10km")).toBe(false);
    expect(ferme(s, "pas_10000")).toBe(false);
  });

  it("le 5 km ferme le 10 km et les 10 000 pas", () => {
    const s = etat([[MOI, "course_5km"]]);
    expect(ferme(s, "course_10km")).toBe(true);
    expect(ferme(s, "pas_10000")).toBe(true);
  });

  it("le 10 km ferme le 5 km et les 10 000 pas", () => {
    const s = etat([[MOI, "course_10km"]]);
    expect(ferme(s, "course_5km")).toBe(true);
    expect(ferme(s, "pas_10000")).toBe(true);
  });

  it("les 10 000 pas ferment les deux distances de course", () => {
    const s = etat([[MOI, "pas_10000"]]);
    expect(ferme(s, "course_5km")).toBe(true);
    expect(ferme(s, "course_10km")).toBe(true);
  });

  it("ne ferme jamais la puce déjà déclarée : on peut toujours se décocher", () => {
    // Le composant tranche avant d'appeler la règle (off = !claimed && …),
    // mais la règle elle-même ne doit pas piéger sa propre déclaration :
    // sinon un changement d'avis coûterait un jour entier.
    expect(ferme(etat([[MOI, "course_10km"]]), "course_10km")).toBe(false);
    expect(ferme(etat([[MOI, "pas_10000"]]), "pas_10000")).toBe(false);
  });

  it("empêche qu'un 10 km se paie 28 points", () => {
    // 20 + 8 : c'est précisément ce que la règle existe pour interdire.
    const s = etat([[MOI, "course_10km"]]);
    expect(ferme(s, "course_5km")).toBe(true);
  });
});

describe("le reste du catalogue n'est pas concerné", () => {
  it("laisse ouverts les exos qui n'ont rien à voir", () => {
    const s = etat([[MOI, "course_5km"]]);
    for (const cle of ["pompes_50", "pompes_100", "gainage_3min", "marches_500"]) {
      expect(ferme(s, cle), cle).toBe(false);
    }
  });

  it("ne prend pas les 500 marches pour de la marche", () => {
    // Des étages, pas des kilomètres : rien n'est payé deux fois.
    expect(ferme(etat([[MOI, "marches_500"]]), "pas_10000")).toBe(false);
    expect(ferme(etat([[MOI, "pas_10000"]]), "marches_500")).toBe(false);
  });

  it("laisse les paliers d'une même échelle se cumuler (migration 22)", () => {
    expect(ferme(etat([[MOI, "pompes_50"]]), "pompes_100")).toBe(false);
    expect(ferme(etat([[MOI, "pompes_100"]]), "pompes_50")).toBe(false);
  });
});

describe("la borne du 27/07", () => {
  it("dort la veille : la S2 finit sous ses propres règles", () => {
    onEstLe("2026-07-26");
    const s = etat([[MOI, "course_5km"]]);
    expect(ferme(s, "pas_10000")).toBe(false);
    expect(ferme(s, "course_10km")).toBe(false);
  });

  it("s'allume à minuit (Paris), pas à minuit UTC", () => {
    // 26/07 23h30 UTC = 27/07 01h30 à Paris. La règle doit être active :
    // c'est la conversion de fuseau de parisToday() qui est testée ici.
    vi.setSystemTime(new Date("2026-07-26T23:30:00Z"));
    expect(ferme(etat([[MOI, "course_5km"]]), "pas_10000")).toBe(true);

    // ...et 26/07 21h00 UTC = 26/07 23h00 à Paris : encore la veille.
    vi.setSystemTime(new Date("2026-07-26T21:00:00Z"));
    expect(ferme(etat([[MOI, "course_5km"]]), "pas_10000")).toBe(false);
  });

  it("tient jusqu'au dernier jour du challenge", () => {
    onEstLe("2026-08-31");
    expect(ferme(etat([[MOI, "course_5km"]]), "pas_10000")).toBe(true);
  });
});

describe("l'isolation entre joueurs", () => {
  it("ne ferme rien chez moi quand c'est un autre qui a couru", () => {
    // todayClaims porte les déclarations de tout le groupe : c'est
    // l'anti-triche. La règle doit filtrer sur le joueur, pas sur le jour.
    const s = etat([[AUTRE, "course_5km"]]);
    expect(ferme(s, "pas_10000")).toBe(false);
    expect(ferme(s, "course_10km")).toBe(false);
  });

  it("ferme quand même chez moi si j'ai couru, peu importe les autres", () => {
    const s = etat([
      [MOI, "course_5km"],
      [AUTRE, "pas_10000"],
    ]);
    expect(ferme(s, "pas_10000")).toBe(true);
    expect(ferme(s, "pas_10000", AUTRE)).toBe(false); // lui n'a pas couru
  });
});

describe("avant que migration29 soit appliquée", () => {
  it("tient sur le 5 km seul, sans le 10 km au catalogue", () => {
    // Le repère est le préfixe de clé, pas la colonne ladder : la règle
    // ne dépend donc pas de l'ordre entre le déploiement et la migration.
    const s = etat([[MOI, "course_5km"]], CATALOGUE_AVANT_M29);
    expect(ferme(s, "pas_10000")).toBe(true);

    const t = etat([[MOI, "pas_10000"]], CATALOGUE_AVANT_M29);
    expect(ferme(t, "course_5km")).toBe(true);
  });
});
