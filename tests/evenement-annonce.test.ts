// Ce que le tirage du jour annonce, sur tous les écrans à la fois.
//
// Le badge et la consigne vivaient recopiés dans trois composants. La
// copie a fini par diverger : `bonus_doubles` (S4, au pluriel, 0 point au
// catalogue parce que son montant est la somme des puces du jour) passait
// à travers un `endsWith("_double")` et s'annonçait « +0 » au groupe.
// Ces tests tiennent la règle : un tirage qui multiplie dit ×2, un tirage
// qui paie dit son montant, et personne n'annonce zéro.

import { describe, expect, it } from "vitest";
import {
  badgeEvenement,
  BonusCatalogItem,
  consigneEvenement,
  estDoublement,
} from "../lib/bonus";

const ev = (
  key: string,
  points: number,
  label = "Un tirage : sa description",
): BonusCatalogItem =>
  ({
    key,
    kind: "event",
    emoji: "🎲",
    label,
    points,
    sort: 0,
  }) as BonusCatalogItem;

/** Les clés tirables connues de l'app, et ce qu'elles doivent annoncer.
    Le point du catalogue des multiplicateurs (1, ou 0 pour les tirages
    dont le gain se calcule ailleurs) est un rouage interne : jamais une
    promesse affichée. */
const MULTIPLICATEURS = [
  ev("pompes_double", 1),
  ev("abdos_double", 1),
  ev("squats_double", 1),
  ev("quitte_ou_double", 1),
  ev("bonus_doubles", 0), // le pluriel : c'est lui qui annonçait « +0 »
];

const FORFAITS = [ev("happy_hour", 3), ev("leve_tot", 3), ev("jour_de_fete", 5)];

describe("le badge du tirage du jour", () => {
  it("dit ×2 pour tout ce qui multiplie, singulier comme pluriel", () => {
    for (const e of MULTIPLICATEURS) {
      expect(estDoublement(e)).toBe(true);
      expect(badgeEvenement(e)).toBe("×2");
    }
  });

  it("dit le montant pour ce qui paie un forfait", () => {
    for (const e of FORFAITS) {
      expect(estDoublement(e)).toBe(false);
      expect(badgeEvenement(e)).toBe(`+${e.points}`);
    }
  });

  it("ne dit rien plutôt que « +0 » quand le tirage ne paie pas le joueur", () => {
    // Le jour miroir paie le dernier du classement, pas celui qui lit.
    expect(badgeEvenement(ev("jour_miroir", 0))).toBeNull();
  });

  it("n'annonce jamais un montant nul", () => {
    for (const e of [...MULTIPLICATEURS, ...FORFAITS]) {
      expect(badgeEvenement(e)).not.toBe("+0");
    }
  });
});

describe("la consigne du tirage du jour", () => {
  const CLES = [
    "pompes_double",
    "abdos_double",
    "squats_double",
    "happy_hour",
    "leve_tot",
    "quitte_ou_double",
    "jour_miroir",
    "boss_dimanche",
    "bonus_doubles",
    "jour_de_fete",
  ];

  it("tient dans les deux lignes du bandeau de l'accueil", () => {
    // La première phrase est la seule que le bandeau montre, dans une
    // boîte de deux lignes (`line-clamp-2`, mesurée à 375 px). Au-delà de
    // 85 caractères elle se fait rogner en plein milieu d'une règle ;
    // en dessous de 45 elle laisse un trou sous elle.
    for (const key of CLES) {
      const [court] = consigneEvenement(ev(key, 1));
      expect(court.length, key).toBeGreaterThanOrEqual(45);
      expect(court.length, key).toBeLessThanOrEqual(85);
    }
  });

  it("retombe sur le libellé du catalogue pour un tirage inconnu", () => {
    // Un événement ajouté en base avant l'app : bandeau maigre, jamais muet.
    const inconnu = ev("tirage_de_demain", 2, "Tirage de demain : à venir");
    expect(consigneEvenement(inconnu)).toEqual(["Tirage de demain : à venir"]);
  });
});
