// La série du moteur de score : jours parfaits, joker, jour off.
//
// Le moteur recopie les CTE kept0 → streaks de daily_points et le
// last_kept de leaderboard() (supabase/migration46-bareme-s4.sql). Une
// copie de règle ne vaut que tenue par des tests : chaque cas ci-dessous
// nomme le comportement SQL qu'il verrouille.
//
// Les fenêtres sont posées dans le passé (mars 2025) : les jours écoulés
// couvrent alors toute la ligue et le « aujourd'hui » du calcul se clampe
// sur son dernier jour — déterministe, quelle que soit la date du test.

import { describe, expect, it } from "vitest";
import { fenetre } from "@/lib/challenge";
import { computeSerie, computeStats, streakEnSursis } from "@/lib/score";
import { Entry, entryKey } from "@/lib/types";

const MOI = "hichem";

/** Une map d'entrées : jours parfaits, plus d'éventuels jours partiels. */
function entries(
  parfaits: string[],
  partiels: [day: string, pushups: boolean, abs: boolean, squats: boolean][] = [],
): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const day of parfaits) {
    m.set(entryKey(MOI, day), {
      player_id: MOI,
      day,
      pushups: true,
      abs: true,
      squats: true,
    });
  }
  for (const [day, pushups, abs, squats] of partiels) {
    m.set(entryKey(MOI, day), { player_id: MOI, day, pushups, abs, squats });
  }
  return m;
}

