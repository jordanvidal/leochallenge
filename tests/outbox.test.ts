// La file d'attente locale des écritures (lib/outbox.ts).
//
// Le scénario défendu : mode avion à 23h, un geste noté, le réseau qui
// revient — le geste part UNE fois, jamais deux. Tout se joue sur trois
// promesses : l'idempotence par clé (un retry ne duplique pas, un
// remplacement annule), le backoff (on n'assomme pas un réseau qui vient
// de dire non), et la vérité (un refus définitif sort de la file et se
// voit ; il ne se rejoue jamais en silence).

import { describe, expect, it, vi } from "vitest";
import {
  creerOutbox,
  OutboxEntry,
  OutboxEvent,
  OutboxStore,
  prochainDelai,
  relireFile,
  SendOutcome,
} from "@/lib/outbox";

/** Un localStorage de poche, synchrone, inspectable. */
function storeMemoire(initial: string | null = null): OutboxStore & {
  brut: () => string | null;
} {
  let contenu = initial;
  return {
    lire: () => contenu,
    ecrire: (v) => {
      contenu = v;
    },
    brut: () => contenu,
  };
}

/** Une horloge qu'on avance à la main. */
function horloge(depart = 1_000_000) {
  let t = depart;
  return { now: () => t, avancer: (ms: number) => (t += ms) };
}

const GESTE = {
  key: "bonus:p1:2026-08-02:pompes_50",
  kind: "bonus.claim",
  payload: { bonusKey: "pompes_50" },
  day: "2026-08-02",
};

describe("prochainDelai", () => {
  it("double à chaque tentative et plafonne", () => {
    expect(prochainDelai(1)).toBe(2_000);
    expect(prochainDelai(2)).toBe(4_000);
    expect(prochainDelai(3)).toBe(8_000);
    expect(prochainDelai(20)).toBe(300_000); // le plafond, pas 2^20 s
  });
});

describe("relireFile", () => {
  it("rend une file vide sur du JSON corrompu", () => {
    expect(relireFile("{oops").entries).toEqual([]);
    expect(relireFile(null).entries).toEqual([]);
    expect(relireFile('"pas un objet"').entries).toEqual([]);
  });

  it("jette les entrées illisibles sans perdre les valides", () => {
    const valide: OutboxEntry = {
      ...GESTE,
      createdAt: 1,
      seq: 3,
      attempts: 0,
      nextTryAt: 0,
    };
    const brut = JSON.stringify({
      v: 1,
      seq: 7,
      entries: [valide, { key: 42 }, null],
    });
    const relu = relireFile(brut);
    expect(relu.entries).toEqual([valide]);
    expect(relu.seq).toBe(7);
  });
});

describe("enqueue", () => {
  it("persiste le geste et le compte en attente", () => {
    const store = storeMemoire();
    const box = creerOutbox({ store });
    box.enqueue(GESTE);
    expect(box.pendingCount()).toBe(1);
    // La persistance est immédiate : une éviction de PWA ne perd rien.
    expect(relireFile(store.brut()).entries).toHaveLength(1);
  });

  it("remplace une clé déjà en file : le dernier geste fait foi", () => {
    const box = creerOutbox({ store: storeMemoire() });
    box.enqueue(GESTE);
    box.enqueue({ ...GESTE, kind: "bonus.unclaim" });
    expect(box.pendingCount()).toBe(1);
    expect(box.entries()[0].kind).toBe("bonus.unclaim");
  });

  it("survit à un rechargement : la file se relit depuis le store", () => {
    const store = storeMemoire();
    creerOutbox({ store }).enqueue(GESTE);
    const box2 = creerOutbox({ store }); // « le lendemain matin »
    expect(box2.pendingCount()).toBe(1);
    expect(box2.entries()[0].day).toBe("2026-08-02");
  });
});

