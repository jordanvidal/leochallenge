// La reprise d'une séance interrompue.
//
// L'état de la séance guidée ne vivait qu'en mémoire, dans le composant
// plein écran. Un rechargement, une PWA évincée par iOS, un onglet fermé au
// 3e tour sur 4 : le format et l'avancement disparaissaient. Le chrono
// restait ouvert côté serveur — donc la journée était déverrouillée — mais
// l'app avait oublié où on en était, et il fallait tout refaire ou
// abandonner en perdant les exos pas encore à 100.
//
// `relireSeance` est le portier de la reprise. Sa règle : dans le doute, on
// ne reprend rien. Reprendre faux ferait valider des exos non faits, ce qui
// est bien pire que refaire un tour.

import { describe, expect, it } from "vitest";
import { relireSeance, SeanceEnCours } from "@/lib/workout";

const AUJOURD_HUI = "2026-07-31";

const SEANCE: SeanceEnCours = {
  day: AUJOURD_HUI,
  config: { rounds: 4, reps: { pushups: 25, abs: 25, squats: 25 }, restSeconds: 120 },
  step: { kind: "block", round: 3, blockIdx: 1 },
  startedAt: 1_785_500_000_000,
  sessionDay: AUJOURD_HUI,
};

const ecrit = (s: unknown) => JSON.stringify(s);

describe("relireSeance", () => {
  it("reprend une séance du jour là où elle s'est arrêtée", () => {
    // Le cas qui motive tout : 3e tour, 2e bloc, l'app est morte entre-temps.
    const reprise = relireSeance(ecrit(SEANCE), AUJOURD_HUI);
    expect(reprise).not.toBeNull();
    expect(reprise!.step).toEqual({ kind: "block", round: 3, blockIdx: 1 });
    expect(reprise!.config.rounds).toBe(4);
    expect(reprise!.sessionDay).toBe(AUJOURD_HUI);
  });

  it("garde le repos par son instant de fin", () => {
    // `endsAt` est absolu : au retour, le temps réel se recalcule tout seul
    // et un repos écoulé pendant l'absence enchaîne sur le bloc suivant.
    const repos = { ...SEANCE, step: { kind: "rest", nextRound: 3, endsAt: 1_785_500_120_000 } };
    const reprise = relireSeance(ecrit(repos), AUJOURD_HUI);
    expect(reprise!.step).toEqual({
      kind: "rest",
      nextRound: 3,
      endsAt: 1_785_500_120_000,
    });
  });

  it("ne ressuscite pas la séance d'hier", () => {
    // Le jour a changé, les coches aussi, et le chrono serveur est clos
    // depuis minuit.
    expect(relireSeance(ecrit({ ...SEANCE, day: "2026-07-30" }), AUJOURD_HUI)).toBeNull();
  });

  it("ne propose pas de reprendre une séance finie", () => {
    const finie = { ...SEANCE, step: { kind: "done" } };
    expect(relireSeance(ecrit(finie), AUJOURD_HUI)).toBeNull();
  });

  it("ne reprend rien quand il n'y a rien", () => {
    expect(relireSeance(null, AUJOURD_HUI)).toBeNull();
    expect(relireSeance("", AUJOURD_HUI)).toBeNull();
  });

  it("jette une écriture corrompue au lieu de deviner", () => {
    expect(relireSeance("{pas du json", AUJOURD_HUI)).toBeNull();
    expect(relireSeance("null", AUJOURD_HUI)).toBeNull();
    expect(relireSeance('"une chaîne"', AUJOURD_HUI)).toBeNull();
  });

  it("refuse une sauvegarde amputée", () => {
    // Sans config ni étape il n'y a pas de séance ; une config sans `rounds`
    // ferait planter le calcul des blocs.
    expect(relireSeance(ecrit({ day: AUJOURD_HUI }), AUJOURD_HUI)).toBeNull();
    expect(
      relireSeance(ecrit({ ...SEANCE, config: { reps: {} } }), AUJOURD_HUI),
    ).toBeNull();
    expect(
      relireSeance(
        ecrit({ ...SEANCE, step: { kind: "block", round: 2 } }),
        AUJOURD_HUI,
      ),
    ).toBeNull();
    expect(
      relireSeance(
        ecrit({ ...SEANCE, step: { kind: "rest", nextRound: 2 } }),
        AUJOURD_HUI,
      ),
    ).toBeNull();
  });

  it("survit à un startedAt manquant", () => {
    // Vieille sauvegarde ou écriture partielle : 0 fait retomber la durée
    // affichée sur la valeur serveur, jamais sur un chiffre inventé.
    const sans = { ...SEANCE, startedAt: undefined };
    expect(relireSeance(ecrit(sans), AUJOURD_HUI)!.startedAt).toBe(0);
  });

  it("accepte une séance dont le chrono serveur n'a jamais répondu", () => {
    // `startSession` en échec réseau : la séance tourne quand même côté
    // client, et elle doit se reprendre aussi.
    const horsLigne = { ...SEANCE, sessionDay: null };
    expect(relireSeance(ecrit(horsLigne), AUJOURD_HUI)!.sessionDay).toBeNull();
  });
});
