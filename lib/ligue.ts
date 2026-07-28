// Le code d'invitation d'une ligue, du lien reçu à la saisie au clavier.
//
// Deux chemins mènent dans une ligue :
//   * on tape le lien qu'un pote a collé dans WhatsApp — c'est le cas normal ;
//   * on recopie le code à la main, depuis une capture d'écran ou de mémoire —
//     c'est le cas qui casse.
//
// Ce module ne parle pas à la base : il prépare, normalise et relit. La vérité
// des codes reste `app.leagues.invite_code` (migration36).

/**
 * L'alphabet des codes courts. **Copie exacte** de `app.code_court()` dans
 * `supabase/migration36-app-structure.sql` — si l'un des deux bouge, l'autre
 * doit bouger, sinon un code généré en base serait refusé à la saisie.
 *
 * Ni I, ni L, ni O, ni 0, ni 1 : ce sont les caractères qu'on lit de travers
 * sur une capture d'écran, dans une police sans empattement, à 23h.
 */
export const ALPHABET_CODE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Longueur d'un code, côté base comme côté saisie. */
export const LONGUEUR_CODE = 6;

/** Un slug plus long que ça ne rentre pas dans une URL lisible. Le nom de la
    ligue est déjà borné à 40 caractères par `leagues_name_check`. */
export const LONGUEUR_SLUG_MAX = 40;

/**
 * Les cinq caractères délibérément absents de l'alphabet.
 *
 * On ne peut PAS les replier sur autre chose : dans un alphabet Crockford, O
 * devient 0 et I devient 1 — ici les deux cibles sont absentes elles aussi.
 * Un code n'en contient donc jamais, et quelqu'un qui en tape un a mal lu son
 * écran. Le dire est plus utile que de deviner à sa place.
 */
const CONFONDABLES = new Set(["I", "L", "O", "0", "1"]);

/**
 * Espaces, tirets, points, barres et caractères invisibles : tout ce qu'un
 * humain ou un copier-coller insère entre les lettres sans y penser.
 *
 * Les invisibles passent par des échappements : un caractère de largeur nulle
 * collé en littéral dans le source est indistinguable d'une faute de frappe,
 * et personne ne le verrait en relecture. \u200B-\u200D sont les largeurs
 * nulles, \u2010-\u2015 et \u2212 la famille des tirets typographiques qu'un
 * traitement de texte substitue au trait d'union.
 */
const SEPARATEURS = /[\s._·•|/\\-]|[\u200B-\u200D\u2010-\u2015\u2212]/g;

/**
 * Met une saisie en forme sans rien interpréter : majuscules, séparateurs
 * retirés, formes typographiques ramenées à l'ASCII (NFKC gère les chiffres
 * pleine largeur d'un clavier japonais et les ligatures).
 *
 * Ne juge pas la validité — c'est le travail de `litCode`. Un caractère
 * interdit ressort tel quel, pour qu'on puisse le nommer.
 */
export function normaliseCode(saisie: string): string {
  return saisie.normalize("NFKC").toUpperCase().replace(SEPARATEURS, "");
}

/** Le code découpé pour l'œil : « K7M2QP » → « K7M-2QP ». `normaliseCode`
    sait relire cette forme, donc l'aller-retour est sûr. */
export function formateCode(code: string): string {
  const c = normaliseCode(code);
  const moitie = Math.ceil(c.length / 2);
  return c.length <= 2 ? c : `${c.slice(0, moitie)}-${c.slice(moitie)}`;
}

export type LectureCode =
  | { ok: true; code: string }
  | { ok: false; raison: "vide" | "caractere" | "longueur"; message: string };

/**
 * Relit une saisie et dit précisément ce qui cloche. Les messages sont ceux
 * que verra le joueur : ils nomment le caractère fautif plutôt que de rendre
 * un « code invalide » qui n'aide personne à 23h.
 *
 * L'ordre compte : on signale un caractère impossible AVANT une longueur
 * fausse. « Ton O est en trop » est actionnable ; « il manque un caractère »
 * envoie chercher au mauvais endroit.
 */
