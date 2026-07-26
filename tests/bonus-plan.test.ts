// Le composeur de séance bonus.
//
// Toute la feature tient dans composePlan() : les écrans ne font que
// l'afficher. Ces tests tiennent les quatre propriétés qui font qu'une
// séance proposée est une séance et pas un barème exploité :
//   · le temps annoncé est vrai (repos compris)
//   · les zones passent avant les points
//   · l'objectif est un plancher, jamais une cible qui rabote la séance
//   · rien de déjà déclaré aujourd'hui ne revient dans la liste

import { describe, expect, it } from "vitest";
import { BonusCatalogItem, BonusFamily, BonusState } from "../lib/bonus";
import {
  composePlan,
  gapToNext,
  planLabel,
  planMinutes,
  REST_MINUTES,
  shortestTimeFor,
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

const TOUTES = new Set<BonusFamily>();

describe("le temps annoncé", () => {
  it("tient dans le budget, repos compris", () => {
    for (const budget of [10, 15, 20, 30]) {
      const plan = composePlan(etat(), MOI, {
        budget,
        goal: null,
        zones: TOUTES,
      });
      expect(plan, `${budget} min`).not.toBeNull();
      expect(plan!.minutes).toBeLessThanOrEqual(budget);
    }
  });

  it("compte bien une minute de repos entre deux blocs", () => {
    const plan = composePlan(etat(), MOI, {
      budget: 15,
      goal: null,
      zones: TOUTES,
    })!;
    const exos = plan.blocks.reduce((s, b) => s + b.minutes, 0);
    expect(plan.minutes).toBe(exos + REST_MINUTES * (plan.blocks.length - 1));
    expect(planMinutes(plan.blocks)).toBe(plan.minutes);
  });
});

describe("les zones avant les points", () => {
  it("ne sort pas une séance 100 % cardio en un quart d'heure", () => {
    // Le vrai piège : jumping jacks et climbers paient le mieux à la
    // minute. Un composeur qui maximise les points en aligne quatre.
    const plan = composePlan(etat(), MOI, {
      budget: 15,
      goal: null,
      zones: TOUTES,
    })!;
    expect(plan.zones).toBeGreaterThan(1);
    expect(new Set(plan.blocks.map((b) => b.family)).size).toBe(plan.zones);
  });

  it("alterne les zones : jamais deux fois la même d'affilée", () => {
    const plan = composePlan(etat(), MOI, {
      budget: 20,
      goal: null,
      zones: TOUTES,
    })!;
    // Vrai tant qu'il reste une autre zone disponible, ce qui est le cas
    // ici : le plan sort quatre zones distinctes.
    expect(plan.zones).toBe(4);
    for (let i = 1; i < plan.blocks.length; i++) {
      expect(plan.blocks[i].family).not.toBe(plan.blocks[i - 1].family);
    }
  });

  it("ne propose que les zones demandées", () => {
    const plan = composePlan(etat(), MOI, {
      budget: 20,
      goal: null,
      zones: new Set<BonusFamily>(["abdos", "jambes"]),
    })!;
    for (const b of plan.blocks) {
      expect(["abdos", "jambes"]).toContain(b.family);
    }
  });
});

describe("l'objectif de points", () => {
  it("est un plancher, pas une cible : la séance remplit le temps donné", () => {
    const petit = composePlan(etat(), MOI, {
      budget: 30,
      goal: 10,
      zones: TOUTES,
    })!;
    expect(petit.points).toBeGreaterThanOrEqual(10);
    // Le bug de la maquette : « 30 min + 10 pts » rendait une séance de
    // 9 minutes, parce que l'objectif était traité comme une cible.
    expect(petit.minutes).toBeGreaterThan(20);
  });

  it("sans plafond de temps, prend le chemin le plus court", () => {
    // Le raccourci « passer Doren (+2,5) » avec « peu importe » comme
    // durée : sans cette règle, le composeur remplissait cinq blocs et
    // proposait 44 minutes pour reprendre deux points et demi.
    const plan = composePlan(etat(), MOI, {
      budget: null,
      goal: 2.5,
      zones: TOUTES,
    })!;
    expect(plan.points).toBeGreaterThanOrEqual(2.5);
    expect(plan.minutes).toBeLessThanOrEqual(5);
    expect(plan.blocks).toHaveLength(1);
  });

  it("rend null quand il ne rentre pas, et dit le temps qu'il faudrait", () => {
    const impossible = composePlan(etat(), MOI, {
      budget: 10,
      goal: 25,
      zones: TOUTES,
    });
    expect(impossible).toBeNull();
    const besoin = shortestTimeFor(etat(), MOI, 25, TOUTES);
    expect(besoin).not.toBeNull();
    expect(besoin!).toBeGreaterThan(10);
  });

  it("rend null quand aucune combinaison n'atteint l'objectif", () => {
    // Une seule zone, un objectif hors de portée de ce qu'elle contient.
    const zones = new Set<BonusFamily>(["abdos"]);
    expect(shortestTimeFor(etat(), MOI, 100, zones)).toBeNull();
    expect(
      composePlan(etat(), MOI, { budget: null, goal: 100, zones }),
    ).toBeNull();
  });
});

describe("ce qui est déjà fait ne revient pas", () => {
  it("exclut les bonus déclarés aujourd'hui", () => {
    const dejaFait = ["gainage_3min", "pompes_50", "chaise_3min"];
    const plan = composePlan(etat(dejaFait), MOI, {
      budget: 30,
      goal: null,
      zones: TOUTES,
    })!;
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
      const plan = composePlan(etat(), MOI, {
        budget,
        goal: null,
        zones: TOUTES,
      })!;
      const echelles = plan.blocks
        .map((b) => b.ladder)
        .filter((l): l is string => l !== null);
      expect(new Set(echelles).size, `${budget} min`).toBe(echelles.length);
    }
  });
});

describe("le raccourci classement", () => {
  // Le classement n'est plus le moteur, juste une façon de se fixer un
  // objectif. Il ne doit donc jamais s'imposer : en tête, il disparaît.
  const CLASSEMENT = [
    { player_id: "jordan", points: 344.5 },
    { player_id: "leo", points: 329.5 },
    { player_id: "doren", points: 328.5 },
  ];

  it("donne le joueur juste devant et l'écart", () => {
    expect(gapToNext(CLASSEMENT, "doren")).toEqual({
      playerId: "leo",
      gap: 1,
    });
  });

  it("ne propose rien à celui qui mène", () => {
    expect(gapToNext(CLASSEMENT, "jordan")).toBeNull();
  });

  it("ne propose rien tant que le classement n'est pas chargé", () => {
    expect(gapToNext(null, "doren")).toBeNull();
    expect(gapToNext(CLASSEMENT, "inconnu")).toBeNull();
  });

  it("saute les ex æquo : on vise celui qui est vraiment devant", () => {
    const exaequo = [...CLASSEMENT, { player_id: "hugo", points: 328.5 }];
    expect(gapToNext(exaequo, "doren")?.playerId).toBe("leo");
  });
});

describe("les déplacements", () => {
  it("ne sont jamais cadencés : on ne case pas un 10 km entre deux blocs", () => {
    const plan = composePlan(etat(), MOI, {
      budget: null,
      goal: null,
      zones: new Set<BonusFamily>(["cardio"]),
    })!;
    const keys = plan.blocks.map((b) => b.key);
    expect(keys).not.toContain("course_5km");
    expect(keys).not.toContain("course_10km");
    expect(keys).not.toContain("pas_10000");
  });
});
