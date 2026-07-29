// Le code d'invitation, de sa lecture sur un écran à sa saisie au clavier.
//
// Ces tests visent le cas qui casse, pas le cas nominal : personne ne tape un
// code proprement. On le recopie d'une capture d'écran avec un espace au
// milieu, le clavier met une majuscule, WhatsApp colle un point derrière
// l'URL, et le tiret devient un tiret cadratin en passant par les Notes.

import { describe, expect, it } from "vitest";
import {
  ALPHABET_CODE,
  formateCode,
  lienInvitation,
  LONGUEUR_CODE,
  litCode,
  litLienInvitation,
  normaliseCode,
  slugifie,
} from "../lib/ligue";

describe("ALPHABET_CODE", () => {
  // Le garde-fou de la copie : cet alphabet DOIT rester celui de
  // `app.code_court()` (migration36). Si quelqu'un ajoute un caractère d'un
  // seul côté, un code généré en base deviendrait insaisissable.
  it("est exactement celui de app.code_court()", () => {
    expect(ALPHABET_CODE).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
    expect(ALPHABET_CODE).toHaveLength(31);
  });

  it("n'a ni I, ni L, ni O, ni 0, ni 1", () => {
    for (const c of ["I", "L", "O", "0", "1"]) {
      expect(ALPHABET_CODE).not.toContain(c);
    }
  });

  it("n'a aucun doublon", () => {
    expect(new Set(ALPHABET_CODE).size).toBe(ALPHABET_CODE.length);
  });
});

describe("normaliseCode", () => {
  it("encaisse ce qu'un humain insère entre les lettres", () => {
    expect(normaliseCode("k7m2qp")).toBe("K7M2QP");
    expect(normaliseCode("K7M 2QP")).toBe("K7M2QP");
    expect(normaliseCode("K7M-2QP")).toBe("K7M2QP");
    expect(normaliseCode("  K7M2QP  ")).toBe("K7M2QP");
    expect(normaliseCode("K.7.M.2.Q.P")).toBe("K7M2QP");
  });

  it("encaisse le tiret cadratin d'un traitement de texte", () => {
    // Les Notes d'iOS remplacent le trait d'union par un tiret demi-cadratin
    // dès qu'il est entouré d'espaces. Le joueur ne voit pas la différence.
    expect(normaliseCode("K7M– 2QP")).toBe("K7M2QP");
    expect(normaliseCode("K7M—2QP")).toBe("K7M2QP");
    expect(normaliseCode("K7M−2QP")).toBe("K7M2QP");
  });

  it("encaisse les caractères de largeur nulle d'un copier-coller", () => {
    expect(normaliseCode("K7M​2QP")).toBe("K7M2QP");
    expect(normaliseCode("﻿K7M2QP")).toBe("K7M2QP");
  });

  it("ramène les chiffres pleine largeur d'un clavier asiatique", () => {
    expect(normaliseCode("Ｋ７Ｍ２ＱＰ")).toBe("K7M2QP");
  });

  it("ne corrige RIEN d'autre : un caractère interdit ressort tel quel", () => {
    // C'est volontaire — `litCode` doit pouvoir le nommer.
    expect(normaliseCode("K7MO2Q")).toBe("K7MO2Q");
  });
});

describe("litCode", () => {
  it("accepte un code correct", () => {
    const r = litCode("k7m-2qp");
    expect(r).toEqual({ ok: true, code: "K7M2QP" });
  });

  it("réclame quelque chose quand la saisie est vide", () => {
    expect(litCode("")).toMatchObject({ ok: false, raison: "vide" });
    expect(litCode("   -  ")).toMatchObject({ ok: false, raison: "vide" });
  });

  it("nomme le caractère impossible plutôt que de dire « code invalide »", () => {
    const r = litCode("K7MO2Q");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("caractere");
    expect(r.message).toContain("« O »");
    expect(r.message).toContain("ni 0"); // on dit lesquels regarder
  });

  it("traite les cinq confondables d'un même message", () => {
    for (const c of ["I", "L", "O", "0", "1"]) {
      const r = litCode(`K7M${c}2Q`);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.message).toContain(`« ${c} »`);
    }
  });

  it("signale un caractère impossible AVANT une longueur fausse", () => {
    // « Ton O est en trop » est actionnable. « Il manque un caractère »
    // envoie chercher au mauvais endroit.
    const r = litCode("K7MO2QPZ");
    expect(r).toMatchObject({ raison: "caractere" });
  });

  it("compte les caractères quand ils sont tous légitimes", () => {
    const r = litCode("K7M2Q");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.raison).toBe("longueur");
    expect(r.message).toContain(`${LONGUEUR_CODE} caractères`);
    expect(r.message).toContain("en fait 5");
  });

  it("accepte tous les codes que la base peut produire", () => {
    // Six caractères pris dans l'alphabet, en balayant tout l'alphabet.
    for (let i = 0; i < ALPHABET_CODE.length; i++) {
      const code = Array.from({ length: LONGUEUR_CODE }, (_, k) =>
        ALPHABET_CODE[(i + k) % ALPHABET_CODE.length],
      ).join("");
      expect(litCode(code)).toEqual({ ok: true, code });
    }
  });
});

describe("formateCode", () => {
  it("coupe en deux pour la lecture", () => {
    expect(formateCode("K7M2QP")).toBe("K7M-2QP");
  });

  it("fait l'aller-retour avec normaliseCode", () => {
    // La forme affichée doit être re-saisissable telle quelle.
    expect(normaliseCode(formateCode("K7M2QP"))).toBe("K7M2QP");
  });
});

