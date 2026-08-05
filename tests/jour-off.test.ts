// Le jour off, côté serveur : les deux gardes qui protègent la prod.
//
// 1. LES LIGUES N'ONT PAS DE JOUR OFF. Le schéma `app` est resté au
//    barème S3 : ni la table `jours_off`, ni la fonction `get_jour_off`.
//    Un appel qui partirait quand même remonterait une erreur Supabase à
//    chaque cron, tous les matins. La garde doit tomber AVANT la requête.
//
// 2. UNE LECTURE RATÉE NE REND PAS L'APP MUETTE. `estJourOff` décide du
//    silence des trois rappels du soir. Si elle répondait « oui » sur une
//    table injoignable, une panne Supabase de dix minutes à 20h ferait
//    disparaître la pression sociale — le cœur du produit — sans que
//    personne ne comprenne pourquoi. Elle répond « non » : un rappel de
//    trop vaut mieux qu'un silence inexplicable.
//
// En test il n'y a pas de Supabase, donc la lecture échoue pour de vrai.
// C'est exactement le scénario du point 2, joué en conditions réelles.

import { describe, expect, it } from "vitest";
import { fenetre } from "@/lib/challenge";
import {
  estJourOff,
  JOUR_OFF_PUSH_BODY,
  JOUR_OFF_PUSH_TITLE,
  notifyJourOff,
} from "@/lib/server/jour-off";
import { TERRAIN_ENV, type Terrain } from "@/lib/server/ligues";

const LIGUE: Terrain = {
  ligue: {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "copains-mars",
    name: "Les copains de mars",
    invite_code: "MARS42",
    start_day: "2027-03-01",
    end_day: "2027-03-28",
    creator_player_id: null,
    parent_league_id: null,
    created_at: "2027-02-20T10:00:00Z",
  },
  fenetre: fenetre("2027-03-01", "2027-03-28"),
  schema: "app",
};

describe("estJourOff", () => {
  it("ne demande rien au schéma des ligues", async () => {
    await expect(estJourOff(LIGUE)).resolves.toBe(false);
  });

  it("répond non quand la table est injoignable, jamais oui", async () => {
    // Sans Supabase la lecture échoue. Si cette assertion tombe un jour à
    // `true`, les rappels du soir se taisent à la première panne réseau.
    await expect(estJourOff(TERRAIN_ENV)).resolves.toBe(false);
  });
});

describe("notifyJourOff", () => {
  it("ne tire pas pour une ligue et n'envoie rien", async () => {
    const r = await notifyJourOff(LIGUE);
    expect(r.off).toBe(false);
    expect(r.sent).toBe(0);
  });
});

describe("le texte du push", () => {
  // Le jour off ne se tease pas. L'événement de 7h protège la surprise de
  // la roue ; un repos qu'on découvre à 21h n'est pas un repos, c'est une
  // information. Le titre et le corps disent donc tout, tout de suite.
  it("dit ce qu'il annonce, sans énigme", () => {
    expect(JOUR_OFF_PUSH_TITLE).toContain("Jour off");
    expect(JOUR_OFF_PUSH_BODY).toMatch(/série/i);
  });

  it("dit aussi qu'on peut s'entraîner quand même", () => {
    // Sans cette phrase, le jour off se lit comme une interdiction — or
    // celui qui coche marque normalement, et son jour reste un vrai 3/3.
    expect(JOUR_OFF_PUSH_BODY).toMatch(/entraînes quand même/i);
  });
});
