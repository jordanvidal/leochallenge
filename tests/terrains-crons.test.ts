// Le verrou qui protège la prod : sans variable de schéma, les crons bouclent
// sur un seul terrain, celui du challenge d'origine, avec sa fenêtre.
//
// C'est la propriété qui rend la phase 4 mergeable sans que rien ne bouge pour
// les neuf joueurs. Si elle casse, un cron pourrait ne notifier personne — ou
// notifier deux fois.

import { describe, expect, it } from "vitest";
import { FENETRE_ENV } from "@/lib/challenge";
import {
  JOUEURS_MINIMUM,
  surChaqueTerrain,
  TERRAIN_ENV,
  terrainsActifs,
} from "@/lib/server/ligues";

describe("terrainsActifs, en groupe unique", () => {
  it("rend exactement un terrain", async () => {
    const t = await terrainsActifs();
    expect(t).toHaveLength(1);
  });

  it("ce terrain n'a pas de ligue et porte la fenêtre des variables d'env", async () => {
    const [t] = await terrainsActifs();
    expect(t.ligue).toBeNull();
    expect(t.fenetre).toEqual(FENETRE_ENV);
  });

  it("ne touche pas la base : aucune ligue à aller chercher", async () => {
    // Si cet appel partait en requête, il échouerait faute d'URL Supabase
    // valide en test. Qu'il réponde prouve qu'il sort avant.
    await expect(terrainsActifs()).resolves.toHaveLength(1);
  });
});

describe("surChaqueTerrain", () => {
  it("appelle le travail une fois, avec le terrain du challenge", async () => {
    const vus: unknown[] = [];
    const r = await surChaqueTerrain(async (t) => {
      vus.push(t);
      return { sent: 3 };
    });
    expect(vus).toEqual([TERRAIN_ENV]);
    expect(r.terrains).toBe(1);
    expect(r.resultats).toEqual([{ ligue: null, sent: 3 }]);
  });

  it("attrape l'échec d'un terrain au lieu de faire tomber la route", async () => {
    // Une ligue qui hoquette ne doit pas priver les autres de leur récap.
    // Ici il n'y en a qu'une, mais c'est le même chemin de code.
    const r = await surChaqueTerrain(async () => {
      throw new Error("lecture Supabase échouée");
    });
    expect(r.terrains).toBe(1);
    expect(r.resultats).toEqual([
      { ligue: null, erreur: "lecture Supabase échouée" },
    ]);
  });
});

describe("le seuil de joueurs", () => {
  it("est de deux — une ligue d'une personne ne se notifie pas", () => {
    // Ce n'est pas une optimisation : « plus que 3 jours, ne lâche pas »
    // envoyé à quelqu'un qui n'a encore invité personne ne parle de personne.
    expect(JOUEURS_MINIMUM).toBe(2);
  });
});
