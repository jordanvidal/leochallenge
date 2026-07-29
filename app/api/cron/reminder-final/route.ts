// Dernier rappel de 22h30 (Paris), uniquement pour ceux encore à 0/3.
// Déclenché par Vercel Cron (20h30 UTC l'été).

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendReminders } from "@/lib/server/reminders";
import { surChaqueTerrain } from "@/lib/server/ligues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await surChaqueTerrain((t) => sendReminders(true, t)));
}
