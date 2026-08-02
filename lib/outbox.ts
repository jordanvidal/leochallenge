// La file d'attente locale des écritures (outbox).
//
// À 23h dans un lit, la 4G ment : une écriture qui part est parfois une
// écriture qui n'arrive pas. Jusqu'ici, échec réseau = toast d'échec et
// travail perdu. La file change le contrat : le geste est noté sur le
// téléphone, l'envoi se rejoue tout seul dès que le réseau revient, et
// l'app ne dit « c'est noté » que parce qu'elle peut le tenir.
//
// Ce module est le mécanisme, sans opinion sur ce qu'il transporte :
// chaque écriture s'enregistre sous un `kind`, avec un expéditeur qui
// sait l'envoyer et classer la réponse. Trois issues possibles :
//
//   · "ok"     — c'est en base (ou ça y était déjà : un doublon d'insert
//                sur une contrainte d'unicité est un succès, pas un bug).
//   · "retry"  — le réseau a manqué. On garde, on retentera avec backoff.
//   · {refus}  — le serveur a dit non pour de bon (trigger, 4xx logique).
//                On retire de la file et on le DIT : rollback + toast chez
//                l'appelant. Un refus définitif ne se rejoue jamais.
//
// Le contrat d'idempotence est porté par la clé : une même clé désigne un
// même geste, et ré-enregistrer une clé REMPLACE l'entrée précédente (le
// dernier geste fait foi — déclarer puis annuler hors ligne s'annulent en
// une seule entrée). Un retry ne peut pas créer de doublon en base : seule
// une écriture couverte par une contrainte d'unicité (ou naturellement
// idempotente, comme un delete ciblé) a le droit d'entrer dans la file.
//
// Chaque entrée porte `day`, le jour du geste (heure de Paris) : c'est ce
// jour-là que l'envoi défend, jamais celui de la synchro. Si le serveur a
// verrouillé le jour entre-temps (minuit est passé), il refuse — et ce
// refus remonte, visible. On ne redate jamais un geste en silence.
//
// localStorage suffit : quelques entrées de moins de 200 octets, lecture
// synchrone au chargement, et c'est déjà la mémoire de l'app (identité,
// séance en cours). IndexedDB n'apporterait ici que de l'asynchrone.

export type SendOutcome = "ok" | "retry" | { refus: string };

export type OutboxEntry = {
  /** Clé d'idempotence : stable pour un même geste, unique dans la file. */
  key: string;
  /** L'expéditeur qui sait envoyer cette entrée (voir `register`). */
  kind: string;
  payload: unknown;
  /** Le jour du geste, 'YYYY-MM-DD' heure de Paris. Jamais réécrit. */
  day: string;
  createdAt: number;
  /** Ordre d'arrivée — et preuve qu'une entrée n'a pas été remplacée
      pendant que son envoi était en l'air. */
  seq: number;
  attempts: number;
  /** Prochain essai autorisé (timestamp ms). 0 = tout de suite. */
  nextTryAt: number;
};

export type OutboxEvent =
  /** La file a bougé : de quoi tenir un indicateur « en attente ». */
  | { type: "file"; enAttente: number }
  /** Une entrée est sortie de la file : livrée, ou refusée pour de bon. */
  | { type: "resultat"; entry: OutboxEntry; outcome: "ok" | { refus: string } };

export type OutboxHandler = (
  payload: unknown,
  entry: OutboxEntry,
) => Promise<SendOutcome>;

export type OutboxStore = {
  lire(): string | null;
  ecrire(valeur: string): void;
};

export const CLE_OUTBOX = "lc100.outbox";

/** Backoff exponentiel plafonné : 2 s, 4 s, 8 s… jusqu'à 5 min. */
export function prochainDelai(
  attempts: number,
  base = 2_000,
  max = 300_000,
): number {
  return Math.min(base * 2 ** Math.max(0, attempts - 1), max);
}

/**
 * Relit la file persistée. Même règle que `relireSeance` : dans le doute,
 * on jette l'entrée illisible plutôt que d'envoyer n'importe quoi — mais
 * entrée par entrée, pour ne pas perdre les gestes valides d'à côté.
 */
