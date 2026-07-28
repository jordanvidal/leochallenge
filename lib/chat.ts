// Couche tchat côté client : messages, réactions, état de lecture,
// préférence de notification.
//
// Toute requête de tchat passe par ce fichier, sans exception. Ce n'est
// pas seulement une convention de rangement : quand le multi-ligues
// arrivera, la bascule vers un `league_id` se fait ici et nulle part
// ailleurs (docs/spec-tchat.md §12). Un appel Supabase écrit en ligne
// dans un composant est une dette à retardement.
//
// Le fil raconte, le tchat discute. Le tchat ne compte aucun point.

import { dayLabel, parisDayOf } from "./feed";
import { supabase } from "./supabase";

export const CHAT_PAGE_SIZE = 50;

/** 500 et pas les 140 de feed_comments : ces 140-là cadrent une pique
    sous un moment. Un salon a besoin de la place d'un paragraphe. La
    base retoque au-delà (contrainte chat_body_500). */
export const CHAT_BODY_MAX = 500;

/** La même liste que le fil (lib/feed.ts). Deux vocabulaires d'emojis
    dans la même app seraient une incohérence gratuite. */
export const CHAT_EMOJIS = ["❤️", "🔥", "💪", "😂", "💀"] as const;

/** Au-delà, deux messages du même auteur ne forment plus une salve :
    le prénom réapparaît et l'espacement se desserre. */
const GROUPE_MS = 5 * 60 * 1000;

export type NotifyPref = "tous" | "mentions" | "aucune";

export type ChatMessage = {
  id: string;
  player_id: string;
  body: string;
  reply_to: string | null;
  feed_event_id: string | null;
  created_at: string;
  deleted_at: string | null;
};

export type ChatReaction = {
  message_id: string;
  player_id: string;
  emoji: string;
};

const CHAT_COLS = "id, player_id, body, reply_to, feed_event_id, created_at, deleted_at";

// ---- Erreurs ----

/** Traduit une erreur de la base en phrase humaine. Principe 5 de
    PRODUCT.md : dire la vérité, jamais un faux succès. */
export function humanChatError(message: string): string {
  if (message.includes("chat_body_500")) return `${CHAT_BODY_MAX} caractères max`;
  if (message.includes("chat_body_non_vide")) return "Message vide";
  if (message.includes("CHAT_FIGE")) return "Ce message ne se modifie plus";
  if (message.includes("duplicate")) return "Déjà envoyé";
  return "Message non envoyé, réessaie";
}

// ---- Logique pure (testée dans tests/tchat.test.ts) ----

/** Sans accents et en minuscules : « Léo » et « leo » doivent
    s'attraper l'un l'autre dans une mention. */
function plat(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Les joueurs mentionnés par `@prénom` dans un message.
 *
 * Sert au réglage « mentions » : c'est la seule chose qui traverse un
 * mute partiel, donc la détection doit être stricte des deux côtés.
 * Elle ne l'est pas sur les accents ni la casse (personne ne tape
 * « @Léo » avec l'accent à 23h), elle l'est sur les bords : « @leon »
 * ne mentionne pas Léo, et « mail@leo » non plus — un `@` collé à
 * une lettre n'ouvre pas une mention.
 */
export function mentionedPlayerIds(
  body: string,
  players: { id: string; name: string }[],
): string[] {
  const hay = plat(body);
  const found: string[] = [];
  for (const p of players) {
    const needle = `@${plat(p.name)}`;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      const avant = at === 0 ? "" : hay[at - 1];
      const apres = hay[at + needle.length] ?? "";
      // Le caractère d'avant ne doit pas être alphanumérique (sinon
      // c'est une adresse mail), celui d'après non plus (sinon c'est
      // un autre prénom qui commence pareil).
      if (!/[\p{L}\p{N}]/u.test(avant) && !/[\p{L}\p{N}]/u.test(apres)) {
        found.push(p.id);
        break;
      }
      from = at + 1;
    }
  }
  return found;
}

