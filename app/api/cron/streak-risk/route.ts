// Série en danger de 17h (Paris) : ceux qui ont une série ≥ 3 et rien
// coché aujourd'hui. Déclenché par GitHub Actions (15h UTC l'été).

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendStreakRisk } from "@/lib/server/reminders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const result = await sendStreakRisk();
  return NextResponse.json(result);
}
