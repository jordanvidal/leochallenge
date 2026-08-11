// La logique pure du tchat : le regroupement des salves et la détection
// des mentions.
//
// Ces deux-là méritent des tests pour des raisons opposées. Le
// regroupement est ce qui rend la conversation lisible : mal réglé, le
// prénom se répète six fois d'affilée ou disparaît là où il fallait le
// lire. La détection de mention, elle, est la SEULE chose qui traverse
// un mute partiel (docs/spec-tchat.md §7) — un faux positif réveille
// quelqu'un qui a demandé le silence, un faux négatif rate l'appel.

import { describe, expect, it } from "vitest";
import {
  apercu,
  apercuMessage,
  buildRows,
  ChatMessage,
  findMentions,
  insertMention,
  mentionedPlayerIds,
  mentionQuery,
  segmentsOf,
} from "@/lib/chat";

const JOUEURS = [
  { id: "leo", name: "Léo" },
  { id: "jordan", name: "Jordan" },
  { id: "leon", name: "Leon" },
];

/** Un message, daté en heure de Paris pour que le découpage par jour
    soit celui que verront les joueurs. */
function msg(
  id: string,
  playerId: string,
  iso: string,
  body = "yo",
): ChatMessage {
  return {
    id,
    player_id: playerId,
    body,
    reply_to: null,
    feed_event_id: null,
    created_at: iso,
    deleted_at: null,
    photo_path: null,
    photo_w: null,
    photo_h: null,
    audio_path: null,
    audio_ms: null,
  };
}

