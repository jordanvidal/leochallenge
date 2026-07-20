// Couche gamification côté client : lecture des points serveur
// (RPC leaderboard, vue player_badges), catalogue des badges,
// souscription push. Aucun calcul de points ici — une seule vérité.

import { addDays, mondayOf, parisToday } from "./challenge";
import { Duel } from "./duels";
import { supabase } from "./supabase";

export type LeaderboardRow = {
  player_id: string;
  points: number;
  rank: number;
  perfect_days: number;
  exos_done: number;
  current_streak: number;
  bonus_points: number; // "dont X pts bonus", déjà inclus dans points
  /** Jour où le joker de série a été brûlé, null s'il est encore intact.
      Optionnel tant que la migration 24 n'est pas appliquée en prod : la
      RPC ne renvoie pas encore la colonne, le marqueur reste muet. */
  joker_day?: string | null;
};

export type Gamification = {
  total: LeaderboardRow[];
  week: LeaderboardRow[];
  lastWeekRanks: Map<string, number>; // rang au dimanche précédent
  badges: Map<string, string[]>; // player_id → badges débloqués
  duels: Duel[]; // tous les appariements (table minuscule)
};

export const BADGES: { key: string; emoji: string; label: string; hint: string }[] = [
  { key: "premiere_semaine", emoji: "🌱", label: "Première semaine", hint: "7 jours parfaits d'affilée" },
  { key: "machine", emoji: "⚙️", label: "Machine", hint: "14 jours parfaits d'affilée" },
  { key: "increvable", emoji: "🛡️", label: "Increvable", hint: "30 jours parfaits d'affilée" },
  { key: "sans_faute", emoji: "💎", label: "Sans faute", hint: "Aucun jour raté depuis le début" },
  { key: "retour_de_flamme", emoji: "🔥", label: "Retour de flamme", hint: "Reprendre une série de 5+ après l'avoir cassée" },
  { key: "premier_de_la_classe", emoji: "👑", label: "Premier de la classe", hint: "N°1 pendant 7 jours consécutifs" },
  { key: "finisseur", emoji: "🏁", label: "Le finisseur", hint: "Les 3 exos validés le 31 août" },
  { key: "centurion", emoji: "🏛️", label: "Centurion", hint: "100 exercices validés au total" },
];

/** "1er", "2e", "3e"… */
export function frenchRank(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}

/** Points affichés sans décimale inutile (47 plutôt que 47.0). */
export function fmtPoints(p: number): string {
  const n = Number(p);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Charge tout l'état gamification en un aller-retour. */
export async function fetchGamification(): Promise<Gamification | null> {
  const today = parisToday();
  const monday = mondayOf(today);
  const lastSunday = addDays(monday, -1);

  const [total, week, lastWeek, badges, duels] = await Promise.all([
    supabase.rpc("leaderboard"),
    supabase.rpc("leaderboard", { p_from: monday }),
    supabase.rpc("leaderboard", { p_until: lastSunday }),
    supabase.from("player_badges").select("player_id, badge"),
    supabase.from("duels").select("week_monday, player_a, player_b"),
  ]);
  if (total.error || week.error || lastWeek.error || badges.error) return null;
  // duels tolère l'erreur (table absente tant que la migration 14 n'est
  // pas jouée) : le classement vaut mieux qu'un écran vide.

  // Semaine 1 : personne n'avait de points dimanche dernier, la variation
  // n'a pas de sens — on ne l'affiche pas plutôt que d'afficher du faux.
  const lastWeekRows = lastWeek.data as LeaderboardRow[];
  const lastWeekMeaningful = lastWeekRows.some((r) => Number(r.points) > 0);
  const lastWeekRanks = new Map(
    lastWeekMeaningful
      ? lastWeekRows.map((r) => [r.player_id, Number(r.rank)] as [string, number])
      : [],
  );
  const badgeMap = new Map<string, string[]>();
  for (const row of badges.data as { player_id: string; badge: string }[]) {
    badgeMap.set(row.player_id, [...(badgeMap.get(row.player_id) ?? []), row.badge]);
  }
  return {
    total: (total.data as LeaderboardRow[]).map(numify),
    week: (week.data as LeaderboardRow[]).map(numify),
    lastWeekRanks,
    badges: badgeMap,
    duels: duels.error ? [] : (duels.data as Duel[]),
  };
}

/** Classement d'une semaine passée (fenêtre close). Même RPC que le reste :
    aucun score stocké, tout est recalculé depuis les entries — l'historique
    hebdo est donc exact même si un bonus a été corrigé après coup. */
export async function fetchWeekLeaderboard(
  from: string,
  until: string,
): Promise<LeaderboardRow[] | null> {
  const { data, error } = await supabase.rpc("leaderboard", {
    p_from: from,
    p_until: until,
  });
  if (error || !data) return null;
  return (data as LeaderboardRow[]).map(numify);
}

/** Postgres renvoie les numeric en string : on renormalise. */
function numify(r: LeaderboardRow): LeaderboardRow {
  return {
    ...r,
    points: Number(r.points),
    rank: Number(r.rank),
    perfect_days: Number(r.perfect_days),
    exos_done: Number(r.exos_done),
    current_streak: Number(r.current_streak),
    bonus_points: Number(r.bonus_points),
  };
}

/** Signale une coche au serveur : détection de dépassement (push) et
    des moments du feed (prise de tête, badge, record, milestone).
    Renvoie la promesse pour pouvoir recharger le fil derrière. */
export function notifyMoments(actorId: string): Promise<void> {
  return fetch("/api/moments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-group-pass": process.env.NEXT_PUBLIC_GROUP_PASSWORD ?? "",
    },
    body: JSON.stringify({ actorId }),
  })
    .then(() => undefined)
    .catch(() => {
      // silencieux : la détection des moments est un bonus, pas un contrat
    });
}

/** Le push web est-il possible ici ? (iOS : PWA installée obligatoire) */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Enregistre en base la subscription du navigateur, en la créant si le
    navigateur n'en a pas. La permission doit déjà être accordée. */
async function saveSubscription(playerId: string): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  // subscribe() rend la subscription existante si elle est encore valide,
  // et en forge une neuve sinon : c'est ce qui rattrape un endpoint périmé.
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  });
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      player_id: playerId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    },
    { onConflict: "endpoint" },
  );
  return !error;
}

/** Demande la permission puis enregistre la subscription en base. */
export async function subscribePush(playerId: string): Promise<boolean> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
    return await saveSubscription(playerId);
  } catch {
    return false;
  }
}

/**
 * Re-synchronise la subscription à chaque ouverture, sans rien demander.
 *
 * Pourquoi : un endpoint push n'est pas éternel (PWA réinstallée, token
 * recyclé par l'OS). Sans ça, une subscription morte le reste à vie — le
 * bandeau d'opt-in, lui, ne réapparaît jamais puisqu'il exige une
 * permission « default » et que la nôtre est déjà « granted ». Le groupe
 * se serait vidé de ses abonnés, un par un, en silence.
 *
 * Ne demande jamais la permission : si elle n'est pas déjà accordée, on
 * ne fait rien et le bandeau garde son rôle.
 */
export async function resyncPush(playerId: string): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    await saveSubscription(playerId);
  } catch {
    // silencieux : c'est une réparation opportuniste, pas un contrat
  }
}
