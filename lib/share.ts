// "Partager ma semaine" : un bloc de texte façon Wordle, prêt pour WhatsApp.
// Du texte et des emojis, pas d'image : ça se colle partout.

import { BonusState } from "./bonus";
import {
  addDays,
  CHALLENGE_DAYS,
  CHALLENGE_END,
  CHALLENGE_START,
  daysLeft,
  frenchDayMonth,
  mondayOf,
  parisToday,
} from "./challenge";
import { Gamification, LeaderboardRow } from "./gamification";
import { computeStats } from "./stats";
import { Entry, entryCount, entryKey } from "./types";
import { Player } from "./types";
import { fetchTodaySessionDuration, formatDuration } from "./workout";

/** Emoji d'un jour : plein = 3/3, partiel = 1-2, vide = 0 ou hors challenge. */
function daySquare(count: number): string {
  if (count === 3) return "🟩";
  if (count > 0) return "🟨";
  return "⬜";
}

/** Construit le message de la semaine en cours pour un joueur.
    rankInfo (phase 2) ajoute la ligne classement si dispo.
    todayBonuses (phase bonus) : libellés des bonus déclarés aujourd'hui.
    sessionLabel (phase séance) : durée de la séance du jour ("22 min 14"). */
export function buildWeekShare(
  player: Player,
  entries: Map<string, Entry>,
  rankInfo?: { rank: number; points: number } | null,
  todayBonuses?: string[],
  sessionLabel?: string | null,
): string {
  const today = parisToday();
  const monday = mondayOf(today > CHALLENGE_END ? CHALLENGE_END : today);

  const squares: string[] = [];
  let perfect = 0;
  let elapsed = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i);
    const inChallenge =
      day >= CHALLENGE_START && day <= CHALLENGE_END && day <= today;
    if (!inChallenge) {
      squares.push("⬜");
      continue;
    }
    elapsed++;
    const n = entryCount(entries.get(entryKey(player.id, day)));
    if (n === 3) perfect++;
    squares.push(daySquare(n));
  }

  const { streak } = computeStats(player.id, entries);
  const left = daysLeft();
  const rankLine = rankInfo
    ? [
        `🏆 ${rankInfo.rank === 1 ? "1er" : `${rankInfo.rank}e`} au général — ${Number.isInteger(rankInfo.points) ? rankInfo.points : rankInfo.points.toFixed(1)} pts`,
      ]
    : [];
  const bonusLine =
    todayBonuses && todayBonuses.length > 0
      ? [`⚡ Bonus du jour : ${todayBonuses.join(", ")}`]
      : [];
  const sessionLine = sessionLabel ? [`⏱️ Séance : ${sessionLabel}`] : [];

  return [
    `💪 Challenge 100-100-100 — Semaine du ${frenchDayMonth(monday)}`,
    `${player.name} — ${perfect}/${elapsed || 7} jours parfaits — série : ${streak}${streak > 0 ? " 🔥" : ""}`,
    ...rankLine,
    ...bonusLine,
    ...sessionLine,
    "",
    "L M M J V S D",
    squares.join(" "),
    "",
    left > 0 ? `Plus que ${left} jour${left > 1 ? "s" : ""}` : "Challenge terminé 🏁",
  ].join("\n");
}

/** Répétitions cumulées d'un joueur : chaque exo validé = 100 mouvements. */
function reps(exosDone: number): number {
  return exosDone * 100;
}

/** Nombre à la française : 13800 → "13 800". */
function frNum(n: number): string {
  return n.toLocaleString("fr-FR");
}

/**
 * Le partage de clôture, façon Wordle : classement final, jours parfaits,
 * répétitions, totaux du groupe et meilleure série. Texte + emojis, ça se
 * colle partout. On lit tout depuis le RPC leaderboard() et les entries — aucun
 * recalcul de points côté client.
 */
