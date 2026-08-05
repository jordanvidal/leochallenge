// Tirage + annonce du jour off, 6h (Paris). Cron Vercel, pas GitHub
// Actions : mesurés sur ce repo, les jobs GitHub arrivent avec 50 min à
// 3h50 de retard, et un jour off annoncé à 9h17 n'est plus un jour off.
// Vercel garantit l'heure à ±59 min près sur Hobby — donc entre 6h et
// 7h, toujours avant le tirage de l'événement (7h-7h59 depuis le 05/08,
// contre 9h auparavant : la marge s'est resserrée, l'ordre tient).
//
// Ce job ÉCRIT de l'état (la ligne du jour off), comme weekly-recap.
// C'est la seconde raison de le mettre sur Vercel.

import { NextResponse } from "next/server";
import { notifyJourOff } from "@/lib/server/jour-off";
import { isAuthorizedCron } from "@/lib/server/push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  // Pas de surChaqueTerrain : le jour off n'existe que sur le challenge
  // d'origine. Les ligues sont restées au barème S3 et leur schéma n'a
  // ni la table ni la fonction.
  return NextResponse.json(await notifyJourOff());
}
