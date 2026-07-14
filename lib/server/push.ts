// Envoi de notifications push, côté serveur uniquement (clé VAPID privée).
// Les subscriptions mortes (410/404) sont purgées au passage.

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

function configureVapid() {
  webpush.setVapidDetails(
    "mailto:jordan.vidal3@gmail.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
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
        if (status === 404 || status === 410) dead.push(sub.id);
      }
    }),
  );
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
