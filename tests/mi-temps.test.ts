// La mi-temps : ce qui doit rester vrai quel que soit le jour où on ouvre
// l'écran. Tout ce qui est testé ici est pur — aucune lecture Supabase.

import { describe, expect, it } from "vitest";
import { fenetre } from "@/lib/challenge";
import {
  angleDeRelance,
  buildMiTempsShare,
  gagnants,
  joinNoms,
  jourDeMiTemps,
  MiTempsData,
  ouvertureMiTemps,
  premiersDuJour,
} from "@/lib/mitemps";
import { LeaderboardRow } from "@/lib/gamification";

const CHALLENGE = fenetre("2026-07-13", "2026-08-31", "2026-07-27");

function ligne(p: Partial<LeaderboardRow> & { player_id: string }): LeaderboardRow {
  return {
    points: 0,
    rank: 1,
    perfect_days: 0,
    exos_done: 0,
    current_streak: 0,
    bonus_points: 0,
    ...p,
  };
}

describe("la date de la mi-temps", () => {
  it("coupe le challenge d'origine au 6 août, ouverture le 7", () => {
    // 50 jours du 13/07 au 31/08 : 25 faits au soir du 06/08, 25 devant.
    expect(jourDeMiTemps(CHALLENGE)).toBe("2026-08-06");
    expect(ouvertureMiTemps(CHALLENGE)).toBe("2026-08-07");
  });

  it("sur un nombre impair de jours, la première moitié prend le milieu", () => {
    // 7 jours : 4 faits, 3 devant — jamais l'inverse, sinon l'écran
    // promettrait plus de jours restants qu'il n'en existe.
    const court = fenetre("2026-03-02", "2026-03-08");
    expect(jourDeMiTemps(court)).toBe("2026-03-05");
  });
});

describe("les distinctions", () => {
  it("nomme tous les ex æquo plutôt que d'en départager un au hasard", () => {
    const g = gagnants(
      ["a", "b", "c"],
      (id) => id,
      (id) => (id === "c" ? 1 : 18),
    );
    expect(g.ids).toEqual(["a", "b"]);
    expect(g.valeur).toBe(18);
  });

  it("ne distingue personne quand tout le monde est à zéro", () => {
    const g = gagnants(["a", "b"], (id) => id, () => 0);
    expect(g.ids).toEqual([]);
  });

  it("énumère les noms à la française", () => {
    expect(joinNoms(["Pierre"])).toBe("Pierre");
    expect(joinNoms(["Pierre", "Léo"])).toBe("Pierre et Léo");
    expect(joinNoms(["Pierre", "Léo", "Doren"])).toBe("Pierre, Léo et Doren");
  });
});

describe("le premier du jour", () => {
  it("compte le 3/3 le plus tôt de chaque journée", () => {
    const compte = premiersDuJour(
      [
        { player_id: "a", day: "2026-07-14", completed_at: "2026-07-14T05:10:00Z" },
        { player_id: "b", day: "2026-07-14", completed_at: "2026-07-14T18:00:00Z" },
        { player_id: "b", day: "2026-07-15", completed_at: "2026-07-15T06:00:00Z" },
      ],
      "2026-08-06",
      "2026-07-13",
    );
    expect(compte.get("a")).toBe(1);
    expect(compte.get("b")).toBe(1);
  });

  it("ignore les journées postérieures à la mi-temps", () => {
    const compte = premiersDuJour(
      [{ player_id: "a", day: "2026-08-07", completed_at: "2026-08-07T05:00:00Z" }],
      "2026-08-06",
      "2026-07-13",
    );
    expect(compte.size).toBe(0);
  });

  it("ignore un 3/3 horodaté un autre jour que sa journée de jeu", () => {
    // Coche rattrapée après minuit : elle garde la date de la journée de
    // jeu, mais elle n'a pas été la plus matinale de cette journée-là.
    const compte = premiersDuJour(
      [{ player_id: "a", day: "2026-07-14", completed_at: "2026-07-16T05:00:00Z" }],
      "2026-08-06",
      "2026-07-13",
    );
    expect(compte.size).toBe(0);
  });
});

