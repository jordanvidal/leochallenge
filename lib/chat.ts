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

import { dayLabel, FeedEvent, parisDayOf } from "./feed";
import { supabase } from "./supabase";
import { leGroupPass } from "./ligue";

export const CHAT_PAGE_SIZE = 50;

/** 500 et pas les 140 de feed_comments : ces 140-là cadrent une pique
    sous un moment. Un salon a besoin de la place d'un paragraphe. La
    base retoque au-delà (contrainte chat_body_500). */
export const CHAT_BODY_MAX = 500;

/** Le cœur du double-tap. Nommé plutôt que recopié : « ❤️ » s'écrit avec
    un sélecteur de variante invisible, et une deuxième copie tapée à la
    main donnerait une chaîne différente — donc une deuxième réaction en
    base, à côté de celle de la feuille, sur le même message. */
export const COEUR = "❤️";

/** La même liste que le fil (lib/feed.ts). Deux vocabulaires d'emojis
    dans la même app seraient une incohérence gratuite. */
export const CHAT_EMOJIS = [COEUR, "🔥", "💪", "😂", "💀"] as const;

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
  /** Le chemin de la photo dans le bucket, ou null. Un message photo a
      son corps facultatif : la légende n'est pas obligatoire. */
  photo_path: string | null;
  /** Les dimensions FINALES de la photo. Elles servent à réserver la
      place dans la bulle avant que l'image n'arrive — sans elles, la
      conversation saute sous le pouce de qui est en train de lire. */
  photo_w: number | null;
  photo_h: number | null;
};

export type ChatReaction = {
  message_id: string;
  player_id: string;
  emoji: string;
};

const CHAT_COLS =
  "id, player_id, body, reply_to, feed_event_id, created_at, deleted_at, photo_path, photo_w, photo_h";

// ---- Erreurs ----

/** Traduit une erreur de la base en phrase humaine. Principe 5 de
    PRODUCT.md : dire la vérité, jamais un faux succès. */
export function humanChatError(message: string): string {
  if (message.includes("chat_body_500")) return `${CHAT_BODY_MAX} caractères max`;
  if (message.includes("chat_body_non_vide")) return "Message vide";
  if (message.includes("CHAT_FIGE")) return "Ce message ne se modifie plus";
  if (message.includes("duplicate")) return "Déjà envoyé";
  // Le bucket refuse au-delà de 3 Mo et hors JPEG (migration44). Les deux
  // ne devraient jamais arriver — le canvas produit du JPEG réduit — mais
  // « Photo non envoyée » vaut mieux que le charabia de Storage.
  if (message.includes("exceeded the maximum allowed size"))
    return "Photo trop lourde";
  if (message.includes("mime type")) return "Format de photo refusé";
  return "Message non envoyé, réessaie";
}

// ---- Logique pure (testée dans tests/tchat.test.ts) ----

const ALPHANUM = /[\p{L}\p{N}]/u;

/**
 * Sans accents et en minuscules : « Léo » et « leo » doivent s'attraper
 * l'un l'autre dans une mention.
 *
 * Le repliement est fait caractère par caractère, et pas par un
 * `normalize("NFD")` sur toute la chaîne, pour UNE raison : il doit
 * conserver la longueur. Une décomposition globale transforme « é » en
 * deux unités, donc tous les index d'après glissent — et depuis le
 * 28/07 ces index servent à surligner la mention dans la bulle, pas
 * seulement à répondre oui ou non. Un décalage d'une unité, et c'est la
 * lettre d'à côté qui se colore.
 *
 * Deux garde-fous : on ne remplace un caractère que si sa décomposition
 * commence bien par une lettre (sinon un emoji, qui tient sur deux
 * unités UTF-16, se ferait couper en deux), et on annule le
 * remplacement s'il change la longueur (cas rares comme « İ »).
 */
function plat(s: string): string {
  let out = "";
  for (const ch of s) {
    const d = ch.normalize("NFD");
    const base = d.length > 1 && /\p{L}/u.test(d[0]) ? d[0] : ch;
    const rep = base.toLowerCase();
    out += rep.length === ch.length ? rep : ch;
  }
  return out;
}

export type MentionSpan = {
  /** Index du « @ » dans le corps d'origine. */
  start: number;
  /** Index de fin, exclu. */
  end: number;
  playerId: string;
};

