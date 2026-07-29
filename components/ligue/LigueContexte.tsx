"use client";

// La ligue courante, disponible partout sans être passée de main en main.
//
// Ce contexte n'existe que parce qu'il a enfin des consommateurs : les écrans
// qui demandent « jusqu'à quand ? » et le hook de données qui demande « qui
// joue avec moi ? ». Tant qu'il n'aurait rendu qu'une constante, il aurait été
// de la plomberie sans usage — c'est pour ça qu'il arrive maintenant et pas en
// phase 3a.
//
// Il rend toujours une `Fenetre`, jamais `undefined` : en groupe unique
// (schéma `public`), c'est celle des variables d'environnement, et les écrans
// n'ont pas à savoir dans quel monde ils tournent.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { FENETRE_ENV, type Fenetre } from "@/lib/challenge";
import { fenetreDeLigue, poseLePass, type Ligue } from "@/lib/ligue";

type ValeurLigue = {
  /** `null` en groupe unique : il n'y a pas de ligue, il y a le challenge. */
  ligue: Ligue | null;
  fenetre: Fenetre;
};

const Contexte = createContext<ValeurLigue>({
  ligue: null,
  fenetre: FENETRE_ENV,
});

export function FournisseurLigue({
  ligue,
  children,
}: {
  ligue: Ligue | null;
  children: ReactNode;
}) {
  const valeur = useMemo<ValeurLigue>(
    () => ({
      ligue,
      fenetre: ligue ? fenetreDeLigue(ligue) : FENETRE_ENV,
    }),
    [ligue],
  );
  // Le code de ligue devient le secret des routes POST, à la place du mot de
  // passe du groupe. Posé ici parce que c'est ici qu'on sait quelle ligue.
  useEffect(() => {
    poseLePass(ligue?.invite_code ?? null);
  }, [ligue]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/**
 * La fenêtre de dates à passer aux fonctions de `lib/challenge`, `lib/stats`,
 * `lib/share` et `lib/duels` — toutes paramétrées pour ça depuis la phase 3a.
 */
export function useFenetre(): Fenetre {
  return useContext(Contexte).fenetre;
}

/** La ligue elle-même, quand on a besoin de son nom ou de son identifiant. */
export function useLigueCourante(): Ligue | null {
  return useContext(Contexte).ligue;
}
