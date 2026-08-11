// La prévisualisation d'un lien Spotify : ce qu'il partage, en pochette
// et en titre.
//
// Par l'oEmbed public de Spotify (open.spotify.com/oembed), et pas par
// son API : l'oEmbed ne demande aucune clé, donc aucun secret à mettre
// chez Vercel, aucun jeton à renouveler, aucune route serveur à écrire.
// Il rend le titre et la pochette, ce qui suffit à dire « voilà ce qu'on
// écoute ». Il ne rend PAS l'artiste — c'est le prix de ne pas avoir de
// clé, et une carte sans artiste reste infiniment plus lisible qu'une
// URL de 80 caractères.
//
// Pas d'iframe non plus. Le lecteur officiel pèse une iframe tierce par
// lien dans une liste qui défile, avec ses scripts et ses cookies ; une
// conversation où traînent six morceaux devient six lecteurs chargés
// pour rien. La carte fait le travail : on voit ce que c'est, on tape,
// Spotify s'ouvre — et là on écoute vraiment, pas trente secondes.

import { trouverLiens } from "./liens";

/** Ce qu'un lien Spotify désigne. */
export type SpotifyKind =
  | "track"
  | "album"
  | "playlist"
  | "artist"
  | "episode"
  | "show";

export type SpotifyRef = { kind: SpotifyKind; id: string };

const KINDS = new Set<string>([
  "track",
  "album",
  "playlist",
  "artist",
  "episode",
  "show",
]);

/** Les identifiants Spotify sont des base62 de 22 caractères. On borne
    large plutôt que d'exiger 22 pile : le format leur appartient, pas à
    nous, et le jour où il change, une carte manquante vaut mieux qu'un
    lien refusé. */
const ID = /^[A-Za-z0-9]{16,40}$/;

/**
 * Ce qu'un lien partage, s'il vient de Spotify.
 *
 * Deux formes circulent, il faut les deux :
 *  · open.spotify.com/track/ID — le bouton « Partager » de l'app ;
 *  · open.spotify.com/intl-fr/track/ID — ce que rend le site en français.
 *
 * Le `?si=…` collé au bout est ignoré : c'est un jeton de suivi, il
 * n'identifie pas le morceau.
 */
export function spotifyRefOf(href: string): SpotifyRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hote = url.hostname.toLowerCase();
  if (hote !== "open.spotify.com" && hote !== "play.spotify.com") return null;

  const bouts = url.pathname.split("/").filter(Boolean);
  if (bouts[0]?.startsWith("intl-")) bouts.shift(); // le préfixe de langue
  const [kind, id] = bouts;
  if (!kind || !id) return null;
  if (!KINDS.has(kind) || !ID.test(id)) return null;
  return { kind: kind as SpotifyKind, id };
}

/** L'URL canonique d'une référence : celle qu'on ouvre, et la clé du
    cache. Reconstruite plutôt que reprise telle quelle, pour que deux
    partages du même morceau (avec et sans `?si=`) ne fassent qu'un seul
    aller-retour. */
export function spotifyUrl(ref: SpotifyRef): string {
  return `https://open.spotify.com/${ref.kind}/${ref.id}`;
}

/** Comment on nomme ce qu'on partage, sous le titre. Un mot, en
    français : la carte doit dire s'il s'agit d'un morceau ou d'une
    playlist de trois heures. */
export const SPOTIFY_LABELS: Record<SpotifyKind, string> = {
  track: "Morceau",
  album: "Album",
  playlist: "Playlist",
  artist: "Artiste",
  episode: "Épisode",
  show: "Podcast",
};

/**
 * Les liens Spotify d'un message, dédoublonnés, dans l'ordre.
 *
 * Dédoublonnés parce que le même morceau collé deux fois dans un message
 * ne mérite pas deux cartes ; sur l'URL canonique, donc « avec ?si= » et
 * « sans » comptent pour un.
 */
export function spotifyRefsOf(body: string): SpotifyRef[] {
  const vus = new Set<string>();
  const refs: SpotifyRef[] = [];
  for (const l of trouverLiens(body)) {
    const ref = spotifyRefOf(l.href);
    if (!ref) continue;
    const cle = spotifyUrl(ref);
    if (vus.has(cle)) continue;
    vus.add(cle);
    refs.push(ref);
  }
  return refs;
}

/** Ce que l'oEmbed nous rend d'utile. */
export type SpotifyApercu = { titre: string; pochette: string | null };

/**
 * Le cache, à l'échelle de l'onglet.
 *
 * Il tient des promesses et pas des résultats, et c'est le point : deux
 * bulles qui citent le même morceau montent en même temps au premier
 * rendu. Sans ça, elles partiraient chacune sur son aller-retour avant
 * que l'autre n'ait répondu. Une conversation qu'on remonte peut
 * traverser des dizaines de liens — autant qu'ils ne se paient qu'une
 * fois.
 *
 * Un échec, lui, SORT du cache une fois résolu. La cause la plus
 * probable est passagère — hors ligne dans le métro, Spotify qui tousse —
 * et graver « ce lien n'a pas d'aperçu » pour toute la session
 * condamnerait la carte jusqu'au rechargement de l'app. La bulle
 * réessaiera à son prochain montage, ce qui est exactement la bonne
 * fréquence : ni à chaque rendu, ni jamais.
 */
const cache = new Map<string, Promise<SpotifyApercu | null>>();

/**
 * Ce que Spotify raconte d'un lien.
 *
 * Aucune clé, aucune route serveur : l'oEmbed répond avec
 * `Access-Control-Allow-Origin: *`, donc le navigateur le lit
 * directement. Un échec rend `null` et la bulle garde son lien nu — une
 * carte est un confort, jamais un contrat (même politique que les
 * notifications dans lib/feed.ts).
 */
export function fetchApercuSpotify(
  ref: SpotifyRef,
): Promise<SpotifyApercu | null> {
  const url = spotifyUrl(ref);
  const dejaEnCours = cache.get(url);
  if (dejaEnCours) return dejaEnCours;

  const p = (async (): Promise<SpotifyApercu | null> => {
    const apercu = await demander(url);
    // Retiré seulement APRÈS résolution : le temps de l'aller-retour, la
    // promesse reste en cache et sert les autres bulles qui citent le
    // même morceau.
    if (!apercu) cache.delete(url);
    return apercu;
  })();

  cache.set(url, p);
  return p;
}

/** L'aller-retour lui-même. Rien n'est cru sur parole : l'oEmbed est du
    JSON venu d'ailleurs, on vérifie chaque champ avant de l'afficher. */
async function demander(url: string): Promise<SpotifyApercu | null> {
  try {
    const r = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
    );
    if (!r.ok) return null;
    const d = (await r.json()) as { title?: unknown; thumbnail_url?: unknown };
    const titre = typeof d.title === "string" ? d.title.trim() : "";
    if (!titre) return null;
    // La pochette est facultative : un titre seul fait déjà une carte
    // lisible, et l'imposer ferait retomber sur l'URL nue pour rien.
    const pochette =
      typeof d.thumbnail_url === "string" &&
      d.thumbnail_url.startsWith("https://")
        ? d.thumbnail_url
        : null;
    return { titre, pochette };
  } catch {
    return null;
  }
}
