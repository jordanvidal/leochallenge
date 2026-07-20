// Clôture hebdo du dimanche 21h (Paris) : qui mène, combien d'heures
// restent avant le reset de minuit. Déclenché par GitHub Actions avec
// le même Bearer CRON_SECRET. Pourrait passer en cron Vercel — le
// plafond Hobby est de 100 crons, pas 2 comme on l'a longtemps cru ici
// — mais ce job n'écrit aucun état : s'il saute, rien ne casse.

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendWeeklyClose } from "@/lib/server/weekly-close";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await sendWeeklyClose());
}
