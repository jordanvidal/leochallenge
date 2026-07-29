// Dernier debout de 21h30 (Paris) : le seul joueur encore à 0/3.
// Déclenché par GitHub Actions (19h30 UTC l'été).

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendLastStanding } from "@/lib/server/reminders";
import { surChaqueTerrain } from "@/lib/server/ligues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await surChaqueTerrain((t) => sendLastStanding(t)));
}
