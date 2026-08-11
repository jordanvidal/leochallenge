// La lecture d'un lien Spotify : ce qu'il désigne, et sous quelle forme
// on le redemande.
//
// L'enjeu n'est pas l'affichage — une carte qui manque n'est qu'un lien
// nu, et c'est déjà ce qu'on avait. L'enjeu est de ne pas prendre pour
// Spotify ce qui n'en est pas : la carte envoie une requête vers
// l'extérieur, et elle ne doit partir que sur un lien qui vient
// vraiment de chez eux.

import { describe, expect, it } from "vitest";
import { spotifyRefOf, spotifyRefsOf, spotifyUrl } from "@/lib/spotify";

const ID = "2HHtWyy5CgaQbC7XSoOb0e";

describe("spotifyRefOf — ce que le lien désigne", () => {
  it("lit un morceau partagé depuis l'app", () => {
    expect(spotifyRefOf(`https://open.spotify.com/track/${ID}`)).toEqual({
      kind: "track",
      id: ID,
    });
  });

  it("lit un lien avec préfixe de langue", () => {
    expect(spotifyRefOf(`https://open.spotify.com/intl-fr/track/${ID}`)).toEqual({
      kind: "track",
      id: ID,
    });
  });

  it("ignore le jeton de suivi du bouton Partager", () => {
    const ref = spotifyRefOf(`https://open.spotify.com/track/${ID}?si=abc123`);
    expect(spotifyUrl(ref!)).toBe(`https://open.spotify.com/track/${ID}`);
  });

  it("reconnaît les autres sortes de contenu", () => {
    for (const kind of ["album", "playlist", "artist", "episode", "show"]) {
      expect(spotifyRefOf(`https://open.spotify.com/${kind}/${ID}`)?.kind).toBe(
        kind,
      );
    }
  });

  it("refuse un autre domaine", () => {
    // Le test qui compte : c'est lui qui évite d'aller demander à Spotify
    // un aperçu de quelque chose qui ne lui appartient pas.
    expect(spotifyRefOf(`https://open.spotify.com.evil.fr/track/${ID}`)).toBeNull();
    expect(spotifyRefOf(`https://youtube.com/track/${ID}`)).toBeNull();
  });

  it("refuse une page Spotify qui n'est pas un contenu", () => {
    expect(spotifyRefOf("https://open.spotify.com/search/rocky")).toBeNull();
    expect(spotifyRefOf("https://open.spotify.com/")).toBeNull();
  });

  it("refuse un identifiant qui n'en est pas un", () => {
    expect(spotifyRefOf("https://open.spotify.com/track/court")).toBeNull();
    expect(spotifyRefOf(`https://open.spotify.com/track/${ID}/extra`)).toEqual({
      kind: "track",
      id: ID,
    });
  });

  it("ne casse pas sur une URL illisible", () => {
    expect(spotifyRefOf("pas une url")).toBeNull();
  });
});

describe("spotifyRefsOf — les liens d'un message", () => {
  it("trouve un lien au milieu d'une phrase", () => {
    const refs = spotifyRefsOf(`écoute ça https://open.spotify.com/track/${ID} !`);
    expect(refs).toEqual([{ kind: "track", id: ID }]);
  });

  it("ne compte qu'une fois le même morceau partagé deux fois", () => {
    const corps = `https://open.spotify.com/track/${ID} et https://open.spotify.com/track/${ID}?si=x`;
    expect(spotifyRefsOf(corps)).toHaveLength(1);
  });

  it("garde l'ordre du message", () => {
    const autre = "4m2880jivSbbyEGAKfITCa";
    const corps = `https://open.spotify.com/album/${autre} puis https://open.spotify.com/track/${ID}`;
    expect(spotifyRefsOf(corps).map((r) => r.kind)).toEqual(["album", "track"]);
  });

  it("ne rend rien sur un message sans lien Spotify", () => {
    expect(spotifyRefsOf("j'ai fait mes 100 pompes")).toEqual([]);
    expect(spotifyRefsOf("regarde https://lequipe.fr/foot")).toEqual([]);
  });
});
