// Client Supabase unique, côté navigateur.
// Les valeurs de secours évitent un crash au build quand le .env est absent.

import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

/** La clé où cet appareil retient sa ligue. Dupliquée de `hooks/useLigue.ts`
    parce que ce module se charge AVANT tout React et ne doit rien lui devoir. */
const CLE_LIGUE = "lc100.ligue";

/**
 * Le schéma Postgres visé, décidé **au chargement du module**.
 *
 * Les deux mondes cohabitent dans la même app :
 *
 *   * `public` — le challenge d'origine, ses neuf joueurs, son historique. Il
 *     tourne jusqu'au 31 août et ne doit pas bouger d'un octet.
 *   * `app` — les ligues, chacune avec ses dates et ses joueurs.
 *
 * C'est l'adresse qui tranche, et rien d'autre :
 *
 *   /                → le challenge, sauf si cet appareil a retenu une ligue
 *   /challenge       → le challenge, toujours — la porte de retour
 *   /l/<slug>        → cette ligue
 *   /ligues          → créer ou rejoindre une ligue
 *
 * `/challenge` existe pour une seule personne et un seul mois : celui qui joue
 * le challenge d'origine ET crée une ligue. Sans elle, sa ligue prendrait son
 * `/` et il n'aurait plus de chemin court vers le groupe. Elle disparaîtra
 * avec la phase 5.
 *
 * Décider ici, une fois, plutôt que de faire circuler un client dans les
 * soixante appels de l'app : le schéma ne change **jamais** au cours d'une même
 * page. Changer de ligue, c'est ouvrir une autre URL, donc recharger ce module.
 *
 * `NEXT_PUBLIC_SUPABASE_SCHEMA` reste prioritaire quand elle est posée : c'est
 * ce qui permet à une preview de tout forcer sur `app`, et ce qui basculera la
 * production en phase 5, une fois le groupe d'origine recopié.
 */
function schemaVoulu(): "public" | "app" {
  const force = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  if (force === "app" || force === "public") return force;

  // Côté serveur (build, routes API, crons) : jamais de bascule implicite.
  // Le serveur choisit son schéma explicitement, terrain par terrain.
  if (typeof window === "undefined") return "public";

  const chemin = window.location.pathname;
  if (/^\/challenge\b/.test(chemin)) return "public";
  if (/^\/(l\/|ligues\b)/.test(chemin)) return "app";

  try {
    return window.localStorage.getItem(CLE_LIGUE) ? "app" : "public";
  } catch {
    // Safari en navigation privée peut refuser localStorage. Dans le doute,
    // le challenge d'origine — c'est lui qui a des joueurs à ne pas perdre.
    return "public";
  }
}

export const SUPABASE_SCHEMA = schemaVoulu();

/**
 * Cette page parle-t-elle d'une ligue ?
 *
 * Sur `public` il n'y a pas de table `leagues` : y chercher une ligue
 * renverrait une erreur à chaque ouverture. Tout le chemin « créer / rejoindre
 * / charger une ligue » est donc conditionné à ce drapeau — et les neuf joueurs
 * du challenge, qui n'ont aucune ligue en mémoire, ne le voient jamais passer.
 */
export const MULTI_LIGUES = SUPABASE_SCHEMA !== "public";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false }, // pas d'auth : clé anonyme seule
  db: { schema: SUPABASE_SCHEMA },
});
