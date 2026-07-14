"use client";

// Le cœur data de l'app : joueurs + entrées, écritures optimistes.
// L'écran change instantanément, Supabase suit derrière, rollback si échec.

import { useCallback, useEffect, useRef, useState } from "react";
import { CHALLENGE_END, CHALLENGE_START } from "@/lib/challenge";
import { nextColor, normalizeName } from "@/lib/palette";
import { supabase } from "@/lib/supabase";
import { Entry, entryKey, Exercise, Player } from "@/lib/types";

/** Traduit une erreur Postgres (message des triggers) en phrase humaine. */
function humanError(message: string): string {
  if (message.includes("JOUR_VERROUILLE")) return "Ce jour est verrouillé 🔒";
  if (message.includes("JOUR_FUTUR")) return "On ne coche pas en avance";
  if (message.includes("JOUEUR_INDESTRUCTIBLE"))
    return "Ce joueur a déjà coché, il est indestructible";
  if (message.includes("CAP_JOUEURS")) return "Groupe complet : 12 joueurs max";
  return "Écriture échouée, re-tape pour réessayer";
}

export type CreateResult =
  | { status: "created"; player: Player }
  | { status: "duplicate"; player: Player }
  | { status: "error" };

export function useChallengeData() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  /** Recharge tout. 12 joueurs × 50 jours max : une seule requête suffit. */
  const refresh = useCallback(async () => {
    const [p, e] = await Promise.all([
      supabase.from("players").select("*").order("created_at"),
      supabase
        .from("entries")
        .select("player_id, day, pushups, abs, squats")
        .gte("day", CHALLENGE_START)
        .lte("day", CHALLENGE_END),
    ]);
    if (p.error || e.error) {
      setOffline(true);
      // premier chargement raté : on affiche quand même l'app (cache SW)
      setPlayers((prev) => prev ?? []);
      return;
    }
    setOffline(false);
    setPlayers(p.data as Player[]);
    const map = new Map<string, Entry>();
    for (const row of e.data as Entry[]) {
      map.set(entryKey(row.player_id, row.day), row);
    }
    setEntries(map);
  }, []);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  /** Bascule un exo. Optimiste : état local d'abord, rollback si la base dit non. */
  const toggleExercise = useCallback(
    async (playerId: string, day: string, exo: Exercise) => {
      const key = entryKey(playerId, day);
      const before = entries.get(key);
      const next: Entry = {
        player_id: playerId,
        day,
        pushups: before?.pushups ?? false,
        abs: before?.abs ?? false,
        squats: before?.squats ?? false,
        [exo]: !(before?.[exo] ?? false),
      };
      setEntries((prev) => new Map(prev).set(key, next));

      const { error } = await supabase
        .from("entries")
        .upsert(next, { onConflict: "player_id,day" });
      if (error) {
        // rollback visible : on ne fait pas semblant
        setEntries((prev) => {
          const map = new Map(prev);
          if (before) map.set(key, before);
          else map.delete(key);
          return map;
        });
        showToast(humanError(error.message));
      }
    },
    [entries, showToast],
  );

  /** Upsert en masse pour le raccourci "tout parfait" du rattrapage. */
  const markAllPerfect = useCallback(
    async (playerId: string, days: string[]) => {
      const rows: Entry[] = days.map((day) => ({
        player_id: playerId,
        day,
        pushups: true,
        abs: true,
        squats: true,
      }));
      const beforeMap = entries;
      setEntries((prev) => {
        const map = new Map(prev);
        for (const row of rows) map.set(entryKey(playerId, row.day), row);
        return map;
      });
      const { error } = await supabase
        .from("entries")
        .upsert(rows, { onConflict: "player_id,day" });
      if (error) {
        setEntries(beforeMap);
        showToast(humanError(error.message));
      }
    },
    [entries, showToast],
  );

  /** Création d'un joueur, doublons gérés (cache vidé, retour au bercail). */
  const createPlayer = useCallback(
    async (rawName: string): Promise<CreateResult> => {
      const name = rawName.trim();
      const existing = (players ?? []).find(
        (p) => normalizeName(p.name) === normalizeName(name),
      );
      if (existing) return { status: "duplicate", player: existing };

      const { data, error } = await supabase
        .from("players")
        .insert({ name, color: nextColor(players?.length ?? 0) })
        .select()
        .single();
      if (error) {
        // 23505 = course sur l'index unique : quelqu'un vient de le créer
        if (error.code === "23505") {
          await refresh();
          const winner = (players ?? []).find(
            (p) => normalizeName(p.name) === normalizeName(name),
          );
          if (winner) return { status: "duplicate", player: winner };
        }
        showToast(humanError(error.message));
        return { status: "error" };
      }
      const player = data as Player;
      setPlayers((prev) => [...(prev ?? []), player]);
      return { status: "created", player };
    },
    [players, refresh, showToast],
  );

  /** Suppression d'un joueur fantôme. La base refuse s'il a des entrées. */
  const deletePlayer = useCallback(
    async (playerId: string) => {
      const { error } = await supabase
        .from("players")
        .delete()
        .eq("id", playerId);
      if (error) {
        showToast(humanError(error.message));
        return false;
      }
      setPlayers((prev) => (prev ?? []).filter((p) => p.id !== playerId));
      return true;
    },
    [showToast],
  );

  /** Verrouille le rattrapage initial. Irréversible (trigger en base). */
  const closeBackfill = useCallback(
    async (playerId: string) => {
      const closedAt = new Date().toISOString();
      const { error } = await supabase
        .from("players")
        .update({ backfill_closed_at: closedAt })
        .eq("id", playerId);
      if (error) {
        showToast(humanError(error.message));
        return false;
      }
      setPlayers((prev) =>
        (prev ?? []).map((p) =>
          p.id === playerId ? { ...p, backfill_closed_at: closedAt } : p,
        ),
      );
      return true;
    },
    [showToast],
  );

  return {
    players,
    entries,
    offline,
    toast,
    showToast,
    refresh,
    toggleExercise,
    markAllPerfect,
    createPlayer,
    deletePlayer,
    closeBackfill,
  };
}

export type ChallengeData = ReturnType<typeof useChallengeData>;
