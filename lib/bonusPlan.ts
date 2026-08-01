// Composer une séance à partir du catalogue de bonus.
//
// Trois axes, combinables : la durée est un BUDGET, les zones un FILTRE,
// les points un PLANCHER. Le composeur cherche la séance la plus variée
// qui tient dans le budget — pas le meilleur rendement au point. Sans
// cette préférence il sort quatre blocs de cardio, parce qu'ils paient le
// mieux à la minute : ce n'est plus une séance préparée, c'est un barème
// exploité.
//
// Rien ici ne touche un score. Les points viennent du catalogue en base
// comme partout ailleurs, et les durées ci-dessous sont des estimations
// d'affichage : elles servent à ranger quatre blocs dans un quart d'heure.
// Corriger une valeur est sans conséquence sur le classement.
//
// Deux montants cohabitent, et il faut les garder distincts : `points`
// est le montant du catalogue, celui que les plafonds comptent, et
// `todayPoints` ce que le bloc paie réellement aujourd'hui — doublement
// du jour compris (migration 33). Le composeur vise le second, les
// plafonds surveillent le premier, exactement comme la feuille de
// déclaration. Confondre les deux, c'est promettre la moitié d'une
// séance un jour de tirage.

import {
  BonusCatalogItem,
  BonusFamily,
  BonusState,
  claimables,
  movementLocked,
  pointsToday,
  weekBonusPoints,
} from "./bonus";

/** Minutes estimées, à la louche et assumé. Une clé absente retombe sur
    une estimation tirée des points — un bonus ajouté en base sans passer
    ici reste composable plutôt que de disparaître de la séance. */
const MINUTES: Record<string, number> = {
  // cardio
  jumping_jacks_100: 2,
  jumping_jacks_200: 4,
  climbers_100: 3,
  climbers_200: 6,
  squats_jump_50: 3,
  squats_jump_100: 6,
  burpees_30: 4,
  burpees_60: 8,
  corde_10min: 10,
  marches_500: 10,
  course_5km: 30,
  course_10km: 60,
  pas_10000: 80,
  // haut du corps
  pompes_50: 4,
  pompes_100: 8,
  dips_50: 4,
  // abdos
  abdos_100: 5,
  abdos_200: 10,
  gainage_3min: 3,
  // jambes
  squats_100: 5,
  squats_200: 10,
  fentes_100: 5,
  fentes_200: 10,
  chaise_3min: 3,
};

/** Ce qu'on ne case pas entre deux blocs : ces bonus SONT la séance. On
    ne cadence pas un 10 km, et 10 000 pas se marchent dans la journée. */
const HORS_SEANCE = new Set(["course_5km", "course_10km", "pas_10000"]);

/** Une minute entre deux blocs, comptée dans le budget : un temps annoncé
    qui ne compte pas les repos est un temps faux. */
export const REST_MINUTES = 1;

/** Au-delà, ce n'est plus une séance, c'est une liste de courses. */
const MAX_BLOCKS = 5;

/** Un bloc de séance. `points` reste le montant du catalogue — c'est lui
    que les plafonds comptent, comme dans la feuille de déclaration.
    `todayPoints` est ce que le bloc rapporte VRAIMENT aujourd'hui,
    doublement du jour compris (migration 33) : c'est ce qu'on affiche, et
    c'est sur lui que l'objectif se juge. Un jour de doublement, composer
    sur les points bruts annoncerait la moitié de ce que la séance paie. */
export type PlanBlock = BonusCatalogItem & {
  minutes: number;
  todayPoints: number;
};

export type Plan = {
  blocks: PlanBlock[];
  /** Durée totale, repos compris. */
  minutes: number;
  /** Ce que la séance rapporte aujourd'hui, doublement compris. */
  points: number;
  /** Nombre de zones distinctes travaillées. */
  zones: number;
};

/** Les zones proposées comme filtre. Libellés courts : ce sont des puces
    sur une ligne, pas les titres de la feuille de déclaration. */
export const PLAN_ZONES: { key: BonusFamily; short: string; long: string }[] = [
  { key: "cardio", short: "Cardio", long: "Cardio" },
  { key: "haut", short: "Haut", long: "Haut du corps" },
  { key: "abdos", short: "Abdos", long: "Abdos & gainage" },
  { key: "jambes", short: "Jambes", long: "Jambes" },
];

export function zoneLabel(family: BonusFamily | null): string {
  return PLAN_ZONES.find((z) => z.key === family)?.long ?? "Bonus";
}

