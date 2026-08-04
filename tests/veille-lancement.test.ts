// Le verrou de la veille de lancement.
//
// Ce qui compte ici n'est pas que le message parte — c'est que la porte
// ouverte pour lui n'ait pas élargi celle de tous les autres crons. La
// demande d'origine était d'étendre `terrainsActifs` à J-1 ; si quelqu'un le
// refait un jour, une ligue recevrait « Personne n'a encore fini
// aujourd'hui » et « Ta série est en jeu » la veille de son premier jour,
// pour un jour où il n'y a rien à finir et aucune série à tenir.
//
// En test il n'y a pas de Supabase : les requêtes sur `app` échouent, et les
// deux fonctions rendent donc ce qu'elles doivent rendre dans ce cas — le
// challenge d'origine seul pour l'une, rien du tout pour l'autre. C'est
// exactement le scénario de panne qu'on veut voir tenir.

import { describe, expect, it } from "vitest";
import { FENETRE_ENV } from "@/lib/challenge";
import {
  terrainsActifs,
  terrainsQuiDemarrentDemain,
} from "@/lib/server/ligues";

describe("terrainsQuiDemarrentDemain", () => {
  it("n'inclut jamais le challenge d'origine", async () => {
    // Sa fenêtre vient de l'environnement et son premier jour est derrière
    // nous : il n'a pas de veille de lancement, et il n'y a aucune ligue à
    // lire pour lui.
    const t = await terrainsQuiDemarrentDemain();
    expect(t.every((x) => x.ligue !== null)).toBe(true);
  });

  it("se tait quand le schéma des ligues est injoignable", async () => {
    // Le cron de 20h porte les rappels du soir, c'est-à-dire le cœur du
    // produit. Une lecture ratée sur `app` ne doit jamais le faire tomber.
    await expect(terrainsQuiDemarrentDemain()).resolves.toEqual([]);
  });

  it("ne partage aucun terrain avec terrainsActifs", async () => {
    // La propriété qui garantit que personne ne reçoit les deux messages :
    // une ligue est soit en cours, soit à la veille de son premier jour.
    const [actifs, veilles] = await Promise.all([
      terrainsActifs(),
      terrainsQuiDemarrentDemain(),
    ]);
    const ids = new Set(actifs.map((t) => t.ligue?.id ?? "env"));
    expect(veilles.some((t) => ids.has(t.ligue?.id ?? "env"))).toBe(false);
  });
});

describe("terrainsActifs n'a pas bougé", () => {
  it("rend toujours le seul challenge d'origine, avec sa fenêtre", async () => {
    // Le test qui échouerait si on élargissait `terrainsActifs` à J-1 au
    // lieu d'ajouter une porte à côté.
    const t = await terrainsActifs();
    expect(t).toHaveLength(1);
    expect(t[0].ligue).toBeNull();
    expect(t[0].schema).toBe("public");
    expect(t[0].fenetre).toEqual(FENETRE_ENV);
  });
});
