// Les seuils des badges suivent la durée de la ligue. Ce fichier tient la
// table complète, et surtout sa dernière ligne : à 50 jours — le challenge
// d'origine — les formules doivent redonner EXACTEMENT 7 / 14 / 30 / 100, les
// valeurs qui ont toujours été affichées. Si elles dérivent d'une unité, le
// groupe verrait ses badges changer le jour de sa migration.
//
// Ce n'est pas un test théorique : écrites en `0.14 * n`, les formules donnent
// 8 et 15 à n = 50, parce que 0.14 × 50 vaut 7.000000000000001 en flottant.
// D'où l'arithmétique entière dans seuilsBadges(), et d'où ce test.
//
// L'autre moitié du filet est côté base : `supabase/tests/badges-proportionnels.sql`
// vérifie la même table sur `app.player_badges`. Les deux doivent s'accorder,
// sinon l'app promet un seuil que Postgres n'applique pas.

import { describe, expect, it } from "vitest";
import { BADGES, badgesFor, seuilsBadges } from "../lib/gamification";

// N → [première semaine, machine, increvable, centurion]
const TABLE: [number, number, number, number, number][] = [
  [7, 3, 3, 5, 14],
  [14, 3, 4, 9, 28],
  [21, 3, 6, 13, 42],
  [28, 4, 8, 17, 56],
  [35, 5, 10, 21, 70],
  [42, 6, 12, 26, 84],
  [50, 7, 14, 30, 100], // les valeurs d'aujourd'hui — celles qui ne doivent pas bouger
];

describe("seuilsBadges", () => {
  it.each(TABLE)(
    "sur %i jours : %i / %i / %i jours parfaits, %i exercices",
    (n, premiere, machine, increvable, centurion) => {
      expect(seuilsBadges(n)).toEqual({
        premiereSemaine: premiere,
        machine,
        increvable,
        centurion,
      });
    },
  );

  it("ne descend jamais sous 3 jours parfaits, même sur une ligue d'une semaine", () => {
    for (let n = 1; n <= 7; n++) {
      const s = seuilsBadges(n);
      expect(s.premiereSemaine).toBeGreaterThanOrEqual(3);
      expect(s.machine).toBeGreaterThanOrEqual(3);
      expect(s.increvable).toBeGreaterThanOrEqual(3);
    }
  });

  it("garde les seuils dans l'ordre : première semaine ≤ machine ≤ increvable", () => {
    for (let n = 1; n <= 60; n++) {
      const s = seuilsBadges(n);
      expect(s.premiereSemaine).toBeLessThanOrEqual(s.machine);
      expect(s.machine).toBeLessThanOrEqual(s.increvable);
    }
  });

  it("garde increvable atteignable : jamais plus long que la ligue", () => {
    for (let n = 3; n <= 60; n++) {
      expect(seuilsBadges(n).increvable).toBeLessThanOrEqual(n);
    }
  });

  it("garde centurion atteignable : 3 exercices par jour suffisent", () => {
    for (let n = 1; n <= 60; n++) {
      expect(seuilsBadges(n).centurion).toBeLessThanOrEqual(3 * n);
    }
  });
});

describe("badgesFor", () => {
  it("affiche les libellés historiques sur le challenge d'origine", () => {
    const parHint = new Map(badgesFor(50, "2026-08-31").map((b) => [b.key, b.hint]));
    expect(parHint.get("premiere_semaine")).toBe("7 jours parfaits d'affilée");
    expect(parHint.get("machine")).toBe("14 jours parfaits d'affilée");
    expect(parHint.get("increvable")).toBe("30 jours parfaits d'affilée");
    expect(parHint.get("centurion")).toBe("100 exercices validés au total");
    expect(parHint.get("finisseur")).toBe("Les 3 exos validés le 31 août");
  });

  // Le test qui compte vraiment : BADGES est ce que les écrans affichent
  // aujourd'hui, calculé depuis les constantes d'env réelles. Le tableau attendu
  // est celui d'avant le passage au proportionnel, recopié à l'identique.
  it("laisse le catalogue affiché rigoureusement inchangé", () => {
    expect(BADGES).toEqual([
      { key: "premiere_semaine", emoji: "🌱", label: "Première semaine", hint: "7 jours parfaits d'affilée" },
      { key: "machine", emoji: "⚙️", label: "Machine", hint: "14 jours parfaits d'affilée" },
      { key: "increvable", emoji: "🛡️", label: "Increvable", hint: "30 jours parfaits d'affilée" },
      { key: "sans_faute", emoji: "💎", label: "Sans faute", hint: "Aucun jour raté depuis le début" },
      { key: "retour_de_flamme", emoji: "🔥", label: "Retour de flamme", hint: "Reprendre une série de 5+ après l'avoir cassée" },
      { key: "premier_de_la_classe", emoji: "👑", label: "Premier de la classe", hint: "N°1 pendant 7 jours consécutifs" },
      { key: "finisseur", emoji: "🏁", label: "Le finisseur", hint: "Les 3 exos validés le 31 août" },
      { key: "centurion", emoji: "🏛️", label: "Centurion", hint: "100 exercices validés au total" },
    ]);
  });

  it("garde les huit badges, dans le même ordre, quelle que soit la durée", () => {
    const cles = (n: number) => badgesFor(n, "2026-03-08").map((b) => b.key);
    expect(cles(7)).toEqual(cles(50));
    expect(cles(7)).toHaveLength(8);
  });
});