export function relireFile(brut: string | null): {
  seq: number;
  entries: OutboxEntry[];
} {
  const vide = { seq: 1, entries: [] as OutboxEntry[] };
  if (!brut) return vide;
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return vide;
  }
  if (!lu || typeof lu !== "object") return vide;
  const env = lu as { seq?: unknown; entries?: unknown };
  if (!Array.isArray(env.entries)) return vide;
  const entries = env.entries.filter((e): e is OutboxEntry => {
    if (!e || typeof e !== "object") return false;
    const c = e as Partial<OutboxEntry>;
    return (
      typeof c.key === "string" &&
      typeof c.kind === "string" &&
      typeof c.day === "string" &&
      typeof c.seq === "number" &&
      typeof c.createdAt === "number" &&
      typeof c.attempts === "number" &&
      typeof c.nextTryAt === "number"
    );
  });
  const seq =
    typeof env.seq === "number"
      ? env.seq
      : entries.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
  return { seq, entries };
}

export type Outbox = ReturnType<typeof creerOutbox>;

export function creerOutbox(opts: {
  store: OutboxStore;
  now?: () => number;
  /** `false` = pas de réseau : on n'essaie même pas, et ça ne compte pas
      comme une tentative. Le backoff punit les échecs, pas le mode avion. */
  enLigne?: () => boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Plafond de VRAIES tentatives (réseau présent, envoi parti, échec).
      Au-delà, l'entrée sort en refus visible : une file qui retente en
      silence pour toujours est un mensonge de plus. */
  maxAttempts?: number;
}) {
  const {
    store,
    now = Date.now,
    enLigne = () => true,
    baseDelayMs = 2_000,
    maxDelayMs = 300_000,
    maxAttempts = 50,
  } = opts;

  const relu = relireFile(store.lire());
  let liste = relu.entries;
  let seq = relu.seq;
  let enCours = false;
  const handlers = new Map<string, OutboxHandler>();
  const abonnes = new Set<(evt: OutboxEvent) => void>();

  function persister() {
    store.ecrire(JSON.stringify({ v: 1, seq, entries: liste }));
  }

  function emettre(evt: OutboxEvent) {
    for (const l of abonnes) l(evt);
  }

  function emettreFile() {
    emettre({ type: "file", enAttente: liste.length });
  }

  function register(kind: string, handler: OutboxHandler) {
    handlers.set(kind, handler);
  }

  /** Enregistre un geste. Une clé déjà en file est remplacée : le dernier
      geste fait foi, et deux gestes opposés n'en laissent qu'un. */
  function enqueue(e: {
    key: string;
    kind: string;
    payload: unknown;
    day: string;
  }): OutboxEntry {
    liste = liste.filter((x) => x.key !== e.key);
    const entry: OutboxEntry = {
      ...e,
      createdAt: now(),
      seq: seq++,
      attempts: 0,
      nextTryAt: 0,
    };
    liste.push(entry);
    persister();
    emettreFile();
    return entry;
  }

  /**
   * Vide ce qui est mûr, dans l'ordre d'arrivée. Une seule passe à la
   * fois ; au premier "retry" on s'arrête — le réseau vient de dire non,
   * inutile d'enchaîner les échecs, le backoff décidera du prochain tour.
   * Rend le nombre d'entrées restantes.
   */
  async function flush(): Promise<number> {
    if (enCours) return liste.length;
    enCours = true;
    try {
      const sansExpediteur = new Set<number>();
      while (enLigne()) {
        const maintenant = now();
        const due = liste
          .filter((x) => x.nextTryAt <= maintenant && !sansExpediteur.has(x.seq))
          .sort((a, b) => a.seq - b.seq)[0];
        if (!due) break;
        const h = handlers.get(due.kind);
        if (!h) {
          // Personne ne sait l'envoyer (module pas encore chargé ?) :
          // on la laisse pour un tour où son expéditeur existera.
          sansExpediteur.add(due.seq);
          continue;
        }
        let outcome: SendOutcome;
        try {
          outcome = await h(due.payload, due);
        } catch {
          outcome = "retry"; // une exception d'envoi est un échec réseau
        }
        // Pendant que l'envoi était en l'air, un nouveau geste a pu
        // remplacer l'entrée : c'est lui qui fait foi, on ne touche à rien.
        const courante = liste.find((x) => x.key === due.key);
        if (!courante || courante.seq !== due.seq) continue;
        if (outcome === "retry") {
          courante.attempts += 1;
          if (courante.attempts >= maxAttempts) {
            liste = liste.filter((x) => x.seq !== courante.seq);
            persister();
            emettre({
              type: "resultat",
              entry: courante,
              outcome: { refus: "TROP_D_ECHECS: écriture abandonnée" },
            });
            emettreFile();
            continue;
          }
          courante.nextTryAt =
            now() + prochainDelai(courante.attempts, baseDelayMs, maxDelayMs);
          persister();
          emettreFile();
          break;
        }
        liste = liste.filter((x) => x.seq !== courante.seq);
        persister();
        emettre({ type: "resultat", entry: courante, outcome });
        emettreFile();
      }
    } finally {
      enCours = false;
    }
    return liste.length;
  }

  return {
    register,
    enqueue,
    flush,
    subscribe(l: (evt: OutboxEvent) => void): () => void {
      abonnes.add(l);
      return () => abonnes.delete(l);
    },
    entries: () => [...liste],
    pendingCount: () => liste.length,
    /** Le plus proche `nextTryAt` en attente — pour planifier un réveil. */
    prochainReveil(): number | null {
      if (liste.length === 0) return null;
      return liste.reduce((m, e) => Math.min(m, e.nextTryAt), Infinity);
    },
  };
}

