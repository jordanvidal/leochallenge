// Les liens dans un message : où ils commencent, où ils finissent, et
// vers quoi ils pointent.
//
// Un fichier à part de lib/chat.ts, et pas trois lignes de regex dedans,
// pour une raison : ce découpage-ci sert deux choses qui n'ont pas le
// même enjeu. Il rend le lien cliquable (confort), et il empêche
// findMentions de voir une mention dans « x.com/@leo » (une
// notification envoyée à quelqu'un qu'on ne nommait pas). La deuxième
// mérite ses propres tests, donc son propre fichier.

/** Un lien repéré dans un corps de message. */
export type LienSpan = {
  /** Index du premier caractère dans le corps d'origine. */
  start: number;
  /** Index de fin, exclu. */
  end: number;
  /** L'URL absolue à ouvrir — « www.x.fr » devient « https://www.x.fr ». */
  href: string;
};

/**
 * Ce qui ressemble à un lien : un schéma explicite, ou un « www. » nu.
 *
 * Volontairement étroit. On ne reconnaît PAS « spotify.fr » écrit au fil
 * d'une phrase : les fausses détections coûtent plus cher que les
 * manquées, parce qu'une phrase où trois mots deviennent des liens est
 * illisible, alors qu'un lien non détecté reste du texte qu'on peut
 * toujours copier. Tout le monde partage en collant l'URL entière, de
 * toute façon — c'est ce que donne le bouton « Partager » de Spotify,
 * d'Instagram et de YouTube.
 *
 * `[^\s<]` : on s'arrête au premier blanc. Le `<` est exclu par prudence,
 * il n'a rien à faire dans une URL collée et tout à faire dans du HTML.
 */
const LIEN = /(?:https?:\/\/|www\.)[^\s<]+/gi;

/** La ponctuation qui suit un lien plutôt qu'elle n'en fait partie. Un
    message finit par un point, et « …/track/abc. » doit ouvrir la piste
    et pas une page qui n'existe pas. */
const FIN_PONCTUATION = /[.,;:!?»"'’)\]}]+$/;

/**
 * Où sont les liens dans un message.
 *
 * Le rognage de la ponctuation finale garde les parenthèses appariées :
 * les URLs de Wikipédia en contiennent (« …_(film) »), et les couper là
 * casse le lien. On ne retire donc une parenthèse fermante que si rien ne
 * l'a ouverte dans le lien.
 */
export function trouverLiens(body: string): LienSpan[] {
  const spans: LienSpan[] = [];
  for (const m of body.matchAll(LIEN)) {
    const start = m.index;
    let brut = m[0];

    // On rogne caractère par caractère depuis la fin, pour pouvoir
    // s'arrêter sur une parenthèse qui appartient au lien.
    while (FIN_PONCTUATION.test(brut.slice(-1))) {
      const dernier = brut.slice(-1);
      const apparie =
        (dernier === ")" && compte(brut, "(") >= compte(brut, ")")) ||
        (dernier === "]" && compte(brut, "[") >= compte(brut, "]"));
      if (apparie) break;
      brut = brut.slice(0, -1);
    }

    // Un « https:// » tout seul, ou un « www. » sans domaine derrière :
    // ce n'est pas un lien, c'est un début de phrase avorté.
    if (!/[a-z0-9]/i.test(brut.replace(/^https?:\/\//i, ""))) continue;

    spans.push({
      start,
      end: start + brut.length,
      href: /^https?:\/\//i.test(brut) ? brut : `https://${brut}`,
    });
  }
  return spans;
}

function compte(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}
