// Rappel de 20h (Paris) : ceux qui n'ont rien coché, avec le nombre
// de potes qui ont déjà fini. Déclenché par Vercel Cron (18h UTC l'été).
//
// Le même passage porte le « demain, ça commence » des ligues qui démarrent
// le lendemain. Pas un cron de plus : celui-ci tourne déjà tous les jours à
// l'heure qu'il faut, et une ligue en avant-première n'est vue par aucun
// autre job (`terrainsActifs` ne rend que les ligues déjà commencées).
// Les deux listes de terrains sont disjointes par construction — une ligue
// est soit en cours, soit à la veille de son premier jour — donc personne
// ne reçoit les deux.

import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/server/push";
import { sendReminders, sendVeilleDeLancement } from "@/lib/server/reminders";
import {
  surChaqueTerrain,
  terrainsQuiDemarrentDemain,
} from "@/lib/server/ligues";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }

  const rappels = await surChaqueTerrain((t) => sendReminders(false, t));

  // Isolé du reste, dans cet ordre : une ligue qui démarre demain ne doit
  // pas pouvoir empêcher les rappels du soir de partir à celles qui tournent.
  let veilles: unknown[] = [];
  try {
    const terrains = await terrainsQuiDemarrentDemain();
    veilles = await Promise.all(
      terrains.map(async (t) => {
        try {
          return await sendVeilleDeLancement(t);
        } catch (e) {
          return { ligue: t.ligue?.slug ?? null, erreur: (e as Error).message };
        }
      }),
    );
  } catch (e) {
    veilles = [{ erreur: (e as Error).message }];
  }

  return NextResponse.json({ ...rappels, veilles });
}
