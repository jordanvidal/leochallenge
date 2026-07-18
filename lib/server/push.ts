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

/** Client Supabase côté serveur (clé anonyme : RLS ouverte par design). */
export function serverSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
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
 * Envoie une notification aux joueurs donnés (toutes leurs subscriptions).
 * Retourne le nombre d'envois réussis.
 */
export async function sendToPlayers(
  playerIds: string[],
  payload: { title: string; body: string },
): Promise<number> {
  if (playerIds.length === 0) return 0;
  configureVapid();
  const supabase = serverSupabase();

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

/** Garde des routes POST appelées par l'app : le client envoie le mot de
    passe du groupe en header. Même niveau que PasswordGate — bloque le
    passant qui a trouvé l'URL, pas le NSA. Fail-closed si non configuré. */
export function isAuthorizedApp(request: Request): boolean {
  const pass = process.env.NEXT_PUBLIC_GROUP_PASSWORD;
  if (!pass) return false;
  return request.headers.get("x-group-pass") === pass;
}