describe("buildRows — le regroupement des salves", () => {
  it("ouvre chaque jour par un séparateur", () => {
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T20:00:00Z"),
      msg("b", "leo", "2026-07-21T20:00:00Z"),
    ]);
    const jours = rows.filter((r) => r.kind === "day");
    expect(jours).toHaveLength(2);
    expect(rows[0].kind).toBe("day");
  });

  it("ne nomme l'auteur qu'une fois par salve", () => {
    // Trois messages du même joueur à une minute d'écart : une salve.
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T20:00:00Z"),
      msg("b", "leo", "2026-07-20T20:01:00Z"),
      msg("c", "leo", "2026-07-20T20:02:00Z"),
    ]);
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.map((m) => m.kind === "message" && m.showAuthor)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("ne met l'heure que sur le dernier de la salve", () => {
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T20:00:00Z"),
      msg("b", "leo", "2026-07-20T20:01:00Z"),
      msg("c", "leo", "2026-07-20T20:02:00Z"),
    ]);
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.map((m) => m.kind === "message" && m.showTime)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("casse la salve au-delà de cinq minutes", () => {
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T20:00:00Z"),
      msg("b", "leo", "2026-07-20T20:06:00Z"),
    ]);
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.every((m) => m.kind === "message" && m.showAuthor)).toBe(true);
    expect(messages.every((m) => m.kind === "message" && m.showTime)).toBe(true);
  });

  it("garde la salve à cinq minutes pile", () => {
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T20:00:00Z"),
      msg("b", "leo", "2026-07-20T20:05:00Z"),
    ]);
    const second = rows.filter((r) => r.kind === "message")[1];
    expect(second.kind === "message" && second.showAuthor).toBe(false);
  });

  it("casse la salve dès que l'auteur change", () => {
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T20:00:00Z"),
      msg("b", "jordan", "2026-07-20T20:00:30Z"),
    ]);
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.every((m) => m.kind === "message" && m.showAuthor)).toBe(true);
  });

  it("casse la salve au passage de minuit, même à une minute d'écart", () => {
    // 23:59 et 00:00 heure de Paris : deux jours civils, donc deux
    // salves — sinon le séparateur de jour couperait une salve en deux
    // et le second message se retrouverait sans prénom sous son titre.
    const rows = buildRows([
      msg("a", "leo", "2026-07-20T21:59:00Z"), // 23:59 Paris
      msg("b", "leo", "2026-07-20T22:00:00Z"), // 00:00 Paris le 21
    ]);
    const messages = rows.filter((r) => r.kind === "message");
    expect(messages.map((m) => m.kind === "message" && m.showAuthor)).toEqual([
      true,
      true,
    ]);
    expect(rows.filter((r) => r.kind === "day")).toHaveLength(2);
  });

  it("rend une liste vide sur zéro message", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("mentionedPlayerIds — ce qui traverse un mute", () => {
  it("attrape une mention simple", () => {
    expect(mentionedPlayerIds("@Jordan tu viens ?", JOUEURS)).toEqual(["jordan"]);
  });

  it("ignore la casse et les accents", () => {
    expect(mentionedPlayerIds("@leo t'es où", JOUEURS)).toEqual(["leo"]);
    expect(mentionedPlayerIds("@LÉO t'es où", JOUEURS)).toEqual(["leo"]);
  });

  it("ne confond pas deux prénoms qui commencent pareil", () => {
    // @leon ne doit PAS réveiller Léo : c'est exactement le faux positif
    // qui décrédibilise le réglage « mentions ».
    expect(mentionedPlayerIds("@Leon salut", JOUEURS)).toEqual(["leon"]);
  });

  it("ne prend pas une adresse mail pour une mention", () => {
    expect(mentionedPlayerIds("écris à jordan@leo.fr", JOUEURS)).toEqual([]);
  });

  it("attrape une mention en fin de message", () => {
    expect(mentionedPlayerIds("c'est parti @Jordan", JOUEURS)).toEqual(["jordan"]);
  });

  it("attrape une mention collée à la ponctuation", () => {
    expect(mentionedPlayerIds("@Jordan, tu viens ?", JOUEURS)).toEqual(["jordan"]);
  });

  it("ne compte un joueur qu'une fois même mentionné deux fois", () => {
    expect(mentionedPlayerIds("@Jordan et encore @Jordan", JOUEURS)).toEqual([
      "jordan",
    ]);
  });

  it("attrape plusieurs joueurs", () => {
    expect(mentionedPlayerIds("@Léo @Jordan on y va", JOUEURS).sort()).toEqual([
      "jordan",
      "leo",
    ]);
  });

  it("ne mentionne personne sans arobase", () => {
    expect(mentionedPlayerIds("Jordan a fini premier", JOUEURS)).toEqual([]);
  });

  it("ne prend pas un compte cité dans une URL pour une mention", () => {
    // Le faux positif qui coûte le plus cher : ce message ne nomme
    // personne du salon, et Léo n'a aucune raison d'être réveillé parce
    // qu'un lien contient son pseudo. Le `/` n'étant ni une lettre ni un
    // chiffre, la règle du « @ collé » ne l'écartait pas.
    expect(
      mentionedPlayerIds("regarde https://instagram.com/@leo", JOUEURS),
    ).toEqual([]);
  });

  it("attrape quand même la mention qui suit un lien", () => {
    expect(
      mentionedPlayerIds("https://instagram.com/@leo t'as vu @Jordan ?", JOUEURS),
    ).toEqual(["jordan"]);
  });
});

describe("findMentions — les positions, pas seulement le oui/non", () => {
  it("rend la position exacte de la mention", () => {
    const [m] = findMentions("salut @Jordan ça va", JOUEURS);
    expect(m.start).toBe(6);
    expect(m.end).toBe(13);
    expect(m.playerId).toBe("jordan");
  });

  it("ne décale pas les index à cause des accents", () => {
    // LE test de ce module. Un `normalize("NFD")` global transforme « é »
    // en deux unités : tous les index d'après glissent, et c'est la
    // lettre d'à côté qui se colore dans la bulle.
    const corps = "héhé @Jordan";
    const [m] = findMentions(corps, JOUEURS);
    expect(corps.slice(m.start, m.end)).toBe("@Jordan");
  });

  it("ne décale pas les index à cause d'un emoji", () => {
    const corps = "🔥🔥 @Jordan";
    const [m] = findMentions(corps, JOUEURS);
    expect(corps.slice(m.start, m.end)).toBe("@Jordan");
  });

  it("préfère le prénom le plus long quand deux commencent pareil", () => {
    const [m] = findMentions("@Leon salut", JOUEURS);
    expect(m.playerId).toBe("leon");
    expect(m.end).toBe(5);
  });

  it("trouve deux mentions collées", () => {
    const spans = findMentions("@Léo @Jordan", JOUEURS);
    expect(spans.map((s) => s.playerId)).toEqual(["leo", "jordan"]);
  });
});

describe("segmentsOf — le découpage pour la bulle", () => {
  it("rend le message entier quand il n'y a pas de mention", () => {
    expect(segmentsOf("rien à signaler", JOUEURS)).toEqual([
      { texte: "rien à signaler" },
    ]);
  });

  it("sépare texte et mention", () => {
    expect(segmentsOf("salut @Jordan !", JOUEURS)).toEqual([
      { texte: "salut " },
      { texte: "@Jordan", playerId: "jordan" },
      { texte: " !" },
    ]);
  });

  it("recolle exactement le message d'origine", () => {
    // Garantie de non-perte : quoi qu'il arrive au découpage, l'utilisateur
    // doit lire ce qu'il a écrit, au caractère près.
    const corps = "héhé @Léo et @Jordan 🔥 ok";
    expect(segmentsOf(corps, JOUEURS).map((s) => s.texte).join("")).toBe(corps);
  });

  it("gère une mention en tout début de message", () => {
    expect(segmentsOf("@Jordan", JOUEURS)).toEqual([
      { texte: "@Jordan", playerId: "jordan" },
    ]);
  });

  it("sépare texte et lien", () => {
    expect(segmentsOf("écoute ça https://a.fr/b", JOUEURS)).toEqual([
      { texte: "écoute ça " },
      { texte: "https://a.fr/b", href: "https://a.fr/b" },
    ]);
  });

  it("range mentions et liens dans l'ordre du message", () => {
    expect(segmentsOf("@Jordan https://a.fr ok", JOUEURS)).toEqual([
      { texte: "@Jordan", playerId: "jordan" },
      { texte: " " },
      { texte: "https://a.fr", href: "https://a.fr" },
      { texte: " ok" },
    ]);
  });

  it("laisse le lien en un seul morceau, sans mention dedans", () => {
    // Le pendant visible du test de mentionedPlayerIds : ce qui n'a
    // prévenu personne ne doit pas non plus se colorer dans la bulle.
    expect(segmentsOf("https://instagram.com/@leo", JOUEURS)).toEqual([
      { texte: "https://instagram.com/@leo", href: "https://instagram.com/@leo" },
    ]);
  });

  it("recolle exactement un message qui mêle mention et lien", () => {
    const corps = "@Léo regarde (https://a.fr/x_(y)) et dis-moi. @Jordan aussi";
    expect(segmentsOf(corps, JOUEURS).map((s) => s.texte).join("")).toBe(corps);
  });
});

describe("mentionQuery — ce qu'on est en train de taper", () => {
  it("rend le terme partiel après l'arobase", () => {
    expect(mentionQuery("salut @jo", 9)).toEqual({ start: 6, terme: "jo" });
  });

  it("rend un terme vide juste après l'arobase", () => {
    expect(mentionQuery("salut @", 7)).toEqual({ start: 6, terme: "" });
  });

  it("se ferme dès qu'un espace sépare le curseur de l'arobase", () => {
    // Sans cette borne, la liste des potes resterait ouverte tout le message.
    expect(mentionQuery("salut @jo rd", 12)).toBeNull();
  });

  it("ignore une arobase d'adresse mail", () => {
    expect(mentionQuery("jordan@leo", 10)).toBeNull();
  });

  it("ne regarde que ce qui est à gauche du curseur", () => {
    expect(mentionQuery("salut @jordan ok", 5)).toBeNull();
  });
});

describe("insertMention — l'insertion au curseur", () => {
  it("remplace le terme partiel et ajoute l'espace", () => {
    expect(insertMention("salut @jo", 9, "Jordan")).toEqual({
      body: "salut @Jordan ",
      caret: 14,
    });
  });

  it("insère au milieu sans toucher à la fin", () => {
    const out = insertMention("salut @jo ça va", 9, "Jordan");
    expect(out.body).toBe("salut @Jordan  ça va");
    // Le curseur se pose après l'espace inséré, pas à la fin du message.
    expect(out.caret).toBe(14);
  });

  it("ne fait rien s'il n'y a pas de mention en cours", () => {
    expect(insertMention("salut", 5, "Jordan")).toEqual({
      body: "salut",
      caret: 5,
    });
  });
});

describe("apercu — la citation d'une réponse", () => {
  it("laisse un texte court intact", () => {
    expect(apercu("court")).toBe("court");
  });

  it("coupe et signale la coupe", () => {
    const long = "a".repeat(100);
    const out = apercu(long, 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("enlève les blancs de bord", () => {
    expect(apercu("  yo  ")).toBe("yo");
  });
});

describe("apercuMessage — comment un message se raconte ailleurs", () => {
  // Trois endroits lisent cette fonction : la bulle citée, la barre de
  // saisie et la notification push. C'est ce qui garantit qu'un push ne
  // promet jamais autre chose que ce qu'on trouve en ouvrant l'app.

  it("rend le texte quand il n'y a pas de photo", () => {
    expect(apercuMessage({ body: "salut", photo_path: null })).toBe("salut");
  });

  it("annonce une photo sans légende", () => {
    // Sans ça, une photo nue se citerait par une chaîne vide : la bulle
    // de réponse serait muette et la notification dirait « Jordan : «  » ».
    expect(apercuMessage({ body: "", photo_path: "leo/a.jpg" })).toBe(
      "📷 Photo",
    );
  });

  it("garde la légende, précédée de l'emoji", () => {
    expect(apercuMessage({ body: "vue du 6e", photo_path: "leo/a.jpg" })).toBe(
      "📷 vue du 6e",
    );
  });

  it("coupe la légende sans dépasser la borne demandée", () => {
    const out = apercuMessage({ body: "a".repeat(80), photo_path: "x.jpg" }, 20);
    // L'emoji et son espace comptent dans la longueur : c'est la place
    // réservée dans la notification qui décide, pas le texte seul.
    expect([...out].length).toBeLessThanOrEqual(20);
    expect(out.startsWith("📷 ")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("annonce une note vocale, qui n'a par nature rien à citer", () => {
    // Le cas le plus important des trois : une photo citée montre au
    // moins une vignette quelque part, un vocal ne montre rien du tout.
    expect(apercuMessage({ body: "", audio_path: "leo/a.m4a" })).toBe(
      "🎤 Note vocale",
    );
  });

  it("laisse parler la légende d'un vocal quand il y en a une", () => {
    expect(apercuMessage({ body: "écoute ça", audio_path: "leo/a.m4a" })).toBe(
      "🎤 écoute ça",
    );
  });

  it("dit la suppression avant tout le reste", () => {
    // Un message supprimé garde ses colonnes vidées par le trigger, mais
    // on ne s'y fie pas : c'est deleted_at qui tranche.
    expect(
      apercuMessage({
        body: "vieux texte",
        photo_path: "leo/a.jpg",
        deleted_at: "2026-07-31T10:00:00Z",
      }),
    ).toBe("Message supprimé");
  });
});