/**
 * Où sont les mentions dans un message, et qui elles désignent.
 *
 * Source unique de vérité : la notification (qui traverse un mute) et le
 * surlignage dans la bulle lisent la MÊME fonction. Deux implémentations
 * auraient fini par diverger, et le jour où elles divergent, l'app
 * colore un prénom sans prévenir la personne — ou l'inverse.
 *
 * Les bords sont stricts : « @leon » ne mentionne pas Léo, et
 * « mail@leo » ne mentionne personne (un `@` collé à une lettre n'ouvre
 * pas une mention). Les prénoms sont essayés du plus long au plus court,
 * pour que « @Leon » désigne Leon même quand Léo existe aussi.
 */
export function findMentions(
  body: string,
  players: { id: string; name: string }[],
): MentionSpan[] {
  const parLongueur = [...players].sort((a, b) => b.name.length - a.name.length);
  const spans: MentionSpan[] = [];
  const bas = plat(body);

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "@") continue;
    // Un « @ » précédé d'une lettre ou d'un chiffre est une adresse.
    if (i > 0 && ALPHANUM.test(body[i - 1])) continue;
    for (const p of parLongueur) {
      const nom = plat(p.name);
      const fin = i + 1 + nom.length;
      if (bas.slice(i + 1, fin) !== nom) continue;
      // Ce qui suit ne doit pas être une lettre : sinon c'est un autre
      // prénom qui commence pareil.
      if (fin < body.length && ALPHANUM.test(body[fin])) continue;
      spans.push({ start: i, end: fin, playerId: p.id });
      i = fin - 1; // on reprend après la mention
      break;
    }
  }
  return spans;
}

/** Les joueurs mentionnés, sans doublon. C'est ce que lit la route de
    notification pour le réglage « mentions ». */
export function mentionedPlayerIds(
  body: string,
  players: { id: string; name: string }[],
): string[] {
  return [...new Set(findMentions(body, players).map((m) => m.playerId))];
}

/** Un morceau de message à rendre : du texte, ou une mention à colorer. */
export type Segment = { texte: string; playerId?: string };

/** Découpe un message en texte et mentions, pour le rendu de la bulle. */
export function segmentsOf(
  body: string,
  players: { id: string; name: string }[],
): Segment[] {
  const spans = findMentions(body, players);
  if (spans.length === 0) return [{ texte: body }];
  const out: Segment[] = [];
  let curseur = 0;
  for (const s of spans) {
    if (s.start > curseur) out.push({ texte: body.slice(curseur, s.start) });
    out.push({ texte: body.slice(s.start, s.end), playerId: s.playerId });
    curseur = s.end;
  }
  if (curseur < body.length) out.push({ texte: body.slice(curseur) });
  return out;
}

/**
 * La mention en cours de frappe, s'il y en a une : le « @ » ouvert le
 * plus proche à gauche du curseur, et ce qui a été tapé depuis.
 *
 * Rend null dès qu'un espace ou un retour à la ligne sépare le curseur
 * du « @ » : passé le premier mot, on écrit une phrase, pas un prénom.
 * Sans cette borne, la liste des potes resterait ouverte tout le message.
 */
export function mentionQuery(
  body: string,
  caret: number,
): { start: number; terme: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const c = body[i];
    if (c === "@") {
      if (i > 0 && ALPHANUM.test(body[i - 1])) return null;
      return { start: i, terme: body.slice(i + 1, caret) };
    }
    if (/\s/.test(c)) return null;
  }
  return null;
}

/** Remplace la mention en cours de frappe par le prénom choisi, et rend
    la position où poser le curseur (après l'espace qui suit). */
