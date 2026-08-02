// L'ordre d'affichage du classement.
//
// `app.leaderboard()` n'a pas d'`order by` : le select final lit
// `from app.players p` et se repose sur le fait qu'une fenêtre
// `rank() over (order by points desc)` sort en général déjà triée. C'est un
// détail d'implémentation, pas une garantie — et l'app ne retriait rien, donc
// `podium[0]` était supposé premier sans que rien ne l'impose.
//
// Ces tests tiennent les deux moitiés : le rang du serveur fait loi, et deux
// ex æquo sont départagés de façon stable.

import { describe, expect, it } from "vitest";
import { ordonneClassement } from "@/lib/gamification";

const NOMS = new Map([
  ["doren", "Doren"],
  ["jordan", "Jordan"],
  ["pierre", "Pierre"],
  ["leo", "Léo"],
]);

/** Le strict nécessaire : le comparateur ne lit que ces deux champs. */
function ligne(player_id: string, rank: number) {
  return { player_id, rank };
}

const noms = (rows: { player_id: string }[]) =>
  rows.map((r) => NOMS.get(r.player_id));

describe("ordonneClassement", () => {
  it("remet dans l'ordre des lignes rendues en désordre", () => {
    // Le cas que rien n'empêchait : Postgres rend les lignes comme il veut.
    const desordre = [ligne("pierre", 3), ligne("doren", 1), ligne("jordan", 2)];
    expect(noms(ordonneClassement(desordre, NOMS))).toEqual([
      "Doren",
      "Jordan",
      "Pierre",
    ]);
  });

  it("départage deux ex æquo par le nom", () => {
    // `rank()` donne le même rang aux deux : sans second critère, l'ordre
    // dépend de celui d'arrivée, donc il change d'un rechargement à l'autre.
    const exaequo = [ligne("pierre", 2), ligne("jordan", 2), ligne("doren", 1)];
    expect(noms(ordonneClassement(exaequo, NOMS))).toEqual([
      "Doren",
      "Jordan",
      "Pierre",
    ]);
  });

  it("rend le même ordre quel que soit l'ordre d'entrée", () => {
    // C'est tout l'enjeu : le Classement et le podium du bilan hebdo lisent
    // deux appels RPC distincts. Ils doivent nommer les mêmes gens dans le
    // même sens.
    const a = [ligne("jordan", 2), ligne("pierre", 2), ligne("doren", 1)];
    const b = [ligne("pierre", 2), ligne("doren", 1), ligne("jordan", 2)];
    expect(noms(ordonneClassement(a, NOMS))).toEqual(
      noms(ordonneClassement(b, NOMS)),
    );
  });

  it("range Léo avec l'accent au bon endroit", () => {
    // localeCompare en "fr" : Léo se classe entre Jordan et Pierre, pas après
    // Z comme le ferait une comparaison de codes.
    const exaequo = [ligne("pierre", 1), ligne("leo", 1), ligne("jordan", 1)];
    expect(noms(ordonneClassement(exaequo, NOMS))).toEqual([
      "Jordan",
      "Léo",
      "Pierre",
    ]);
  });

  it("ne modifie pas le tableau reçu", () => {
    // Les lignes viennent du state React : les trier en place serait une
    // mutation silencieuse d'une prop.
    const source = [ligne("pierre", 2), ligne("doren", 1)];
    ordonneClassement(source, NOMS);
    expect(noms(source)).toEqual(["Pierre", "Doren"]);
  });

  it("survit à un nom inconnu", () => {
    // Un joueur retiré de la ligue entre deux chargements : on ne plante pas.
    const orphelin = [ligne("fantome", 1), ligne("doren", 1)];
    expect(() => ordonneClassement(orphelin, NOMS)).not.toThrow();
    expect(ordonneClassement(orphelin, NOMS)).toHaveLength(2);
  });
});
