// Les terrains sur lesquels un cron doit passer ce matin.
//
// Un « terrain », c'est une ligue et sa fenêtre de dates. En groupe unique il
// n'y en a qu'un, sans ligue, avec la fenêtre des variables d'environnement :
// les crons bouclent alors sur une seule itération et se comportent
// exactement comme aujourd'hui.
//
// C'est ce qui permet d'écrire la boucle une fois pour toutes, sans que chaque
// route ait à savoir dans quel monde elle tourne.

import { addDays, FENETRE_ENV, parisToday, type Fenetre } from "@/lib/challenge";
import { fenetreDeLigue, type Ligue } from "@/lib/ligue";
import { serverSupabase } from "./push";

export type Terrain = {
  /** `null` pour le challenge d'origine : ce n'est pas une ligue. */
  ligue: Ligue | null;
  fenetre: Fenetre;
  /** `public` pour le challenge d'origine, `app` pour une ligue. */
  schema: "public" | "app";
};

/** Le terrain du groupe d'origine : pas de ligue, la fenêtre des variables. */
export const TERRAIN_ENV: Terrain = {
  ligue: null,
  fenetre: FENETRE_ENV,
  schema: "public",
};

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
 * Le challenge d'origine ouvre la liste tant qu'il tourne, et il est calculé
 * sans toucher à `app` : ses neuf joueurs ne perdent pas un rappel parce
 * qu'une requête sur les ligues a échoué. Les ligues, elles, sont ignorées en
 * silence si le schéma est absent — un cron qui ne sait pas à qui parler se
 * tait plutôt que d'échouer bruyamment.
 */
export async function terrainsActifs(): Promise<Terrain[]> {
  const today = parisToday();
  const terrains: Terrain[] = [];

  // Le challenge d'origine, tant qu'il tourne. Il passe en premier et il est
  // calculé sans toucher à `app` : ses neuf joueurs ne doivent jamais perdre
  // un rappel parce qu'une requête sur les ligues a échoué.
  if (today >= FENETRE_ENV.start && today <= FENETRE_ENV.end) {
    terrains.push(TERRAIN_ENV);
  }

  try {
    const sb = serverSupabase("app");
    const { data: ligues, error } = await sb
      .from("leagues")
      .select(COLONNES)
      .lte("start_day", today)
      .gte("end_day", today);
    if (error || !ligues || ligues.length === 0) return terrains;

    // Le compte des joueurs en une seule requête plutôt qu'une par ligue : à ce
    // volume, ramener les identifiants coûte moins cher que N aller-retours.
    const ids = (ligues as Ligue[]).map((l) => l.id);
    const { data: joueurs, error: err2 } = await sb
      .from("players")
      .select("league_id")
      .in("league_id", ids);
    if (err2 || !joueurs) return terrains;

    const compte = new Map<string, number>();
    for (const j of joueurs as { league_id: string }[]) {
      compte.set(j.league_id, (compte.get(j.league_id) ?? 0) + 1);
    }

    for (const ligue of ligues as Ligue[]) {
      if ((compte.get(ligue.id) ?? 0) >= JOUEURS_MINIMUM) {
        terrains.push({
          ligue,
          fenetre: fenetreDeLigue(ligue),
          schema: "app",
        });
      }
    }
  } catch {
    // Le schéma `app` peut être absent ou non exposé selon l'environnement.
    // Ce n'est pas une raison pour taire le challenge d'origine.
  }

  return terrains;
}

/**
 * Les ligues dont le premier jour est DEMAIN, à au moins deux joueurs.
 *
 * Fonction séparée, et c'est le cœur de la décision. La demande d'origine
 * était d'élargir `terrainsActifs` à J-1 — mais ce filtre est ce qui protège
 * TOUS les crons : l'événement du jour, les deux rappels du soir, la série en
 * danger, le dernier debout, la clôture du dimanche. Une ligue qui y entrerait
 * la veille recevrait « Personne n'a encore fini aujourd'hui » et « Ta série
 * est en jeu » pour un jour où il n'y a rien à finir et aucune série à tenir.
 * On ajoute donc une porte à côté, qui ne sert qu'à ce message-là. Rayon
 * d'action sur l'existant : zéro.
 *
 * Comme `terrainsActifs`, le seuil de deux joueurs s'applique : annoncer
 * « demain, première séance » à quelqu'un qui n'a encore invité personne,
 * c'est lui promettre un groupe qui n'existe pas.
 *
 * Le challenge d'origine n'en fait jamais partie — sa fenêtre est celle de
 * l'environnement, son premier jour est derrière nous, et il n'y a pas de
 * ligue à lire pour lui.
 */
export async function terrainsQuiDemarrentDemain(): Promise<Terrain[]> {
  const demain = addDays(parisToday(), 1);
  try {
    const sb = serverSupabase("app");
    const { data: ligues, error } = await sb
      .from("leagues")
      .select(COLONNES)
      .eq("start_day", demain);
    if (error || !ligues || ligues.length === 0) return [];

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
      .map((ligue) => ({
        ligue,
        fenetre: fenetreDeLigue(ligue),
        schema: "app" as const,
      }));
  } catch {
    // Même silence que `terrainsActifs` : le schéma `app` peut être absent
    // selon l'environnement, et ce n'est pas une raison de faire tomber le
    // cron des rappels du soir, qui porte le cœur du produit.
    return [];
  }
}

/** Les identifiants des joueurs d'un terrain — les destinataires d'un push. */
export async function joueursDuTerrain(t: Terrain): Promise<string[] | null> {
  const sb = serverSupabase(t.schema);
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