export function insertMention(
  body: string,
  caret: number,
  name: string,
): { body: string; caret: number } {
  const q = mentionQuery(body, caret);
  if (!q) return { body, caret };
  const avant = body.slice(0, q.start);
  const apres = body.slice(caret);
  // L'espace évite que le mot suivant se colle au prénom et casse la
  // mention qu'on vient tout juste d'insérer.
  const insere = `@${name} `;
  return { body: avant + insere + apres, caret: avant.length + insere.length };
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

/** Le prénom commence-t-il par ce qui vient d'être tapé ? Insensible à
    la casse et aux accents, comme la détection. */
export function nameStartsWith(name: string, terme: string): boolean {
  return plat(name).startsWith(plat(terme));
}

/** Le texte d'une réponse citée, coupé pour tenir sur une ligne. */
export function apercu(body: string, max = 60): string {
  const t = body.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * Comment un message se raconte quand il est cité ailleurs : dans une
 * bulle de réponse, dans la barre de saisie, dans une notification.
 *
 * Une photo sans légende n'a rien à donner à lire — d'où l'emoji, qui dit
 * ce qu'il y a à voir plutôt que de laisser un blanc. Avec légende, c'est
 * la légende qui parle, précédée du même emoji : on doit savoir qu'on
 * répond à une photo sans avoir à remonter la conversation.
 *
 * Une seule fonction pour les trois endroits, comme findMentions : le
 * jour où deux d'entre eux divergent, l'app annonce dans la notification
 * autre chose que ce qu'elle affiche à l'écran.
 */
export function apercuMessage(
  m: { body: string; photo_path?: string | null; deleted_at?: string | null },
  max = 60,
): string {
  if (m.deleted_at) return "Message supprimé";
  const texte = m.body.trim();
  if (!m.photo_path) return apercu(texte, max);
  return texte ? `📷 ${apercu(texte, max - 2)}` : "📷 Photo";
}

// ---- Lecture ----

/** Une page de messages, du plus récent au plus ancien (l'écran les
    remet à l'endroit). Offset simple : à six joueurs sur sept
    semaines, inutile de faire plus malin. */
export async function fetchChatPage(
  offset: number,
  ligueId: string | null,
): Promise<{ messages: ChatMessage[]; hasMore: boolean } | null> {
  // Un message appartient à un joueur, qui appartient à une ligue : pas de
  // `league_id` sur la table, d'où la jointure interne. migration41 annonçait
  // « une colonne league_id + un backfill » — ce n'est pas le choix de `app`,
  // qui cadre partout par jointure et ne duplique rien (voir migration43).
  let q = supabase
    .from("chat_messages")
    .select(ligueId ? `${CHAT_COLS}, players!inner(league_id)` : CHAT_COLS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (ligueId) q = q.eq("players.league_id", ligueId);
  const { data, error } = await q.range(offset, offset + CHAT_PAGE_SIZE - 1);
  if (error) return null;
  const messages = data as unknown as ChatMessage[];
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

/** Les moments du fil cités par des messages. Le tchat lit `feed_events`
    en lecture seule : il ne l'écrit jamais, c'est le rôle des triggers
    et de /api/moments. */
export async function fetchCitedFeedEvents(
  ids: string[],
): Promise<FeedEvent[] | null> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("feed_events")
    .select("id, player_id, kind, payload, created_at")
    .in("id", ids);
  return error ? null : (data as FeedEvent[]);
}

// ---- Écriture ----

/** Ce qu'on attache à un message : le chemin dans le bucket et les
    dimensions de l'image, toujours les trois ensemble (contrainte
    chat_photo_complete). */
export type PhotoJointe = { path: string; w: number; h: number };

/** Poste un message. Renvoie la ligne insérée, ou le message d'erreur. */
export async function insertMessage(
  playerId: string,
  body: string,
  opts: {
    replyTo?: string | null;
    feedEventId?: string | null;
    photo?: PhotoJointe | null;
  } = {},
): Promise<{ message: ChatMessage } | { error: string }> {
  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      player_id: playerId,
      body,
      reply_to: opts.replyTo ?? null,
      feed_event_id: opts.feedEventId ?? null,
      photo_path: opts.photo?.path ?? null,
      photo_w: opts.photo?.w ?? null,
      photo_h: opts.photo?.h ?? null,
    })
    .select(CHAT_COLS)
    .single();
  if (error) return { error: error.message };
  return { message: data as ChatMessage };
}

/**
 * Le chemin de la photo d'un message, lu EN BASE.
 *
 * Sert juste avant une suppression, et c'est un aller-retour assumé : le
 * nettoyage des octets ne doit dépendre d'aucun état client. Celui-ci
 * peut être en retard d'un événement temps réel, avoir été reconstruit
 * par un rechargement, ou venir d'un autre appareil que celui qui a
 * envoyé la photo. La base, elle, sait.
 *
 * À lire AVANT l'update : le trigger vide `photo_path` au passage, donc
 * après, plus personne ne sait quels octets effacer.
 */
export async function fetchPhotoPath(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("photo_path")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { photo_path: string | null }).photo_path;
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
      "x-group-pass": leGroupPass(),
    },
    body: JSON.stringify({ messageId, actorId }),
  }).catch(() => {
    // silencieux, par construction
  });
}
