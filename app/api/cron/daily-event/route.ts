// Tirage + annonce de 7h (Paris) : le serveur tire l'événement du jour et
// prévient tout le monde s'il y en a un. Cron Vercel, `0 5 * * *` (05:00
// UTC = 7h Paris l'été), tenu à ±59 min par le plan Hobby.
//
// Il a vécu jusqu'au 05/08 sur GitHub Actions, programmé à 9h. Le job
// partait en réalité entre 11h et 12h50 : le retard de file de GitHub
// n'est pas de 5 à 20 min comme l'affirmaient les commentaires de ce
// repo, mais de 2h à 3h50, tous les jours sans exception. Une annonce
// « voilà ta journée » qui arrive à midi n'annonce plus grand-chose.
// D'où la migration : Vercel ne garantit pas la minute, mais l'heure.
//
// Un seul déclencheur, et c'est important : la route ne déduplique pas
// ses push. Si un jour on rebranche un cron externe dessus sans retirer
// celui-ci, six téléphones sonnent deux fois.

import { NextResponse } from "next/server";
import { notifyDailyEvent } from "@/lib/server/daily-event";
import { isAuthorizedCron } from "@/lib/server/push";
import { surChaqueTerrain } from "@/lib/server/ligues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await surChaqueTerrain((t) => notifyDailyEvent(t)));
}
