// Couche gamification côté client : lecture des points serveur
// (RPC leaderboard, vue player_badges), catalogue des badges,
// souscription push. Aucun calcul de points ici — une seule vérité.

import { addDays, mondayOf, parisToday } from "./challenge";
import { Duel } from "./duels";
import { argLigue, leGroupPass } from "./ligue";
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
  // Les rangs du dimanche précédent ne sont PAS ici : ils ne servent qu'aux
  // flèches ↑↓ de l'onglet Général, et coûtent un appel complet à
  // `leaderboard()`. Voir `fetchLastWeekRanks`, tiré par l'écran.
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


// ---------------------------------------------------------------------------
// Les trois lectures qui traversent tous les joueurs
// ---------------------------------------------------------------------------
//
// Elles ne portent pas de `league_id` à filtrer : un badge, un duel et une
// coche appartiennent à un joueur, qui appartient à une ligue. D'où les
// jointures internes — PostgREST fait le tri côté serveur, en un aller-retour.
//
// En groupe unique, aucune de ces colonnes n'existe : on garde la requête
// d'aujourd'hui, mot pour mot.

/** Les badges de la ligue. La vue `app.player_badges` porte `league_id`. */
function badgesDeLaLigue(ligueId: string | null) {
  const q = supabase.from("player_badges").select("player_id, badge");
  return ligueId ? q.eq("league_id", ligueId) : q;
}

/**
 * Les duels de la ligue. `duels` a deux clés vers `players` (`player_a` et
 * `player_b`) : PostgREST refuse de deviner laquelle, il faut la nommer.
 * `player_a` suffit — un duel n'apparie jamais deux ligues.
 */
function duelsDeLaLigue(ligueId: string | null) {
  if (!ligueId) {
    return supabase.from("duels").select("week_monday, player_a, player_b");
  }
  return supabase
    .from("duels")
    .select("week_monday, player_a, player_b, players!duels_player_a_fkey!inner(league_id)")
    .eq("players.league_id", ligueId);
}

/** Les coches de la ligue jusqu'à un jour donné. */
function cochesDeLaLigue(until: string, ligueId: string | null) {
  if (!ligueId) {
    return supabase
      .from("entries")
      .select("player_id, pushups, abs, squats")
      .lte("day", until);
  }
  return supabase
    .from("entries")
    .select("player_id, pushups, abs, squats, players!inner(league_id)")
    .eq("players.league_id", ligueId)
    .lte("day", until);
}

/** Charge tout l'état gamification en un aller-retour. */
export async function fetchGamification(
  ligueId: string | null,
): Promise<Gamification | null> {
  const today = parisToday();
  const monday = mondayOf(today);

  const [total, week, badges, duels] = await Promise.all([
    supabase.rpc("leaderboard", argLigue(ligueId)),
    supabase.rpc("leaderboard", { ...argLigue(ligueId), p_from: monday }),
    badgesDeLaLigue(ligueId),
    duelsDeLaLigue(ligueId),
  ]);
  if (total.error || week.error || badges.error) return null;
  // duels tolère l'erreur (table absente tant que la migration 14 n'est
  // pas jouée) : le classement vaut mieux qu'un écran vide.

  const badgeMap = new Map<string, string[]>();
  for (const row of badges.data as { player_id: string; badge: string }[]) {
    badgeMap.set(row.player_id, [...(badgeMap.get(row.player_id) ?? []), row.badge]);
  }
  return {
    total: (total.data as LeaderboardRow[]).map(numify),
    week: (week.data as LeaderboardRow[]).map(numify),
    badges: badgeMap,
    duels: duels.error ? [] : (duels.data as Duel[]),
  };
}

/**
 * Les rangs au dimanche dernier — uniquement les flèches ↑↓ de l'onglet
 * « Général ».
 *
 * C'est un troisième appel à `leaderboard()`, la RPC la plus chère de
 * l'app, et il partait à chaque ouverture alors que l'onglet par défaut
 * est « Semaine » : le plus souvent on payait un recalcul complet du
 * challenge pour une colonne que personne ne regardait. Il est maintenant
 * tiré par l'écran, quand la vue Général s'ouvre pour de vrai.
 *
 * Rend `null` si l'appel échoue — l'écran retentera en revenant sur
 * l'onglet, exactement comme pour l'historique des semaines closes.
 */
