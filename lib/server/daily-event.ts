// Tirage + annonce du matin. On dit qu'un événement est tombé, jamais
// lequel : la découverte appartient à la roue de la modale. Le spoiler
// ici tuerait le seul moment de surprise de la journée.
//
// Ce cron répare aussi un défaut du tirage paresseux : sans lui,
// get_daily_event() n'est appelé qu'à la première ouverture de l'app.
// Le 14/07 elle est tombée à 20h06 — un « happy hour » (fenêtre 18h-20h)
// tiré à cette heure-là aurait désigné une fenêtre déjà fermée. Tiré le
// matin par le cron (9h), l'événement existe tôt dans la journée.

import { parisToday, sendToPlayers, serverSupabase } from "./push";
import { joueursDuTerrain, TERRAIN_ENV, type Terrain } from "./ligues";

// Quatre formulations en rotation : ~30 notifications sur le challenge,
// un texte unique deviendrait invisible au bout d'une semaine.
const TEASERS = [
  "Le tirage est tombé. Ouvre pour voir sur quoi.",
  "Un événement est actif aujourd'hui. À toi de voir lequel.",
  "Ça a tourné cette nuit. Il y a quelque chose à prendre.",
  "Événement du jour tiré. Il ne dure que jusqu'à minuit.",
];

export const EVENT_PUSH_TITLE = "🎲 Événement du jour";

/** Teaser du jour. Pur et déterministe : même jour, même texte, donc
    deux envois le même jour ne se contredisent pas. */
export function teaserFor(day: string): string {
  return TEASERS[Number(day.slice(-2)) % TEASERS.length];
}

export async function notifyDailyEvent(t: Terrain = TERRAIN_ENV): Promise<{
  day: string;
  event: string | null;
  sent: number;
}> {
  const supabase = serverSupabase(t.schema);
  const day = parisToday();

  // Idempotent par construction : la RPC tire si personne ne l'a fait,
  // sinon elle relit le tirage existant. Rien à changer côté SQL.
  const { data, error } = await supabase.rpc("get_daily_event");
  if (error) throw new Error(`tirage échoué : ${error.message}`);

  const event = data as string | null;
  // null = hors challenge, « rien » = 40 % des jours. Dans les deux cas
  // on se tait : réveiller les gens pour dire qu'il ne se passe rien, non.
  if (!event || event === "rien") return { day, event, sent: 0 };

  // Le tirage est global — un événement par jour civil, le même pour tout le
  // monde (`app.daily_events`, migration36). Les destinataires, eux, ne le
  // sont pas : quelqu'un dont la ligue n'a pas encore commencé n'a rien à
  // faire d'un « aujourd'hui, double pompes ».
  const ids = await joueursDuTerrain(t);
  if (!ids) throw new Error("lecture joueurs échouée");
  const sent = await sendToPlayers(
    ids,
    { title: EVENT_PUSH_TITLE, body: teaserFor(day) },
    t.schema,
  );
  return { day, event, sent };
}
