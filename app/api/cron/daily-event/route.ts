// Tirage + annonce de 6h (Paris) : le serveur tire l'événement du jour et
// prévient tout le monde s'il y en a un. Déclenché par Vercel Cron
// (4h UTC l'été, même convention que les rappels du soir).

import { NextResponse } from "next/server";
import { notifyDailyEvent } from "@/lib/server/daily-event";
import { isAuthorizedCron } from "@/lib/server/push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const result = await notifyDailyEvent();
  return NextResponse.json(result);
}
