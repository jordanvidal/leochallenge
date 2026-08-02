// Le composeur de séance bonus.
//
// Toute la feature tient dans composePlan() : les écrans ne font que
// l'afficher. Depuis le 02/08 il n'a qu'un réglage, le budget de temps.
// Ces tests tiennent les trois propriétés qui font qu'une séance
// proposée est une séance et pas un barème exploité :
//   · le temps annoncé est vrai (repos compris)
//   · les zones passent avant les points
//   · rien de déjà déclaré aujourd'hui ne revient dans la liste

import { describe, expect, it } from "vitest";
import { BonusCatalogItem, BonusFamily, BonusState } from "../lib/bonus";
import {
  composePlan,
  planLabel,
  planMinutes,
  REST_MINUTES,
} from "../lib/bonusPlan";

const MOI = "jordan";

/** Catalogue post-MEP (migrations 29 et 31), réduit à ce qui sert ici.
    Les durées ne sont pas dans ce tableau : elles vivent dans bonusPlan.ts,
    et c'est bien la table réelle qu'on veut éprouver. */
const c = (
  key: string,
  label: string,
  points: number,
  family: BonusFamily | null,
  ladder: string | null = null,
): BonusCatalogItem => ({
  key,
  kind: "exercise",
  emoji: "🔸",
  label,
  points,
  sort: 0,
  ladder,
  family,
});

const CATALOGUE: BonusCatalogItem[] = [
  c("jumping_jacks_100", "100 jumping jacks", 3, "cardio", "jumping_jacks"),
  c("jumping_jacks_200", "200 jumping jacks", 5, "cardio", "jumping_jacks"),
  c("climbers_100", "100 mountain climbers", 4, "cardio", "climbers"),
  c("climbers_200", "200 mountain climbers", 7, "cardio", "climbers"),
  c("burpees_30", "30 burpees", 4, "cardio", "burpees"),
  c("burpees_60", "60 burpees", 7, "cardio", "burpees"),
  c("squats_jump_50", "50 squats jump", 4, "cardio", "squats_jump"),
  c("corde_10min", "10 min de corde à sauter", 5, "cardio"),
  c("pompes_50", "+50 pompes", 4, "haut", "pompes"),
  c("pompes_100", "+100 pompes", 7, "haut", "pompes"),
  c("dips_50", "50 dips sur chaise", 4, "haut"),
  c("abdos_100", "+100 abdos", 4, "abdos", "abdos"),
  c("abdos_200", "+200 abdos", 7, "abdos", "abdos"),
  c("gainage_3min", "3 min de gainage", 3, "abdos"),
  c("squats_100", "+100 squats", 4, "jambes", "squats"),
  c("fentes_100", "100 fentes", 4, "jambes", "fentes"),
  c("chaise_3min", "3 min de chaise murale", 3, "jambes"),
  // Les trois déplacements : jamais dans une séance cadencée.
  c("course_5km", "5 km de course", 8, "cardio"),
  c("course_10km", "10 km de course", 20, "cardio"),
  c("pas_10000", "10 000 pas", 4, "cardio"),
  // Les plafonds, levés comme en prod depuis la S2.
  { ...c("cap_claims_jour", "plafond jour", 99, null), kind: "cap" },
  { ...c("cap_points_semaine", "plafond semaine", 999, null), kind: "cap" },
];

function etat(dejaDeclare: string[] = []): BonusState {
  const claims = dejaDeclare.map((bonus_key) => ({
    player_id: MOI,
    day: "2026-07-28",
    bonus_key,
    points: CATALOGUE.find((x) => x.key === bonus_key)?.points ?? 0,
  }));
  return {
    catalog: CATALOGUE,
    event: null,
    todayClaims: claims,
    weekClaims: claims,
  };
}

describe("le temps annoncé", () => {
  it("tient dans le budget, repos compris", () => {
    for (const budget of [10, 15, 20, 30]) {
      const plan = composePlan(etat(), MOI, budget);
      expect(plan, `${budget} min`).not.toBeNull();
      expect(plan!.minutes).toBeLessThanOrEqual(budget);
    }
  });

  it("compte bien une minute de repos entre deux blocs", () => {
    const plan = composePlan(etat(), MOI, 15)!;
    const exos = plan.blocks.reduce((s, b) => s + b.minutes, 0);
    expect(plan.minutes).toBe(exos + REST_MINUTES * (plan.blocks.length - 1));
    expect(planMinutes(plan.blocks)).toBe(plan.minutes);
  });
});

