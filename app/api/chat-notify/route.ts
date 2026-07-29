// Push quand un message part dans le tchat.
//
// Contrairement à /api/feed-notify, il n'y a PAS de throttle : chaque
// message notifie (docs/spec-tchat.md §7). Un salon qui prévient un
// quart d'heure plus tard n'est pas un salon, c'est une boîte aux
// lettres, et il perd contre WhatsApp le premier jour.
//
// Cette décision n'est tenable que grâce à quatre gardes, et ce sont des
// conditions, pas des optimisations :
//
//  1. Le `tag` du service worker. Dix messages remplacent une seule
//     notification au lieu d'en empiler dix. Le tag est propre au tchat
//     pour qu'une vanne n'efface pas un rappel de série.
//  2. On ne prévient jamais qui a l'écran sous les yeux (last_seen_at).
//     Sans ça, six personnes qui discutent en direct reçoivent une
//     notification par message qu'elles voient déjà.
//  3. Le réglage par joueur : tous / mentions / aucune.
//  4. Le texte agrège : « 3 nouveaux messages · Jordan : … ».

import { NextResponse } from "next/server";
import { mentionedPlayerIds } from "@/lib/chat";
import { mondeAutorise, sendToPlayers, serverSupabase } from "@/lib/server/push";

export const dynamic = "force-dynamic";

/** Trois battements de présence (30 s chacun) : un de perdu ne réveille
    pas quelqu'un qui lit déjà. */
const PRESENT_MS = 90_000;

type Pref = "tous" | "mentions" | "aucune";

export async function POST(request: Request) {
  // Le secret envoyé dit de quel monde vient l'appel : mot de passe du groupe
  // pour le challenge d'origine, code de ligue pour une ligue.
  const monde = await mondeAutorise(request);
  if (!monde) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const { messageId, actorId } = (await request.json().catch(() => ({}))) as {
    messageId?: string;
    actorId?: string;
  };
  if (!messageId || !actorId) {
    return NextResponse.json(
      { error: "messageId et actorId requis" },
      { status: 400 },
    );
  }

  const supabase = serverSupabase(monde);

  const { data: msg, error: msgErr } = await supabase
    .from("chat_messages")
    .select("id, player_id, body, created_at, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }
  // Supprimé entre l'envoi et l'appel : on ne notifie pas un vide.
  if (!msg || (msg as { deleted_at: string | null }).deleted_at) {
    return NextResponse.json({ sent: 0 });
  }
  const message = msg as {
    player_id: string;
    body: string;
    created_at: string;
  };

  const [players, reads, prefs] = await Promise.all([
    supabase.from("players").select("id, name"),
    supabase.from("chat_reads").select("player_id, last_read_at, last_seen_at"),
    supabase.from("chat_prefs").select("player_id, notify"),
  ]);
  if (players.error || reads.error || prefs.error) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }

  const tous = players.data as { id: string; name: string }[];
  const auteur = tous.find((p) => p.id === actorId)?.name ?? "Quelqu'un";

  const lecture = new Map(
    (reads.data as { player_id: string; last_read_at: string; last_seen_at: string }[])
      .map((r) => [r.player_id, r]),
  );
  const reglage = new Map(
    (prefs.data as { player_id: string; notify: Pref }[]).map((p) => [
      p.player_id,
      p.notify,
    ]),
  );

  const mentionnes = new Set(mentionedPlayerIds(message.body, tous));
  const maintenant = Date.now();

  /**
   * Quelqu'un a-t-il le tchat sous les yeux ?
   *
   * `last_seen_at` est horodaté par le client, donc par sa montre. On se
   * protège d'une montre déréglée en bornant des DEUX côtés : trop
   * vieux, il n'est pas là ; trop dans le futur, sa montre ment et on
   * refuse de s'y fier. Dans les deux cas on échoue du bon côté, celui
   * qui ENVOIE la notification. Une notification de trop agace ; un
   * joueur définitivement muet parce que son téléphone avance de dix
   * minutes, c'est un salon cassé pour lui et personne ne le saura.
   */
  function present(id: string): boolean {
    const r = lecture.get(id);
    if (!r) return false;
    const vu = new Date(r.last_seen_at).getTime();
    if (Number.isNaN(vu)) return false;
    const ecart = maintenant - vu;
    return ecart >= -PRESENT_MS && ecart <= PRESENT_MS;
  }

  const destinataires = tous.filter((p) => {
    if (p.id === actorId) return false; // on ne se notifie pas soi-même
    if (present(p.id)) return false;
    const pref = reglage.get(p.id) ?? "tous";
    if (pref === "aucune") return false;
    if (pref === "mentions") return mentionnes.has(p.id);
    return true;
  });

  if (destinataires.length === 0) {
    return NextResponse.json({ sent: 0, destinataires: 0 });
  }

  // Le nombre de non-lus est propre à chacun, donc le texte aussi. À six
  // joueurs, un comptage par destinataire reste largement moins cher
  // qu'un aller-retour de plus vers la base.
  const extrait = message.body.replace(/\s+/g, " ").trim().slice(0, 90);

  const comptes = await Promise.all(
    destinataires.map(async (p) => {
      const depuis = lecture.get(p.id)?.last_read_at;
      if (!depuis) return { id: p.id, n: 1 };
      const { count } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .neq("player_id", p.id)
        .is("deleted_at", null)
        .gt("created_at", depuis);
      return { id: p.id, n: Math.max(1, count ?? 1) };
    }),
  );

  // Même nombre de non-lus = même texte : on regroupe pour n'envoyer
  // qu'une charge par groupe.
  const parCompte = new Map<number, string[]>();
  for (const { id, n } of comptes) {
    parCompte.set(n, [...(parCompte.get(n) ?? []), id]);
  }

  let envoyes = 0;
  for (const [n, ids] of parCompte) {
    const corps =
      n > 1
        ? `${n} nouveaux messages · ${auteur} : « ${extrait} »`
        : `${auteur} : « ${extrait} »`;
    envoyes += await sendToPlayers(ids, {
      title: "💬 Le tchat",
      body: corps,
      // Propre au tchat : ses notifications se remplacent entre elles et
      // n'effacent aucune autre famille.
      tag: "lc100-chat",
      url: "/?tab=chat",
    });
  }

  return NextResponse.json({ sent: envoyes, destinataires: destinataires.length });
}
