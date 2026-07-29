"use client";

// La hauteur que le clavier mange, publiée en CSS sous `--kb`.
//
// C'est le piège numéro un d'un tchat en PWA sur iPhone, et il ne se
// voit qu'en mode installé sur un vrai téléphone : à l'ouverture du
// clavier, iOS ne redimensionne PAS la fenêtre de mise en page. Un
// élément collé en bas (`position: sticky; bottom: 0`) se colle donc au
// bas d'une fenêtre dont le clavier recouvre le tiers inférieur, et la
// barre de saisie disparaît sous les touches. Au simulateur, tout va
// bien. En local dans Safari, tout va bien. Sur le téléphone, non.
//
// visualViewport, lui, décrit ce qui est RÉELLEMENT visible. L'écart
// entre les deux est exactement la hauteur du clavier.
//
// Le hook ne rend rien et ne provoque aucun re-rendu : il écrit une
// variable CSS. Un `useState` ici redessinerait tout le tchat à chaque
// image pendant l'animation d'ouverture du clavier, sur des téléphones
// qui n'en ont pas les moyens.

import { useEffect } from "react";

export function useKeyboardInset(actif: boolean): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!actif || !vv) return;

    const racine = document.documentElement;
    let frame = 0;

    const appliquer = () => {
      // offsetTop compte : quand iOS fait défiler la page sous un
      // clavier ouvert, la fenêtre visuelle glisse, et l'écart avec le
      // bas de la fenêtre de mise en page change sans que sa hauteur
      // bouge. Sans lui, la barre de saisie flotte pendant le scroll.
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      racine.style.setProperty("--kb", `${Math.round(inset)}px`);
    };

    // Les deux événements tirent en rafale pendant l'animation : on ne
    // garde qu'un calcul par image.
    const planifier = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        appliquer();
      });
    };

    appliquer();
    vv.addEventListener("resize", planifier);
    vv.addEventListener("scroll", planifier);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", planifier);
      vv.removeEventListener("scroll", planifier);
      // Quitter le tchat avec un clavier ouvert laisserait la valeur
      // gravée, et la barre d'onglets décalée sur tous les autres écrans.
      racine.style.setProperty("--kb", "0px");
    };
  }, [actif]);
}
