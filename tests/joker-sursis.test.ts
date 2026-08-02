// La série en sursis recopie les conditions de la CTE `joker` (migration
// 24) côté client. Une copie de règle ne vaut que si elle est tenue par des
// tests : chaque cas ci-dessous est une des trois conditions SQL, plus les
// deux états où l'on doit se taire faute de savoir.
//
// Le challenge de référence commence le 13/07/2026 (lib/challenge.ts).

import { describe, expect, it } from "vitest";
import { streakEnSursis } from "@/lib/score";
import { Entry, entryKey } from "@/lib/types";

const MOI = "hichem";

/** Une map d'entrées : jours parfaits, plus d'éventuels jours partiels. */
function entries(
  parfaits: string[],
  partiels: [day: string, pushups: boolean, abs: boolean, squats: boolean][] = [],
): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const day of parfaits) {
    m.set(entryKey(MOI, day), {
      player_id: MOI,
      day,
      pushups: true,
      abs: true,
      squats: true,
    });
  }
  for (const [day, pushups, abs, squats] of partiels) {
    m.set(entryKey(MOI, day), { player_id: MOI, day, pushups, abs, squats });
  }
  return m;
}

/** Les jours parfaits de `from` à `to` inclus, bornes ISO. */
function suite(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; ) {
    out.push(d);
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  return out;
}

describe("streakEnSursis", () => {
  it("annonce la série que le joker peut encore rattraper", () => {
    // Le cas réel du 28/07 : 14 jours parfaits, le 27 vierge, le joker
    // intact. Le serveur rend encore current_streak = 0 ce matin-là.
    const e = entries(suite("2026-07-13", "2026-07-26"));
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(14);
  });

  it("se tait une fois le joker brûlé", () => {
    // Un seul joker pour tout le challenge : il ne rattrape pas deux fois.
    const e = entries(suite("2026-07-13", "2026-07-26"));
    expect(streakEnSursis(MOI, e, "2026-07-20", "2026-07-28")).toBe(0);
  });

  it("se tait tant qu'on ne sait pas si le joker est intact", () => {
    // undefined = ligne absente du classement, ou colonne absente de la RPC.
    // Promettre un filet qu'on n'a pas vérifié serait pire que ne rien dire.
    const e = entries(suite("2026-07-13", "2026-07-26"));
    expect(streakEnSursis(MOI, e, undefined, "2026-07-28")).toBe(0);
  });

  it("ne se déclenche pas sous 3 jours parfaits", () => {
    // Même seuil que le ×1,5 : en dessous il n'y a rien à sauver et brûler
    // le joker serait du gâchis.
    const e = entries(suite("2026-07-25", "2026-07-26"));
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(0);
  });

  it("se déclenche pile à 3 jours parfaits", () => {
    const e = entries(suite("2026-07-24", "2026-07-26"));
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(3);
  });

  it("abandonne après deux jours ratés d'affilée", () => {
    // Le joker recolle deux morceaux, il ne rattrape pas quelqu'un qui a
    // arrêté. Trou les 26 et 27 : plus rien à sauver le 28.
    const e = entries(suite("2026-07-13", "2026-07-25"));
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(0);
  });

  it("ne dit rien quand la série est intacte", () => {
    // Hier parfait : il n'y a pas de trou, la ligne parle de série en jeu.
    const e = entries(suite("2026-07-13", "2026-07-27"));
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(0);
  });

  it("se tait dès que le 3/3 du jour est fait", () => {
    // Le joker est parti pour de bon : le serveur redit la vérité tout seul.
    const e = entries([...suite("2026-07-13", "2026-07-26"), "2026-07-28"]);
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(0);
  });

  it("traite une journée incomplète comme un trou", () => {
    // La CTE SQL teste `perfect`, pas la présence d'une ligne : 2/3 hier
    // casse la série exactement comme un jour vierge.
    const e = entries(suite("2026-07-13", "2026-07-26"), [
      ["2026-07-27", true, true, false],
    ]);
    expect(streakEnSursis(MOI, e, null, "2026-07-28")).toBe(14);
  });

  it("s'arrête au premier jour du challenge", () => {
    // La remontée est bornée : pas de boucle qui sorte du challenge.
    const e = entries(suite("2026-07-13", "2026-07-16"));
    expect(streakEnSursis(MOI, e, null, "2026-07-18")).toBe(4);
  });

  it("ne compte pas la série d'un autre joueur", () => {
    const e = entries(suite("2026-07-13", "2026-07-26"));
    expect(streakEnSursis("pierre", e, null, "2026-07-28")).toBe(0);
  });
});
