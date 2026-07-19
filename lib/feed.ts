// Couche feed côté client : lecture des événements (générés par
// triggers et /api/moments, jamais saisis), réactions, commentaires.
// Le feed raconte l'histoire, il ne compte aucun point.

import { addDays, frenchDate, parisToday } from "./challenge";
import { BADGES, fmtPoints } from "./gamification";
import { supabase } from "./supabase";
import { formatClock } from "./workout";

export const FEED_PAGE_SIZE = 50;

// La liste fixe, dans l'ordre d'affichage. Pas de picker complet.
export const REACTION_EMOJIS = ["❤️", "🔥", "💪", "😂", "💀"] as const;

export type FeedKind =
  | "seance"
  | "bonus"
  | "event"
  | "lead"
  | "co_lead"
  | "badge"
  | "record"
  | "milestone"
  | "collectif"
  | "duel_start"
  | "duel_result";

export type FeedPayload = {
  day?: string;
  duration_seconds?: number;
  bonus_key?: string;
  label?: string;
  emoji?: string;
  points?: number | string;
  badge?: string;
  streak?: number;
  co?: string[];
  // duels
  week_monday?: string;
  opponent?: string;
  opponent_id?: string;
  score?: string; // "3–2", en jours parfaits
  pointsScore?: string; // "23,5–19", le départage aux points de la semaine
  outcome?: "win" | "draw";
  tiebreak?: boolean;
  bye?: boolean; // exempt de la semaine
};

export type FeedEvent = {
  id: string;
  player_id: string;
  kind: FeedKind;
  payload: FeedPayload;
  created_at: string;
};

export type FeedReaction = {
  event_id: string;
  player_id: string;
  emoji: string;
};

export type FeedComment = {
  id: string;
  event_id: string;
  player_id: string;
  body: string;
  created_at: string;
};

/** Traduit une erreur des triggers feed en phrase humaine. */
export function humanFeedError(message: string): string {
  if (message.includes("comment_140")) return "140 caractères max";
  if (message.includes("comment_non_vide")) return "Commentaire vide";
  return "Écriture échouée, réessaie";
}

// ---- Phrases ----
// Les libellés du catalogue font des phrases bancales ("+50 pompes").
// On mappe les clés connues vers un verbe, le label reste le repli.

const BONUS_PHRASES: Record<string, string> = {
  pompes_50: "a enchaîné 50 pompes en plus",
  pompes_100: "a enchaîné 100 pompes en plus",
  abdos_100: "a remis 100 abdos",
  abdos_200: "a remis 200 abdos",
  squats_100: "a remis 100 squats",
  squats_200: "a remis 200 squats",
  course_5km: "a couru 5 km",
  gainage_3min: "a tenu 3 min de gainage",
  corde_10min: "a sauté 10 min à la corde",
  marches_500: "a grimpé 500 marches",
  boss_dimanche: "a réussi le boss du dimanche",
};

/** La phrase d'un événement, sans le prénom (affiché à part, coloré). */
export function eventPhrase(e: FeedEvent): { emoji: string; text: string } {
  const p = e.payload;
  const pts = p.points !== undefined ? ` (+${fmtPoints(Number(p.points))} pts)` : "";
  switch (e.kind) {
    case "seance":
      return p.duration_seconds
        ? { emoji: "🔥", text: `a terminé sa séance en ${formatClock(p.duration_seconds)}` }
        : { emoji: "🔥", text: "a validé ses 3 exos" };
    case "bonus": {
      const verb = BONUS_PHRASES[p.bonus_key ?? ""] ?? `a validé « ${p.label} »`;
      return { emoji: p.emoji || "💪", text: verb + pts };
    }
    case "event": {
      const verb = BONUS_PHRASES[p.bonus_key ?? ""] ?? `a réussi « ${p.label} »`;
      return { emoji: "🎲", text: verb + pts };
    }
    case "lead":
      return { emoji: "👑", text: "prend la tête du classement" };
    case "co_lead": {
      // Auteur rendu à part (prénom coloré) : la phrase enchaîne dessus.
      const co = p.co ?? [];
      const list =
        co.length <= 1
          ? co[0] ?? ""
          : `${co.slice(0, -1).join(", ")} et ${co[co.length - 1]}`;
      return { emoji: "👑", text: `et ${list} se partagent la tête` };
    }
    case "badge": {
      const b = BADGES.find((x) => x.key === p.badge);
      return b
        ? { emoji: b.emoji, text: `décroche « ${b.label} » (${b.hint.toLowerCase()})` }
        : { emoji: "🏅", text: "décroche un badge" };
    }
    case "record":
      return { emoji: "📈", text: `bat sa meilleure série : ${p.streak} jours` };
    case "milestone":
      return { emoji: "⚡", text: `aligne ${p.streak} jours parfaits d'affilée` };
    case "collectif": {
      const pts =
        p.points !== undefined
          ? `, +${fmtPoints(Number(p.points))} pts chacun`
          : "";
      return {
        emoji: "🤝",
        text: `ferme le jour parfait collectif : toute la bande à 3/3${pts}`,
      };
    }
    case "duel_start":
      return p.bye
        ? {
            emoji: "⚔️",
            text: "est exempt de duel cette semaine — nombre impair, ça tournera",
          }
        : {
            emoji: "⚔️",
            text: `défie ${p.opponent} en duel : le plus de jours parfaits d'ici dimanche prend ${fmtPoints(Number(p.points ?? 3))} pts à l'autre`,
          };
    case "duel_result": {
      if (p.outcome === "draw") {
        return {
          emoji: "🤝",
          text: `fait match nul contre ${p.opponent} en duel (${p.score}) — aucun point ne bouge`,
        };
      }
      const tb = p.tiebreak ? ` (départage aux points ${p.pointsScore})` : "";
      return {
        emoji: "⚔️",
        text: `remporte son duel contre ${p.opponent} ${p.score}${tb} et lui prend ${fmtPoints(Number(p.points ?? 3))} pts`,
      };
    }
  }
}

