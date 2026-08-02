// Les déclarations de bonus dans la file d'attente (lib/bonus.ts).
//
// Trois contrats à défendre :
//   1. Le classement des réponses — un message de trigger est un refus
//      définitif (rollback visible), un doublon d'unicité au rejeu est un
//      SUCCÈS (l'écriture était déjà passée : c'est ça, l'idempotence),
//      et tout le reste est du réseau, à retenter.
//   2. La clé d'idempotence — stable, alignée sur la contrainte
//      `unique (player_id, day, bonus_key)` de la base.
//   3. La fusion file → état — après un re-fetch, un bonus « noté » hors
//      ligne reste visible, et un retrait en attente reste retiré.

import { describe, expect, it } from "vitest";
import {
  appliquerFileBonus,
  BonusState,
  cleEcritureBonus,
  estEcritureBonus,
  issueEcritureBonus,
  OUTBOX_BONUS_CLAIM,
  OUTBOX_BONUS_UNCLAIM,
} from "@/lib/bonus";
import { parisToday } from "@/lib/challenge";
import { OutboxEntry } from "@/lib/outbox";

describe("issueEcritureBonus", () => {
  it("sans erreur : parti", () => {
    expect(issueEcritureBonus(null, "insert")).toBe("ok");
    expect(issueEcritureBonus(null, "delete")).toBe("ok");
  });

  it("doublon d'unicité au rejeu d'un insert : un succès, pas un échec", () => {
    // Le cas exact du mode avion : l'insert est passé, la réponse s'est
    // perdue, la file rejoue. La contrainte d'unicité répond « déjà là ».
    expect(
      issueEcritureBonus(
        'duplicate key value violates unique constraint "bonus_claims_player_id_day_bonus_key_key"',
        "insert",
      ),
    ).toBe("ok");
  });

  it("les messages des triggers sont des refus définitifs", () => {
    for (const m of [
      "CAP_JOUR: 2 bonus d'exercice max par jour",
      "CAP_SEMAINE: plafond de 25 pts",
      "JOUR_VERROUILLE: seul le jour en cours est déclarable",
      "JOUR_FUTUR: on ne déclare pas en avance",
      "BOSS_INACTIF: pas de boss ce jour-là",
      "BONUS_INCONNU: xyz n'est pas au catalogue",
      "BONUS_NON_DECLARABLE: cap_claims_jour est automatique",
      'new row violates check constraint "bonus_day_in_challenge"',
    ]) {
      expect(issueEcritureBonus(m, "insert")).toEqual({ refus: m });
    }
  });

  it("un échec réseau se retente", () => {
    expect(issueEcritureBonus("TypeError: Failed to fetch", "insert")).toBe(
      "retry",
    );
    expect(issueEcritureBonus("Load failed", "delete")).toBe("retry");
  });

  it("JOUR_VERROUILLE sur un delete reste un refus (pas un rejeu)", () => {
    const m = "JOUR_VERROUILLE: seul le jour en cours est déclarable";
    expect(issueEcritureBonus(m, "delete")).toEqual({ refus: m });
  });
});

describe("cleEcritureBonus", () => {
  it("est le triplet de la contrainte d'unicité, stable", () => {
    expect(cleEcritureBonus("p1", "2026-08-02", "pompes_50")).toBe(
      "bonus:p1:2026-08-02:pompes_50",
    );
    // Déclarer et annuler partagent la clé : hors ligne, le dernier
    // geste remplace l'autre dans la file — c'est le mécanisme qui fait
    // qu'un aller-retour de pouce ne laisse qu'une écriture, ou aucune.
    expect(cleEcritureBonus("p1", "2026-08-02", "pompes_50")).toBe(
      cleEcritureBonus("p1", "2026-08-02", "pompes_50"),
    );
  });
});

// ---- Fusion file → état --------------------------------------------

const AUJOURD_HUI = parisToday();

function etat(claims: BonusState["todayClaims"]): BonusState {
  return {
    catalog: [],
    event: null,
    todayClaims: claims.filter((c) => c.day === AUJOURD_HUI),
    weekClaims: claims,
  };
}

function entree(
  kind: string,
  bonusKey: string,
  day = AUJOURD_HUI,
  seq = 1,
): OutboxEntry {
  return {
    key: cleEcritureBonus("p1", day, bonusKey),
    kind,
    payload: { playerId: "p1", bonusKey, points: 4 },
    day,
    createdAt: 0,
    seq,
    attempts: 0,
    nextTryAt: 0,
  };
}

describe("appliquerFileBonus", () => {
  it("sans file, l'état ressort intact (même référence)", () => {
    const s = etat([]);
    expect(appliquerFileBonus(s, [])).toBe(s);
  });

  it("une déclaration en attente reste visible après un re-fetch", () => {
    const s = appliquerFileBonus(etat([]), [
      entree(OUTBOX_BONUS_CLAIM, "pompes_50"),
    ]);
    expect(s.todayClaims).toHaveLength(1);
    expect(s.todayClaims[0].bonus_key).toBe("pompes_50");
    expect(s.weekClaims).toHaveLength(1);
  });

  it("ne duplique pas une déclaration que la base connaît déjà", () => {
    const deja = {
      player_id: "p1",
      day: AUJOURD_HUI,
      bonus_key: "pompes_50",
      points: 4,
    };
    const s = appliquerFileBonus(etat([deja]), [
      entree(OUTBOX_BONUS_CLAIM, "pompes_50"),
    ]);
    expect(s.todayClaims).toHaveLength(1);
    expect(s.weekClaims).toHaveLength(1);
  });

  it("un retrait en attente efface la ligne lue en base", () => {
    const deja = {
      player_id: "p1",
      day: AUJOURD_HUI,
      bonus_key: "pompes_50",
      points: 4,
    };
    const s = appliquerFileBonus(etat([deja]), [
      entree(OUTBOX_BONUS_UNCLAIM, "pompes_50"),
    ]);
    expect(s.todayClaims).toHaveLength(0);
    expect(s.weekClaims).toHaveLength(0);
  });

  it("une déclaration d'hier soir encore en file ne pollue pas aujourd'hui", () => {
    // Notée à 23h58, toujours pas partie : elle porte son jour à elle.
    // Elle compte dans la semaine, pas dans « aujourd'hui ».
    const hier = "2000-01-01"; // n'importe quel jour ≠ aujourd'hui
    const s = appliquerFileBonus(etat([]), [
      entree(OUTBOX_BONUS_CLAIM, "pompes_50", hier),
    ]);
    expect(s.todayClaims).toHaveLength(0);
    expect(s.weekClaims).toHaveLength(1);
    expect(s.weekClaims[0].day).toBe(hier);
  });

  it("ignore ce qui n'est pas une écriture bonus", () => {
    const autre: OutboxEntry = {
      ...entree("tchat.message", "x"),
      kind: "tchat.message",
    };
    expect(estEcritureBonus(autre)).toBe(false);
    const s = etat([]);
    expect(appliquerFileBonus(s, [autre])).toBe(s);
  });
});
