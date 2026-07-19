// Clôture hebdo du dimanche 21h (Paris) : qui mène, combien d'heures
// restent avant le reset de minuit. Pas de cron Vercel disponible
// (plan Hobby : 2 max, déjà pris par les rappels) — déclenché par
// GitHub Actions avec le même Bearer CRON_SECRET.

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
