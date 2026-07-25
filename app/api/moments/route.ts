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
import {
  type VolumeClaim,
  volumeDedupeKey,
  volumeRecords,
} from "@/lib/records";
import {
  isAuthorizedApp,
  parisToday,
  sendToPlayers,
  serverSupabase,
} from "@/lib/server/push";

export const dynamic = "force-dynamic";

type LbRow = { player_id: string; rank: number; points: number };
type Snap = { player_id: string; rank: number };
type BadgeRow = { player_id: string; badge: string };
type StreakRow = { player_id: string; day: string; streak_pos: number };
type JokerRow = { player_id: string; day: string };
type EntryRow = {
  player_id: string;
  day: string;
  pushups: boolean;
  abs: boolean;
  squats: boolean;
};
type LadderRow = { key: string; ladder: string | null };
type FeedInsert = {
  player_id: string;
  kind:
    | "collectif"
    | "lead"
    | "co_lead"
    | "badge"
    | "record"
    | "milestone"
    | "joker"
    | "premier";
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
  // Le joker passe devant milestone et record : il n'arrive qu'une fois
  // par joueur sur tout le challenge, et c'est lui l'histoire du soir.
  "joker",
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
    case "joker":
      return {
        emoji: "🛟",
        text: `a brûlé son joker — sa série de ${payload.streak} jours tient`,
      };
    case "record":
      // Deux familles sous le même kind, discriminées par le payload (même
      // règle que lib/feed.ts) : `reps` présent = record de volume, sinon
      // record de série. Celui de volume ne part jamais en push (filtré
      // plus bas), cette branche ne sert donc que l'exhaustivité.
      return payload.reps !== undefined
        ? {
            emoji: "💥",
            text: `explose son record de rab : ${payload.reps} répétitions, contre ${payload.before} avant`,
          }
        : { emoji: "📈", text: `bat sa meilleure série : ${payload.streak} jours` };
    case "milestone":
      return { emoji: "⚡", text: `aligne ${payload.streak} jours parfaits d'affilée` };
    case "premier":
      // Rendu réel côté client (lib/feed.ts) : cette carte n'est jamais
      // poussée, donc cette branche ne sert qu'à l'exhaustivité du switch.
      return { emoji: "🌅", text: "a fini premier" };
  }
}

// Fenêtre de silence du push de dépassement : une notif max par
// destinataire par 4 heures, quel que soit le nombre de dépasseurs.
const OVERTAKE_WINDOW_MS = 4 * 60 * 60 * 1000;

/** 📈 records et ⚡ milestones, dérivés des streak_pos de daily_points.
    Un seul record par série (dedupe = jour de départ de la série) :
    battre son record de 1 chaque matin ne spamme pas le fil. */
