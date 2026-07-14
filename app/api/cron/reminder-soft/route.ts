// Rappel de 20h (Paris) : ceux qui n'ont rien coché, avec le nombre
// de potes qui ont déjà fini. Déclenché par Vercel Cron (18h UTC l'été).

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendReminders } from "@/lib/server/reminders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const result = await sendReminders(false);
  return NextResponse.json(result);
}
