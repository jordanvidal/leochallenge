"use client";

// Le retour arrière : le glissé depuis le bord gauche sur iPhone installé,
// et le bouton retour d'Android, branchés sur la même pile.
//
// L'app n'a pas de routeur. Un seul écran est monté à la fois et les
// onglets ne s'empilent pas, donc « revenir » ne veut dire quelque chose
// que dans deux cas — les seuls que cette pile connaisse :
//
//  · une couche par-dessus (feuille, modale, mode séance) : on la ferme ;
//  · un saut que l'app a fait pour le joueur (« En parler » ouvre le
//    tchat, « Voir les scores » ouvre le classement) : on le défait.
//
// Un tap sur un onglet n'empile rien. C'est un choix délibéré, la barre
// reste là pour en changer, et empiler les allers-retours d'onglets
// obligerait à glisser six fois pour revenir d'où l'on vient.
//
// Tout passe par l'historique du navigateur : le geste appelle
// history.back() au lieu de dépiler lui-même, donc le bouton d'Android et
// le glissé suivent exactement le même chemin — un seul comportement à
// tenir juste. L'URL n'est jamais touchée (pushState sans argument
// d'URL), le lien ?tab=chat des notifications reste intact.

import { useEffect, useRef } from "react";

/** Largeur de la zone de départ, depuis le bord gauche. 24 px : assez
    pour être atteignable au pouce, assez peu pour ne pas manger les
    gestes du contenu — au premier rang, la réponse par glissé d'une
    bulle de tchat, qui commence elle aussi à gauche. */
export const ZONE_BORD_PX = 24;

/** Distance horizontale au-delà de laquelle le glissé est un retour. */
const SEUIL_PX = 64;

type Couche = {
  id: number;
  fermer: () => void;
  /** Un saut d'écran, par opposition à une couche posée par-dessus. Seuls
      les sauts se vident quand le joueur choisit un onglet à la main. */
  saut: boolean;
};

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
export function empiler(fermer: () => void, saut = false): () => void {
  const couche: Couche = { id: prochainId++, fermer, saut };
  pile.push(couche);
  accorder();
  return () => {
    if (!pile.some((c) => c.id === couche.id)) return;
    pile = pile.filter((c) => c.id !== couche.id);
    accorder();
  };
}

/**
 * Un écran couvrant est-il ouvert sans avoir posé de couche ?
 *
 * Filet de sécurité, pas mécanisme : une feuille qui s'enregistre passe
 * en tête de pile et ce test la laisse tranquille. Il n'attrape que
 * l'overlay qu'on aurait oublié de brancher — auquel cas défaire un saut
 * d'écran derrière lui changerait un écran que le joueur ne voit même
 * pas, et il ne s'en apercevrait qu'en refermant.
 */
function bloqueParUnOverlay(): boolean {
  const dessus = pile[pile.length - 1];
  if (dessus && !dessus.saut) return false;
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** Y a-t-il quelque chose à défaire ? */
export function peutRevenir(): boolean {
  return pile.length > 0 && !bloqueParUnOverlay();
}

/**
 * Le joueur a choisi un onglet lui-même : les sauts en attente n'ont plus
 * de sens, revenir en arrière le ramènerait dans un écran qu'il vient de
 * quitter volontairement.
 *
 * Une couche ouverte fait renoncer : ses entrées sont au-dessus des sauts,
 * et les retirer par le milieu n'a pas de sens dans un historique. Le cas
 * ne se produit pas — une feuille couvre l'écran, on ne peut pas taper un
 * onglet derrière — et on préfère ne rien faire plutôt que de le gérer à
 * moitié.
 */
export function viderSauts(): void {
  if (pile.length === 0 || pile.some((c) => !c.saut)) return;
  pile = [];
  accorder();
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
 * donc le bouton retour d'Android, le glissé natif de Safari et notre
 * propre geste, qui passent tous par là.
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
      // Le bouton d'Android a déjà consommé l'entrée quand on arrive ici.
      // Refuser de dépiler ne suffit donc pas : c'est accorder() qui la
      // repousse, sinon un retour bloqué décalerait tout pour la session.
      if (!bloqueParUnOverlay()) pile.pop()?.fermer();
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

/** Un ancêtre défile-t-il horizontalement ? Les puces de semaines du
    classement commencent au bord gauche : sans ce test, les faire défiler
    déclencherait un retour. */
function dansUnDefilement(cible: EventTarget | null): boolean {
  let el = cible instanceof Element ? cible : null;
  while (el) {
    if (el.scrollWidth > el.clientWidth + 4) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Le glissé depuis le bord gauche.
 *
 * Il ne s'installe que là où le système n'en propose pas déjà un :
 * l'iPhone en PWA installée, où Safari a retiré le sien avec sa barre
 * d'adresse. Dans un onglet Safari, le glissé natif fait le travail ; sur
 * Android, c'est le geste système. Les deux passent par popstate, donc le
 * retour marche partout — ici on évite seulement de le déclencher deux
 * fois.
 *
 * Reconnu au relâché, pas en cours de route : le doigt peut revenir sur
 * ses pas et le geste ne compte pas. Un retour déclenché à mi-parcours
 * est impossible à annuler, et c'est un écran qu'on perd.
 */
export function useGesteRetour(): void {
  useEffect(() => {
    const ios =
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!ios) return;

    let depart: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      depart = null;
      if (e.clientX > ZONE_BORD_PX) return;
      if (dansUnDefilement(e.target)) return;
      depart = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const d = depart;
      depart = null;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      // Franchement horizontal, sinon c'est un défilement de la page.
      if (dx < SEUIL_PX || Math.abs(dy) > Math.abs(dx)) return;
      if (!peutRevenir()) return;
      navigator.vibrate?.(10);
      history.back();
    };
    const onCancel = () => {
      depart = null;
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };
  }, []);
}
