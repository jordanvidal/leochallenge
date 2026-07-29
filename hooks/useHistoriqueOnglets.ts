"use client";

// L'ordre dans lequel on a vu les écrans, et non l'ordre dans lequel ils
// sont rangés dans la barre.
//
// C'est la différence entre « la page précédente » et « la page d'à
// côté ». Depuis le Classement, revenir en arrière ramène au Tchat si
// c'est de là qu'on vient — pas au Tchat parce qu'il est à gauche dans la
// rangée. Les deux coïncident souvent, et quand elles divergent c'est la
// première qu'on attend : on repart d'où l'on venait.
//
// Le modèle est celui d'un navigateur : une pile, un curseur dedans.
// Reculer déplace le curseur, avancer le remet, et ouvrir un nouvel écran
// coupe ce qui était devant.

import { useCallback, useRef, useState } from "react";
import { Tab } from "@/components/TabBar";

/** Au-delà, on oublie le plus ancien. Personne ne remonte trente écrans,
    et une pile qui grandit tout une soirée finit par peser. */
const MAX = 30;

export type HistoriqueOnglets = {
  tab: Tab;
  /** Ouvrir un écran : il devient le présent, et le futur est oublié. */
  aller: (cible: Tab) => void;
  /** L'écran d'avant, s'il y en a un. Rend false si la pile est au bout. */
  reculer: () => boolean;
  /** Défaire un reculer. Rend false s'il n'y a rien devant. */
  avancer: () => boolean;
};

export function useHistoriqueOnglets(initial: Tab): HistoriqueOnglets {
  const [pile, setPile] = useState<Tab[]>([initial]);
  const [i, setI] = useState(0);
  // Lus par les gestes, qui ne se recréent pas à chaque rendu.
  const etat = useRef({ pile, i });
  etat.current = { pile, i };

  /** La ref est mise à jour AVANT les setState : deux navigations dans le
      même tour de boucle liraient sinon deux fois le même état d'avant. */
  const poser = useCallback((p: Tab[], j: number) => {
    etat.current = { pile: p, i: j };
    setPile(p);
    setI(j);
  }, []);

  const aller = useCallback(
    (cible: Tab) => {
      const { pile: p, i: j } = etat.current;
      // Réouvrir l'écran courant n'est pas une navigation : sans ce test,
      // taper deux fois le même onglet ajouterait une étape à remonter.
      if (p[j] === cible) return;
      const coupe = [...p.slice(0, j + 1), cible].slice(-MAX);
      poser(coupe, coupe.length - 1);
    },
    [poser],
  );

  const reculer = useCallback(() => {
    const { pile: p, i: j } = etat.current;
    if (j <= 0) return false;
    poser(p, j - 1);
    return true;
  }, [poser]);

  const avancer = useCallback(() => {
    const { pile: p, i: j } = etat.current;
    if (j >= p.length - 1) return false;
    poser(p, j + 1);
    return true;
  }, [poser]);

  return { tab: pile[i] ?? initial, aller, reculer, avancer };
}
