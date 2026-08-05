// 😴 Le jour off de la semaine : tirage de 6h et annonce.
//
// Deux différences avec l'événement du jour, et elles vont dans le même
// sens : ce push DIT ce qu'il annonce, et il part tôt.
//
// Le teaser de 7h protège une surprise — la roue de la modale est le
// seul moment de découverte de la journée. Un jour de repos n'a rien à
// protéger : quelqu'un qui apprend à 21h qu'il pouvait souffler n'a pas
// eu de jour off, il a eu une information. D'où 6h, et d'où le texte en
// clair.
//
// 6h et pas plus tard, aussi, parce que le cron de l'événement tourne à
// 7h (05/08 : il était à 9h, sur GitHub Actions) et que la fonction SQL
// résout le jour off AVANT de tirer l'événement. Sans ce job matinal, le
// repos serait décidé à 7h — après le réveil de ceux qui s'entraînent le
// matin. L'ordre tient : 6h-6h59 précède 7h-7h59. Et même s'il ne tenait
// pas, `get_daily_event()` appelle `get_jour_off()` lui-même — arriver
// premier ne lui ferait pas tirer d'événement un jour de repos.

import { parisToday, sendToPlayers, serverSupabase } from "./push";
import { joueursDuTerrain, TERRAIN_ENV, type Terrain } from "./ligues";

export const JOUR_OFF_PUSH_TITLE = "😴 Jour off";

// Le corps du message. Il dit les deux choses qu'on a besoin de savoir
// dans son lit : ta série ne risque rien, et tu peux quand même y aller.
// Sans la seconde, le jour off se lit comme une interdiction.
export const JOUR_OFF_PUSH_BODY =
  "Aujourd'hui, personne ne coche et les séries tiennent. Si tu t'entraînes quand même, tout compte normalement.";

/** Aujourd'hui est-il le jour off ? Lecture seule, aucun tirage. Sert
    aux rappels du soir, qui doivent se taire — pas les provoquer.
 *
 *  Elle ne lève JAMAIS. C'est un choix, pas une négligence : cette
 *  fonction décide du silence des trois rappels du soir, et elle est
 *  appelée depuis leurs crons. Une exception ici ne rendrait pas l'app
 *  bavarde, elle ferait tomber le cron entier — donc plus aucun rappel,
 *  et le cœur du produit avec. Le `try` couvre la construction du client
 *  autant que la requête : `serverSupabase()` lève quand l'URL manque.
 *
 *  En cas de doute on répond « non » : un rappel de trop vaut mieux
 *  qu'un silence inexplicable un soir de panne. */
export async function estJourOff(t: Terrain = TERRAIN_ENV): Promise<boolean> {
  // Le jour off n'existe que sur le challenge d'origine : les ligues
  // sont restées au barème S3, et leur schéma n'a pas la table.
  if (t.schema !== "public") return false;
  try {
    const { data, error } = await serverSupabase(t.schema)
      .from("jours_off")
      .select("day")
      .eq("day", parisToday())
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

/** Tirage de 6h + annonce. Idempotent par construction : la RPC tire si
    personne ne l'a fait, sinon elle relit. Rejouer le job n'envoie pas
    deux notifications — le second appel trouve le tirage déjà fait et
    repart, mais on ne peut pas le savoir d'ici. La déduplication vient
    du fait qu'un seul cron le déclenche. */
export async function notifyJourOff(t: Terrain = TERRAIN_ENV): Promise<{
  day: string;
  off: boolean;
  sent: number;
}> {
  const day = parisToday();
  if (t.schema !== "public") return { day, off: false, sent: 0 };

  // Déjà tiré ? Alors le job a déjà tourné aujourd'hui (ou un lève-tôt a
  // ouvert l'app avant 6h) : on ne repousse pas.
  const deja = await estJourOff(t);

  const { data, error } = await serverSupabase(t.schema).rpc("get_jour_off");
  if (error) throw new Error(`tirage du jour off échoué : ${error.message}`);

  const off = data as boolean;
  if (!off || deja) return { day, off, sent: 0 };

  const ids = await joueursDuTerrain(t);
  if (!ids) throw new Error("lecture joueurs échouée");
  const sent = await sendToPlayers(
    ids,
    { title: JOUR_OFF_PUSH_TITLE, body: JOUR_OFF_PUSH_BODY },
    t.schema,
  );
  return { day, off, sent };
}