/** Une ligne de l'écran : un séparateur de jour, ou un message avec
    ce que le rendu doit savoir de sa place dans la salve. */
export type ChatRow =
  | { kind: "day"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      message: ChatMessage;
      /** Premier d'une salve : c'est lui qui porte le prénom. */
      showAuthor: boolean;
      /** Dernier d'une salve : c'est lui qui porte l'heure. */
      showTime: boolean;
    };

/**
 * Transforme une liste chronologique (du plus ancien au plus récent) en
 * lignes d'affichage : séparateurs de jour, et regroupement des salves.
 *
 * Deux messages se regroupent s'ils sont du même auteur, le même jour,
 * à moins de cinq minutes. Le prénom n'apparaît alors qu'une fois et
 * l'heure une seule aussi — répéter « Jordan · 22:14 » six fois de
 * suite pour six phrases écrites d'affilée, c'est du bruit qui rend la
 * conversation illisible.
 */
export function buildRows(messages: ChatMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let jour = "";
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const j = parisDayOf(m.created_at);
    if (j !== jour) {
      rows.push({ kind: "day", key: `day-${j}`, label: dayLabel(j) });
      jour = j;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    rows.push({
      kind: "message",
      key: m.id,
      message: m,
      showAuthor: !memeSalve(prev, m, j),
      showTime: !memeSalve(m, next, j),
    });
  }
  return rows;
}

/** `b` prolonge-t-il la salve de `a` ? Le jour de `b` est passé en
    paramètre : il vient d'être calculé, inutile de le refaire. */
function memeSalve(
  a: ChatMessage | undefined,
  b: ChatMessage | undefined,
  jourDeB: string,
): boolean {
  if (!a || !b) return false;
  if (a.player_id !== b.player_id) return false;
  if (parisDayOf(a.created_at) !== jourDeB) return false;
  const ecart =
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  return ecart >= 0 && ecart <= GROUPE_MS;
}

/** Le texte d'une réponse citée, coupé pour tenir sur une ligne. */
export function apercu(body: string, max = 60): string {
  const t = body.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

// ---- Lecture ----

/** Une page de messages, du plus récent au plus ancien (l'écran les
    remet à l'endroit). Offset simple : à six joueurs sur sept
    semaines, inutile de faire plus malin. */
export async function fetchChatPage(
  offset: number,
): Promise<{ messages: ChatMessage[]; hasMore: boolean } | null> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select(CHAT_COLS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + CHAT_PAGE_SIZE - 1);
  if (error) return null;
  const messages = data as ChatMessage[];
  return { messages, hasMore: messages.length === CHAT_PAGE_SIZE };
}

/** Les réactions des messages chargés, en un aller-retour. */
export async function fetchChatReactions(
  messageIds: string[],
): Promise<ChatReaction[] | null> {
  if (messageIds.length === 0) return [];
  const { data, error } = await supabase
    .from("chat_reactions")
    .select("message_id, player_id, emoji")
    .in("message_id", messageIds);
  return error ? null : (data as ChatReaction[]);
}

/** Un message précis : sert à récupérer le parent d'une réponse quand
    il est tombé hors de la page chargée. */
export async function fetchMessages(
  ids: string[],
): Promise<ChatMessage[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("chat_messages")
    .select(CHAT_COLS)
    .in("id", ids);
  return error ? null : (data as ChatMessage[]);
}

// ---- Écriture ----

/** Poste un message. Renvoie la ligne insérée, ou le message d'erreur. */
export async function insertMessage(
  playerId: string,
  body: string,
  opts: { replyTo?: string | null; feedEventId?: string | null } = {},
): Promise<{ message: ChatMessage } | { error: string }> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      player_id: playerId,
      body,
      reply_to: opts.replyTo ?? null,
      feed_event_id: opts.feedEventId ?? null,
    })
    .select(CHAT_COLS)
    .single();
  if (error) return { error: error.message };
  return { message: data as ChatMessage };
}

/** Suppression douce. La base vide le corps elle-même — on ne lui
    envoie que la date, et on ne lui fait pas confiance pour le reste. */