export function bonusMinutes(item: BonusCatalogItem): number {
  return MINUTES[item.key] ?? Math.max(2, Math.round(item.points));
}

/** Durée d'une suite de blocs, repos inclus. */
export function planMinutes(blocks: PlanBlock[]): number {
  if (blocks.length === 0) return 0;
  return (
    blocks.reduce((t, b) => t + b.minutes, 0) +
    REST_MINUTES * (blocks.length - 1)
  );
}

/** Un palier déjà entamé aujourd'hui se relit « de plus » : cocher
    +50 pompes après +100 pompes, ce sont 150 pompes déclarées (les
    paliers se cumulent depuis la migration 22). Sans ça, la séance
    annoncerait « +50 pompes » à quelqu'un qui en a déjà 100 au compteur. */
export function planLabel(
  item: BonusCatalogItem,
  claimedKeys: Set<string>,
  catalog: BonusCatalogItem[],
): string {
  if (!item.ladder || claimedKeys.has(item.key)) return item.label;
  const sameLadder = catalog.some(
    (c) => c.ladder === item.ladder && c.key !== item.key && claimedKeys.has(c.key),
  );
  if (!sameLadder) return item.label;
  return `${item.label.replace(/^\+/, "")} de plus`;
}

export type PlanOptions = {
  /** Budget en minutes, repos compris. null = pas de plafond. */
  budget: number | null;
  /** Plancher de points. null = aucun objectif. */
  goal: number | null;
  /** Zones retenues. Vide = toutes. */
  zones: Set<BonusFamily>;
  /** Cherche la séance la plus COURTE qui atteint l'objectif, budget
      ignoré. Sert à répondre « il te faudrait N min », pas à composer. */
  shortest?: boolean;
};

/** Les bonus qu'on peut encore mettre dans une séance aujourd'hui. */
function pool(
  state: BonusState,
  playerId: string,
  zones: Set<BonusFamily>,
  claimedKeys: Set<string>,
): PlanBlock[] {
  return claimables(state)
    .filter(
      (c) =>
        !claimedKeys.has(c.key) &&
        !HORS_SEANCE.has(c.key) &&
        !movementLocked(state, playerId, c) &&
        (zones.size === 0 || (c.family !== null && zones.has(c.family))),
    )
    .map((c) => ({
      ...c,
      minutes: bonusMinutes(c),
      todayPoints: pointsToday(state, c),
    }));
}

/**
 * La séance proposée, ou null si rien ne rentre.
 *
 * Sous contrainte de temps et de zones :
 *   · avec objectif  → toute séance qui l'atteint (c'est un plancher, pas
 *                      une cible : « au moins tant », jamais « arrête-toi là »)
 *   · le départage   → d'abord le nombre de zones, ensuite les points,
 *                      ensuite la durée la plus courte
 */
