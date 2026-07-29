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
 * Cette bascule ne se fait qu'en phase 5, une fois le groupe d'origine recopié
 * dans `app`. D'ici là la variable reste absente et rien ne change.
 *
 * Attention : préfixe NEXT_PUBLIC_, donc figée au build. La changer côté Vercel
 * demande un redéploiement — c'est voulu, ce n'est pas un interrupteur qu'on
 * actionne un soir sans y penser.
 */
export const SUPABASE_SCHEMA =
  process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? "public";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false }, // pas d'auth : clé anonyme seule
  db: { schema: SUPABASE_SCHEMA },
});