export function buildFinalShare(
  players: Player[],
  rows: LeaderboardRow[],
  entries: Map<string, Entry>,
): string {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ranked = [...rows]
    .filter((r) => byId.has(r.player_id))
    .sort((a, b) => a.rank - b.rank);
  const medals = ["🥇", "🥈", "🥉"];

  const lines = ranked.map((r, i) => {
    const name = byId.get(r.player_id)!.name;
    const perfect = `${r.perfect_days} jours parfaits`;
    if (i < 3) {
      return `${medals[i]} ${name} — ${perfect} — ${frNum(reps(r.exos_done))} répétitions`;
    }
    return `${i + 1}. ${name} — ${perfect}`;
  });

  const groupPerfect = ranked.reduce((s, r) => s + r.perfect_days, 0);
  const groupReps = ranked.reduce((s, r) => s + reps(r.exos_done), 0);

  // Meilleure série du groupe : calculée sur les entries déjà chargées.
  let best = { name: "", streak: 0 };
  for (const p of players) {
    const { bestStreak } = computeStats(p.id, entries);
    if (bestStreak > best.streak) best = { name: p.name, streak: bestStreak };
  }

  return [
    "🏁 Challenge 100-100-100 — TERMINÉ",
    `${frenchDayMonth(CHALLENGE_START)} → ${frenchDayMonth(CHALLENGE_END)} · ${CHALLENGE_DAYS} jours`,
    "",
    ...lines,
    "",
    `Le groupe : ${groupPerfect} jours parfaits cumulés, ${frNum(groupReps)} répétitions.`,
    ...(best.streak > 0
      ? [`Meilleure série : ${best.name}, ${best.streak} jours d'affilée 🔥`]
      : []),
  ].join("\n");
}

/** Message « nouvelle saison » : un thermomètre, pas un moteur de challenge.
    Il prépare juste un texte à balancer dans le groupe. */
export const REMATCH_MESSAGE = [
  "On remet ça en septembre ? 💪",
  "Même format, nouvelles dates. Répondez 👍 si vous êtes dedans.",
].join("\n");

/** Partage le bilan de clôture. Sorti de App.tsx, comme shareWeekFlow. */
export function shareFinalFlow(
  players: Player[],
  rows: LeaderboardRow[],
  entries: Map<string, Entry>,
): Promise<"share" | "clipboard"> {
  return shareText(buildFinalShare(players, rows, entries));
}

/** Prépare le message « on remet ça » pour le groupe. */
export function shareRematch(): Promise<"share" | "clipboard"> {
  return shareText(REMATCH_MESSAGE);
}

/** Rassemble classement, bonus du jour et séance chronométrée, puis
    partage la semaine. Sorti de App.tsx pour garder l'orchestrateur court. */
export async function shareWeekFlow(
  player: Player,
  entries: Map<string, Entry>,
  gamification: Gamification | null,
  bonus: BonusState | null,
): Promise<"share" | "clipboard"> {
  const mine = gamification?.total.find((r) => r.player_id === player.id);
  const today = parisToday();
  // Bonus déclarés aujourd'hui par le joueur, libellés depuis le catalogue.
  const todayBonuses = (bonus?.todayClaims ?? [])
    .filter((c) => c.player_id === player.id && c.day === today)
    .map((c) => {
      const item = bonus?.catalog.find((k) => k.key === c.bonus_key);
      return item ? `${item.emoji} ${item.label} (+${item.points})` : "";
    })
    .filter(Boolean);
  // Séance chronométrée du jour : la durée serveur, ou rien.
  const duration = await fetchTodaySessionDuration(player.id);
  return shareText(
    buildWeekShare(
      player,
      entries,
      mine ? { rank: mine.rank, points: mine.points } : null,
      todayBonuses,
      duration !== null ? formatDuration(duration) : null,
    ),
  );
}

/** Partage le lien de l'app (invitation au groupe). */
export async function shareInvite(): Promise<"share" | "clipboard"> {
  const url = window.location.origin;
  if (navigator.share) {
    try {
      await navigator.share({ url });
      return "share";
    } catch {
      /* annulé */
    }
  }
  await navigator.clipboard.writeText(url);
  return "clipboard";
}

/**
 * Partage via le sélecteur natif si dispo (envoi direct WhatsApp),
 * sinon copie dans le presse-papier. Retourne le canal utilisé.
 */
export async function shareText(text: string): Promise<"share" | "clipboard"> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ text });
      return "share";
    } catch {
      // annulé ou refusé : on retombe sur le presse-papier
    }
  }
  await navigator.clipboard.writeText(text);
  return "clipboard";
}
