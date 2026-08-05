"use client";

// L'indice du jour : ce que la journée a déjà dit d'elle (02/08).
//
// Trois blocs de l'accueil n'existent qu'après leur fetch : les bandeaux
// (événement / jour off), la rangée d'état, la section bonus. Chacun, en
// arrivant, poussait le lanceur vers le bas — au moment précis où le pouce
// descendait dessus. RankLine tient déjà sa place avec un skeleton ; pour
// généraliser, il faut savoir AVANT le fetch si un bloc conditionnel va
// venir : un skeleton pour un bandeau qui ne viendra jamais est pire que
// le saut qu'il évite.
//
// D'où cette note en localStorage, écrite à chaque fetch réussi et datée :
// « aujourd'hui il y a un événement / c'est jour off / ta séance est
// lancée ». À la prochaine ouverture du même jour — le cas réel : on ouvre
// l'app plusieurs fois par jour — l'accueil réserve exactement ce qui va
// revenir, et rien d'autre. Première ouverture du jour : pas d'indice, on
// assume le comportement d'avant plutôt que de réserver à l'aveugle.
//
// L'indice ne DÉVERROUILLE rien : le portier reste useTodaySession et la
// séance serveur. Il ne décide que des pixels réservés et de l'affichage
// anticipé de blocs purement informatifs.

import { useEffect, useState } from "react";
import { BonusState, estJourOffAujourdhui } from "@/lib/bonus";
import { parisToday } from "@/lib/challenge";

const CLE_INDICE = "lc100.accueilJour";

type IndiceJour = {
  j: string; // le jour de l'indice — périmé dès minuit
  ev: boolean; // un événement a été tiré aujourd'hui
  boss: boolean; // ...et c'est le boss du dimanche, seul tirage à bandeau bas
  off: boolean; // aujourd'hui est le jour off
  seance: boolean; // une séance a été ouverte côté serveur aujourd'hui
};

/** L'indice du jour, ou null s'il date d'un autre jour (ou n'existe pas). */
function lireIndice(): IndiceJour | null {
  if (typeof window === "undefined") return null;
  try {
    const brut = localStorage.getItem(CLE_INDICE);
    if (!brut) return null;
    const i = JSON.parse(brut) as IndiceJour;
    return i.j === parisToday() ? i : null;
  } catch {
    return null;
  }
}

export function useIndiceAccueil(
  bonus: BonusState | null,
  sessionStarted: boolean,
) {
  // Ce qu'on attend des fetchs, lu une fois à l'ouverture. Le croisement
  // avec « déjà vu aujourd'hui » est parti le 05/08 avec le ✕ du bandeau :
  // un événement tiré aujourd'hui donne un bandeau, point — plus rien ne
  // peut l'éteindre avant minuit, donc plus rien ne peut fermer sa place.
  const [attendu] = useState(() => {
    const i = lireIndice();
    return {
      ev: !!i?.ev,
      boss: !!i?.boss,
      off: !!i?.off,
      seance: !!i?.seance,
    };
  });

  // L'indice s'écrit dès que la journée s'est dite (fetch bonus revenu),
  // et se met à jour quand la séance part. `attendu.seance` dans le OU :
  // écrire `false` entre l'arrivée du bonus et celle de la séance
  // effacerait un souvenir vrai du matin même.
  useEffect(() => {
    if (!bonus) return;
    const indice: IndiceJour = {
      j: parisToday(),
      ev: !!bonus.event,
      boss: bonus.event?.key === "boss_dimanche",
      off: estJourOffAujourdhui(bonus),
      seance: sessionStarted || attendu.seance,
    };
    localStorage.setItem(CLE_INDICE, JSON.stringify(indice));
  }, [bonus, sessionStarted, attendu.seance]);

  // La séance du jour est ouverte — su par le serveur, ou promis par
  // l'indice en attendant sa réponse. `sessionStarted` ne vient que d'une
  // ligne en base (useWorkout n'appelle markStarted qu'à la confirmation),
  // donc un indice du même jour ne peut pas être un faux souvenir : une
  // séance ne se dé-lance pas avant minuit. Pilote la rangée d'état et le
  // libellé du lanceur — de l'affichage, jamais une coche : le portier
  // reste useTodaySession.
  const enSeance = sessionStarted || attendu.seance;

  return { attendu, enSeance };
}
