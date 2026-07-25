// La règle du record de volume est déterministe et rejouable : elle se
// vérifie sans base. Chaque test ci-dessous est une ligne du tableau des
// cas limites de docs/spec-record-volume.md.

import { describe, expect, it } from "vitest";
import { type VolumeClaim, volumeDedupeKey, volumeRecords } from "@/lib/records";

// Le catalogue réel, réduit à ce qui compte ici : les trois échelles du
// contrat, une échelle hors contrat (les fentes), et des bonus sans échelle.
const LADDERS = new Map<string, string | null>([
  ["pompes_50", "pompes"],
  ["pompes_100", "pompes"],
  ["abdos_100", "abdos"],
  ["abdos_200", "abdos"],
  ["squats_100", "squats"],
  ["squats_200", "squats"],
  ["fentes_100", "fentes"],
  ["fentes_200", "fentes"],
  ["course_5km", null],
  ["pas_10000", null],
  ["gainage_3min", null],
  ["corde_10min", null],
]);

const TODAY = "2026-07-25";

/** Raccourci de lisibilité : ("jordan", "2026-07-24", "pompes_50", …). */
function claims(
  ...rows: [player: string, day: string, key: string][]
): VolumeClaim[] {
  return rows.map(([player_id, day, bonus_key]) => ({
    player_id,
    day,
    bonus_key,
  }));
}

