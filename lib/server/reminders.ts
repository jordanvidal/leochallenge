// Logique partagée des deux rappels quotidiens (20h et 22h30 Paris).
// "Marc et Léo ont fini. Pas toi." — c'est ça qui fait faire les pompes.
// À 22h30, la série en cours prime : perdre son multiplicateur fait plus
// mal que la pression sociale, alors on le dit à celui qui risque gros.

import { parisToday, sendToPlayers, serverSupabase } from "./push";

type Entry = {
  player_id: string;
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};

type LbRow = { player_id: string; current_streak: number };

// Seuil où le multiplicateur de série est actif : en dessous, rien à perdre.
const STREAK_AT_RISK = 3;

/** Message "série en danger" : personnalisé, court, il fait mal gentiment. */
function streakBody(streak: number): string {
  if (streak >= 7) {
    return `${streak} jours parfaits d'affilée. Tu vas vraiment tout casser à 3 exos près ? Ton ×2 saute à minuit.`;
  }
  return `Ta série de ${streak} jours tombe à minuit. 3 exos et elle tient.`;
}

export async function sendReminders(final: boolean): Promise<{
  notified: number;
  sent: number;
}> {
  const supabase = serverSupabase();
  const today = parisToday();

  // La série vient du RPC leaderboard (current_streak reflète la série
  // jusqu'à hier tant qu'aujourd'hui n'est pas parfait — exactement ce
  // qui est en jeu à 22h30). Inutile au rappel de 20h.
  const [players, entries, lb] = await Promise.all([
    supabase.from("players").select("id, name"),
    supabase
      .from("entries")
      .select("player_id, pushups, abs, squats")
      .eq("day", today),
    final ? supabase.rpc("leaderboard") : Promise.resolve(null),
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

  // Série par joueur. RPC en échec → map vide, on retombe sur le générique.
  const streaks = new Map(
    ((lb?.data ?? []) as LbRow[]).map((r) => [
      r.player_id,
      Number(r.current_streak),
    ]),
  );

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

  // À 22h30, la série en danger gagne sur le message social : envoi
  // individuel pour eux (le message porte leur nombre de jours), envoi
  // groupé inchangé pour les autres.
  const title = "💪 100 · 100 · 100";
  let sent = 0;
  const generic: string[] = [];
  for (const s of slackers) {
    const streak = streaks.get(s.id) ?? 0;
    if (final && streak >= STREAK_AT_RISK) {
      sent += await sendToPlayers([s.id], { title, body: streakBody(streak) });
    } else {
      generic.push(s.id);
    }
  }
  if (generic.length > 0) {
    sent += await sendToPlayers(generic, { title, body });
  }
  return { notified: slackers.length, sent };
}
