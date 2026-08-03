// Le push one-shot de la mi-temps : jeudi 07/08 à 9h Paris, une fois, pour
// tout le monde. Il ne fait qu'une chose — réveiller la bande vers l'écran
// story ouvert le matin même (components/MiTempsScreen).
//
// Même patron que feu `announce-duels` : pas de cron Vercel, un workflow
// GitHub gardé par une date (.github/workflows/mi-temps.yml), le Bearer
// CRON_SECRET des autres routes, et le fichier de workflow supprimé une
// fois l'annonce partie. Concept : docs/mi-temps.md.
//
// Le challenge d'origine seulement. `surChaqueTerrain` n'a rien à faire
// ici : une ligue neuve n'a ni les mêmes dates ni de mi-temps le 7 août,
// et lui envoyer « 25 jours faits » au milieu de sa deuxième semaine
// serait faux pour tout le monde.

import { NextResponse } from "next/server";
import { jourDeMiTemps } from "@/lib/challenge";
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

  // Les chiffres restent dans l'écran : une notification qui annonce déjà le
  // total du groupe n'a plus rien à faire ouvrir. Elle dit qu'il y a quelque
  // chose à voir, et où.
  const ids = (players.data as { id: string }[]).map((p) => p.id);
  const sent = await sendToPlayers(ids, {
    title: "⏱️ Mi-temps",
    body:
      "La moitié du challenge est jouée. Ton bilan, celui de la bande et " +
      "ce qui se joue encore : c'est dans l'app, une fois.",
    url: "/",
  });

  return NextResponse.json({
    miTemps: jourDeMiTemps(),
    notified: ids.length,
    sent,
  });
}
