// La durée d'une ligue : le « -1 » que tout le monde oublie, et la borne des
// 6 semaines qui doit tomber exactement là où le trigger SQL la met.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  aUneBasculeDeBareme,
  baremeS3,
  fenetre,
  FENETRE_ENV,
  joursDeFenetre,
  saison3Started,
} from "@/lib/challenge";
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

describe("aUneBasculeDeBareme", () => {
  it("est vrai pour le challenge d'origine, qui a basculé en S3 à mi-parcours", () => {
    expect(aUneBasculeDeBareme(fenetre("2026-07-13", "2026-08-31", "2026-07-27"))).toBe(true);
  });

  it("est faux pour une ligue neuve, en S3 pur du premier au dernier jour", () => {
    // C'est le piège : `saison3Started` est vrai dès le jour 1 d'une ligue
    // neuve, puisque sa saison 3 est calée sur son début. Sans cette
    // distinction, l'écran qui raconte la bascule s'afficherait à la création
    // de chaque ligue — le récit d'un changement qui n'a jamais eu lieu.
    expect(aUneBasculeDeBareme(fenetreDeLigue(ligue("2026-03-02", "2026-03-29")))).toBe(false);
  });

  it("est faux quelle que soit la durée de la ligue", () => {
    for (const s of [1, 2, 3, 4, 5, 6]) {
      const l = ligue("2026-03-02", finDeLigue("2026-03-02", s));
      expect(aUneBasculeDeBareme(fenetreDeLigue(l))).toBe(false);
    }
  });
});

// Le drapeau que lisent les écrans de règles (tuto, mini-barème, détail
// joueur). Il ne dit pas « la bascule a-t-elle eu lieu » mais « quel barème
// faut-il décrire » — et les deux divergent avant le jour 1 d'une ligue.
describe("baremeS3", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const onEstLe = (jour: string) => vi.setSystemTime(new Date(`${jour}T10:00:00Z`));

  const SPRINT = fenetreDeLigue(ligue("2026-03-02", "2026-03-29"));

  it("décrit la S3 à une ligue neuve AVANT son premier jour", () => {
    // Le vrai moment du tuto : on s'inscrit le vendredi pour une ligue qui
    // démarre lundi. `saison3Started` répond non — et l'écran des règles
    // affichait alors +2 par jour parfait, le premier du jour, le happy
    // hour, le lève-tôt et le jour miroir. Rien de tout ça n'existe pour
    // cette ligue, ni le jour 1, ni la veille.
    onEstLe("2026-02-27");
    expect(saison3Started(SPRINT)).toBe(false);
    expect(baremeS3(SPRINT)).toBe(true);
  });

  it("reste vrai pendant toute la ligue", () => {
    for (const jour of ["2026-03-02", "2026-03-15", "2026-03-29", "2026-04-10"]) {
      onEstLe(jour);
      expect(baremeS3(SPRINT)).toBe(true);
    }
  });

  it("suit la bascule pour le challenge d'origine, lui qui l'a vécue", () => {
    onEstLe("2026-07-26"); // veille de la S3
    expect(baremeS3(FENETRE_ENV)).toBe(false);
    onEstLe("2026-07-27");
    expect(baremeS3(FENETRE_ENV)).toBe(true);
  });
});
