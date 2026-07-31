"use client";

// La photo dans la bulle, et la visionneuse plein écran qu'elle ouvre.
//
// Un choix de geste, et il en coûte un autre : sur un message photo, le
// tap simple OUVRE la photo. C'est l'attente universelle — WhatsApp,
// Messages, Signal font tous ça — et une photo qu'on ne peut pas
// regarder en grand n'est qu'une vignette.
//
// Le prix : le double-tap ❤️ ne s'applique pas aux messages photo. Les
// deux gestes ne peuvent pas coexister sur la même cible, puisqu'au
// premier tap on ne sait pas encore s'il y en aura un second — et
// attendre 400 ms avant d'ouvrir une photo se sent. Le cœur n'est pas
// perdu pour autant : il est sur un bouton dans la visionneuse, à
// l'endroit où l'on regarde justement la photo, et l'appui long sur la
// bulle ouvre toujours la feuille des cinq emojis.

import { useState } from "react";
import { useCoucheRetour } from "@/hooks/useRetour";
import { chatPhotoUrl } from "@/lib/chatPhotos";

/**
 * Le ratio d'affichage dans la bulle, borné.
 *
 * Une photo panoramique devient une fente illisible, une photo prise en
 * portrait par un iPhone (9:16) prendrait tout l'écran et pousserait la
 * conversation dehors. On borne donc la forme de la VIGNETTE, jamais
 * celle de la photo : la visionneuse, elle, montre le cadre entier.
 */
const RATIO_MIN = 0.62; // à peu près 5:8, un portrait franc
const RATIO_MAX = 1.9; // à peu près 16:9

function ratioAffiche(w: number, h: number): number {
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, w / h));
}

/**
 * La photo telle qu'elle apparaît dans la bulle.
 *
 * La place est réservée AVANT le chargement, à partir des dimensions
 * stockées en base : c'est ce qui fait qu'une conversation qui défile ne
 * saute pas quand les images arrivent. Le fond `surface` occupe la place
 * en attendant, et l'image se fond dedans à l'arrivée.
 */
export function ChatPhoto({
  path,
  w,
  h,
  onOpen,
}: {
  path: string;
  w: number;
  h: number;
  onOpen: () => void;
}) {
  const [charge, setCharge] = useState(false);
  return (
    <button
      onClick={onOpen}
      // Les événements de pointeur ne sont PAS arrêtés ici : ils doivent
      // remonter à la bulle, sinon glisser une photo ne répondrait pas et
      // l'appui long dessus n'ouvrirait aucune feuille. Le clic, lui, ne
      // part que sur un tap net — le navigateur ne l'émet pas après un
      // glissé — et la bulle le neutralise quand son appui long a pris
      // la main.
      aria-label="Voir la photo en grand"
      className="block w-full overflow-hidden rounded-xl bg-surface"
      style={{ aspectRatio: ratioAffiche(w, h) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={chatPhotoUrl(path)}
        alt="Photo envoyée dans le tchat"
        // `cover` sur la vignette : la borne de ratio a pu la rogner, et
        // une photo rognée vaut mieux qu'une photo entourée de bandes
        // noires dans une bulle.
        //
        // Le fondu à l'arrivée est la même idée que le Skeleton : la place
        // est déjà tenue, seul le contenu apparaît. `photo-in` porte la
        // durée et la courbe du système, et se coupe en mouvement réduit.
        className="photo-in h-full w-full object-cover"
        style={{ opacity: charge ? 1 : 0 }}
        onLoad={() => setCharge(true)}
        // Le navigateur décide seul quand décoder : sur une longue
        // conversation, ça évite de bloquer le défilement.
        decoding="async"
      />
    </button>
  );
}

/**
 * La photo en grand : fond noir, image entière, et le cœur à portée de
 * pouce.
 *
 * `object-contain` et pas `cover` : ici on montre ce qui a été cadré, sans
 * rien couper. C'est toute la raison d'être de cet écran.
 */
export function ChatPhotoViewer({
  path,
  aReagi,
  onCoeur,
  onClose,
}: {
  path: string;
  /** J'ai déjà posé le cœur : le bouton est allumé, et il retire. */
  aReagi: boolean;
  onCoeur: () => void;
  onClose: () => void;
}) {
  // Le retour arrière ferme la photo avant de toucher à l'écran — même
  // règle que les feuilles du tchat (ChatSheets).
  useCoucheRetour(onClose);

  return (
    <div
      // `bg` et pas un noir pur : c'est le fond de tous les écrans de
      // l'app, et le système n'a pas d'étage en dessous (DESIGN.md, The
      // Two-Floors Rule).
      className="fixed inset-0 z-50 flex flex-col bg-bg"
      role="dialog"
      aria-modal="true"
      aria-label="Photo en grand"
    >
      <div className="flex justify-end pt-safe">
        <button
          onClick={onClose}
          aria-label="Fermer la photo"
          className="m-2 flex size-11 items-center justify-center rounded-full bg-raised text-ink transition-transform active:scale-95"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Le tap dans le vide autour de la photo ferme aussi : c'est le
          geste qu'on essaie en premier quand on a fini de regarder. */}
      <button
        onClick={onClose}
        aria-label="Fermer la photo"
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={chatPhotoUrl(path)}
          alt="Photo envoyée dans le tchat"
          className="max-h-full max-w-full object-contain"
        />
      </button>

      <div className="flex justify-center pb-safe">
        {/* Le même vocabulaire que les emojis de la feuille d'actions et
            que le tapback : fond `raised` au repos, mixé à l'accent du
            joueur une fois posé, anneau intérieur pour l'état actif. Un
            bouton inventé ici serait une troisième façon de dire « j'ai
            réagi » dans le même écran. */}
        <button
          onClick={onCoeur}
          aria-pressed={aReagi}
          aria-label={aReagi ? "Retirer le cœur" : "Mettre un cœur"}
          className="m-3 flex size-14 items-center justify-center rounded-full text-2xl transition-transform active:scale-95"
          style={{
            background: aReagi
              ? "color-mix(in oklch, var(--pc) 22%, var(--color-raised))"
              : "var(--color-raised)",
            boxShadow: aReagi
              ? "inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 60%, transparent)"
              : undefined,
          }}
        >
          ❤️
        </button>
      </div>
    </div>
  );
}
