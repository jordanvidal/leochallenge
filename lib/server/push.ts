// Envoi de notifications push, côté serveur uniquement (clé VAPID privée).
// Les subscriptions mortes (410/404) sont purgées au passage.

import { createECDH } from "node:crypto";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export type PushRow = {
  id: string;
  player_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Client Supabase côté serveur (clé anonyme : RLS ouverte par design).
 *
 * Le schéma est un argument et non une variable d'environnement : un cron
 * traite le challenge d'origine (`public`) ET les ligues (`app`) dans le même
 * passage, et il ne peut pas être des deux avis à la fois. Chaque terrain dit
 * le sien — voir `lib/server/ligues.ts`.
 */
export function serverSupabase(schema: "public" | "app" = "public") {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
      db: { schema },
    },
  );
}

/** Base64url d'un buffer, sans dépendre de l'encodage natif. */
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let vapidReady = false;

/**
 * Configure et VALIDE la paire VAPID, une fois par instance.
 *
 * Pourquoi valider ici plutôt que laisser web-push échouer : une clé vide
 * ou dépareillée casse 100 % des envois, mais ne se manifeste qu'au premier
 * sendNotification — où l'erreur tombe dans le catch par subscription et
 * disparaît. Résultat vécu du 14 au 17/07 : VAPID_PRIVATE_KEY valait ""
 * en production, les crons plantaient chaque jour, et personne n'a rien vu
 * pendant trois jours. On échoue donc tôt, fort, et en nommant la variable.
 */
function configureVapid() {
  if (vapidReady) return;

  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY ?? "";
  if (!pub || !priv) {
    const manquante = !pub ? "NEXT_PUBLIC_VAPID_PUBLIC_KEY" : "VAPID_PRIVATE_KEY";
    throw new Error(
      `VAPID : ${manquante} est vide. Aucune notification ne peut partir.`,
    );
  }

  // La publique se dérive de la privée : si les deux ne se répondent pas,
  // les services de push rejettent chaque envoi (403), silencieusement.
  let derivee: string;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(
      Buffer.from(priv.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
    );
    derivee = b64url(ecdh.getPublicKey());
  } catch (err) {
    throw new Error(
      `VAPID_PRIVATE_KEY illisible (${(err as Error).message}). ` +
        `Attendu : 43 caractères base64url.`,
    );
  }
  if (derivee !== pub) {
    throw new Error(
      "VAPID : la clé privée ne correspond pas à la clé publique. " +
        "Les souscriptions ont été créées avec la publique — tout sera rejeté (403).",
    );
  }

  webpush.setVapidDetails("mailto:jordan.vidal3@gmail.com", pub, priv);
  vapidReady = true;
}

/**
 * Une preview Vercel partage TOUT avec la prod : même Supabase, mêmes
 * clés VAPID, mêmes souscriptions. Tester un bonus sur une URL de
 * preview réveillait donc six personnes pour de vrai. Une carte de fil
 * fausse se supprime, une notification partie à 23h ne se rattrape pas.
 *
 * On n'autorise l'envoi que depuis la production. Deux garde-fous, dans
 * cet ordre volontaire :
 *
 *  1. VERCEL_ENV vaut « preview » ou « development » → muet. C'est le
 *     cas qui pose problème aujourd'hui.
 *  2. VERCEL_ENV absent (hors Vercel : machine locale, test) → muet
 *     sauf si NODE_ENV vaut « production ».
 *
 * Écrit comme ça, la prod ne peut pas devenir muette par accident : elle
 * a NODE_ENV=production même si les variables système de Vercel n'étaient
 * pas exposées. Le pire cas est un envoi de trop depuis un build de prod,
 * jamais un silence total — l'inverse serait invisible pendant des jours.
 */
function pushAutorise(): boolean {
  const vercel = process.env.VERCEL_ENV;
  if (vercel) return vercel === "production";
  return process.env.NODE_ENV === "production";
}

/**
 * La charge d'une notification.
 *
 * `tag` et `url` sont facultatifs, et leur absence garde EXACTEMENT le
 * comportement d'avant le 28/07 : le service worker retombe sur « lc100 »
 * et sur la racine. C'est la condition pour que l'ajout du tchat ne
 * change rien aux sept notifications déjà en production.
 *
 * `tag` : deux notifications de même tag se remplacent au lieu de
 * s'empiler. C'est ce qui rend « chaque message notifie » vivable — et
 * c'est aussi pourquoi le tchat a besoin d'un tag À LUI. Avec le tag
 * unique d'avant, une vanne à 22h effaçait le rappel « ta série est en
 * jeu » arrivé une minute plus tôt.
 */