function streakMoments(
  rows: StreakRow[],
  jokerDays: Map<string, string>,
  today: string,
): FeedInsert[] {
  const byPlayer = new Map<string, StreakRow[]>();
  for (const r of rows) {
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }

  const out: FeedInsert[] = [];
  for (const [playerId, days] of byPlayer) {
    days.sort((a, b) => (a.day < b.day ? -1 : 1));
    const last = days[days.length - 1];

    // 🛟 Le joker brûlé : annoncé une fois, dès qu'il existe. Le chiffre
    // gelé dans le payload est la série de la VEILLE du trou — ce qui
    // était en jeu. Dédup par jour du joker : un seul par challenge.
    const jokerDay = jokerDays.get(playerId);
    if (jokerDay) {
      const before = days.find((d) => d.day === addDays(jokerDay, -1));
      if (before) {
        out.push({
          player_id: playerId,
          kind: "joker",
          dedupe_key: jokerDay,
          payload: { streak: Number(before.streak_pos), day: jokerDay },
        });
      }
    }

    // Série en cours seulement : dernier jour parfait = aujourd'hui ou hier
    // (même convention que current_streak dans leaderboard()).
    if (last.day < addDays(today, -1)) continue;

    const streak = Number(last.streak_pos);
    // Le jour joker occupe une case du calendrier sans compter dans
    // streak_pos : l'île commence donc un jour plus tôt que la longueur
    // de la série ne le laisse croire. Sans ce rattrapage, le dedupe_key
    // des records glisse d'un jour le soir où le joker est brûlé, et le
    // fil réannonce le même record sous une nouvelle clé.
    let islandStart = addDays(last.day, -(streak - 1));
    if (jokerDay && jokerDay < last.day && jokerDay >= addDays(islandStart, -1)) {
      islandStart = addDays(islandStart, -1);
    }
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
  if (!isAuthorizedApp(request)) {
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const { actorId } = (await request.json().catch(() => ({}))) as {
    actorId?: string;
  };
  if (!actorId) {
    return NextResponse.json({ error: "actorId requis" }, { status: 400 });
  }

  const supabase = serverSupabase();
  const today = parisToday();
  const [
    lb,
    snaps,
    players,
    badges,
    streaks,
    jokers,
    premierYesterday,
    premierCat,
    todayEntries,
    collectifCat,
    ladders,
    volumeClaims,
  ] = await Promise.all([
      supabase.rpc("leaderboard"),
      supabase.from("rank_snapshots").select("player_id, rank"),
      supabase.from("players").select("id, name"),
      supabase.from("player_badges").select("player_id, badge"),
      supabase
        .from("daily_points")
        .select("player_id, day, streak_pos")
        .gt("streak_pos", 0),
      supabase
        .from("daily_points")
        .select("player_id, day")
        .eq("jokered", true),
      // 🌅 Le « premier du jour » de la VEILLE : le trophée est attribué
      // une fois la journée finie (rotation comprise), donc c'est hier
      // qu'on connaît le gagnant. Au plus une ligne.
      supabase
        .from("daily_points")
        .select("player_id")
        .eq("day", addDays(today, -1))
        .eq("premier_du_jour", true)
        .maybeSingle(),
      supabase
        .from("bonus_catalog")
        .select("points")
        .eq("key", "premier_du_jour")
        .maybeSingle(),
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
      // 💥 Record de volume : l'échelle de chaque bonus (pompes / abdos /
      // squats = le contrat, null ou autre = un à-côté) et toutes les
      // déclarations, tous jours confondus — le record est à vie, il ne se
      // borne pas à une fenêtre. Non filtré côté base : une liste de clés
      // en dur se périmerait au premier palier ajouté au catalogue, et le
      // volume reste modeste (123 lignes après 11 jours à six joueurs).
      supabase.from("bonus_catalog").select("key, ladder"),
      supabase.from("bonus_claims").select("player_id, day, bonus_key"),
    ]);
  if (
    lb.error ||
    snaps.error ||
    players.error ||
    badges.error ||
    streaks.error ||
    todayEntries.error
    // jokers/premier/volume volontairement absents : cette route porte aussi
    // les records, les milestones, le jour parfait collectif et les push de
    // dépassement. Perdre l'annonce d'un joker ou d'un premier du jour vaut
    // infiniment mieux que faire tomber tout le reste en 500. On dégrade,
    // on ne casse pas. Le bloc volume se saute en entier si l'une de ses
    // deux lectures a échoué : sur des données partielles il annoncerait un
    // faux record, ou retirerait une carte vraie.
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
  // Les jours joker ont un streak_pos nul : ils sont hors de la requête
  // `streaks` ci-dessus, d'où cette lecture séparée. Au plus une ligne
  // par joueur — un seul joker pour tout le challenge.
  const jokerDays = new Map(
    ((jokers.data ?? []) as JokerRow[]).map((j) => [j.player_id, j.day]),
  );
  moments.push(
    ...streakMoments(streaks.data as StreakRow[], jokerDays, today),
  );

  // 💥 Record de volume : le joueur bat sa propre meilleure journée de rab.
  // Aucun point en jeu — c'est une carte de fil, la seule mécanique où le
  // dernier du classement peut gagner quelque chose. Dédup par jour, donc
  // deux déclarations qui franchissent le seuil dans la soirée ne font
  // qu'une carte.
  //
  // Cette route est appelée après chaque déclaration de bonus (useBonus →
  // onBonusScored → rescore → notifyMoments), donc la détection tombe juste
  // après le geste qui la déclenche.
  let volumeToClear: string[] = [];
  if (!ladders.error && !volumeClaims.error) {
    const ladderOf = new Map(
      (ladders.data as LadderRow[]).map((c) => [c.key, c.ladder]),
    );
    const { records, abandoned } = volumeRecords(
      volumeClaims.data as VolumeClaim[],
      ladderOf,
      today,
    );
    for (const r of records) {
      moments.push({
        player_id: r.player_id,
        kind: "record",
        dedupe_key: volumeDedupeKey(r.day),
        payload: { day: r.day, reps: r.reps, before: r.before },
      });
    }
    // Le décochage passe par la même route : qui retire sa déclaration
    // repasse sous son record, et la carte se met à mentir. Elle part.
    // L'appli a deux comportements opposés et c'est assumé — un bonus
    // annulé garde sa carte, une séance décochée perd la sienne (migration
    // 26). Un record appartient à la seconde famille : c'est une
    // affirmation sur l'histoire du joueur, pas sur son geste du soir.
    //
    // Les joueurs abandonnés sont épargnés : on ne sait pas s'ils ont le
    // record, donc on ne retire rien.
    const withRecord = new Set(records.map((r) => r.player_id));
    volumeToClear = playerIds.filter(
      (id) => !withRecord.has(id) && !abandoned.has(id),
    );
  }
  if (volumeToClear.length > 0) {
    // Le préfixe `vol:` ne peut appartenir qu'à un record de volume : celui
    // de série se dédup sur une date nue. La suppression est donc précise,
    // elle n'atteindra jamais une carte de série.
    await supabase
      .from("feed_events")
      .delete()
      .eq("kind", "record")
      .eq("dedupe_key", volumeDedupeKey(today))
      .in("player_id", volumeToClear);
  }

  // 🌅 Premier du jour : le gagnant de la VEILLE (le trophée se décerne
  // une fois la journée finie, rotation comprise). Une carte par jour,
  // dédup par jour. Volontairement HORS push (voir plus bas) : un premier
  // quotidien poussé à six serait le bruit que le produit refuse — la
  // carte se découvre en ouvrant le fil, comme le « premier à terminer »
  // vivait déjà, sans notif, dans le détail des points.
  const premierId = (premierYesterday.data as { player_id: string } | null)
    ?.player_id;
  if (premierId) {
    const yesterday = addDays(today, -1);
    moments.push({
      player_id: premierId,
      kind: "premier",
      dedupe_key: yesterday,
      payload: {
        day: yesterday,
        ...(premierCat.data ? { points: Number(premierCat.data.points) } : {}),
      },
    });
  }

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

    // Le « premier du jour » entre bien dans le fil (inséré ci-dessus)
    // mais ne part JAMAIS en push : on le retire avant de grouper les
    // notifs. Un joueur qui n'a que ça de neuf ne reçoit donc rien.
    const byPlayer = new Map<string, FeedInsert[]>();
    for (const m of (inserted ?? []) as FeedInsert[]) {
      if (m.kind === "premier") continue;
      // Le record de volume non plus ne part jamais en push. À une carte
      // par jour environ pour le groupe, ce serait une notification de plus
      // par jour pour cinq personnes — l'appli motive, elle ne harcèle pas.
      // Un record personnel se découvre très bien en ouvrant le fil. Le
      // record de SÉRIE, lui, continue de partir : d'où le test du payload
      // et pas du kind.
      if (m.kind === "record" && m.payload.reps !== undefined) continue;
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
