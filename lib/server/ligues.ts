// Les terrains sur lesquels un cron doit passer ce matin.
//
// Un « terrain », c'est une ligue et sa fenêtre de dates. En groupe unique il
// n'y en a qu'un, sans ligue, avec la fenêtre des variables d'environnement :
// les crons bouclent alors sur une seule itération et se comportent
// exactement comme aujourd'hui.
//
// C'est ce qui permet d'écrire la boucle une fois pour toutes, sans que chaque
// route ait à savoir dans quel monde elle tourne.

import { FENETRE_ENV, parisToday, type Fenetre } from "@/lib/challenge";
import { fenetreDeLigue, type Ligue } from "@/lib/ligue";
import { serverSupabase } from "./push";

const MULTI = (process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ?? "public") !== "public";

export type Terrain = {
  /** `null` en groupe unique : il n'y a pas de ligue, il y a le challenge. */
  ligue: Ligue | null;
  fenetre: Fenetre;
};

/** Le terrain du groupe d'origine : pas de ligue, la fenêtre des variables. */
export const TERRAIN_ENV: Terrain = { ligue: null, fenetre: FENETRE_ENV };

/** Le nombre de joueurs à partir duquel une ligue mérite qu'on la notifie. */
export const JOUEURS_MINIMUM = 2;

const COLONNES =
  "id, slug, name, invite_code, start_day, end_day, creator_player_id, parent_league_id, created_at";

/**
 * Les ligues qu'un cron doit traiter : **démarrées, pas finies, et à au moins
 * deux joueurs**.
 *
 * Le seuil de deux n'est pas une optimisation. Une ligue d'une personne, c'est
 * quelqu'un qui a créé son terrain et n'a encore invité personne — lui envoyer
 * « plus que 3 jours, ne lâche pas » ou « personne n'a encore coché », c'est
 * une notification qui ne parle de personne. Elle se réveillera quand ses
 * potes seront là.
 *
 * Rend une liste vide en cas d'erreur : un cron qui ne sait pas à qui parler
 * se tait. C'est la bonne façon d'échouer quand on tient un canal qui réveille
 * les gens.
 */
export async function terrainsActifs(): Promise<Terrain[]> {
  if (!MULTI) return [TERRAIN_ENV];

  const today = parisToday();
  const sb = serverSupabase();

  const { data: ligues, error } = await sb
    .from("leagues")
    .select(COLONNES)
    .lte("start_day", today)
    .gte("end_day", today);
  if (error || !ligues || ligues.length === 0) return [];

  // Le compte des joueurs en une seule requête plutôt qu'une par ligue : à ce
  // volume, ramener les identifiants coûte moins cher que N aller-retours.
  const ids = (ligues as Ligue[]).map((l) => l.id);
  const { data: joueurs, error: err2 } = await sb
    .from("players")
    .select("league_id")
    .in("league_id", ids);
  if (err2 || !joueurs) return [];

  const compte = new Map<string, number>();
  for (const j of joueurs as { league_id: string }[]) {
    compte.set(j.league_id, (compte.get(j.league_id) ?? 0) + 1);
  }

  return (ligues as Ligue[])
    .filter((l) => (compte.get(l.id) ?? 0) >= JOUEURS_MINIMUM)
    .map((ligue) => ({ ligue, fenetre: fenetreDeLigue(ligue) }));
}

/** Les identifiants des joueurs d'un terrain — les destinataires d'un push. */
export async function joueursDuTerrain(t: Terrain): Promise<string[] | null> {
  const sb = serverSupabase();
  let q = sb.from("players").select("id");
  if (t.ligue) q = q.eq("league_id", t.ligue.id);
  const { data, error } = await q;
  if (error || !data) return null;
  return (data as { id: string }[]).map((p) => p.id);
}

/** Les joueurs d'un terrain, avec leur prénom — le socle des récaps. */
export function joueursNommes(
  sb: ReturnType<typeof serverSupabase>,
  t: Terrain,
) {
  const q = sb.from("players").select("id, name");
  return t.ligue ? q.eq("league_id", t.ligue.id) : q;
}

/**
 * Passe sur chaque terrain actif et rend un compte-rendu par ligue.
 *
 * Chaque terrain est isolé : si la lecture échoue pour l'un, les autres
 * partent quand même et l'erreur apparaît dans le compte-rendu au lieu de
 * faire tomber la route. Un cron qui réveille des gens ne doit pas se taire
 * pour six ligues parce qu'une septième a hoqueté.
 *
 * En groupe unique, la liste a un seul terrain sans ligue : le compte-rendu
 * porte alors `ligue: null` et le contenu est celui d'aujourd'hui.
 */
export async function surChaqueTerrain<T extends object>(
  travail: (t: Terrain) => Promise<T>,
): Promise<{ terrains: number; resultats: unknown[] }> {
  const terrains = await terrainsActifs();
  const resultats = await Promise.all(
    terrains.map(async (t) => {
      const ligue = t.ligue?.slug ?? null;
      try {
        return { ligue, ...(await travail(t)) };
      } catch (e) {
        return { ligue, erreur: (e as Error).message };
      }
    }),
  );
  return { terrains: terrains.length, resultats };
}
