// Récap hebdo du lundi 10h (Paris) : la semaine écoulée, le gagnant,
// la course qui repart. Cron Vercel (vercel.json), doublé d'un filet
// GitHub deux heures plus tard — c'est le seul de nos jobs planifiés
// qui écrit de l'état, il ne doit pas passer à la trappe.
//
// Les duels vivent dans le même rendez-vous : résolution de la semaine
// jouée + nouvel appariement, et leurs lignes s'embarquent dans le push
// du récap. Si les duels échouent, le récap part quand même.
//
// Rejouable, push compris. Deux déclencheurs tirent le lundi : le second
// voit que les événements du feed existent déjà et sort sans notifier.
// Sans cette garde, le groupe recevrait le récap en double — c'est
// arrivé le 20/07, quand le cron en retard s'est réveillé après un
// rattrapage manuel. Elle rend aussi les rattrapages sûrs.

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
