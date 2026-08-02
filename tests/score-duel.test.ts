// Le duel de la semaine et l'ordre du classement, côté moteur.
//
// Miroir de la vue duel_results : le duel se joue aux jours parfaits,
// se départage aux points de la semaine, sinon nul. Le jour off n'est
// pas un jour de duel : il ne fabrique de 3/3 pour personne, et il est
// le même pour les deux camps — neutre par construction.

import { describe, expect, it } from "vitest";
import type { Duel } from "@/lib/duels";
import { duelWinner, ordonneClassement, tallyDuel } from "@/lib/score";
import { Entry, entryKey } from "@/lib/types";

const A = "ali";
const B = "boris";

const DUEL: Duel = {
  week_monday: "2025-03-10",
  player_a: A,
  player_b: B,
};

/** Des 3/3 pour un joueur, aux jours donnés. */
function parfaits(m: Map<string, Entry>, playerId: string, days: string[]) {
  for (const day of days) {
    m.set(entryKey(playerId, day), {
      player_id: playerId,
      day,
      pushups: true,
      abs: true,
      squats: true,
    });
  }
}

describe("tallyDuel", () => {
  it("compte les jours parfaits de chaque camp sur la fenêtre", () => {
    const e = new Map<string, Entry>();
    parfaits(e, A, ["2025-03-10", "2025-03-11", "2025-03-12"]);
    parfaits(e, B, ["2025-03-10", "2025-03-13"]);
    const t = tallyDuel(e, DUEL, "2025-03-10", "2025-03-16");
    expect(t).toEqual({ perfectA: 3, perfectB: 2 });
  });

  it("ignore les jours hors fenêtre et les journées partielles", () => {
    const e = new Map<string, Entry>();
    parfaits(e, A, ["2025-03-09", "2025-03-17"]); // avant et après la semaine
    e.set(entryKey(B, "2025-03-11"), {
      player_id: B,
      day: "2025-03-11",
      pushups: true,
      abs: true,
      squats: false, // 2/3 : pas un jour parfait
    });
    const t = tallyDuel(e, DUEL, "2025-03-10", "2025-03-16");
    expect(t).toEqual({ perfectA: 0, perfectB: 0 });
  });

  it("un jour off est neutre : personne n'y marque de jour parfait", () => {
    // Le repos est un fait de calendrier, identique pour les deux camps :
    // aucune entrée ce jour-là, donc aucun 3/3 — le score du duel ne
    // bouge pas, exactement ce que fait la vue (tally lit entries).
    const e = new Map<string, Entry>();
    parfaits(e, A, ["2025-03-10"]);
    parfaits(e, B, ["2025-03-12"]);
    const avecOff = tallyDuel(e, DUEL, "2025-03-10", "2025-03-16");
    expect(avecOff).toEqual({ perfectA: 1, perfectB: 1 });
  });

  it("gère un duel sans adversaire (exempt)", () => {
    const e = new Map<string, Entry>();
    parfaits(e, A, ["2025-03-10"]);
    const t = tallyDuel(
      e,
      { ...DUEL, player_b: null },
      "2025-03-10",
      "2025-03-16",
    );
    expect(t).toEqual({ perfectA: 1, perfectB: 0 });
  });
});

describe("duelWinner", () => {
  it("donne la semaine au plus de jours parfaits", () => {
    expect(duelWinner({ perfectA: 3, perfectB: 2 }, 0, 100)).toBe("a");
    expect(duelWinner({ perfectA: 1, perfectB: 4 }, 100, 0)).toBe("b");
  });

  it("départage une égalité aux points de la semaine", () => {
    expect(duelWinner({ perfectA: 3, perfectB: 3 }, 41.5, 39)).toBe("a");
    expect(duelWinner({ perfectA: 3, perfectB: 3 }, 39, 41.5)).toBe("b");
  });

  it("déclare nul quand tout est égal", () => {
    expect(duelWinner({ perfectA: 3, perfectB: 3 }, 40, 40)).toBeNull();
  });
});

describe("ordonneClassement", () => {
  const noms = new Map([
    ["p1", "Léo"],
    ["p2", "Ali"],
    ["p3", "Zoé"],
  ]);

  it("trie par rang serveur, jamais par ordre d'arrivée des lignes", () => {
    const rows = [
      { player_id: "p3", rank: 2 },
      { player_id: "p1", rank: 1 },
    ];
    expect(ordonneClassement(rows, noms).map((r) => r.player_id)).toEqual([
      "p1",
      "p3",
    ]);
  });

  it("départage les ex æquo par le prénom, ordre stable", () => {
    const rows = [
      { player_id: "p1", rank: 1 },
      { player_id: "p3", rank: 1 },
      { player_id: "p2", rank: 1 },
    ];
    expect(ordonneClassement(rows, noms).map((r) => r.player_id)).toEqual([
      "p2", // Ali
      "p1", // Léo
      "p3", // Zoé
    ]);
  });
});
