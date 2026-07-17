// Annonce one-shot des duels, envoyée à toute la bande. Pas de cron :
// déclenchée à la main (workflow_dispatch ou curl) la veille du premier
// tirage. Même Bearer CRON_SECRET que les autres routes.

import { NextResponse } from "next/server";
import { frenchDayMonth } from "@/lib/challenge";
import { DUEL_POINTS, DUELS_FROM } from "@/lib/duels";
import { isAuthorizedCron, sendToPlayers, serverSupabase } from "@/lib/server/push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }

  const supabase = serverSupabase();
  const players = await supabase.from("players").select("id");
  if (players.error) {
    return NextResponse.json({ error: "lecture players échouée" }, { status: 500 });
  }

  const ids = (players.data as { id: string }[]).map((p) => p.id);
  const sent = await sendToPlayers(ids, {
    title: "⚔️ Demain, les duels débarquent",
    body:
      `Un face-à-face d'une semaine contre ton voisin de classement : ` +
      `le plus de journées parfaites l'emporte et prend ${DUEL_POINTS} pts à l'autre. ` +
      `Premier tirage lundi ${frenchDayMonth(DUELS_FROM)} à 10h. Sois prêt.`,
  });

  return NextResponse.json({ notified: ids.length, sent });
}