describe("volumeRecords", () => {
  it("ne déclenche pas sur la première déclaration de la vie du joueur", () => {
    // Il faut un record antérieur à dépasser. Sans passé, pas de carte —
    // c'est le garde qui fait passer la recette de 13 cartes à 7.
    const { records } = volumeRecords(
      claims(["jordan", TODAY, "pompes_100"]),
      LADDERS,
      TODAY,
    );
    expect(records).toEqual([]);
  });

  it("ne déclenche pas quand le volume égale le record", () => {
    // Égaler n'est pas battre : la comparaison est strictement supérieure.
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_100"],
        ["jordan", TODAY, "abdos_100"],
      ),
      LADDERS,
      TODAY,
    );
    expect(records).toEqual([]);
  });

  it("déclenche quand le volume dépasse le meilleur jour précédent", () => {
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-19", "pompes_100"],
        ["jordan", "2026-07-20", "abdos_200"],
        ["jordan", TODAY, "squats_200"],
        ["jordan", TODAY, "pompes_100"],
      ),
      LADDERS,
      TODAY,
    );
    // 300 aujourd'hui contre 200 le 20/07 — et pas contre le 19/07 : c'est
    // le MEILLEUR jour précédent qui fait référence, pas le dernier.
    expect(records).toEqual([
      { player_id: "jordan", day: TODAY, reps: 300, before: 200 },
    ]);
  });

  it("additionne les paliers cumulés d'une même échelle", () => {
    // Depuis la migration 22, pompes_50 et pompes_100 cochés le même jour
    // font 150, pas 100.
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "abdos_100"],
        ["jordan", TODAY, "pompes_50"],
        ["jordan", TODAY, "pompes_100"],
      ),
      LADDERS,
      TODAY,
    );
    expect(records[0].reps).toBe(150);
  });

  it("laisse la course, les pas et les autres à-côtés hors du total", () => {
    // Le contrat, c'est pompes/abdos/squats. Une course ne fait pas un
    // record de volume, sinon le record suivrait le tarif et pas l'effort.
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_100"],
        ["jordan", TODAY, "pompes_100"],
        ["jordan", TODAY, "course_5km"],
        ["jordan", TODAY, "pas_10000"],
        ["jordan", TODAY, "gainage_3min"],
        ["jordan", TODAY, "corde_10min"],
      ),
      LADDERS,
      TODAY,
    );
    // 100 contre 100 : égalité, donc rien. Les quatre à-côtés du jour n'ont
    // pas fait pencher la balance.
    expect(records).toEqual([]);
  });

  it("ignore une échelle hors contrat sans abandonner le calcul", () => {
    // Les fentes ont bien une échelle, mais ce n'est pas le contrat : elles
    // sortent du total sans pour autant rendre le joueur incalculable.
    const { records, abandoned } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_50"],
        ["jordan", TODAY, "pompes_100"],
        ["jordan", TODAY, "fentes_200"],
      ),
      LADDERS,
      TODAY,
    );
    expect(abandoned.size).toBe(0);
    expect(records[0]).toMatchObject({ reps: 100, before: 50 });
  });

  it("abandonne le joueur si un palier du contrat manque à la table", () => {
    // Un palier ajouté au catalogue et oublié dans REPS_PAR_PALIER : le
    // total serait partiel. Mieux vaut aucune carte qu'un record
    // sous-évalué qui s'annonce quand même.
    const inconnu = new Map(LADDERS).set("pompes_200", "pompes");
    const { records, abandoned } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_50"],
        ["jordan", TODAY, "pompes_200"],
      ),
      inconnu,
      TODAY,
    );
    expect(records).toEqual([]);
    expect(abandoned.has("jordan")).toBe(true);
  });

  it("abandonne aussi quand le palier inconnu est dans le passé", () => {
    // Le passé est la référence : sous-évalué, il ferait tomber une carte
    // pour un record qui n'en est pas un. 100 aujourd'hui battrait un 50
    // faussement bas, alors que la vraie journée du 20/07 vaut 250.
    const inconnu = new Map(LADDERS).set("pompes_200", "pompes");
    const { records, abandoned } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_50"],
        ["jordan", "2026-07-20", "pompes_200"],
        ["jordan", TODAY, "pompes_100"],
      ),
      inconnu,
      TODAY,
    );
    expect(records).toEqual([]);
    expect(abandoned.has("jordan")).toBe(true);
  });

  it("n'abandonne que le joueur concerné, pas le groupe", () => {
    const inconnu = new Map(LADDERS).set("pompes_200", "pompes");
    const { records, abandoned } = volumeRecords(
      claims(
        ["jordan", TODAY, "pompes_200"],
        ["doren", "2026-07-20", "abdos_100"],
        ["doren", TODAY, "abdos_200"],
      ),
      inconnu,
      TODAY,
    );
    expect([...abandoned]).toEqual(["jordan"]);
    expect(records).toEqual([
      { player_id: "doren", day: TODAY, reps: 200, before: 100 },
    ]);
  });

  it("ne rend rien pour une journée sans déclaration sur les trois exos", () => {
    // Volume 0 : jamais un record, même avec un passé chargé.
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_100"],
        ["jordan", TODAY, "course_5km"],
      ),
      LADDERS,
      TODAY,
    );
    expect(records).toEqual([]);
  });

  it("retire le joueur des records dès qu'il décoche sous son record", () => {
    // Le décochage repasse par la même route : la déclaration du jour
    // disparaît, le joueur n'est plus dans `records`, la route supprime sa
    // carte. C'est ce qui empêche le fil d'affirmer un record annulé.
    const avant = claims(
      ["jordan", "2026-07-20", "pompes_100"],
      ["jordan", TODAY, "pompes_100"],
      ["jordan", TODAY, "abdos_100"],
    );
    expect(volumeRecords(avant, LADDERS, TODAY).records).toHaveLength(1);

    const apres = avant.filter((c) => c.bonus_key !== "abdos_100");
    expect(volumeRecords(apres, LADDERS, TODAY).records).toEqual([]);
  });

  it("compte les saisons précédentes : le record est à vie", () => {
    // Un gros jour de S1 reste la référence en S3. C'est ce qui rend le
    // record rare et mérité — il ne se réinitialise pas chaque saison.
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-15", "squats_200"],
        ["jordan", "2026-07-15", "pompes_100"],
        ["jordan", TODAY, "squats_200"],
      ),
      LADDERS,
      TODAY,
    );
    expect(records).toEqual([]);
  });

  it("ne regarde pas les jours postérieurs au jour évalué", () => {
    const { records } = volumeRecords(
      claims(
        ["jordan", "2026-07-20", "pompes_50"],
        ["jordan", TODAY, "pompes_100"],
        ["jordan", "2026-07-26", "squats_200"],
      ),
      LADDERS,
      TODAY,
    );
    expect(records[0]).toMatchObject({ reps: 100, before: 50 });
  });
});

describe("volumeDedupeKey", () => {
  it("préfixe le jour, pour ne jamais collisionner avec un record de série", () => {
    // Le record de série se dédup sur une date nue (son jour de départ
    // d'îlot) : sans préfixe, les deux familles s'écraseraient.
    expect(volumeDedupeKey("2026-07-25")).toBe("vol:2026-07-25");
    expect(volumeDedupeKey("2026-07-25")).not.toBe("2026-07-25");
  });
});