describe("les zones avant les points", () => {
  it("ne sort pas une séance 100 % cardio en un quart d'heure", () => {
    // Le vrai piège : jumping jacks et climbers paient le mieux à la
    // minute. Un composeur qui maximise les points en aligne quatre.
    const plan = composePlan(etat(), MOI, 15)!;
    expect(plan.zones).toBeGreaterThan(1);
    expect(new Set(plan.blocks.map((b) => b.family)).size).toBe(plan.zones);
  });

  it("alterne les zones : jamais deux fois la même d'affilée", () => {
    const plan = composePlan(etat(), MOI, 20)!;
    // Vrai tant qu'il reste une autre zone disponible, ce qui est le cas
    // ici : le plan sort quatre zones distinctes.
    expect(plan.zones).toBe(4);
    for (let i = 1; i < plan.blocks.length; i++) {
      expect(plan.blocks[i].family).not.toBe(plan.blocks[i - 1].family);
    }
  });

});

describe("ce qui est déjà fait ne revient pas", () => {
  it("exclut les bonus déclarés aujourd'hui", () => {
    const dejaFait = ["gainage_3min", "pompes_50", "chaise_3min"];
    const plan = composePlan(etat(dejaFait), MOI, 30)!;
    for (const key of dejaFait) {
      expect(plan.blocks.map((b) => b.key)).not.toContain(key);
    }
  });

  it("relit un palier entamé en « de plus »", () => {
    const claimed = new Set(["pompes_50"]);
    const pompes100 = CATALOGUE.find((x) => x.key === "pompes_100")!;
    expect(planLabel(pompes100, claimed, CATALOGUE)).toBe("100 pompes de plus");
    // Hors échelle entamée, le libellé ne bouge pas.
    const dips = CATALOGUE.find((x) => x.key === "dips_50")!;
    expect(planLabel(dips, claimed, CATALOGUE)).toBe("50 dips sur chaise");
  });

  it("ne met jamais deux paliers de la même échelle dans une séance", () => {
    for (const budget of [10, 15, 20, 30]) {
      const plan = composePlan(etat(), MOI, budget)!;
      const echelles = plan.blocks
        .map((b) => b.ladder)
        .filter((l): l is string => l !== null);
      expect(new Set(echelles).size, `${budget} min`).toBe(echelles.length);
    }
  });
});

describe("les déplacements", () => {
  it("ne sont jamais cadencés : on ne case pas un 10 km entre deux blocs", () => {
    // Sans budget, le composeur sort la séance la plus fournie — même là,
    // un 10 km n'a rien à faire entre deux blocs.
    const plan = composePlan(etat(), MOI, null)!;
    const keys = plan.blocks.map((b) => b.key);
    expect(keys).not.toContain("course_5km");
    expect(keys).not.toContain("course_10km");
    expect(keys).not.toContain("pas_10000");
  });
});

// Le doublement du jour (migration 33) est arrivé après l'écriture du
// composeur. Deux montants cohabitent depuis : `points`, celui du
// catalogue, que les plafonds comptent ; et `todayPoints`, ce que le bloc
// paie vraiment aujourd'hui. Composer sur le premier un jour de tirage,
// c'est promettre la moitié de ce que la séance rapporte.
describe("les jours de doublement", () => {
  /** État avec un tirage qui double une puce nommée. */
  function etatDouble(cle: string, eventKey = "cardio_double"): BonusState {
    const catalogue = CATALOGUE.map((c) =>
      c.key === cle ? { ...c, double_event: eventKey } : c,
    );
    return {
      catalog: catalogue,
      event: {
        key: eventKey,
        kind: "event",
        emoji: "🎲",
        label: "Cardio doublé",
        points: 1,
        sort: 0,
        ladder: null,
        family: null,
      },
      todayClaims: [],
      weekClaims: [],
    };
  }

  it("compte le double sur la puce tirée", () => {
    const state = etatDouble("corde_10min");
    const plan = composePlan(state, MOI, null)!;
    const corde = plan.blocks.find((b) => b.key === "corde_10min");
    if (corde) {
      // 5 au catalogue, 10 aujourd'hui.
      expect(corde.points).toBe(5);
      expect(corde.todayPoints).toBe(10);
    }
    // Le total de la séance est bien la somme des montants du jour.
    expect(plan.points).toBe(
      plan.blocks.reduce((s, b) => s + b.todayPoints, 0),
    );
  });

  it("laisse les autres puces à leur montant de catalogue", () => {
    const state = etatDouble("corde_10min");
    const plan = composePlan(state, MOI, null)!;
    for (const b of plan.blocks) {
      if (b.key !== "corde_10min") expect(b.todayPoints).toBe(b.points);
    }
  });

});
