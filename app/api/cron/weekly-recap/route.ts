// Récap hebdo du lundi 10h (Paris) : la semaine écoulée, le gagnant,
// la course qui repart. Pas de cron Vercel disponible (plan Hobby :
// 2 max, déjà pris par les rappels) — déclenché par un cron externe
// avec le même Bearer CRON_SECRET.
//
// Les duels vivent dans le même rendez-vous : résolution de la semaine
// jouée + nouvel appariement, et leurs lignes s'embarquent dans le push
// du récap. Si les duels échouent, le récap part quand même.

import { NextResponse } from "next/server";
import { runWeeklyDuels } from "@/lib/server/duels";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendWeeklyRecap } from "@/lib/server/recap";
import { sendWinBack } from "@/lib/server/reminders";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }

  let duels: Awaited<ReturnType<typeof runWeeklyDuels>> | null = null;
  let duelsError: string | undefined;
  try {
    duels = await runWeeklyDuels();
  } catch (e) {
    duelsError = (e as Error).message;
  }

  // Win-back des décrochés, isolé comme les duels : s'il échoue, le récap
  // part quand même (les relancés recevront juste le récap standard).
  let winBack: Awaited<ReturnType<typeof sendWinBack>> | null = null;
  let winBackError: string | undefined;
  try {
    winBack = await sendWinBack();
  } catch (e) {
    winBackError = (e as Error).message;
  }

  const recap = await sendWeeklyRecap(
    duels?.lines,
    winBack ? new Set(winBack.reengaged) : undefined,
  );
  return NextResponse.json({
    recap,
    winBack: winBack
      ? { notified: winBack.notified, sent: winBack.sent }
      : { error: winBackError },
    duels: duels
      ? {
          skipped: duels.skipped,
          resolved: duels.resolved,
          created: duels.created,
          feedInserted: duels.feedInserted,
        }
      : { error: duelsError },
  });
}
