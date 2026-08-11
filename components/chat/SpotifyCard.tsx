"use client";

// La carte d'un lien Spotify, sous la bulle qui le contient.
//
// Sous et pas dedans : la bulle porte ce que quelqu'un a écrit, la carte
// porte ce que Spotify en dit. Les mélanger ferait passer un titre
// d'album pour une phrase de son auteur. C'est la même logique que la
// citation posée AU-DESSUS de la réponse dans ChatBubble — chaque chose
// à son étage.
//
// Elle n'apparaît que si Spotify répond. Tant qu'il n'a rien dit, il n'y
// a RIEN : pas de squelette, pas de cadre vide. Un lien Spotify n'est
// pas une photo dont on connaît d'avance les dimensions (ChatPhoto
// réserve sa place, lui) ; réserver une place ici, c'est parier sur une
// réponse qui peut ne jamais venir, et laisser un trou gris au milieu de
// la conversation quand elle ne vient pas. Le lien reste dans la bulle,
// cliquable : on ne perd jamais rien.

import { useEffect, useState } from "react";
import {
  fetchApercuSpotify,
  SPOTIFY_LABELS,
  SpotifyApercu,
  SpotifyRef,
  spotifyUrl,
} from "@/lib/spotify";

export default function SpotifyCard({
  refSpotify,
  /** L'appui long a ouvert la feuille : le tap qui suit ne doit pas
      ouvrir Spotify par-dessus. Même garde que la photo et le lien. */
  gesteConsomme,
}: {
  refSpotify: SpotifyRef;
  gesteConsomme: () => boolean;
}) {
  const [apercu, setApercu] = useState<SpotifyApercu | null>(null);

  useEffect(() => {
    let vivant = true;
    fetchApercuSpotify(refSpotify).then((a) => {
      if (vivant) setApercu(a);
    });
    return () => {
      vivant = false;
    };
    // La référence est reconstruite à chaque rendu du parent : c'est sur
    // ses deux champs qu'on se cale, pas sur l'identité de l'objet.
  }, [refSpotify.kind, refSpotify.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!apercu) return null;

  const url = spotifyUrl(refSpotify);
  const label = SPOTIFY_LABELS[refSpotify.kind];

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (gesteConsomme()) e.preventDefault();
      }}
      // L'appui long appartient à la bulle (les cinq emojis, « Répondre »),
      // pas au menu de partage d'iOS.
      style={{ WebkitTouchCallout: "none" }}
      aria-label={`${label} sur Spotify : ${apercu.titre}`}
      // Elle prend la largeur de la bulle au-dessus d'elle, et se colle à
      // son bas : les deux forment un bloc, comme la citation et la
      // réponse qu'elle précède.
      className="mt-1 flex w-full items-center gap-2.5 rounded-2xl bg-surface p-2 transition-transform active:scale-[0.98]"
    >
      {apercu.pochette ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={apercu.pochette}
          alt=""
          width={48}
          height={48}
          // La pochette d'un artiste est ronde chez Spotify, celle d'un
          // morceau carrée. On ne les distingue pas : une seule forme
          // dans la carte, sinon deux liens côte à côte n'ont plus l'air
          // de la même chose.
          className="size-12 shrink-0 rounded-lg object-cover"
          decoding="async"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-raised"
        >
          <Logo />
        </span>
      )}

      <span className="flex min-w-0 flex-col">
        {/* Deux lignes au plus : un nom de playlist peut être un roman,
            et la carte ne doit pas devenir plus haute que le message
            qu'elle accompagne. */}
        <span className="line-clamp-2 text-[13px] leading-tight font-bold text-ink">
          {apercu.titre}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
          <Logo taille={11} />
          {label} · Spotify
        </span>
      </span>
    </a>
  );
}

/** Le logo, dessiné plutôt que chargé : trois arcs valent moins cher
    qu'une requête, et il doit prendre la couleur du texte à côté de lui.
    Pas de vert de marque — la couleur, c'est les joueurs. */
function Logo({ taille = 18 }: { taille?: number }) {
  return (
    <svg
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M7.2 9.4c3.2-.9 6.6-.6 9.4 1M7.9 12.4c2.6-.7 5.4-.5 7.7.8M8.6 15.3c2.1-.5 4.3-.4 6.1.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
