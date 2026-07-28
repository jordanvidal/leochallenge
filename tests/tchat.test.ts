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
import { apercu, buildRows, ChatMessage, mentionedPlayerIds } from "@/lib/chat";

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
