// Couche feed côté client : lecture des événements (générés par
// triggers et /api/moments, jamais saisis), réactions, commentaires.
// Le feed raconte l'histoire, il ne compte aucun point.

import { addDays, frenchDate, frenchDayMonth, parisToday } from "./challenge";
import { BADGES, fmtPoints, frenchRank } from "./gamification";
import { supabase } from "./supabase";
import { formatClock } from "./workout";
import { leGroupPass } from "./ligue";

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
  | "duel_result"
  | "joker"
  | "premier"
  | "recit";

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
  // 👑 tête de la semaine : les ids des leaders au moment de l'annonce,
  // dans un ordre canonique. C'est la mémoire qui permet à /api/moments de
  // savoir si la tête a bougé — la semaine repart de zéro chaque lundi, il
  // n'existe aucun rang hebdo figé ailleurs.
  leaders?: string[];
  // record de volume : les répétitions de rab du jour, et l'ancien record
  // qui vient de tomber. Leur présence distingue les deux familles de
  // `kind: "record"` — sans `reps`, c'est un record de série.
  reps?: number;
  before?: number;
  // duels
  week_monday?: string;
  opponent?: string;
  opponent_id?: string;
  score?: string; // "3–2", en jours parfaits
  pointsScore?: string; // "23,5–19", le départage aux points de la semaine
  outcome?: "win" | "draw";
  tiebreak?: boolean;
  bye?: boolean; // exempt de la semaine
  // récit du lundi : le job SQL n'écrit que des faits, la phrase se
  // fabrique ici (voir supabase/migration32-recit-hebdo.sql). `angle`
  // commande tout le reste — chaque angle n'emporte que ce qu'il utilise.
  angle?: RecitAngle;
  rank?: number; // rang au général à la fermeture de la semaine
  rank_before?: number; // et une semaine plus tôt
  parfaits?: number; // jours parfaits de la semaine, sur 7
  jours_vides?: number; // jours sans une seule coche
  finish?: number; // points des deux derniers jours
  joker?: boolean;
  peers?: string[]; // les autres sans-fautes de la semaine
  leader?: string;
  leader_parfaits?: number;
  foil?: string; // celui à qui on compare
  foil_finish?: number;
  gap?: number; // écart de points avec le foil
  streak_before?: number; // l'ancien record de série
};

/** Les angles du récit, dans l'ordre de priorité de la spéc (§6). */
export type RecitAngle =
  | "sans_faute_sans_recompense"
  | "sans_faute"
  | "bond"
  | "chute"
  | "finish"
  | "serie_record"
  | "duel_departage"
  | "defaut";

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
  course_10km: "a poussé jusqu'à 10 km",
  gainage_3min: "a tenu 3 min de gainage",
  corde_10min: "a sauté 10 min à la corde",
  marches_500: "a grimpé 500 marches",
  jumping_jacks_100: "a claqué 100 jumping jacks",
  jumping_jacks_200: "a claqué 200 jumping jacks",
  climbers_100: "a enchaîné 100 mountain climbers",
  climbers_200: "a enchaîné 200 mountain climbers",
  squats_jump_50: "a sauté 50 squats jump",
  squats_jump_100: "a sauté 100 squats jump",
  boss_dimanche: "a réussi le boss du dimanche",
};

/** "A, B et C" — les autres sans-fautes de la semaine. */
function frenchList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

/** Le sprint de fin comparé à celui d'en face : un rapport quand il est
    net, les deux chiffres sinon. Jamais un superlatif (spéc §7, règle 5). */
function finishCompare(finish: number, foil?: string, foilFinish?: number): string {
  if (!foil || foilFinish === undefined || Number(foilFinish) <= 0) return "";
  const ratio = finish / Number(foilFinish);
  if (ratio >= 2.5) return `, le triple de ${foil}`;
  if (ratio >= 1.8) return `, le double de ${foil}`;
  return `, contre ${fmtPoints(Number(foilFinish))} à ${foil}`;
}

