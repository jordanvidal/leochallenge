// La mise de côté des duels, lue depuis DUELS_EXCLUS.
//
// Ces tests visent la saisie réelle : une variable Vercel se remplit à la
// main, un soir, sur un téléphone. On y met des espaces, on oublie une
// majuscule, on laisse une virgule qui traîne en retirant un nom. Rien de
// tout ça ne doit changer qui est écarté — et surtout, une chaîne vide ou
// bancale ne doit JAMAIS écarter tout le monde : un appariement vide, c'est
// une semaine sans duel pour six personnes.

import { describe, expect, it } from "vitest";
import { nomsExclus } from "../lib/duels";
import { normalizeName } from "../lib/palette";

/** Ce que fait createPairings : le prénom en base passe par la même
    normalisation avant d'être cherché dans l'ensemble. */
const estEcarte = (nomEnBase: string, raw: string | undefined) =>
  nomsExclus(raw).has(normalizeName(nomEnBase));

describe("nomsExclus", () => {
  it("lit la liste de la saison : Jerem, Hugo et Nathan", () => {
    expect(nomsExclus("Jerem, Hugo, Nathan")).toEqual(
      new Set(["jerem", "hugo", "nathan"]),
    );
  });

  it("ne retient personne quand la variable est absente ou vide", () => {
    // Le cas nominal de toutes les autres ligues, et celui du jour où
    // Jordan videra le champ : l'appariement doit reprendre à l'identique.
    expect(nomsExclus(undefined).size).toBe(0);
    expect(nomsExclus("").size).toBe(0);
    expect(nomsExclus("   ").size).toBe(0);
  });

  it("survit aux virgules qui traînent quand on retire un nom", () => {
    expect(nomsExclus("Jerem,,Hugo,")).toEqual(new Set(["jerem", "hugo"]));
  });
});

describe("qui est réellement écarté", () => {
  const LISTE = "jerem , HUGO,Nathan";

  it("pardonne la casse et les espaces des deux côtés", () => {
    expect(estEcarte("Jerem", LISTE)).toBe(true);
    expect(estEcarte("Hugo", LISTE)).toBe(true);
    expect(estEcarte("  Nathan ", LISTE)).toBe(true);
  });

  it("pardonne les accents : « Jérém » dans la liste écarte « Jerem » en base", () => {
    expect(estEcarte("Jerem", "Jérém")).toBe(true);
    expect(estEcarte("Jérém", "Jerem")).toBe(true);
  });

  it("laisse les autres joueurs dans le vivier", () => {
    expect(estEcarte("Jordan", LISTE)).toBe(false);
    expect(estEcarte("Doren", LISTE)).toBe(false);
    expect(estEcarte("Léo", LISTE)).toBe(false);
  });

  it("n'écarte personne sur une correspondance partielle", () => {
    // « Nath » n'est pas « Nathan » : on ne veut pas qu'un prénom court
    // écarte silencieusement un homonyme partiel.
    expect(estEcarte("Nath", LISTE)).toBe(false);
    expect(estEcarte("Nathanaël", LISTE)).toBe(false);
  });
});