describe("l'angle de relance", () => {
  const noms = new Map([
    ["p1", "Pierre"],
    ["p2", "Doren"],
    ["p3", "Jordan"],
  ]);
  const classement = [
    ligne({ player_id: "p1", rank: 1, points: 702.5, current_streak: 21 }),
    ligne({ player_id: "p2", rank: 2, points: 623.5, current_streak: 18 }),
    ligne({ player_id: "p3", rank: 3, points: 598.5, exos_done: 57 }),
  ];

  const ctx = { joursFaits: 25, joursRestants: 25 };

  it("au premier, parle de son avance — pas de son retard", () => {
    const t = angleDeRelance(classement[0], 21, classement, noms, ctx);
    expect(t).toContain("en tête");
    expect(t).toContain("79 pts");
  });

  it("aux autres, vise l'échelon juste au-dessus, jamais le premier", () => {
    const t = angleDeRelance(classement[2], 9, classement, noms, ctx);
    expect(t).toContain("Doren");
    expect(t).not.toContain("Pierre");
    expect(t).toContain("25 pts");
  });

  it("tait un écart hors de portée plutôt que de le jeter à la figure", () => {
    // Une semaine au sommet vaut ici 702,5 / 25 × 7 ≈ 197 pts. À 339 pts du
    // joueur de devant, annoncer l'écart démoralise au lieu de relancer :
    // on bascule sur le classement hebdo, où tout le monde repart à zéro.
    const decroche = ligne({ player_id: "p9", rank: 6, points: 45.5, exos_done: 9 });
    const avec = [...classement, ligne({ player_id: "p4", rank: 5, points: 384.5 }), decroche];
    const t = angleDeRelance(decroche, 3, avec, noms, ctx);
    expect(t).not.toContain("339");
    expect(t).toContain("repart de zéro");
  });

  it("à celui qui n'a jamais validé un exo, ne promet aucune série", () => {
    const zero = ligne({ player_id: "p9", rank: 8, points: 0 });
    const t = angleDeRelance(zero, 0, [...classement, zero], noms, ctx);
    expect(t).toContain("25 jours devant toi");
    expect(t).not.toContain("Ta série");
  });
});

describe("le partage", () => {
  const data: MiTempsData = {
    joursFaits: 25,
    joursRestants: 25,
    totalExos: 351,
    totalReps: 35100,
    joursParfaitsCollectifs: 118,
    seances: 91,
    mvps: [
      { emoji: "🔥", noms: ["Pierre"], exploit: "tient la plus longue série : 25 jours parfaits" },
    ],
    top3: [
      { name: "Pierre", color: "", points: 702.5 },
      { name: "Doren", color: "", points: 623.5 },
      { name: "Jordan", color: "", points: 598.5 },
    ],
    duels: { tranches: 6, nuls: 0 },
    me: { rank: 3, points: 598.5, exos: 57, perfectDays: 19, bestStreak: 19, relance: "" },
  };

  it("partage le collectif, jamais les chiffres perso", () => {
    const texte = buildMiTempsShare(data);
    expect(texte).toContain("25 jours faits, 25 restants");
    // Espace insécable ou non : `toLocaleString('fr-FR')` choisit, comme
    // partout ailleurs dans lib/share.ts.
    expect(texte).toMatch(/35\s100 répétitions/);
    expect(texte).toContain("🥇 Pierre — 702.5 pts");
    expect(texte).toContain("6 duels tranchés");
    // La carte « Toi » ne fuite pas dans le message du groupe.
    expect(texte).not.toContain("meilleure série");
  });

  it("tait la ligne des duels quand il n'y en a pas eu", () => {
    const sansDuel = { ...data, duels: { tranches: 0, nuls: 0 } };
    expect(buildMiTempsShare(sansDuel)).not.toContain("⚔️");
  });
});
