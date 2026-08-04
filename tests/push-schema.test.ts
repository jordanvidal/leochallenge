// Le verrou du 04/08 : un push part TOUJOURS chercher les souscriptions dans
// le schéma des joueurs qu'on lui a donnés.
//
// Ce fichier sort de la règle « logique pure, pas de base » du reste de la
// suite, et c'est assumé : le bug qu'il verrouille ne vit nulle part ailleurs
// que dans le choix du client Supabase. `sendToPlayers` lisait
// `public.push_subscriptions` en dur ; les joueurs d'une ligue, eux, ont leurs
// souscriptions dans `app.push_subscriptions`. Le filtre `.in(player_id, …)`
// ne trouvait donc jamais rien pour une ligue, sans lever la moindre erreur —
// `sent: 0`, exactement comme une ligue où personne n'est abonné. Aucun test
// de logique pure ne pouvait voir ça : il fallait regarder quel client est
// construit. C'est tout ce que ce fichier fait.

import { createECDH } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** Les schémas vus par `createClient`, dans l'ordre des appels. */
const vus = vi.hoisted(() => [] as { schema: string; tables: string[] }[]);

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    _url: string,
    _key: string,
    options: { db?: { schema?: string } },
  ) => {
    const trace = { schema: options?.db?.schema ?? "public", tables: [] as string[] };
    vus.push(trace);
    return {
      from(table: string) {
        trace.tables.push(table);
        return {
          select: () => ({ in: async () => ({ data: [], error: null }) }),
          delete: () => ({ in: async () => ({ data: null, error: null }) }),
        };
      },
    };
  },
}));

/** Une vraie paire VAPID : `configureVapid` vérifie que la publique dérive
    bien de la privée, et refuse d'envoyer sinon. */
function paireVapid(): { pub: string; priv: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const b64url = (b: Buffer) =>
    b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { pub: b64url(ecdh.getPublicKey()), priv: b64url(ecdh.getPrivateKey()) };
}

beforeAll(() => {
  const { pub, priv } = paireVapid();
  // `pushAutorise()` ne laisse passer que la production : sans ça la fonction
  // sort avant même de construire un client, et le test ne verrait rien.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", pub);
  vi.stubEnv("VAPID_PRIVATE_KEY", priv);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://exemple.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "cle-de-test");
});

describe("sendToPlayers lit les souscriptions dans le bon schéma", () => {
  it("va chercher dans `app` pour les joueurs d'une ligue", async () => {
    const { sendToPlayers } = await import("@/lib/server/push");
    vus.length = 0;

    await sendToPlayers(["joueur-de-ligue"], { title: "t", body: "b" }, "app");

    expect(vus).toHaveLength(1);
    expect(vus[0].schema).toBe("app");
    expect(vus[0].tables).toContain("push_subscriptions");
  });

  it("va chercher dans `public` pour le challenge d'origine", async () => {
    const { sendToPlayers } = await import("@/lib/server/push");
    vus.length = 0;

    await sendToPlayers(["joueur-du-challenge"], { title: "t", body: "b" }, "public");

    expect(vus).toHaveLength(1);
    expect(vus[0].schema).toBe("public");
  });

  it("ne construit aucun client quand la liste est vide", async () => {
    const { sendToPlayers } = await import("@/lib/server/push");
    vus.length = 0;

    expect(await sendToPlayers([], { title: "t", body: "b" }, "app")).toBe(0);
    expect(vus).toHaveLength(0);
  });
});
