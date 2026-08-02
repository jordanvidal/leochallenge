"use client";

// Le glissé vers le bas qui ferme une feuille montante. Sorti de la
// feuille de bonus (02/08) avec elle : c'est un geste, pas du bonus.

import { useEffect, useRef, useState } from "react";

// Le glissé vers le bas ferme la feuille. La poignée le promettait depuis
// le début sans que rien ne l'écoute : sur un téléphone, un trait gris en
// haut d'une feuille est une instruction, pas une décoration. Le geste
// échouait en silence, et il fallait viser « Fermer ».
const SEUIL_PX = 88; // un glissé franc suffit, on ne demande pas la moitié de l'écran
const FLICK_PX = 28; // ...et un coup sec part de plus haut
const FLICK_VITESSE = 0.45; // px/ms

/** Rend la feuille tirable vers le bas. La zone de prise est passée à
    l'appelant : plus bas, le doigt appartient à la liste qui défile. */
export function useGlisserPourFermer(onClose: () => void) {
  const [dy, setDy] = useState(0);
  const [tire, setTire] = useState(false);
  const feuille = useRef<HTMLDivElement>(null);
  const depart = useRef<{ y: number; t: number } | null>(null);
  const sortie = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sortie.current) clearTimeout(sortie.current);
    },
    [],
  );

  /** Sortie par le bas : la feuille finit son geste avant de disparaître.
      Fermer sèchement sous le doigt donne l'impression d'un bug. */
  function sortirParLeBas() {
    setTire(false);
    setDy(feuille.current?.offsetHeight ?? 600);
    sortie.current = setTimeout(onClose, 200);
  }

  const prise = {
    style: { touchAction: "none" as const },
    onTouchStart: (e: React.TouchEvent) => {
      depart.current = { y: e.touches[0].clientY, t: e.timeStamp };
      setTire(true);
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!depart.current) return;
      const d = e.touches[0].clientY - depart.current.y;
      setDy(d > 0 ? d : 0); // vers le haut, la feuille ne suit pas
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const d = depart.current;
      depart.current = null;
      setTire(false);
      if (!d) return;
      const vitesse = dy / Math.max(1, e.timeStamp - d.t);
      if (dy > SEUIL_PX || (dy > FLICK_PX && vitesse > FLICK_VITESSE)) {
        sortirParLeBas();
      } else {
        setDy(0); // pas assez : elle remonte se remettre en place
      }
    },
    onTouchCancel: () => {
      depart.current = null;
      setTire(false);
      setDy(0);
    },
  };

  return { dy, tire, feuille, prise };
}