export async function fetchLastWeekRanks(
  ligueId: string | null,
): Promise<Map<string, number> | null> {
  const lastSunday = addDays(mondayOf(parisToday()), -1);
  const { data, error } = await supabase.rpc("leaderboard", {
    ...argLigue(ligueId),
    p_until: lastSunday,
  });
  if (error || !data) return null;

  // Semaine 1 : personne n'avait de points dimanche dernier, la variation
  // n'a pas de sens — on ne l'affiche pas plutôt que d'afficher du faux.
  const rows = data as LeaderboardRow[];
  if (!rows.some((r) => Number(r.points) > 0)) return new Map();
  return new Map(rows.map((r) => [r.player_id, Number(r.rank)]));
}

// --- Bilan des saisons 1 et 2, pour l'écran de lancement de la S3 -----
// Ces chiffres vivaient en dur dans le composant, à figer à la main le
// dimanche soir. Un écran qui s'affiche une fois, à une date connue, sur
// des données que la base sait produire : il n'y avait aucune raison de
// les recopier. Calculés ici, ils sont justes quoi qu'il arrive — et il
// n'y a plus de déploiement à passer à minuit.

export type BilanSaison = {
  moyenneReps: number;
  totalReps: number;
  joursParfaits: number;
  /** Les trois premiers du classement général, 1er en tête. */
  podium: { playerId: string; nom: string; points: number; joursParfaits: number }[];
  /** Combien de joueurs ont compté dans la moyenne. */
  joueurs: number;
};

type EntryRow = {
  player_id: string;
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};

/**
 * Le bilan des jours joués avant `until` (inclus).
 *
 * Ne comptent que les joueurs qui ont coché **au moins la moitié des
 * jours**. Le challenge s'ouvre à qui veut, et trois comptes se sont
 * arrêtés à 0, 2 et 3 jours sur quatorze : les inclure divisait la
 * moyenne par huit et sortait 2 771 répétitions là où ceux qui jouent
 * sont à 3 660. Le seuil n'exclut personne à la main, et la marge est
 * large — 11 à 13 jours d'un côté, 0 à 3 de l'autre.
 */
export async function fetchBilanSaison(
  until: string,
  joursTotal: number,
  noms: Map<string, string>,
  ligueId: string | null,
): Promise<BilanSaison | null> {
  const [entries, lb] = await Promise.all([
    cochesDeLaLigue(until, ligueId),
    supabase.rpc("leaderboard", { ...argLigue(ligueId), p_until: until }),
  ]);
  if (entries.error || lb.error) return null;

  // Jours cochés et répétitions, par joueur. Une coche = 100 répétitions.
  const jours = new Map<string, number>();
  const reps = new Map<string, number>();
  for (const e of entries.data as EntryRow[]) {
    const n = Number(e.pushups) + Number(e.abs) + Number(e.squats);
    if (n === 0) continue;
    jours.set(e.player_id, (jours.get(e.player_id) ?? 0) + 1);
    reps.set(e.player_id, (reps.get(e.player_id) ?? 0) + n * 100);
  }

  const seuil = Math.ceil(joursTotal / 2);
  const retenus = (lb.data as LeaderboardRow[])
    .map(numify)
    .filter((r) => (jours.get(r.player_id) ?? 0) >= seuil);
  if (retenus.length === 0) return null;

  const totalReps = retenus.reduce((s, r) => s + (reps.get(r.player_id) ?? 0), 0);
  return {
    totalReps,
    moyenneReps: Math.round(totalReps / retenus.length),
    joursParfaits: retenus.reduce((s, r) => s + r.perfect_days, 0),
    joueurs: retenus.length,
    podium: [...retenus]
      .sort((a, b) => b.points - a.points)
      .slice(0, 3)
      .map((r) => ({
        playerId: r.player_id,
        nom: noms.get(r.player_id) ?? "",
        points: r.points,
        joursParfaits: r.perfect_days,
      })),
  };
}

/** Classement d'une semaine passée (fenêtre close). Même RPC que le reste :
    aucun score stocké, tout est recalculé depuis les entries — l'historique
    hebdo est donc exact même si un bonus a été corrigé après coup. */
export async function fetchWeekLeaderboard(
  from: string,
  until: string,
  ligueId: string | null,
): Promise<LeaderboardRow[] | null> {
  const { data, error } = await supabase.rpc("leaderboard", {
    ...argLigue(ligueId),
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
      "x-group-pass": leGroupPass(),
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