// ---- Dates & heures (heure de Paris, comme tout le reste) ----

const parisDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const parisTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
});

/** Jour civil Paris d'un timestamp, 'YYYY-MM-DD' (pour grouper le fil). */
export function parisDayOf(iso: string): string {
  return parisDayFmt.format(new Date(iso));
}

/** "22:14" — heure Paris d'un timestamp. */
export function timeOf(iso: string): string {
  return parisTimeFmt.format(new Date(iso));
}

/** "Aujourd'hui" / "Hier" / "samedi 12 juillet" */
export function dayLabel(day: string): string {
  const today = parisToday();
  if (day === today) return "Aujourd'hui";
  if (day === addDays(today, -1)) return "Hier";
  return frenchDate(day);
}

// ---- Accès base ----

/** Une page du fil, antéchronologique. Offset simple : à 6 joueurs
    sur 48 jours (< 1 000 événements au total), inutile de faire
    plus malin — les doublons de bord sont dédupliqués par id. */
export async function fetchFeedPage(
  offset: number,
): Promise<{ events: FeedEvent[]; hasMore: boolean } | null> {
  const { data, error } = await supabase
    .from("feed_events")
    .select("id, player_id, kind, payload, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + FEED_PAGE_SIZE - 1);
  if (error) return null;
  const events = data as FeedEvent[];
  return { events, hasMore: events.length === FEED_PAGE_SIZE };
}

/** Réactions + commentaires des événements chargés, en un aller-retour. */
export async function fetchFeedAnnex(
  eventIds: string[],
): Promise<{ reactions: FeedReaction[]; comments: FeedComment[] } | null> {
  if (eventIds.length === 0) return { reactions: [], comments: [] };
  const [r, c] = await Promise.all([
    supabase
      .from("feed_reactions")
      .select("event_id, player_id, emoji")
      .in("event_id", eventIds),
    supabase
      .from("feed_comments")
      .select("id, event_id, player_id, body, created_at")
      .in("event_id", eventIds)
      .order("created_at"),
  ]);
  if (r.error || c.error) return null;
  return {
    reactions: r.data as FeedReaction[],
    comments: c.data as FeedComment[],
  };
}

/** Ajoute une réaction. Renvoie le message d'erreur, ou null. */
export async function insertReaction(
  eventId: string,
  playerId: string,
  emoji: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("feed_reactions")
    .insert({ event_id: eventId, player_id: playerId, emoji });
  return error ? error.message : null;
}

/** Retire une réaction (retap). */
export async function deleteReaction(
  eventId: string,
  playerId: string,
  emoji: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("feed_reactions")
    .delete()
    .match({ event_id: eventId, player_id: playerId, emoji });
  return error ? error.message : null;
}

/** Poste un commentaire (140 max, la base retoque au-delà). */
export async function insertComment(
  eventId: string,
  playerId: string,
  body: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("feed_comments")
    .insert({ event_id: eventId, player_id: playerId, body });
  return error ? error.message : null;
}

/** Signale au serveur qu'il y a de l'activité sur un événement (push
    groupé, throttle 15 min côté serveur). `actorId` est l'auteur de
    l'activité : le serveur l'exclut des destinataires et s'en sert pour
    formuler la notif. Sur un commentaire, sont notifiés l'auteur du
    moment ET les autres participants au fil. */
export function notifyFeedActivity(eventId: string, actorId: string): void {
  fetch("/api/feed-notify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-group-pass": process.env.NEXT_PUBLIC_GROUP_PASSWORD ?? "",
    },
    body: JSON.stringify({ eventId, actorId }),
  }).catch(() => {
    // silencieux : la notif est un bonus, pas un contrat
  });
}