export async function deleteMessage(id: string): Promise<string | null> {
  const { error } = await supabase
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  return error ? error.message : null;
}

export async function insertChatReaction(
  messageId: string,
  playerId: string,
  emoji: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("chat_reactions")
    .insert({ message_id: messageId, player_id: playerId, emoji });
  return error ? error.message : null;
}

export async function deleteChatReaction(
  messageId: string,
  playerId: string,
  emoji: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("chat_reactions")
    .delete()
    .match({ message_id: messageId, player_id: playerId, emoji });
  return error ? error.message : null;
}

// ---- Lecture, présence, préférences ----

/** Le dernier instant lu par ce joueur. Absent = jamais ouvert. */
export async function fetchLastRead(playerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("chat_reads")
    .select("last_read_at")
    .eq("player_id", playerId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { last_read_at: string }).last_read_at;
}

/**
 * Combien de messages des autres depuis `since`. Comptage seul
 * (`head: true`) : c'est la requête que l'app tolère hors du tchat,
 * elle ne ramène aucune ligne.
 *
 * `since` nul (jamais ouvert) : on ne compte pas les 400 messages de
 * l'historique, on ne compte rien. Une pastille à « 9+ » au premier
 * lancement n'appelle pas, elle décourage.
 */
export async function countUnread(
  playerId: string,
  since: string | null,
): Promise<number> {
  if (!since) return 0;
  const { count, error } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .neq("player_id", playerId)
    .is("deleted_at", null)
    .gt("created_at", since);
  return error ? 0 : (count ?? 0);
}

/**
 * Marque comme lu jusqu'à `jusqu_a`, qui DOIT être le `created_at`
 * d'un message réel et non l'heure du téléphone : les deux se
 * comparent ensuite à des horodatages serveur, et une montre en
 * avance masquerait des messages jamais lus.
 */
export async function markRead(
  playerId: string,
  jusqu_a: string,
): Promise<void> {
  await supabase
    .from("chat_reads")
    .upsert(
      { player_id: playerId, last_read_at: jusqu_a, last_seen_at: new Date().toISOString() },
      { onConflict: "player_id" },
    );
}

/**
 * Battement de présence : « j'ai le tchat sous les yeux ». Le serveur
 * s'en sert pour ne pas notifier quelqu'un qui lit déjà.
 *
 * Horodaté par le client, donc sujet à sa montre. C'est assumé, et la
 * route de notification s'en protège en échouant du bon côté : une
 * montre trop décalée fait ENVOYER la notification plutôt que la
 * taire. Une notification de trop agace, un salon définitivement muet
 * est cassé.
 */
export async function beatPresence(playerId: string): Promise<void> {
  await supabase
    .from("chat_reads")
    .upsert(
      { player_id: playerId, last_seen_at: new Date().toISOString() },
      { onConflict: "player_id", ignoreDuplicates: false },
    );
}

export async function fetchNotifyPref(playerId: string): Promise<NotifyPref> {
  const { data, error } = await supabase
    .from("chat_prefs")
    .select("notify")
    .eq("player_id", playerId)
    .maybeSingle();
  if (error || !data) return "tous";
  return (data as { notify: NotifyPref }).notify;
}

export async function setNotifyPref(
  playerId: string,
  notify: NotifyPref,
): Promise<string | null> {
  const { error } = await supabase
    .from("chat_prefs")
    .upsert(
      { player_id: playerId, notify, updated_at: new Date().toISOString() },
      { onConflict: "player_id" },
    );
  return error ? error.message : null;
}

// ---- Notification ----

/** Signale au serveur qu'un message vient de partir. Tire et oublie :
    une notification est un bonus, pas un contrat (même politique que
    notifyFeedActivity dans lib/feed.ts). */
export function notifyChatMessage(messageId: string, actorId: string): void {
  fetch("/api/chat-notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-group-pass": process.env.NEXT_PUBLIC_GROUP_PASSWORD ?? "",
    },
    body: JSON.stringify({ messageId, actorId }),
  }).catch(() => {
    // silencieux, par construction
  });
}
