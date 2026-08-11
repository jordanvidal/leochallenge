// La détection des liens dans un message.
//
// Elle mérite ses tests pour la même raison que les mentions : elle a un
// effet de bord qui sort de l'écran. Un lien mal détecté est un lien
// mort ou une phrase illisible, mais surtout, c'est trouverLiens() qui
// dit à findMentions ce qu'il doit ignorer — donc une erreur ici envoie
// une notification à quelqu'un que le message ne nommait pas.

import { describe, expect, it } from "vitest";
import { trouverLiens } from "@/lib/liens";

/** Le texte de chaque lien trouvé, dans l'ordre. */
function textes(body: string): string[] {
  return trouverLiens(body).map((l) => body.slice(l.start, l.end));
}

describe("trouverLiens — ce qu'on reconnaît", () => {
  it("attrape une URL complète au milieu d'une phrase", () => {
    expect(textes("regarde https://open.spotify.com/track/abc c'est ça")).toEqual([
      "https://open.spotify.com/track/abc",
    ]);
  });

  it("attrape un « www. » nu et le rend ouvrable", () => {
    const [l] = trouverLiens("va sur www.lequipe.fr");
    expect(l.href).toBe("https://www.lequipe.fr");
  });

  it("attrape plusieurs liens dans le même message", () => {
    expect(textes("https://a.fr et http://b.fr")).toEqual([
      "https://a.fr",
      "http://b.fr",
    ]);
  });

  it("ne voit rien dans une phrase sans lien", () => {
    expect(trouverLiens("j'ai fait mes 100 pompes ce soir")).toEqual([]);
  });

  it("ne prend pas un domaine écrit au fil de la phrase", () => {
    // Volontaire : mieux vaut un lien manqué qu'une phrase où trois mots
    // deviennent cliquables.
    expect(trouverLiens("regarde sur lequipe.fr")).toEqual([]);
  });

  it("ne prend pas un schéma sans domaine derrière", () => {
    expect(trouverLiens("https:// bref")).toEqual([]);
  });
});

describe("trouverLiens — les bords du lien", () => {
  it("laisse dehors le point qui finit la phrase", () => {
    expect(textes("c'est ici https://leochallenge.app.")).toEqual([
      "https://leochallenge.app",
    ]);
  });

  it("laisse dehors une ponctuation multiple", () => {
    expect(textes("t'as vu https://a.fr/b !?")).toEqual(["https://a.fr/b"]);
  });

  it("laisse dehors la parenthèse qui refermait la phrase", () => {
    expect(textes("(voir https://a.fr/b)")).toEqual(["https://a.fr/b"]);
  });

  it("garde la parenthèse qui appartient à l'URL", () => {
    const url = "https://fr.wikipedia.org/wiki/Rocky_(film)";
    expect(textes(`comme ${url}`)).toEqual([url]);
  });

  it("garde les paramètres de partage", () => {
    const url = "https://open.spotify.com/track/abc?si=xyz&utm_source=copy";
    expect(textes(url)).toEqual([url]);
  });

  it("s'arrête au retour à la ligne", () => {
    expect(textes("https://a.fr\nsuite du message")).toEqual(["https://a.fr"]);
  });
});
