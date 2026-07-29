"use client";

// Passer d'un onglet à l'autre au glissé horizontal.
//
// Les cinq onglets sont une rangée, pas un arbre : à droite du Feed il y a
// le Tchat, à gauche il y a Aujourd'hui, et c'est vrai depuis n'importe
// quel écran. Le glissé dit exactement ça, et il évite le trajet
// pouce-vers-le-bas-viser-l'onglet-remonter que la barre impose.
//
// Reconnu au relâché, pas en cours de route : la page ne suit pas le
// doigt. Un seul écran est monté à la fois — en faire suivre deux
// demanderait de tous les monter en même temps, ce qui coûterait à chaque
// ouverture de l'app pour un effet qu'on voit une demi-seconde.

import { useEffect, useRef } from "react";

/** Distance horizontale au-delà de laquelle le glissé change d'onglet. */
const SEUIL_PX = 70;

/** Le glissé doit être franchement horizontal. Sous ce rapport, on laisse
    la page défiler : voler un défilement vertical est bien pire que rater
    un changement d'onglet, qui se rattrape d'un tap. */
const RAPPORT = 1.4;

/**
 * Étouffe le clic que le glissé vient de produire.
 *
 * Un glissé qui traverse le fil passe sur « En parler », sur une réaction,
 * sur une carte. Sans ça, changer d'onglet ouvrirait une conversation au
 * passage. La fenêtre est courte et se referme d'elle-même : un clic
 * étouffé par erreur serait un tap sans réponse, le pire défaut possible.
 */
function avalerLeClic(): void {
  const avaler = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    fini();
  };
  const fini = () => {
    clearTimeout(minuteur);
    document.removeEventListener("click", avaler, true);
  };
  const minuteur = setTimeout(fini, 400);
  document.addEventListener("click", avaler, true);
}

/** Un ancêtre défile-t-il horizontalement, ou réclame-t-il le glissé pour
    lui ? Les puces de semaines du classement défilent ; les bulles du
    tchat répondent au glissé vers la droite. Dans les deux cas, le geste
    ne nous appartient pas. */
function dejaPris(cible: EventTarget | null): boolean {
  let el = cible instanceof Element ? cible : null;
  while (el) {
    if (el.getAttribute?.("data-geste") === "horizontal") return true;
    if (el.scrollWidth > el.clientWidth + 4) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

/**
 * Le glissé entre onglets.
 *
 * `onGlisser(1)` va vers l'onglet de droite, `onGlisser(-1)` vers celui de
 * gauche — le sens de lecture, pas celui du doigt.
 *
 * Lue par une ref : l'appelant peut recréer sa fonction à chaque rendu
 * sans qu'on rebranche quatre écouteurs sur le document à chaque fois.
 */
export function useGestePage(onGlisser: (sens: 1 | -1) => void): void {
  const ref = useRef(onGlisser);
  ref.current = onGlisser;

  useEffect(() => {
    let depart: { x: number; y: number; id: number } | null = null;
    let dernier: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      depart = null;
      dernier = null;
      // Deux doigts : c'est un pincement ou un geste système, pas nous.
      if (!e.isPrimary) return;
      // La barre d'onglets absente veut dire qu'on n'est pas sur l'app
      // à onglets : mode séance, tuto, porte, écran d'installation. Le
      // test se maintient tout seul, contrairement à une liste d'états.
      if (!document.querySelector('nav[aria-label="Navigation"]')) return;
      // Une feuille ou une modale ouverte : elle a ses propres gestes, et
      // changer d'onglet derrière elle ne se verrait même pas.
      if (document.querySelector('[aria-modal="true"]')) return;
      if (dejaPris(e.target)) return;
      depart = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dernier = { x: e.clientX, y: e.clientY };
    };

    const onMove = (e: PointerEvent) => {
      if (depart && e.pointerId === depart.id) {
        dernier = { x: e.clientX, y: e.clientY };
      }
    };

    /** Fin du geste, quelle qu'en soit la cause. Le pointeur coupé compte
        comme un relâché : sur iPhone, c'est ce qui arrive dès que le
        système croit reconnaître un de ses propres gestes. */
    const conclure = (e: PointerEvent) => {
      const d = depart;
      const f = dernier;
      if (!d || !f || e.pointerId !== d.id) return;
      depart = null;
      dernier = null;
      const dx = f.x - d.x;
      const dy = f.y - d.y;
      if (Math.abs(dx) < SEUIL_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * RAPPORT) return;
      navigator.vibrate?.(8);
      avalerLeClic();
      ref.current(dx < 0 ? 1 : -1);
    };

    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", conclure, { passive: true });
    document.addEventListener("pointercancel", conclure, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", conclure);
      document.removeEventListener("pointercancel", conclure);
    };
  }, []);
}
