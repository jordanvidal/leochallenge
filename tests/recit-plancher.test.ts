// Le plancher du récit : l'angle « chute » doit dire ce qui reste debout,
// pas seulement de combien on est tombé. La règle est déterministe et se
// vérifie sans base — c'est du français fabriqué à partir de faits.
//
// Ce que ces tests protègent, c'est une décision produit, pas une mise en
// forme : la chute reste entière et chiffrée, mais elle cesse d'être la
// seule chose que la carte sache dire de quelqu'un. Voir
// docs/spec-recit-hebdo.md §7, règle 5 — jamais un adjectif sans un
// chiffre derrière. Aucun mot ajouté ici n'est un adjectif.

import { describe, expect, it } from "vitest";
import { eventPhrase, type FeedEvent } from "@/lib/feed";

function chute(payload: Record<string, unknown>): string {
  const e = {
    id: "x",
    player_id: "p1",
    kind: "recit",
    created_at: "2026-07-27T06:00:00Z",
    payload: { angle: "chute", week_monday: "2026-07-20", ...payload },
  } as unknown as FeedEvent;
  return eventPhrase(e).text;
}

describe("le plancher de l'angle « chute »", () => {
  it("nomme les jours parfaits à côté des jours vides", () => {
    const t = chute({ rank: 5, rank_before: 3, jours_vides: 2, parfaits: 3 });
    expect(t).toContain("était 3e il y a une semaine, il est 5e");
    expect(t).toContain("2 jours sans une seule coche");
    expect(t).toContain("et 3 jours parfaits");
  });

  it("accorde le singulier des deux côtés", () => {
    const t = chute({ rank: 4, rank_before: 2, jours_vides: 1, parfaits: 1 });
    expect(t).toContain("1 jour sans une seule coche");
    expect(t).toContain("et 1 jour parfait");
    expect(t).not.toContain("parfaits");
  });

  it("ne maquille pas une semaine à zéro jour parfait", () => {
    const t = chute({ rank: 6, rank_before: 4, jours_vides: 4, parfaits: 0 });
    expect(t).toContain("4 jours sans une seule coche.");
    expect(t).not.toContain("parfait");
  });

  it("ne dit rien de plus quand `parfaits` manque du payload", () => {
    const t = chute({ rank: 6, rank_before: 4, jours_vides: 3 });
    expect(t).toContain("3 jours sans une seule coche.");
    expect(t).not.toContain("parfait");
  });

  it("laisse intacte la branche sans jour vide, qui a déjà ses chiffres", () => {
    const t = chute({
      rank: 5,
      rank_before: 3,
      jours_vides: 0,
      parfaits: 2,
      finish: 4,
      foil: "Léo",
      foil_finish: 12,
    });
    expect(t).toContain("4 pts sur les deux derniers jours");
    expect(t).toContain("contre 12 à Léo");
    expect(t).not.toContain("jour parfait");
  });

  it("la chute reste entière : le rang d'avant et celui d'après sont toujours dits", () => {
    const t = chute({ rank: 6, rank_before: 1, jours_vides: 5, parfaits: 1 });
    expect(t).toContain("était 1er il y a une semaine, il est 6e");
  });
});

describe("le garde-fou d'un kind inconnu", () => {
  it("rend une phrase au lieu de faire tomber le fil", () => {
    const e = {
      id: "x",
      player_id: "p1",
      kind: "un_kind_ecrit_par_un_job_plus_recent",
      created_at: "2026-07-27T06:00:00Z",
      payload: {},
    } as unknown as FeedEvent;
    const r = eventPhrase(e);
    expect(r).toBeDefined();
    expect(typeof r.emoji).toBe("string");
    expect(r.text.length).toBeGreaterThan(0);
  });
});