/** Le récit du lundi : un angle, une ou deux phrases, jamais un adjectif
    sans un chiffre derrière. Les faits viennent du job SQL — ici on ne
    fait qu'écrire le français. Voir docs/spec-recit-hebdo.md §6 et §7. */
function recitPhrase(p: FeedPayload): { emoji: string; text: string } {
  const rank = frenchRank(Number(p.rank ?? 0));
  const before = frenchRank(Number(p.rank_before ?? 0));
  const pts = fmtPoints(Number(p.points ?? 0));
  const finish = Number(p.finish ?? 0);

  switch (p.angle) {
    case "sans_faute_sans_recompense": {
      const peers = p.peers ?? [];
      const avec = peers.length > 0 ? `, avec ${frenchList(peers)},` : ", seul du groupe,";
      // Si le leader est lui aussi à 7/7 il est déjà nommé juste avant :
      // le citer une seconde fois ne dirait rien de plus.
      const suite =
        p.leader && p.leader_parfaits !== undefined && Number(p.leader_parfaits) < 7
          ? ` ${p.leader}, 1er, en a coché ${p.leader_parfaits}.`
          : "";
      return {
        emoji: "🎯",
        text: `a bouclé la semaine à 7 jours parfaits sur 7${avec} et finit ${rank}.${suite}`,
      };
    }
    case "sans_faute":
      return {
        emoji: "🎯",
        text:
          `a bouclé la semaine à 7 jours parfaits sur 7, et finit ${rank}.` +
          (p.foil && p.gap !== undefined
            ? ` ${fmtPoints(Number(p.gap))} pts d'avance sur ${p.foil}.`
            : ""),
      };
    case "bond":
      return {
        emoji: "📈",
        text:
          `était ${before} il y a une semaine, il est ${rank}. ` +
          `${fmtPoints(finish)} pts sur les deux derniers jours` +
          finishCompare(finish, p.foil, p.foil_finish) +
          (p.joker ? ", et un joker brûlé en route" : "") +
          ".",
      };
    case "chute": {
      const vides = Number(p.jours_vides ?? 0);
      const suite =
        vides > 0
          ? ` ${vides} jour${vides > 1 ? "s" : ""} sans une seule coche.`
          : ` ${fmtPoints(finish)} pts sur les deux derniers jours` +
            finishCompare(finish, p.foil, p.foil_finish) +
            ".";
      return { emoji: "📉", text: `était ${before} il y a une semaine, il est ${rank}.${suite}` };
    }
    case "finish":
      return {
        emoji: "🏁",
        text:
          `a tout mis à la fin : ${fmtPoints(finish)} de ses ${pts} pts sont tombés ` +
          `sur les deux derniers jours.` +
          (p.foil && p.foil_finish !== undefined
            ? ` ${p.foil} sur la même fenêtre : ${fmtPoints(Number(p.foil_finish))}.`
            : ""),
      };
    case "serie_record":
      return {
        emoji: "⚡",
        text:
          `tient ${p.streak} jours parfaits d'affilée — sa plus longue série` +
          (p.streak_before ? `, l'ancienne s'arrêtait à ${p.streak_before}` : "") +
          ".",
      };
    case "duel_departage":
      return {
        emoji: "⚔️",
        text:
          `a gagné son duel contre ${p.foil} au départage : ${p.score} en jours ` +
          `parfaits, ${p.pointsScore} aux points.`,
      };
    case "defaut":
      return {
        emoji: "📊",
        text:
          `rafle la semaine avec ${pts} pts` +
          (p.foil && p.gap !== undefined
            ? `, ${fmtPoints(Number(p.gap))} devant ${p.foil}`
            : "") +
          ".",
      };
    default:
      // Angle inconnu : une version du job plus récente que l'app. On dit
      // le peu qu'on sait plutôt que de casser le fil.
      return { emoji: "📊", text: `a bouclé sa semaine à ${pts} pts.` };
  }
}

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
      // La tête se joue sur la semaine depuis le 29/07, comme le
      // Classement qui s'ouvre dessus. Les cartes d'avant ont été
      // calculées sur le général : sans `week_monday`, elles gardent
      // leur phrase, sinon le fil réécrirait son propre passé.
      return {
        emoji: "👑",
        text: p.week_monday
          ? "prend la tête de la semaine"
          : "prend la tête du classement",
      };
    case "co_lead": {
      // Auteur rendu à part (prénom coloré) : la phrase enchaîne dessus.
      const co = p.co ?? [];
      const list =
        co.length <= 1
          ? co[0] ?? ""
          : `${co.slice(0, -1).join(", ")} et ${co[co.length - 1]}`;
      return {
        emoji: "👑",
        text: `et ${list} se partagent la tête${p.week_monday ? " de la semaine" : ""}`,
      };
    }
    case "badge": {
      const b = BADGES.find((x) => x.key === p.badge);
      return b
        ? { emoji: b.emoji, text: `décroche « ${b.label} » (${b.hint.toLowerCase()})` }
        : { emoji: "🏅", text: "décroche un badge" };
    }
    case "joker":
      // Le chiffre est celui d'AVANT la journée ratée : c'est ce qui
      // était en jeu, donc ce qui a été sauvé. Il ne bouge plus ensuite.
      return {
        emoji: "🛟",
        text: `a brûlé son joker — sa série de ${p.streak} jours tient`,
      };
    case "premier":
      // Le trophée « premier du jour » se décerne une fois la journée
      // finie (rotation comprise), donc la carte tombe le lendemain : on
      // nomme le jour explicitement pour qu'elle ne se lise jamais de
      // travers, même relue plus tard.
      return {
        emoji: "🌅",
        text: `a fini premier${p.day ? ` le ${frenchDayMonth(p.day)}` : ""}${pts}`,
      };
    case "record":
      // Deux records sous le même kind — réutiliser 'record' évite d'étendre
      // feed_events_kind_check, donc évite une migration. On discrimine sur
      // le payload, et l'emoji sépare les deux à l'œil : deux cartes de même
      // famille qui se ressembleraient seraient illisibles.
      //
      // L'ancien record est affiché, et c'est tout l'objet de la carte :
      // sans lui « 350 répétitions » n'est qu'un chiffre, avec lui c'est une
      // progression. C'est la seule chose que l'appli dise à un joueur sur
      // lui-même plutôt que sur son rang.
      return p.reps !== undefined
        ? {
            emoji: "💥",
            text: `explose son record de rab : ${p.reps} répétitions, contre ${p.before} avant`,
          }
        : { emoji: "📈", text: `bat sa meilleure série : ${p.streak} jours` };
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
    case "recit":
      return recitPhrase(p);
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
  ligueId: string | null,
): Promise<{ events: FeedEvent[]; hasMore: boolean } | null> {
  // Un événement de fil appartient à un joueur, qui appartient à une ligue :
  // pas de colonne à filtrer, d'où la jointure interne. Sans elle, le fil
  // raconterait les séances des inconnus d'une autre ligue — et la pagination
  // se remplirait de leurs événements, poussant les vrais hors de la page.
  const colonnes = ligueId
    ? "id, player_id, kind, payload, created_at, players!inner(league_id)"
    : "id, player_id, kind, payload, created_at";
  let q = supabase
    .from("feed_events")
    .select(colonnes)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (ligueId) q = q.eq("players.league_id", ligueId);
  const { data, error } = await q.range(offset, offset + FEED_PAGE_SIZE - 1);
  if (error) return null;
  // Champ par champ : la jointure ajoute un `players` qui n'a rien à faire
  // dans un FeedEvent.
  const events = (data as unknown as FeedEvent[]).map((e) => ({
    id: e.id,
    player_id: e.player_id,
    kind: e.kind,
    payload: e.payload,
    created_at: e.created_at,
  }));
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
      "x-group-pass": leGroupPass(),
    },
    body: JSON.stringify({ eventId, actorId }),
  }).catch(() => {
    // silencieux : la notif est un bonus, pas un contrat
  });
}
