// Client Supabase unique, côté navigateur.
// Les valeurs de secours évitent un crash au build quand le .env est absent.

import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false }, // pas d'auth : clé anonyme seule
});
