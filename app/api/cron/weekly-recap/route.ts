// Récap hebdo du lundi 10h (Paris) : la semaine écoulée, le gagnant,
// la course qui repart. Pas de cron Vercel disponible (plan Hobby :
// 2 max, déjà pris par les rappels) — déclenché par un cron externe
// avec le même Bearer CRON_SECRET.
//
// Les duels vivent dans le même rendez-vous : résolution de la semaine
// jouée + nouvel appariement, et leurs lignes s'embarquent dans le push
// du récap. Si les duels échouent, le récap part quand même.
//
// Rejouable, push compris. Le cron GitHub arrive avec 1 à 3 heures de
// retard et il est parfois avalé (le 20/07 il n'est jamais parti) : le
// workflow tire donc deux fois le lundi. Le second appel voit que les
// événements du feed existent déjà et se tait — sinon tout le monde
// recevrait le récap en double, ce qui est arrivé le 20/07 sur le
// tirage du jour, qui lui n'a pas cette garde.

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

  // Rejeu détecté : la base a déjà tout, il ne reste qu'à ne réveiller
  // personne. On sort avant les deux envois (récap et win-back).
  if (duels?.alreadyRan) {
    return NextResponse.json({
      replayed: true,
      duels: {
        resolved: duels.resolved,
        created: duels.created,
        feedInserted: duels.feedInserted,
      },
    });
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