describe("slugifie", () => {
  it("transforme un nom de ligue en morceau d'URL", () => {
    expect(slugifie("Les Bras Cassés")).toBe("les-bras-casses");
    expect(slugifie("Ça déménage !!")).toBe("ca-demenage");
    expect(slugifie("Équipe #1")).toBe("equipe-1");
  });

  it("traite les lettres qu'Unicode ne décompose pas", () => {
    // Piège : `normalize("NFKD")` ne touche NI œ NI æ — Unicode les tient pour
    // des lettres à part entière. Sans table explicite, « Cœur de Lion »
    // sortait « c-ur-de-lion ».
    expect(slugifie("Cœur de Lion")).toBe("coeur-de-lion");
    expect(slugifie("Ex æquo")).toBe("ex-aequo");
    // ﬁ, elle, se décompose bien toute seule.
    expect(slugifie("Les ﬁnisseurs")).toBe("les-finisseurs");
  });

  it("ne laisse jamais de tiret aux extrémités", () => {
    expect(slugifie("  !! Les fous !!  ")).toBe("les-fous");
    expect(slugifie("--test--")).toBe("test");
  });

  it("ne coupe pas sur un tiret quand le nom est trop long", () => {
    const slug = slugifie("a".repeat(38) + " bcd");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("rend une chaîne vide quand rien d'utilisable ne survit", () => {
    // Un nom fait d'emojis est un nom valable, mais pas une URL. À l'appelant
    // de proposer autre chose — pas à cette fonction d'inventer.
    expect(slugifie("💪💪💪")).toBe("");
    expect(slugifie("   ")).toBe("");
  });
});

describe("lienInvitation", () => {
  it("construit le lien à coller", () => {
    expect(lienInvitation("https://leo.app", "les-bras-casses", "K7M2QP")).toBe(
      "https://leo.app/l/les-bras-casses?c=K7M2QP",
    );
  });

  it("normalise le code au passage", () => {
    expect(lienInvitation("https://leo.app", "abc", "k7m-2qp")).toBe(
      "https://leo.app/l/abc?c=K7M2QP",
    );
  });

  it("ne double pas le slash de l'origine", () => {
    expect(lienInvitation("https://leo.app/", "abc")).toBe("https://leo.app/l/abc");
  });

  it("refuse de fabriquer un lien cassé", () => {
    expect(() => lienInvitation("https://leo.app", "")).toThrow(/sans slug/);
    expect(() => lienInvitation("https://leo.app", "abc", "K7MO2Q")).toThrow(
      /code invalide/,
    );
  });
});

describe("litLienInvitation", () => {
  it("lit un lien propre", () => {
    expect(litLienInvitation("https://leo.app/l/les-bras-casses?c=K7M2QP")).toEqual({
      slug: "les-bras-casses",
      code: "K7M2QP",
    });
  });

  it("survit au message qui l'entoure", () => {
    const msg =
      "Salut ! Rejoins ma ligue : https://leo.app/l/les-fous?c=K7M2QP à demain 💪";
    expect(litLienInvitation(msg)).toEqual({ slug: "les-fous", code: "K7M2QP" });
  });

  it("survit à la ponctuation collée par WhatsApp", () => {
    expect(litLienInvitation("Voilà : https://leo.app/l/abc?c=K7M2QP.")).toEqual({
      slug: "abc",
      code: "K7M2QP",
    });
    expect(litLienInvitation("<https://leo.app/l/abc?c=K7M2QP>")).toEqual({
      slug: "abc",
      code: "K7M2QP",
    });
  });

  it("survit au slash de trop et aux majuscules d'auto-correction", () => {
    expect(litLienInvitation("https://leo.app/L/Abc/?c=k7m2qp")).toEqual({
      slug: "abc",
      code: "K7M2QP",
    });
  });

  it("trouve le code même s'il n'est pas le premier paramètre", () => {
    expect(litLienInvitation("https://leo.app/l/abc?utm=whatsapp&c=K7M2QP")).toEqual({
      slug: "abc",
      code: "K7M2QP",
    });
  });

  it("rend code: null quand le lien n'en porte pas", () => {
    expect(litLienInvitation("https://leo.app/l/abc")).toEqual({
      slug: "abc",
      code: null,
    });
  });

  it("ignore un code illisible plutôt que de le propager", () => {
    // L'écran demandera de le taper, au lieu d'interroger la base sur une
    // valeur qu'on sait fausse.
    expect(litLienInvitation("https://leo.app/l/abc?c=K7MO2Q")).toEqual({
      slug: "abc",
      code: null,
    });
  });

  it("ne ramasse pas le c= d'une autre URL du message", () => {
    const msg = "https://leo.app/l/abc et sinon https://autre.site/x?c=ZZZZZZ";
    expect(litLienInvitation(msg)).toEqual({ slug: "abc", code: null });
  });

  it("rend null quand il n'y a pas de lien de ligue", () => {
    expect(litLienInvitation("On se voit demain ?")).toBeNull();
    expect(litLienInvitation("https://leo.app/")).toBeNull();
  });

  it("fait l'aller-retour avec lienInvitation", () => {
    const lien = lienInvitation("https://leo.app", "les-bras-casses", "K7M2QP");
    expect(litLienInvitation(lien)).toEqual({
      slug: "les-bras-casses",
      code: "K7M2QP",
    });
  });
});
