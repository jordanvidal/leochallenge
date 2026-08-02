// Le barème par saison : le moteur est paramétré par le jour et la
// fenêtre, jamais par des constantes éparpillées. Les bascules testées
// ici sont celles du challenge d'origine (S3 le 27/07, S4 le 03/08) et
// leur absence sur une ligue neuve — qui naît en S3 pur et y reste
// (son schéma n'a ni jours_off ni les événements S4).

import { describe, expect, it } from "vitest";
import { fenetre, FENETRE_ENV } from "@/lib/challenge";
import { baremeDe, multiplicateurSerie, saisonDe } from "@/lib/score";

describe("saisonDe — le challenge d'origine", () => {
  it("est en S1/S2 avant le 27/07", () => {
    expect(saisonDe("2026-07-13", FENETRE_ENV)).toBe("S1S2");
    expect(saisonDe("2026-07-26", FENETRE_ENV)).toBe("S1S2");
  });

  it("bascule en S3 le 27/07, jour de bascule inclus", () => {
    expect(saisonDe("2026-07-27", FENETRE_ENV)).toBe("S3");
    expect(saisonDe("2026-08-02", FENETRE_ENV)).toBe("S3");
  });

  it("bascule en S4 le 03/08, jour de bascule inclus", () => {
    expect(saisonDe("2026-08-03", FENETRE_ENV)).toBe("S4");
    expect(saisonDe("2026-08-31", FENETRE_ENV)).toBe("S4");
  });
});

describe("saisonDe — une ligue neuve", () => {
  // fenetre(start, end) cale sa saison 3 sur son premier jour : pas de
  // bascule en cours de route, donc jamais de S4 — même après le 03/08.
  const ligue = fenetre("2026-08-01", "2026-09-15");

  it("est en S3 pur du premier au dernier jour", () => {
    expect(saisonDe("2026-08-01", ligue)).toBe("S3");
    expect(saisonDe("2026-08-03", ligue)).toBe("S3");
    expect(saisonDe("2026-09-15", ligue)).toBe("S3");
  });

  it("n'a pas de jour off, même après le 03/08", () => {
    expect(baremeDe("2026-08-10", ligue).jourOffActif).toBe(false);
  });
});

describe("baremeDe — les valeurs de la base du jour", () => {
  it("paie la journée parfaite +2 avant la S3, +4 ensuite", () => {
    // Miroir du `case when day >= '2026-07-27' then 4 else 2` de la vue.
    expect(baremeDe("2026-07-26", FENETRE_ENV).primeJourParfait).toBe(2);
    expect(baremeDe("2026-07-27", FENETRE_ENV).primeJourParfait).toBe(4);
    expect(baremeDe("2026-08-03", FENETRE_ENV).primeJourParfait).toBe(4);
  });

  it("garde 1 point par exo et les seuils ×1,5 / ×2 sur toutes les saisons", () => {
    for (const day of ["2026-07-13", "2026-07-27", "2026-08-03"]) {
      const b = baremeDe(day, FENETRE_ENV);
      expect(b.pointParExo).toBe(1);
      expect(b.seuilMult15).toBe(3);
      expect(b.seuilMult2).toBe(7);
    }
  });

  it("n'active le jour off qu'en S4", () => {
    expect(baremeDe("2026-08-02", FENETRE_ENV).jourOffActif).toBe(false);
    expect(baremeDe("2026-08-03", FENETRE_ENV).jourOffActif).toBe(true);
  });
});

describe("multiplicateurSerie", () => {
  it("×1 avant 3 jours parfaits consécutifs", () => {
    expect(multiplicateurSerie(0)).toBe(1);
    expect(multiplicateurSerie(1)).toBe(1);
    expect(multiplicateurSerie(2)).toBe(1);
  });

  it("×1,5 de 3 à 6 jours", () => {
    expect(multiplicateurSerie(3)).toBe(1.5);
    expect(multiplicateurSerie(6)).toBe(1.5);
  });

  it("×2 dès 7 jours — et ça ne monte plus", () => {
    expect(multiplicateurSerie(7)).toBe(2);
    expect(multiplicateurSerie(30)).toBe(2);
  });
});