/** Les jours de `from` à `to` inclus, bornes ISO. */
function suite(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; ) {
    out.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

// Une ligue de 4 semaines, lundi 03/03/2025 → dimanche 30/03/2025.
const F = fenetre("2025-03-03", "2025-03-30");

describe("computeSerie — jours parfaits seuls", () => {
  it("compte une série en cours qui touche la fin de la fenêtre", () => {
    // 7 jours parfaits jusqu'au dernier jour : la série vit, ×2 atteint.
    const e = entries(suite("2025-03-24", "2025-03-30"));
    const s = computeSerie(MOI, e, F);
    expect(s.streak).toBe(7);
    expect(s.bestStreak).toBe(7);
    expect(s.jokerDay).toBeNull();
  });

  it("tolère un dernier jour incomplet : la série ne casse qu'à minuit", () => {
    // Parfait jusqu'à l'avant-dernier jour : le serveur (last_kept >= hier)
    // rend encore la série vivante.
    const e = entries(suite("2025-03-24", "2025-03-29"));
    expect(computeSerie(MOI, e, F).streak).toBe(6);
  });

  it("rend 0 quand le dernier jour parfait date d'avant-hier", () => {
    const e = entries(suite("2025-03-20", "2025-03-28"));
    const s = computeSerie(MOI, e, F);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(9);
  });

  it("un jour partiel casse la série comme un jour vierge", () => {
    // La CTE teste `perfect`, pas la présence d'une ligne.
    const e = entries(suite("2025-03-25", "2025-03-30"), [
      ["2025-03-24", true, true, false],
    ]);
    const s = computeSerie(MOI, e, F);
    expect(s.streak).toBe(6);
    expect(s.bestStreak).toBe(6);
  });
});

describe("computeSerie — le joker", () => {
  it("recolle un trou d'un jour après 3 parfaits : la série continue", () => {
    // 7 parfaits, trou le 10, retour : streak_pos reprend à 8, pas à 1.
    // C'était LA divergence entre l'app et le serveur : l'ancien
    // computeStats cassait la série alors que leaderboard() la préservait.
    const e = entries([
      ...suite("2025-03-03", "2025-03-09"),
      ...suite("2025-03-11", "2025-03-13"),
    ]);
    const s = computeSerie(MOI, e, F);
    expect(s.jokerDay).toBe("2025-03-10");
    expect(s.bestStreak).toBe(10); // 7 + 3, le jour joker ne compte pas
  });

  it("ne part pas sous 3 jours parfaits — rien à sauver", () => {
    const e = entries([
      ...suite("2025-03-08", "2025-03-09"),
      ...suite("2025-03-11", "2025-03-13"),
    ]);
    const s = computeSerie(MOI, e, F);
    expect(s.jokerDay).toBeNull();
    expect(s.bestStreak).toBe(3);
  });

  it("ne part pas si le joueur n'est pas revenu le lendemain", () => {
    // Deux jours de trou : le joker recolle deux morceaux, il ne
    // rattrape pas quelqu'un qui a arrêté.
    const e = entries([
      ...suite("2025-03-03", "2025-03-09"),
      ...suite("2025-03-12", "2025-03-14"),
    ]);
    const s = computeSerie(MOI, e, F);
    expect(s.jokerDay).toBeNull();
    expect(s.bestStreak).toBe(7);
  });

  it("ne part qu'une fois : le deuxième trou casse pour de bon", () => {
    const e = entries([
      ...suite("2025-03-03", "2025-03-05"),
      ...suite("2025-03-07", "2025-03-09"),
      ...suite("2025-03-11", "2025-03-13"),
    ]);
    const s = computeSerie(MOI, e, F);
    expect(s.jokerDay).toBe("2025-03-06");
    // 3 + 3 recollés = 6 ; après le trou du 10, la série repart à 1.
    expect(s.bestStreak).toBe(6);
  });
});

describe("computeSerie — le jour off (S4)", () => {
  const OFF = new Set(["2025-03-11"]); // un mardi

  it("préserve la série sans l'allonger : 6 autour d'un repos font 6", () => {
    const e = entries([
      "2025-03-08",
      "2025-03-09",
      "2025-03-10",
      "2025-03-12",
      "2025-03-13",
      "2025-03-14",
    ]);
    const s = computeSerie(MOI, e, F, OFF);
    expect(s.bestStreak).toBe(6);
    expect(s.jokerDay).toBeNull(); // le repos n'est pas un trou à racheter
  });

  it("compte un vrai 3/3 pour qui s'entraîne quand même", () => {
    const e = entries(suite("2025-03-08", "2025-03-14"));
    expect(computeSerie(MOI, e, F, OFF).bestStreak).toBe(7);
  });

  it("garde la série vivante le lendemain matin du repos", () => {
    // Le raté le plus visible côté SQL (last_kept) : sans le jour off
    // dans la chaîne, toutes les séries tombaient à zéro au réveil.
    const offFin = new Set(["2025-03-29"]);
    const e = entries(suite("2025-03-22", "2025-03-28"));
    expect(computeSerie(MOI, e, F, offFin).streak).toBe(7);
  });

  it("ne ressuscite pas une série morte : l'adjacence compte", () => {
    // Arrêté depuis le 24 ; le jour off du 29 est distribué à tout le
    // monde, il ne doit pas redevenir « un dernier jour qui tient la
    // chaîne » (mesuré côté SQL : 21 jours réaffichés à tort).
    const offFin = new Set(["2025-03-29"]);
    const e = entries(suite("2025-03-20", "2025-03-24"));
    expect(computeSerie(MOI, e, F, offFin).streak).toBe(0);
  });

  it("le joker enjambe le jour off : le trou est après le repos", () => {
    // 3 parfaits, repos, trou, retour : le joker brûle sur le trou du 12,
    // jamais sur le jour off du 11.
    const e = entries([
      ...suite("2025-03-08", "2025-03-10"),
      ...suite("2025-03-13", "2025-03-14"),
    ]);
    const s = computeSerie(MOI, e, F, OFF);
    expect(s.jokerDay).toBe("2025-03-12");
    expect(s.bestStreak).toBe(5);
  });

  it("le retour du joker peut lui aussi enjamber un repos", () => {
    // Trou le 10, repos le 11, retour le 12 : le « lendemain » du trou
    // saute le jour off, le joker part quand même.
    const e = entries([
      ...suite("2025-03-03", "2025-03-09"),
      ...suite("2025-03-12", "2025-03-13"),
    ]);
    const s = computeSerie(MOI, e, F, OFF);
    expect(s.jokerDay).toBe("2025-03-10");
    expect(s.bestStreak).toBe(9);
  });
});

describe("computeStats", () => {
  it("sans joker ni jour off : les mêmes chiffres qu'avant le moteur", () => {
    // Non-régression sur l'ancien lib/stats.ts : 7 parfaits, un 2/3, un
    // zéro, 3 parfaits — vérifié à la main contre l'ancien algorithme.
    const e = entries(
      [...suite("2025-03-03", "2025-03-09"), ...suite("2025-03-12", "2025-03-14")],
      [["2025-03-10", true, true, false]],
    );
    const s = computeStats(MOI, e, F);
    expect(s.perfectDays).toBe(10);
    expect(s.completion).toBe(38); // 32 exos sur 84
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(7);
    expect(s.zeroDays).toBe(17); // le 11 + les 16 derniers jours
  });

  it("un jour off sans coche n'est ni un 3/3 ni un jour à zéro", () => {
    const OFF = new Set(["2025-03-11"]);
    const e = entries([
      ...suite("2025-03-08", "2025-03-10"),
      ...suite("2025-03-12", "2025-03-14"),
    ]);
    const s = computeStats(MOI, e, F, OFF);
    expect(s.perfectDays).toBe(6); // le repos ne fabrique pas de 3/3
    expect(s.bestStreak).toBe(6); // mais il préserve la série
    expect(s.zeroDays).toBe(21); // 22 jours vides moins le jour off
  });

  it("rend des zéros avant le début de la ligue", () => {
    const demain = fenetre("2999-01-01", "2999-01-28");
    const s = computeStats(MOI, new Map(), demain);
    expect(s).toEqual({
      perfectDays: 0,
      completion: 0,
      streak: 0,
      bestStreak: 0,
      zeroDays: 0,
    });
  });
});

describe("streakEnSursis — avec le jour off", () => {
  // Les cas sans jour off restent verrouillés par tests/joker-sursis.test.ts.
  it("se tait le lendemain d'un repos : la série tient déjà toute seule", () => {
    const OFF = new Set(["2025-03-11"]);
    const e = entries(suite("2025-03-03", "2025-03-10"));
    expect(streakEnSursis(MOI, e, null, "2025-03-12", F, OFF)).toBe(0);
  });

  it("annonce le sursis quand le trou précède le repos", () => {
    // Trou le 10, repos le 11 : au matin du 12, le 3/3 du jour est encore
    // le retour qui recolle (back = trou + 2 côté SQL).
    const OFF = new Set(["2025-03-11"]);
    const e = entries(suite("2025-03-03", "2025-03-09"));
    expect(streakEnSursis(MOI, e, null, "2025-03-12", F, OFF)).toBe(7);
  });

  it("enjambe un repos en comptant la série à sauver", () => {
    const OFF = new Set(["2025-03-06"]);
    const e = entries([
      ...suite("2025-03-03", "2025-03-05"),
      ...suite("2025-03-07", "2025-03-09"),
    ]);
    // Trou le 10 : la série d'avant vaut 6 (3 + 3, repos enjambé).
    expect(streakEnSursis(MOI, e, null, "2025-03-11", F, OFF)).toBe(6);
  });
});
