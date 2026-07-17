// Les "moments" : appelée après chaque coche, compare l'état calculé
// (classement, badges, séries) à l'état stocké et insère ce qui a
// changé dans le feed. Étend l'ancien /api/overtake : la détection de
// dépassement (push "Sam vient de te passer") vit toujours ici,
// plafonnée à une notif par destinataire par fenêtre de 4 heures.
// Chaque moment réellement inséré part aussi en push aux autres
// joueurs (groupé par joueur, une seule notif même si badge + record
// tombent ensemble). L'unicité (player_id, kind, dedupe_key) rend tout
// ré-exécutable : un appel raté est rattrapé au suivant, jamais de
// doublon — ni dans le fil, ni en push.

import { NextResponse } from "next/server";
import { addDays } from "@/lib/challenge";
import { BADGES } from "@/lib/gamification";
import { parisToday, sendToPlayers, serverSupabase } from "@/lib/server/push";

export const dynamic = "force-dynamic";

type LbRow = { player_id: string; rank: number; points: number };
type Snap = { player_id: string; rank: number };
type BadgeRow = { player_id: string; badge: string };
type StreakRow = { player_id: string; day: string; streak_pos: number };
type EntryRow = {
  player_id: string;
  day: string;
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};
type FeedInsert = {
  player_id: string;
  kind: "collectif" | "lead" | "co_lead" | "badge" | "record" | "milestone";
  dedupe_key: string;
  payload: Record<string, unknown>;
};

const MILESTONES = [7, 14, 21, 30];

// Ordre d'importance quand un joueur décroche plusieurs nouveautés
// d'un coup : la plus forte fait le titre, les autres passent en corps.
const KIND_PRIORITY: FeedInsert["kind"][] = [
  "collectif",
  "lead",
  "co_lead",
  "milestone",
  "record",
  "badge",
];

/** "et Hichem se partagent la tête" — la queue d'un ex-æquo en tête,
    à accrocher derrière le prénom de l'auteur (rendu à part). */
function coLeadText(coNames: string[]): string {
  const list =
    coNames.length <= 1
      ? coNames[0] ?? ""
      : `${coNames.slice(0, -1).join(", ")} et ${coNames[coNames.length - 1]}`;
  return `et ${list} se partagent la tête`;
}

/** La phrase d'un moment, sans le prénom (même ton que le fil). */
function momentPhrase(
  kind: FeedInsert["kind"],
  payload: Record<string, unknown>,
): { emoji: string; text: string } {
  switch (kind) {
    case "collectif": {
      const pts =
        payload.points !== undefined ? `, +${payload.points} pts chacun` : "";
      return {
        emoji: "🤝",
        text: `ferme le jour parfait collectif : toute la bande à 3/3${pts}`,
      };
    }
    case "lead":
      return { emoji: "👑", text: "prend la tête du classement" };
    case "co_lead": {
      const co = Array.isArray(payload.co) ? (payload.co as string[]) : [];
      return { emoji: "👑", text: coLeadText(co) };
    }
    case "badge": {
      const b = BADGES.find((x) => x.key === payload.badge);
      return b
        ? { emoji: b.emoji, text: `décroche « ${b.label} »` }
        : { emoji: "🏅", text: "décroche un badge" };
    }
    case "record":
      return { emoji: "📈", text: `bat sa meilleure série : ${payload.streak} jours` };
    case "milestone":
      return { emoji: "⚡", text: `aligne ${payload.streak} jours parfaits d'affilée` };
  }
}

// Fenêtre de silence du push de dépassement : une notif max par
// destinataire par 4 heures, quel que soit le nombre de dépasseurs.
const OVERTAKE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** 📈 records et ⚡ milestones, dérivés des streak_pos de daily_points.
    Un seul record par série (dedupe = jour de départ de la série) :
    battre son record de 1 chaque matin ne spamme pas le fil. */
function streakMoments(rows: StreakRow[], today: string): FeedInsert[] {
  const byPlayer = new Map<string, StreakRow[]>();
  for (const r of rows) {
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }

  const out: FeedInsert[] = [];
  for (const [playerId, days] of byPlayer) {
    days.sort((a, b) => (a.day < b.day ? -1 : 1));
    const last = days[days.length - 1];
    // Série en cours seulement : dernier jour parfait = aujourd'hui ou hier
    // (même convention que current_streak dans leaderboard()).
    if (last.day < addDays(today, -1)) continue;

    const streak = Number(last.streak_pos);
    const islandStart = addDays(last.day, -(streak - 1));
    // Meilleure série AVANT celle en cours (0 si première série).
    const best = days
      .filter((d) => d.day < islandStart)
      .reduce((max, d) => Math.max(max, Number(d.streak_pos)), 0);

    // Record perso : uniquement à partir de 3 jours, sinon tout est un record.
    if (streak >= 3 && streak > best) {
      out.push({
        player_id: playerId,
        kind: "record",
        dedupe_key: islandStart,
        payload: { streak },
      });
    }
    for (const m of MILESTONES) {
      if (streak >= m) {
        out.push({
          player_id: playerId,
          kind: "milestone",
          dedupe_key: `${islandStart}:${m}`,
          payload: { streak: m },
        });
      }
    }
  }
  return out;
}

