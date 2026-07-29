"use client";

// Le retour arrière : ce que fait le bouton retour d'Android, et le glissé
// natif de Safari dans un onglet.
//
// Il ne connaît qu'une chose, les couches posées par-dessus l'écran :
// feuilles, modales, mode séance. Changer d'onglet ne passe pas par ici —
// les cinq onglets sont une rangée qu'on traverse au glissé
// (hooks/useGestePage), pas une pile où l'on entre et d'où l'on ressort.
//
// Tout passe par l'historique du navigateur, et l'URL n'est jamais touchée
// (pushState sans argument d'URL) : le lien ?tab=chat des notifications
// reste intact.

import { useEffect, useRef } from "react";

type Couche = { id: number; fermer: () => void };

let pile: Couche[] = [];
let prochainId = 1;
/** Entrées d'historique que nous avons réellement poussées. */
let profondeur = 0;
/** Les popstate provoqués par nos propres corrections : à ne pas dépiler. */
let aIgnorer = 0;
let accordPrevu = false;

/**
 * Accorde l'historique sur la pile.
 *
 * Personne ne pousse ni ne retire d'entrée à la main : on déclare l'état
 * voulu, et un seul endroit rattrape l'écart. C'est ce qui rend le tout
 * insensible au double montage des effets de React en développement —
 * monter, démonter, remonter dans le même tour de boucle se réduit à une
 * seule entrée, au lieu d'en pousser deux et d'en rendre une.
 *
 * Le microtask est la raison même : il laisse le tour de boucle finir,
 * donc l'aller-retour se voit comme un non-événement.
 */
function accorder(): void {
  if (accordPrevu) return;
  accordPrevu = true;
  queueMicrotask(() => {
    accordPrevu = false;
    const cible = pile.length;
    while (profondeur < cible) {
      profondeur += 1;
      history.pushState({ lc: profondeur }, "");
    }
    if (profondeur > cible) {
      const n = profondeur - cible;
      profondeur = cible;
      // history.go(-n) ne déclenche qu'UN popstate, quel que soit n.
      aIgnorer += 1;
      history.go(-n);
    }
  });
}

/**
 * Empile une action de retour. Rend la fonction qui la retire : à appeler
 * quand la couche se ferme par un autre chemin (tap dehors, bouton
 * « Annuler »), sinon le bouton retour demanderait deux appuis.
 */
export function empiler(fermer: () => void): () => void {
  const couche: Couche = { id: prochainId++, fermer };
  pile.push(couche);
  accorder();
  return () => {
    if (!pile.some((c) => c.id === couche.id)) return;
    pile = pile.filter((c) => c.id !== couche.id);
    accorder();
  };
}

/** La pile est un module : les tests et les remontages ne doivent pas en
    hériter. Appelé au démontage du gestionnaire. */
function reinitialiser(): void {
  pile = [];
  profondeur = 0;
  aIgnorer = 0;
}

/**
 * Le gestionnaire, monté une seule fois (App). Il écoute l'historique —
 * donc le bouton retour d'Android et le glissé natif de Safari.
 */
export function useRetour(): void {
  useEffect(() => {
    const onPop = () => {
      // Nos propres corrections : la profondeur a déjà été ajustée.
      if (aIgnorer > 0) {
        aIgnorer -= 1;
        return;
      }
      profondeur = Math.max(0, profondeur - 1);
      pile.pop()?.fermer();
      accorder();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      reinitialiser();
    };
  }, []);
}

/**
 * Une couche par-dessus l'écran : feuille, modale, mode séance. Tant
 * qu'elle est là, c'est elle que le retour ferme.
 *
 * `fermer` est lue par une ref : la couche reste enregistrée pendant
 * toute sa vie, même si l'appelant recrée sa fonction à chaque rendu.
 * `actif` sert aux couches dont l'état vit chez un parent qui, lui, ne
 * se démonte pas.
 */
export function useCoucheRetour(fermer: () => void, actif = true): void {
  const ref = useRef(fermer);
  ref.current = fermer;
  useEffect(() => {
    if (!actif) return;
    return empiler(() => ref.current());
  }, [actif]);
}
