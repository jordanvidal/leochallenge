// Enregistre une note vocale côté client. Même règle que lib/image.ts :
// le téléphone fait le travail, et ce qui part sur le réseau est déjà à
// la bonne taille.
//
// Le format est LE point dur de ce fichier. iPhone et Android
// n'encodent pas dans le même conteneur, et un vocal qu'un pote ne peut
// pas écouter ne vaut rien. On demande donc `audio/mp4` (AAC) EN
// PREMIER : c'est ce que produit Safari iOS nativement, c'est ce que
// Chrome sait produire depuis longtemps maintenant, et surtout c'est le
// seul des deux qui se lise partout. `audio/webm` (Opus) n'est qu'un
// repli pour un navigateur qui ne saurait pas encoder de mp4 — Safari
// ne lit pas le WebM de façon fiable, donc un vocal enregistré dans ce
// repli-là pourrait ne pas s'ouvrir sur un iPhone. C'est le seul angle
// mort connu, et il est derrière une porte que nos deux cibles
// n'ouvrent pas.

/** Une minute. Assez pour raconter une séance, assez peu pour que
    personne ne monopolise le salon. La base borne à 65 s (migration45) :
    l'écart absorbe le temps que MediaRecorder met à rendre la main. */
export const VOCAL_MAX_MS = 60_000;

/** En dessous, c'est un doigt qui a glissé sur le bouton, pas un
    message. On préfère ne rien envoyer et le dire. */
const VOCAL_MIN_MS = 700;

/** 32 kbps mono : de la voix, pas de la musique. Une minute pèse
    ~240 Ko, soit à peu près une photo de tchat. Certains navigateurs
    ignorent ce réglage, d'où la borne à 2 Mo côté bucket. */
const BITRATE = 32_000;

/** Par ordre de préférence. L'extension part dans le nom de l'objet :
    c'est elle qui dira au navigateur quoi faire, le jour où quelqu'un
    ouvrira l'URL en direct. */
const FORMATS = [
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/webm", ext: "webm" },
] as const;

/** Un vocal prêt à partir : les octets, et la durée MESURÉE.
    La durée ne se relit pas depuis le fichier — un WebM de
    MediaRecorder n'en porte pas (voir migration45). */
export type VocalPret = { blob: Blob; ms: number; mime: string; ext: string };

export type Enregistrement = {
  /** Arrête et rend le vocal. Null si rien d'exploitable : trop court,
      ou pas un seul octet capté. */
  arreter: () => Promise<VocalPret | null>;
  /** Jette tout et referme le micro. Rien ne part. */
  annuler: () => void;
  /** Millisecondes écoulées, à lire quand on veut afficher le compteur. */
  ecoule: () => number;
};

export type ErreurVocal = "NON_SUPPORTE" | "MICRO_REFUSE";

/** Le premier format que ce navigateur sait encoder, ou null s'il n'en
    sait aucun — auquel cas le bouton micro ne s'affiche pas du tout. */
export function formatVocal(): (typeof FORMATS)[number] | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) ?? null;
}

/** Ce navigateur peut-il enregistrer ? Lu au montage du composeur. */
export function vocalSupporte(): boolean {
  return !!formatVocal() && !!navigator.mediaDevices?.getUserMedia;
}

/** Referme le micro. À ne jamais oublier : un flux laissé ouvert garde
    la pastille rouge allumée dans la barre d'état, et le téléphone
    continue d'écouter pour rien. */
function fermer(stream: MediaStream): void {
  for (const piste of stream.getTracks()) piste.stop();
}

/**
 * Ouvre le micro et commence à enregistrer.
 *
 * `onLimite` est appelé si la minute tombe avant qu'on ait appuyé sur
 * stop : l'enregistrement est alors DÉJÀ arrêté, et c'est à l'écran de
 * se mettre à jour. Le minuteur vit ici et pas dans le composant parce
 * qu'un `setInterval` d'affichage est ralenti quand l'app passe en
 * arrière-plan — il finirait par laisser courir un vocal au-delà de ce
 * que la base accepte, et le refus arriverait après le téléversement.
 */
export async function demarrerVocal(
  onLimite?: () => void,
): Promise<Enregistrement | { error: ErreurVocal }> {
  const format = formatVocal();
  if (!format || !navigator.mediaDevices?.getUserMedia) {
    return { error: "NON_SUPPORTE" };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch {
    // Refus explicite, micro occupé par une autre app, ou pas de micro :
    // pour l'utilisateur c'est la même phrase, et elle parle de la
    // permission parce que c'est le cas de loin le plus fréquent.
    return { error: "MICRO_REFUSE" };
  }

  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, {
      mimeType: format.mime,
      audioBitsPerSecond: BITRATE,
    });
  } catch {
    fermer(stream);
    return { error: "NON_SUPPORTE" };
  }

  const morceaux: Blob[] = [];
  const debut = performance.now();
  let fin: number | null = null;
  let jete = false;

  rec.ondataavailable = (e) => {
    if (e.data.size > 0) morceaux.push(e.data);
  };

  // Pas de `timeslice` : on veut UN blob complet à l'arrêt. Découpé en
  // tranches, un mp4 arrive fragmenté et certains lecteurs refusent de
  // l'ouvrir — et à une minute, il n'y a rien à gagner à découper.
  rec.start();

  const minuteur = setTimeout(() => {
    if (rec.state === "inactive") return;
    fin = performance.now();
    rec.stop();
    onLimite?.();
  }, VOCAL_MAX_MS);

  const pret = new Promise<VocalPret | null>((resolve) => {
    rec.onstop = () => {
      clearTimeout(minuteur);
      fermer(stream);
      if (jete || morceaux.length === 0) return resolve(null);
      const ms = Math.round((fin ?? performance.now()) - debut);
      if (ms < VOCAL_MIN_MS) return resolve(null);
      const blob = new Blob(morceaux, { type: format.mime });
      if (blob.size === 0) return resolve(null);
      // Le plafond est réaffirmé ici : c'est cette valeur qui part en
      // base, et elle doit tenir dans la contrainte quoi qu'ait fait
      // l'horloge entre-temps.
      resolve({
        blob,
        ms: Math.min(ms, VOCAL_MAX_MS),
        mime: format.mime,
        ext: format.ext,
      });
    };
  });

  return {
    arreter: () => {
      if (rec.state !== "inactive") {
        fin = performance.now();
        rec.stop();
      }
      return pret;
    },
    annuler: () => {
      jete = true;
      if (rec.state !== "inactive") rec.stop();
      else fermer(stream);
    },
    ecoule: () => Math.round((fin ?? performance.now()) - debut),
  };
}

/**
 * Demande à iOS de traiter le son comme une LECTURE et non comme un
 * bip d'interface.
 *
 * Sans ça, un iPhone dont le petit interrupteur latéral est sur
 * silencieux ne joue pas les vocaux — et comme rien ne le dit à
 * l'écran, le lecteur a l'air cassé. Appelé juste avant de lancer la
 * lecture ; ailleurs que sur Safari récent, la propriété n'existe pas
 * et il ne se passe rien.
 */
export function preparerLecture(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "playback";
}

/** « 0:07 ». Le format d'un vocal partout où on en parle : dans la
    bulle, dans le composeur, dans la citation. */
export function dureeLisible(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  return `${min}:${String(total - min * 60).padStart(2, "0")}`;
}