export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  /**
   * Chiffre à poser sur l'icône de l'écran d'accueil, app fermée comprise
   * (le service worker l'applique, voir public/sw.js). Absent : la
   * pastille ne bouge pas — c'est le cas des sept notifications de rappel,
   * et ce n'est pas un oubli.
   *
   * Une pastille ne compte QUE du contenu non lu, jamais un rappel. La
   * nuance a coûté un revert le 17/07 : badger les exos restants posait un
   * « 3 » chaque matin sur l'écran d'accueil, que seule la séance faisait
   * disparaître. Un rappel qu'on ne peut pas acquitter, c'est du harcèlement
   * poli. Un non-lu s'éteint en l'ouvrant.
   *
   * Seul le tchat le renseigne aujourd'hui : lui seul a de quoi compter par
   * destinataire côté serveur (`chat_reads.last_read_at`). Les non-lus du
   * fil vivent dans le localStorage de chacun — le serveur ne peut pas les
   * connaître, donc il ne prétend pas les compter.
   */
  badge?: number;
};

/**
 * Envoie une notification aux joueurs donnés (toutes leurs subscriptions).
 * Retourne le nombre d'envois réussis.
 *
 * `schema` est OBLIGATOIRE, et c'est le correctif du 04/08. Cette fonction
 * lisait `public.push_subscriptions` en dur alors que les identifiants qu'on
 * lui passe viennent du terrain appelant : ceux d'une ligue vivent dans
 * `app.players`, et leurs souscriptions dans `app.push_subscriptions`. Le
 * `.in(player_id, ...)` ne trouvait donc jamais rien pour une ligue — zéro
 * ligne, aucune erreur, `sent: 0`. Tous les pushs des ligues (rappels du
 * soir, événement du jour, récap du lundi, feed, tchat) tombaient dans ce
 * trou depuis la création du schéma `app`, sans le moindre bruit.
 *
 * Pas de valeur par défaut, volontairement. Un défaut à « public » aurait
 * gardé cette panne exacte pour tout appelant qui oublie l'argument, et elle
 * est invisible en production : le compte d'envois d'une ligue vide ressemble
 * trait pour trait à celui d'une ligue dont personne n'est abonné. Rendre le
 * paramètre obligatoire fait tomber l'oubli à la compilation.
 */
export async function sendToPlayers(
  playerIds: string[],
  payload: PushPayload,
  schema: "public" | "app",
): Promise<number> {
  if (playerIds.length === 0) return 0;
  if (!pushAutorise()) {
    // Bruyant exprès : sur une preview on veut LIRE ce qui serait parti,
    // c'est tout l'intérêt du test. Muet, on croirait que rien ne marche.
    console.warn(
      `[push] env=${process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "?"} ` +
        `— envoi bloqué hors production. ${playerIds.length} destinataire(s) ` +
        `auraient reçu : « ${payload.title} — ${payload.body} »`,
    );
    return 0;
  }
  configureVapid();
  // Le schéma des souscriptions doit être celui des joueurs qu'on notifie.
  const supabase = serverSupabase(schema);

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("*")
    .in("player_id", playerIds);
  if (error || !data) return 0;

  let sent = 0;
  const dead: string[] = [];
  const echecs: string[] = [];
  await Promise.all(
    (data as PushRow[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(sub.id);
        } else {
          // Tout le reste (403 de clé, 413 payload trop gros, 5xx du
          // service) : on le dit. Muet, un échec total ressemble à
          // « personne n'est abonné » — et on ne cherche pas.
          echecs.push(`${status ?? "?"} · ${(err as Error).message}`);
        }
      }
    }),
  );
  if (echecs.length > 0) {
    console.error(
      `[push] ${echecs.length}/${data.length} envois échoués :`,
      echecs.slice(0, 3),
    );
  }
  if (dead.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", dead);
  }
  return sent;
}

/** Jour civil actuel à Paris, 'YYYY-MM-DD' (dupliqué de lib/challenge pour le serveur). */
export function parisToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Garde d'accès des routes cron : Vercel envoie Bearer CRON_SECRET. */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * De quel monde vient cet appel ? `null` s'il n'est pas autorisé.
 *
 * Le secret envoyé **est** le discriminant, et c'est ce qui rend la
 * cohabitation possible sans paramètre supplémentaire :
 *
 *   * le mot de passe du groupe ouvre le challenge d'origine (`public`) ;
 *   * un code d'invitation valide ouvre les ligues (`app`).
 *
 * Même niveau qu'avant — ça bloque le passant qui a trouvé l'URL, pas le NSA.
 * **Fail-closed** sur tous les chemins : en-tête absent, format invalide, code
 * inconnu, base injoignable. On refuse plutôt que d'ouvrir en cas de doute.
 */
export async function mondeAutorise(
  request: Request,
): Promise<"public" | "app" | null> {
  const envoye = request.headers.get("x-group-pass");
  if (!envoye) return null;

  const pass = process.env.NEXT_PUBLIC_GROUP_PASSWORD;
  if (pass && envoye === pass) return "public";

  // Normalisation minimale, alignée sur `normaliseCode` côté client : le code
  // voyage en clair dans un en-tête, autant ne pas refuser une casse.
  const code = envoye.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return null;

  const { data, error } = await serverSupabase("app")
    .from("leagues")
    .select("id")
    .eq("invite_code", code)
    .maybeSingle();
  return !error && data ? "app" : null;
}

/** La même garde, en booléen, pour qui n'a pas besoin de savoir d'où ça vient. */
export async function isAuthorizedApp(request: Request): Promise<boolean> {
  return (await mondeAutorise(request)) !== null;
}