export async function POST(request: Request) {
  const { actorId } = (await request.json().catch(() => ({}))) as {
    actorId?: string;
  };
  if (!actorId) {
    return NextResponse.json({ error: "actorId requis" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const today = parisToday();
  const [lb, snaps, players, badges, streaks, todayEntries, collectifCat] =
    await Promise.all([
      supabase.rpc("leaderboard"),
      supabase.from("rank_snapshots").select("player_id, rank"),
      supabase.from("players").select("id, name"),
      supabase.from("player_badges").select("player_id, badge"),
      supabase
        .from("daily_points")
        .select("player_id, day, streak_pos")
        .gt("streak_pos", 0),
      supabase
        .from("entries")
        .select("player_id, day, pushups, abs, squats")
        .gte("day", addDays(today, -6))
        .lte("day", today),
      supabase
        .from("bonus_catalog")
        .select("points")
        .eq("key", "jour_parfait_collectif")
        .maybeSingle(),
    ]);
  if (
    lb.error ||
    snaps.error ||
    players.error ||
    badges.error ||
    streaks.error ||
    todayEntries.error
  ) {
    return NextResponse.json({ error: "lecture échouée" }, { status: 500 });
  }

  const lbRows = lb.data as LbRow[];
  const newRanks = new Map(lbRows.map((r) => [r.player_id, Number(r.rank)]));
  const oldRanks = new Map(
    (snaps.data as Snap[]).map((s) => [s.player_id, Number(s.rank)]),
  );
  const names = new Map(
    (players.data as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );

  // 📉 Dépassés par l'acteur : ils étaient devant, ils sont derrière.
  const actorOld = oldRanks.get(actorId);
  const actorNew = newRanks.get(actorId);
  const overtaken: string[] = [];
  if (actorOld !== undefined && actorNew !== undefined) {
    for (const [pid, oldRank] of oldRanks) {
      if (pid === actorId) continue;
      const newRank = newRanks.get(pid);
      if (newRank === undefined) continue;
      if (oldRank < actorOld && newRank > actorNew) overtaken.push(pid);
    }
  }
  // Plafond : verrou par destinataire (même patron atomique que
  // /api/feed-notify). L'update conditionnel ne rend que les joueurs
  // hors fenêtre de silence — les autres ont déjà été prévenus qu'ils
  // glissaient, on les laisse tranquilles 4h. Erreur → on n'envoie rien
  // (rater un push vaut mieux que spammer).
  let sent = 0;
  if (overtaken.length > 0) {
    const cutoff = new Date(Date.now() - OVERTAKE_WINDOW_MS).toISOString();
    const { data: locked } = await supabase
      .from("rank_snapshots")
      .update({ last_overtake_at: new Date().toISOString() })
      .in("player_id", overtaken)
      .or(`last_overtake_at.is.null,last_overtake_at.lt.${cutoff}`)
      .select("player_id");
    const notifiable = (locked ?? []).map((r) => r.player_id);
    if (notifiable.length > 0) {
      sent = await sendToPlayers(notifiable, {
        title: "📉 Tu viens de te faire doubler",
        body: `${names.get(actorId) ?? "Quelqu'un"} vient de te passer au classement.`,
      });
    }
  }

  // ---- Événements du feed ----
  const moments: FeedInsert[] = [];

  // 🤝 Jour parfait collectif : la coche de l'acteur vient-elle de fermer
  // la journée ? La « bande » = joueurs actifs sur 7 jours glissants —
  // même règle que la vue daily_points, un inscrit fantôme ne compte pas.
  // Une seule carte, portée par l'acteur — dédup par jour, donc
  // rejouable sans doublon même si plusieurs coches arrivent ensemble.
  const weekRows = todayEntries.data as EntryRow[];
  const nDone = (e: EntryRow) =>
    (e.pushups ? 1 : 0) + (e.abs ? 1 : 0) + (e.squats ? 1 : 0);
  const doneToday = new Map(
    weekRows.filter((e) => e.day === today).map((e) => [e.player_id, nDone(e)]),
  );
  const activeIds = new Set(
    weekRows.filter((e) => nDone(e) > 0).map((e) => e.player_id),
  );
  const playerIds = (players.data as { id: string }[]).map((p) => p.id);
  const allPerfect =
    activeIds.size >= 2 &&
    [...activeIds].every((id) => doneToday.get(id) === 3);
  if (allPerfect) {
    moments.push({
      player_id: actorId,
      kind: "collectif",
      dedupe_key: today,
      payload: {
        day: today,
        ...(collectifCat.data ? { points: Number(collectifCat.data.points) } : {}),
      },
    });
  }

  // 👑 Tête du classement. rank() rend le même rang 1 à un ex-æquo :
  // deux joueurs à égalité en tête ne "prennent" pas la tête chacun de
  // leur côté. On distingue donc le leader unique ("prend la tête") du
  // partage ("se partagent la tête"), et on ne pousse qu'un seul
  // événement — jamais deux "prend la tête" à la même seconde.
  // points > 0 évite le "tout le monde en tête" du jour 1.
  const leaders = lbRows
    .filter((r) => Number(r.rank) === 1 && Number(r.points) > 0)
    .sort((a, b) =>
      (names.get(a.player_id) ?? "").localeCompare(names.get(b.player_id) ?? ""),
    );
  // Nouveau seulement si quelqu'un vient d'arriver en tête (rang > 1
  // avant) : sinon on répéterait une tête inchangée à chaque coche.
  const leadChanged = leaders.some((r) => {
    const old = oldRanks.get(r.player_id);
    return old !== undefined && old > 1;
  });
  if (leadChanged && leaders.length === 1) {
    moments.push({
      player_id: leaders[0].player_id,
      kind: "lead",
      dedupe_key: today,
      payload: { day: today },
    });
  } else if (leadChanged && leaders.length >= 2) {
    // Ex-æquo : un seul event, porté par le premier (ordre alphabétique,
    // stable → la dédup du jour tient), les autres dans le payload.
    const [owner, ...rest] = leaders;
    moments.push({
      player_id: owner.player_id,
      kind: "co_lead",
      dedupe_key: today,
      payload: { day: today, co: rest.map((r) => names.get(r.player_id) ?? "?") },
    });
  }

  // 🏅 Badges : on pousse tout, l'unicité en base ne garde que les nouveaux.
  for (const b of badges.data as BadgeRow[]) {
    moments.push({
      player_id: b.player_id,
      kind: "badge",
      dedupe_key: b.badge,
      payload: { badge: b.badge },
    });
  }

  // 📈⚡ Records et milestones de série.
  moments.push(...streakMoments(streaks.data as StreakRow[], today));

  // 🗞️ L'upsert en ignoreDuplicates ne rend que les lignes vraiment
  // insérées : la dédup en base garantit qu'un moment ne part qu'une
  // fois en push, même si l'appel est rejoué. Erreur → data null →
  // aucun push (rater une notif vaut mieux que spammer).
  let feedPush = 0;
  if (moments.length > 0) {
    const { data: inserted } = await supabase
      .from("feed_events")
      .upsert(moments, {
        onConflict: "player_id,kind,dedupe_key",
        ignoreDuplicates: true,
      })
      .select("player_id, kind, payload");

    const byPlayer = new Map<string, FeedInsert[]>();
    for (const m of (inserted ?? []) as FeedInsert[]) {
      byPlayer.set(m.player_id, [...(byPlayer.get(m.player_id) ?? []), m]);
    }
    const allIds = playerIds;
    for (const [pid, ms] of byPlayer) {
      ms.sort(
        (a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind),
      );
      const [first, ...rest] = ms.map((m) => momentPhrase(m.kind, m.payload));
      feedPush += await sendToPlayers(
        allIds.filter((id) => id !== pid),
        {
          title: `${first.emoji} ${names.get(pid) ?? "Quelqu'un"} ${first.text}`,
          body: rest.length
            ? `Et aussi : ${rest.map((p) => p.text).join(" · ")}`
            : "Ça se passe dans le feed.",
        },
      );
    }
  }

  // On fige le nouvel état des rangs, y compris pour les sans-snapshot.
  // Surtout ne pas inclure last_overtake_at ici : PostgREST en merge ne
  // touche que les colonnes fournies, le verrou de 4h doit survivre.
  const upserts = lbRows.map((r) => ({
    player_id: r.player_id,
    rank: r.rank,
    points: r.points,
    updated_at: new Date().toISOString(),
  }));
  await supabase
    .from("rank_snapshots")
    .upsert(upserts, { onConflict: "player_id" });

  return NextResponse.json({
    overtaken: overtaken.length,
    sent,
    moments: moments.length,
    feedPush,
  });
}