// ---- Le singleton de l'app, branché sur le navigateur ----------------

function creerStoreNavigateur(): OutboxStore {
  // Safari en navigation privée peut refuser localStorage : la file
  // devient alors mémoire pure — moins bien qu'un disque, mieux qu'un
  // crash. Côté serveur (SSR), même repli, jamais utilisé pour écrire.
  let memoire: string | null = null;
  return {
    lire() {
      try {
        return window.localStorage.getItem(CLE_OUTBOX) ?? memoire;
      } catch {
        return memoire;
      }
    },
    ecrire(valeur: string) {
      memoire = valeur;
      try {
        window.localStorage.setItem(CLE_OUTBOX, valeur);
      } catch {
        // plein ou refusé : la copie mémoire tient la session en cours
      }
    },
  };
}

/** LA file de l'app. Les modules d'écriture y enregistrent leurs
    expéditeurs (`register`) puis y déposent leurs gestes (`enqueue`). */
export const outbox = creerOutbox({
  store:
    typeof window === "undefined"
      ? { lire: () => null, ecrire: () => {} }
      : creerStoreNavigateur(),
  enLigne: () =>
    typeof navigator === "undefined" || navigator.onLine !== false,
});

// Les déclencheurs : retour du réseau, retour de l'app au premier plan,
// ouverture — plus un réveil planifié sur le backoff. Installés une seule
// fois, même si le module est réévalué (HMR en dev).
declare global {
  interface Window {
    __lc100OutboxInstalle?: boolean;
  }
}

if (typeof window !== "undefined" && !window.__lc100OutboxInstalle) {
  window.__lc100OutboxInstalle = true;

  let reveil: ReturnType<typeof setTimeout> | null = null;
  const planifier = () => {
    if (reveil) clearTimeout(reveil);
    reveil = null;
    const prochain = outbox.prochainReveil();
    if (prochain === null) return;
    reveil = setTimeout(
      () => outbox.flush(),
      Math.max(250, prochain - Date.now()),
    );
  };

  outbox.subscribe((evt) => {
    if (evt.type === "file") planifier();
  });
  window.addEventListener("online", () => outbox.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") outbox.flush();
  });
  // Ce qui restait d'hier soir part dès l'ouverture — après que les
  // modules d'écriture ont eu le temps d'enregistrer leurs expéditeurs.
  setTimeout(() => outbox.flush(), 0);
}