export function litCode(saisie: string): LectureCode {
  const code = normaliseCode(saisie);

  if (code === "") {
    return { ok: false, raison: "vide", message: "Entre le code de la ligue." };
  }

  for (const c of code) {
    if (ALPHABET_CODE.includes(c)) continue;
    if (CONFONDABLES.has(c)) {
      // Les cinq exclus ont droit à leur propre phrase : le joueur cherche un
      // caractère qui n'existe nulle part, autant lui dire lesquels regarder.
      return {
        ok: false,
        raison: "caractere",
        message:
          `Un code ne contient jamais « ${c} ». Ni I, ni L, ni O, ni 0, ni 1 — ` +
          "regarde à nouveau, c'est sûrement une autre lettre.",
      };
    }
    return {
      ok: false,
      raison: "caractere",
      message: `« ${c} » n'existe pas dans un code de ligue.`,
    };
  }

  if (code.length !== LONGUEUR_CODE) {
    return {
      ok: false,
      raison: "longueur",
      message: `Un code fait ${LONGUEUR_CODE} caractères, celui-ci en fait ${code.length}.`,
    };
  }

  return { ok: true, code };
}

/**
 * Les lettres qu'Unicode ne décompose PAS.
 *
 * On croit volontiers que `normalize("NFKD")` règle tout : c'est faux pour œ
 * et æ, qu'Unicode considère comme des lettres à part entière et non comme des
 * ligatures — contrairement à ﬁ, qui se décompose bien. Sans cette table,
 * « Cœur de Lion » sortait « c-ur-de-lion ».
 */
const LETTRES_ENTIERES: [RegExp, string][] = [
  [/œ/g, "oe"],
  [/æ/g, "ae"],
  [/ø/g, "o"],
  [/ß/g, "ss"],
  [/đ|ð/g, "d"],
  [/ł/g, "l"],
];

/**
 * Le nom d'une ligue transformé en morceau d'URL : « Les Bras Cassés » devient
 * « les-bras-casses ».
 *
 * Rend une chaîne vide si rien d'utilisable ne survit — un nom fait de trois
 * emojis est un nom valable, mais pas une URL. C'est à l'appelant de proposer
 * autre chose, pas à cette fonction d'inventer.
 *
 * L'unicité n'est PAS traitée ici : c'est la contrainte `unique` de
 * `app.leagues.slug` qui tranche, et la création qui suffixe en cas de collision.
 */
export function slugifie(nom: string): string {
  const sansLigature = LETTRES_ENTIERES.reduce(
    (txt, [motif, vers]) => txt.replace(motif, vers),
    nom.toLowerCase(),
  );
  return sansLigature
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LONGUEUR_SLUG_MAX)
    .replace(/-+$/g, ""); // la coupe a pu retomber sur un tiret
}

/** Construit le lien à coller dans la conversation. */
export function lienInvitation(origine: string, slug: string, code?: string): string {
  if (slug === "") {
    throw new Error("Lien d'invitation sans slug de ligue.");
  }
  const base = origine.replace(/\/+$/, "");
  const lu = code === undefined ? null : litCode(code);
  if (lu && !lu.ok) {
    throw new Error(`Lien d'invitation avec un code invalide : ${lu.message}`);
  }
  return `${base}/l/${slug}${lu ? `?c=${lu.code}` : ""}`;
}

export type LienInvitation = { slug: string; code: string | null };

// Le chemin, puis le code, cherchés séparément : le paramètre `c` n'est pas
// toujours le premier de la query, et certains partages ajoutent leur propre
// suivi derrière.
const MOTIF_CHEMIN = /\/l\/([a-z0-9][a-z0-9-]*)/i;
const MOTIF_CODE = /[?&]c=([^&#\s]+)/i;

/**
 * Retrouve une ligue dans un message collé. Doit survivre à ce que WhatsApp
 * fait subir à une URL : du texte autour, un point final accolé, un slash de
 * trop, une majuscule d'auto-correction.
 *
 * Rend `code: null` quand le lien n'en porte pas — le joueur le tapera. Rend
 * `null` tout court si aucun `/l/...` n'apparaît.
 */
export function litLienInvitation(texte: string): LienInvitation | null {
  const m = MOTIF_CHEMIN.exec(texte);
  if (!m) return null;

  // Le lien s'arrête au premier blanc : un « c= » appartenant à une autre URL
  // collée plus loin dans le même message ne doit pas être ramassé.
  const jeton = texte.slice(m.index).split(/\s/)[0];
  const slug = m[1].toLowerCase().replace(/-+$/, "");
  if (slug === "") return null;

  const brut = MOTIF_CODE.exec(jeton);
  if (!brut) return { slug, code: null };

  // La ponctuation qui emballe le lien n'appartient pas au code : Slack et les
  // clients mail encadrent volontiers une URL de chevrons, et une phrase la
  // termine par un point ou une parenthèse fermante.
  const nettoye = brut[1].replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");

  // Un code présent mais illisible vaut mieux ignoré que propagé tel quel :
  // l'écran demandera de le taper, au lieu de partir sur une valeur fausse.
  const lu = litCode(nettoye);
  return { slug, code: lu.ok ? lu.code : null };
}
