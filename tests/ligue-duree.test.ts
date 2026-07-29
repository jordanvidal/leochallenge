// La durée d'une ligue : le « -1 » que tout le monde oublie, et la borne des
// 6 semaines qui doit tomber exactement là où le trigger SQL la met.

import { describe, expect, it } from "vitest";
import { addDays, joursDeFenetre } from "@/lib/challenge";
import {
  fenetreDeLigue,
  finDeLigue,
  semainesDeLigue,
  SEMAINES_MAX,
  SEMAINES_MIN,
  type Ligue,
} from "@/lib/ligue";

/** Une ligue de test, réduite aux colonnes qui comptent ici. */
function ligue(start_day: string, end_day: string): Ligue {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "les-potes",
    name: "Les potes",
    invite_code: "K7M2QP",
    start_day,
    end_day,
    creator_player_id: null,
    parent_league_id: null,
    created_at: `${start_day}T08:00:00Z`,
  };
}

describe("finDeLigue", () => {
  it("compte les bornes : une semaine, c'est 7 jours, pas 8", () => {
    // Lundi 2 mars → dimanche 8 mars.
    expect(finDeLigue("2026-03-02", 1)).toBe("2026-03-08");
    expect(joursDeFenetre(fenetreDeLigue(ligue("2026-03-02", "2026-03-08")))).toBe(7);
  });

  it("donne 42 jours pour six semaines", () => {
    expect(joursDeFenetre(fenetreDeLigue(ligue("2026-03-02", finDeLigue("2026-03-02", 6))))).toBe(42);
  });

  it.each([1, 2, 3, 4, 5, 6])("rend %i × 7 jours, bornes comprises", (s) => {
    const fin = finDeLigue("2026-03-02", s);
    expect(joursDeFenetre(fenetreDeLigue(ligue("2026-03-02", fin)))).toBe(s * 7);
  });

  it("tombe exactement sur la borne du trigger SQL (start_day + 41)", () => {
    // `guard_league_insert` refuse `end_day > start_day + 41`. Si cette
    // égalité casse, l'écran de création proposera une durée que la base
    // rejettera — ou refusera une durée qu'elle acceptait.
    expect(finDeLigue("2026-03-02", SEMAINES_MAX)).toBe(addDays("2026-03-02", 41));
  });

  it("traverse un changement de mois sans se tromper", () => {
    // 26 février + 1 semaine, sur une année non bissextile.
    expect(finDeLigue("2026-02-26", 1)).toBe("2026-03-04");
  });

  it("traverse un changement d'année", () => {
    expect(finDeLigue("2026-12-28", 2)).toBe("2027-01-10");
  });

  it.each([0, 7, 12, -1])("refuse une durée de %i semaines", (s) => {
    expect(() => finDeLigue("2026-03-02", s)).toThrow(/1 à 6 semaines/);
  });

  it("refuse une durée non entière", () => {
    expect(() => finDeLigue("2026-03-02", 1.5)).toThrow(/non entière/);
  });

  it("accepte les deux bornes déclarées", () => {
    expect(() => finDeLigue("2026-03-02", SEMAINES_MIN)).not.toThrow();
    expect(() => finDeLigue("2026-03-02", SEMAINES_MAX)).not.toThrow();
  });
});

describe("fenetreDeLigue", () => {
  it("cale le barème S3 sur le premier jour : une ligue neuve n'a pas d'avant", () => {
    const f = fenetreDeLigue(ligue("2026-03-02", "2026-03-08"));
    expect(f.start).toBe("2026-03-02");
    expect(f.end).toBe("2026-03-08");
    expect(f.saison3).toBe("2026-03-02");
  });

  it("refuse une ligue à l'envers", () => {
    expect(() => fenetreDeLigue(ligue("2026-03-08", "2026-03-02"))).toThrow(/à l'envers/);
  });
});

describe("semainesDeLigue", () => {
  it.each([
    ["2026-03-02", "2026-03-08", 1],
    ["2026-03-02", "2026-03-15", 2],
    ["2026-03-02", "2026-04-12", 6],
  ])("compte %s → %s comme %i semaines", (d, f, attendu) => {
    expect(semainesDeLigue(ligue(d, f))).toBe(attendu);
  });

  it("arrondit au-dessus pour le groupe d'origine, qui fait 50 jours", () => {
    // 13/07 → 31/08/2026 : 50 jours, soit 7 semaines pleines et un jour.
    // La phase 5 importera cette ligue-là en désactivant le trigger de durée.
    expect(semainesDeLigue(ligue("2026-07-13", "2026-08-31"))).toBe(8);
  });
});
