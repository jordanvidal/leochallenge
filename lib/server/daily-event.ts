// Tirage + annonce du matin. On dit qu'un événement est tombé, jamais
// lequel : la découverte appartient à la roue de la modale. Le spoiler
// ici tuerait le seul moment de surprise de la journée.
//
// Ce cron répare aussi un défaut du tirage paresseux : sans lui,
// get_daily_event() n'est appelé qu'à la première ouverture de l'app.
// Le 14/07 elle est tombée à 20h06 — un « happy hour » (fenêtre 18h-20h)
// tiré à cette heure-là aurait désigné une fenêtre déjà fermée. À 6h,
// l'événement existe avant que la journée commence.

import { parisToday, sendToPlayers, serverSupabase } from "./push";

// Quatre formulations en rotation : ~30 notifications sur le challenge,
// un texte unique deviendrait invisible au bout d'une semaine.
const TEASERS = [
  "Le tirage est tombé. Ouvre pour voir sur quoi.",
  "Un événement est actif aujourd'hui. À toi de voir lequel.",
  "Ça a tourné cette nuit. Il y a quelque chose à prendre.",
  "Événement du jour tiré. Il ne dure que jusqu'à minuit.",
];

export async function notifyDailyEvent(): Promise<{
  day: string;
  event: string | null;
  sent: number;
}> {
  const supabase = serverSupabase();
  const day = parisToday();

  // Idempotent par construction : la RPC tire si personne ne l'a fait,
  // sinon elle relit le tirage existant. Rien à changer côté SQL.
  const { data, error } = await supabase.rpc("get_daily_event");
  if (error) throw new Error(`tirage échoué : ${error.message}`);

  const event = data as string | null;
  // null = hors challenge, « rien » = 40 % des jours. Dans les deux cas
  // on se tait : réveiller les gens pour dire qu'il ne se passe rien, non.
  if (!event || event === "rien") return { day, event, sent: 0 };

  const players = await supabase.from("players").select("id");
  if (players.error) throw new Error("lecture joueurs échouée");

  const ids = (players.data as { id: string }[]).map((p) => p.id);
  const teaser = TEASERS[Number(day.slice(-2)) % TEASERS.length];
  const sent = await sendToPlayers(ids, {
    title: "🎲 Événement du jour",
    body: teaser,
  });
  return { day, event, sent };
}
