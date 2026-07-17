// Tirage + annonce de 9h (Paris) : le serveur tire l'événement du jour et
// prévient tout le monde s'il y en a un. Déclenché par GitHub Actions
// (07:00 UTC l'été ; le plan Vercel Hobby ne laisse que 2 crons, déjà pris).

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