describe("flush", () => {
  it("livre dans l'ordre d'arrivée et vide la file", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    const envois: string[] = [];
    box.register("t", async (p) => {
      envois.push(p as string);
      return "ok";
    });
    box.enqueue({ key: "a", kind: "t", payload: "a", day: "2026-08-02" });
    box.enqueue({ key: "b", kind: "t", payload: "b", day: "2026-08-02" });
    expect(await box.flush()).toBe(0);
    expect(envois).toEqual(["a", "b"]);
  });

  it("échec réseau : l'entrée reste, avec backoff, sans doublon", async () => {
    const h = horloge();
    const box = creerOutbox({ store: storeMemoire(), now: h.now });
    const envoyer = vi.fn(async (): Promise<SendOutcome> => "retry");
    box.register("t", envoyer);
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });

    expect(await box.flush()).toBe(1); // toujours en attente
    expect(envoyer).toHaveBeenCalledTimes(1);

    // Avant l'heure du backoff : on ne réessaie pas.
    h.avancer(500);
    await box.flush();
    expect(envoyer).toHaveBeenCalledTimes(1);

    // Après : on réessaie — et le succès ne livre qu'UNE entrée.
    h.avancer(2_000);
    envoyer.mockResolvedValueOnce("ok");
    expect(await box.flush()).toBe(0);
    expect(envoyer).toHaveBeenCalledTimes(2);
  });

  it("le backoff double d'un échec au suivant", async () => {
    const h = horloge();
    const box = creerOutbox({ store: storeMemoire(), now: h.now });
    box.register("t", async () => "retry");
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });

    await box.flush();
    expect(box.entries()[0].nextTryAt).toBe(h.now() + 2_000);
    h.avancer(2_000);
    await box.flush();
    expect(box.entries()[0].nextTryAt).toBe(h.now() + 4_000);
  });

  it("hors ligne : aucune tentative, et ça ne compte pas comme un échec", async () => {
    const envoyer = vi.fn(async (): Promise<SendOutcome> => "ok");
    const box = creerOutbox({ store: storeMemoire(), enLigne: () => false });
    box.register("t", envoyer);
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });
    expect(await box.flush()).toBe(1);
    expect(envoyer).not.toHaveBeenCalled();
    expect(box.entries()[0].attempts).toBe(0); // le mode avion n'est pas puni
  });

  it("une exception de l'expéditeur vaut un échec réseau, pas un crash", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    box.register("t", async () => {
      throw new TypeError("Failed to fetch");
    });
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });
    expect(await box.flush()).toBe(1);
    expect(box.entries()[0].attempts).toBe(1);
  });

  it("refus définitif : l'entrée sort de la file et le refus se voit", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    box.register("t", async () => ({ refus: "JOUR_VERROUILLE" }));
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-01" });
    const vus: OutboxEvent[] = [];
    box.subscribe((e) => vus.push(e));

    expect(await box.flush()).toBe(0);
    const resultat = vus.find((e) => e.type === "resultat");
    expect(resultat).toBeDefined();
    expect(
      resultat!.type === "resultat" ? resultat!.outcome : null,
    ).toEqual({ refus: "JOUR_VERROUILLE" });
  });

  it("un refus ne bloque pas les entrées suivantes", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    box.register("t", async (p) =>
      p === "mauvais" ? { refus: "CAP_JOUR" } : "ok",
    );
    box.enqueue({ key: "a", kind: "t", payload: "mauvais", day: "2026-08-02" });
    box.enqueue({ key: "b", kind: "t", payload: "bon", day: "2026-08-02" });
    expect(await box.flush()).toBe(0);
  });

  it("pas d'expéditeur enregistré : l'entrée attend sans partir ni boucler", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    box.enqueue({ key: "a", kind: "inconnu", payload: null, day: "2026-08-02" });
    expect(await box.flush()).toBe(1); // pas de boucle infinie
    expect(box.entries()[0].attempts).toBe(0);
  });

  it("trop de vrais échecs : abandon VISIBLE, pas une file éternelle", async () => {
    const h = horloge();
    const box = creerOutbox({
      store: storeMemoire(),
      now: h.now,
      maxAttempts: 2,
      baseDelayMs: 10,
    });
    box.register("t", async () => "retry");
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });
    const refus: OutboxEvent[] = [];
    box.subscribe((e) => {
      if (e.type === "resultat" && e.outcome !== "ok") refus.push(e);
    });

    await box.flush(); // tentative 1 → backoff
    h.avancer(50);
    expect(await box.flush()).toBe(0); // tentative 2 → dehors, en le disant
    expect(refus).toHaveLength(1);
  });

  it("remplacée pendant l'envoi : le nouveau geste fait foi", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    const envois: string[] = [];
    let premierEnvoi = true;
    box.register("t", async (p) => {
      if (premierEnvoi) {
        premierEnvoi = false;
        // Pendant que l'envoi est en l'air, l'utilisateur retape :
        // même clé, geste inverse.
        box.enqueue({ key: "a", kind: "t", payload: "annule", day: "2026-08-02" });
      }
      envois.push(p as string);
      return "ok";
    });
    box.enqueue({ key: "a", kind: "t", payload: "declare", day: "2026-08-02" });

    expect(await box.flush()).toBe(0);
    // Les deux sont partis (le premier était déjà en l'air), mais le
    // remplaçant n'a pas été effacé par le succès du remplacé.
    expect(envois).toEqual(["declare", "annule"]);
  });

  it("deux flush concurrents ne doublent pas les envois", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    let envois = 0;
    box.register("t", async () => {
      envois += 1;
      await new Promise((r) => setTimeout(r, 5));
      return "ok";
    });
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });
    await Promise.all([box.flush(), box.flush()]);
    expect(envois).toBe(1);
  });

  it("l'indicateur « en attente » suit la file", async () => {
    const box = creerOutbox({ store: storeMemoire() });
    box.register("t", async () => "ok");
    const vues: number[] = [];
    box.subscribe((e) => {
      if (e.type === "file") vues.push(e.enAttente);
    });
    box.enqueue({ key: "a", kind: "t", payload: null, day: "2026-08-02" });
    await box.flush();
    expect(vues[0]).toBe(1); // noté
    expect(vues[vues.length - 1]).toBe(0); // parti
  });
});
