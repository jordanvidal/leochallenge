// Le verrou qui protège la prod : sans variable de schéma, les crons bouclent
// sur un seul terrain, celui du challenge d'origine, avec sa fenêtre.
//
// C'est la propriété qui rend la phase 4 mergeable sans que rien ne bouge pour
// les neuf joueurs. Si elle casse, un cron pourrait ne notifier personne — ou
// notifier deux fois.

import { describe, expect, it, vi } from "vitest";
import { FENETRE_ENV } from "@/lib/challenge";
import {
  JOUEURS_MINIMUM,
  surChaqueTerrain,
  TERRAIN_ENV,
  terrainsActifs,
} from "@/lib/server/ligues";

describe("terrainsActifs, les deux mondes", () => {
  it("ouvre toujours sur le challenge d'origine tant qu'il tourne", async () => {
    const [t] = await terrainsActifs();
    expect(t.ligue).toBeNull();
    expect(t.fenetre).toEqual(FENETRE_ENV);
    expect(t.schema).toBe("public");
  });

  it("rend le challenge même quand les ligues sont injoignables", async () => {
    // En test il n'y a pas de Supabase : la requête sur `app` échoue. C'est
    // exactement le scénario qui compte — les neuf joueurs ne doivent pas
    // perdre un rappel parce que le schéma des ligues a hoqueté.
    const t = await terrainsActifs();
    expect(t).toHaveLength(1);
    expect(t[0].schema).toBe("public");
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

  it("crie dans les logs au lieu de se taire", async () => {
    // Le compte-rendu ne suffit pas : le tirage de « Les sangcho » a échoué
    // quatre matins de suite sans qu'aucune alerte ne sorte. L'erreur doit
    // atterrir dans les logs Vercel, pas seulement dans le corps de la
    // réponse HTTP.
    const espion = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await surChaqueTerrain(async () => {
        throw new Error("tirage échoué : row-level security");
      });
      expect(espion).toHaveBeenCalledOnce();
      expect(String(espion.mock.calls[0][0])).toContain("[cron] terrain");
    } finally {
      espion.mockRestore();
    }
  });
});

describe("le seuil de joueurs", () => {
  it("est de deux — une ligue d'une personne ne se notifie pas", () => {
    // Ce n'est pas une optimisation : « plus que 3 jours, ne lâche pas »
    // envoyé à quelqu'un qui n'a encore invité personne ne parle de personne.
    expect(JOUEURS_MINIMUM).toBe(2);
  });
});
