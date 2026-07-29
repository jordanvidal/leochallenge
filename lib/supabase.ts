// Client Supabase unique, côté navigateur.
// Les valeurs de secours évitent un crash au build quand le .env est absent.

import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

/**
 * Le schéma Postgres visé. `public` par défaut : c'est là que vit le challenge
 * d'origine, et il ne doit pas bouger d'un octet tant qu'il tourne.
 *
 * Le socle multi-ligues se construit dans un schéma neuf `app` (migrations 36 à
 * 38). Poser `NEXT_PUBLIC_SUPABASE_SCHEMA=app` bascule toute l'app dessus :
 * `.from()`, `.rpc()` et le canal temps réel suivent automatiquement.
 *
 * En **preview**, la variable vaut `app` : c'est là qu'on essaie les ligues,
 * sur un schéma vide, sans jamais approcher les données du groupe. En
 * **production** elle reste absente jusqu'à la phase 5, une fois le groupe
 * d'origine recopié dans `app`.
 *
 * Attention : préfixe NEXT_PUBLIC_, donc figée au build. La changer côté Vercel
 * demande un redéploiement — c'est voulu, ce n'est pas un interrupteur qu'on
 * actionne un soir sans y penser.
 */
export const SUPABASE_SCHEMA =
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? "public";

/**
 * L'app tourne-t-elle en multi-ligues ?
 *
 * C'est **le** garde-fou de la phase 3. Sur `public`, la table `leagues`
 * n'existe pas : chercher une ligue y renverrait une erreur à chaque
 * ouverture. Tout le chemin « créer / rejoindre / charger une ligue » est donc
 * conditionné à ce drapeau, et l'app reste exactement celle d'aujourd'hui tant
 * qu'il est faux — un seul groupe, la fenêtre des variables d'env, aucune
 * requête de plus.
 *
 * C'est ce qui rend cette PR mergeable sans que la prod bouge.
 */
export const MULTI_LIGUES = SUPABASE_SCHEMA !== "public";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false }, // pas d'auth : clé anonyme seule
  db: { schema: SUPABASE_SCHEMA },
});
