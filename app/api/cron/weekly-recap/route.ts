// Récap hebdo du lundi 10h (Paris) : la semaine écoulée, le gagnant,
// la course qui repart. Pas de cron Vercel disponible (plan Hobby :
// 2 max, déjà pris par les rappels) — déclenché par un cron externe
// (cron-job.org) avec le même Bearer CRON_SECRET.

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendWeeklyRecap } from "@/lib/server/recap";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const result = await sendWeeklyRecap();
  return NextResponse.json(result);
}