export function composePlan(
  state: BonusState,
  playerId: string,
  opts: PlanOptions,
): Plan | null {
  const mine = state.todayClaims.filter((c) => c.player_id === playerId);
  const claimedKeys = new Set(mine.map((c) => c.bonus_key));
  const items = pool(state, playerId, opts.zones, claimedKeys);

  // Les plafonds sont levés depuis la S2, mais on ne compose pas une
  // séance que la base refusera : si un plafond revient, elle rétrécit.
  const capDay =
    state.catalog.find((c) => c.key === "cap_claims_jour")?.points ?? 3;
  const capWeek =
    state.catalog.find((c) => c.key === "cap_points_semaine")?.points ?? 25;
  const exerciseKeys = new Set(claimables(state).map((c) => c.key));
  const mineCount = mine.filter((c) => exerciseKeys.has(c.bonus_key)).length;
  const weekUsed = weekBonusPoints(state, playerId);

  // Le meilleur candidat vit dans un objet, pas dans un `let` : TypeScript
  // ne suit pas les affectations faites depuis une closure et finirait par
  // le croire toujours nul.
  const found: { best: Plan | null } = { best: null };
  const combo: PlanBlock[] = [];

  // Sans plafond de temps mais avec un objectif, « la plus dense » n'a
  // plus de sens : le composeur remplirait cinq blocs et proposerait
  // trois quarts d'heure pour reprendre 2,5 points. Là, la plus courte
  // qui atteint l'objectif EST la bonne réponse.
  const shortest =
    opts.shortest ?? (opts.budget === null && opts.goal !== null);

  const consider = () => {
    if (combo.length === 0) return;
    const minutes = planMinutes(combo);
    if (opts.budget !== null && minutes > opts.budget) return;
    // Ce que la séance paie aujourd'hui : c'est ce que le joueur lit, et
    // donc ce que son objectif doit mesurer.
    const points = combo.reduce((s, b) => s + b.todayPoints, 0);
    if (opts.goal !== null && points < opts.goal) return;
    if (mineCount + combo.length > capDay) return;
    // Les plafonds, eux, comptent les points bruts du catalogue — même
    // arithmétique que la feuille de déclaration, sinon un jour de
    // doublement fermerait la semaine deux fois plus vite en apparence.
    const brut = combo.reduce((s, b) => s + b.points, 0);
    if (weekUsed + brut > capWeek) return;

    const zones = new Set(combo.map((b) => b.family)).size;
    const cand: Plan = { blocks: [...combo], minutes, points, zones };
    const best = found.best;
    if (!best) {
      found.best = cand;
      return;
    }
    if (shortest) {
      if (
        cand.minutes < best.minutes ||
        (cand.minutes === best.minutes && cand.zones > best.zones)
      ) {
        found.best = cand;
      }
      return;
    }
    if (
      cand.zones > best.zones ||
      (cand.zones === best.zones &&
        (cand.points > best.points ||
          (cand.points === best.points && cand.minutes < best.minutes)))
    ) {
      found.best = cand;
    }
  };

  const walk = (start: number) => {
    consider();
    if (combo.length === MAX_BLOCKS) return;
    for (let i = start; i < items.length; i++) {
      // Un seul palier par échelle : « +50 pompes » puis « +100 pompes »
      // dans la même séance, c'est le même exercice annoncé deux fois.
      if (
        items[i].ladder !== null &&
        combo.some((b) => b.ladder === items[i].ladder)
      ) {
        continue;
      }
      combo.push(items[i]);
      if (opts.budget === null || planMinutes(combo) <= opts.budget) {
        walk(i + 1);
      }
      combo.pop();
    }
  };
  walk(0);

  const plan = found.best;
  if (!plan) return null;
  return { ...plan, blocks: cadence(plan.blocks) };
}

/** L'ordre qui fait la cadence : on alterne les zones, jamais deux fois le
    même muscle d'affilée tant qu'il reste autre chose à faire. C'est tout
    l'intérêt de préparer sa séance plutôt que d'enchaîner au hasard. */
function cadence(blocks: PlanBlock[]): PlanBlock[] {
  const buckets = new Map<BonusFamily | null, PlanBlock[]>();
  for (const b of blocks) {
    const arr = buckets.get(b.family);
    if (arr) arr.push(b);
    else buckets.set(b.family, [b]);
  }
  const out: PlanBlock[] = [];
  let last: BonusFamily | null | undefined = undefined;
  while (out.length < blocks.length) {
    const left = [...buckets.entries()].filter(([, arr]) => arr.length > 0);
    const others = left.filter(([f]) => f !== last);
    // la zone la plus fournie, en évitant celle du bloc précédent
    const pick = (others.length ? others : left).sort(
      (a, b) => b[1].length - a[1].length,
    )[0];
    out.push(pick[1].shift() as PlanBlock);
    last = pick[0];
  }
  return out;
}

/** Le temps qu'il faudrait pour tenir cet objectif, budget ignoré. null
    si aucune combinaison ne l'atteint, quelles que soient les minutes. */
export function shortestTimeFor(
  state: BonusState,
  playerId: string,
  goal: number,
  zones: Set<BonusFamily>,
): number | null {
  const p = composePlan(state, playerId, {
    budget: null,
    goal,
    zones,
    shortest: true,
  });
  return p ? p.minutes : null;
}

/** Le joueur juste devant et l'écart qui l'en sépare, ou null si on mène
    (ou si le classement n'est pas encore chargé). Un raccourci pour se
    fixer un objectif, rien de plus : le classement n'est pas le moteur
    ici — c'est préparer sa séance qui l'est. */
export function gapToNext(
  rows: { player_id: string; points: number }[] | null | undefined,
  playerId: string,
): { playerId: string; gap: number } | null {
  if (!rows) return null;
  const me = rows.find((r) => r.player_id === playerId);
  if (!me) return null;
  const ahead = rows.filter((r) => r.points > me.points);
  if (ahead.length === 0) return null;
  const next = ahead.reduce((a, b) => (a.points <= b.points ? a : b));
  return { playerId: next.player_id, gap: next.points - me.points };
}
