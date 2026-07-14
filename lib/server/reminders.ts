// Logique partagée des deux rappels quotidiens (20h et 22h30 Paris).
// "Marc et Léo ont fini. Pas toi." — c'est ça qui fait faire les pompes.

import { parisToday, sendToPlayers, serverSupabase } from "./push";

type Entry = {
  player_id: string;
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};

export async function sendReminders(final: boolean): Promise<{
  notified: number;
  sent: number;
}> {
  const supabase = serverSupabase();
  const today = parisToday();

  const [players, entries] = await Promise.all([
    supabase.from("players").select("id, name"),
    supabase
      .from("entries")
      .select("player_id, pushups, abs, squats")
      .eq("day", today),
  ]);
  if (players.error || entries.error) {
    throw new Error("lecture Supabase échouée");
  }

  const rows = entries.data as Entry[];
  const doneCount = (e: Entry | undefined) =>
    e ? (e.pushups ? 1 : 0) + (e.abs ? 1 : 0) + (e.squats ? 1 : 0) : 0;
  const byPlayer = new Map(rows.map((e) => [e.player_id, e]));

  // Cibles : rien coché aujourd'hui (0/3). Les 1/3 et 2/3 ont déjà ouvert l'app.
  const slackers = (players.data as { id: string; name: string }[]).filter(
    (p) => doneCount(byPlayer.get(p.id)) === 0,
  );
  const finishers = (players.data as { id: string; name: string }[]).filter(
    (p) => doneCount(byPlayer.get(p.id)) === 3,
  );

  if (slackers.length === 0) return { notified: 0, sent: 0 };

  const names = finishers.map((f) => f.name);
  let body: string;
  if (final) {
    body = "22h30. Dernier appel pour les 300. Demain il sera trop tard.";
  } else if (names.length === 0) {
    body = "Personne n'a encore fini aujourd'hui. Sois le premier.";
  } else if (names.length === 1) {
    body = `${names[0]} a fini. Pas toi.`;
  } else if (names.length === 2) {
    body = `${names[0]} et ${names[1]} ont fini. Pas toi.`;
  } else {
    body = `${names[0]}, ${names[1]} et ${names.length - 2} autre${names.length > 3 ? "s" : ""} ont fini. Pas toi.`;
  }

  const sent = await sendToPlayers(
    slackers.map((s) => s.id),
    { title: "💪 100 · 100 · 100", body },
  );
  return { notified: slackers.length, sent };
}
