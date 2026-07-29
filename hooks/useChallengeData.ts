"use client";

// Le cœur data de l'app : joueurs + entrées, écritures optimistes.
// L'écran change instantanément, Supabase suit derrière, rollback si échec.

import { useCallback, useEffect, useRef, useState } from "react";
import { useFenetre, useLigueCourante } from "@/components/ligue/LigueContexte";
import { parisToday } from "@/lib/challenge";
import { nextColor, normalizeName } from "@/lib/palette";
import { SUPABASE_SCHEMA, supabase } from "@/lib/supabase";
import { Entry, entryCount, entryKey, Exercise, Player } from "@/lib/types";

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
  const ligue = useLigueCourante();
  // Les bornes, pas l'objet : la `Fenetre` est recréée à chaque ligue, et
  // deux chaînes en dépendances valent mieux qu'un objet à comparer.
  const { start: debut, end: fin } = useFenetre();
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [entries, setEntries] = useState<Map<string, Entry>>(new Map());
  // Horodatage (ms) de la dernière coche MONTANTE de chaque joueur,
  // reçue en temps réel — c'est ce qui fait pulser la ligne des potes.
  const [liveChecks, setLiveChecks] = useState<Map<string, number>>(new Map());
  const [offline, setOffline] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Miroir de `entries` pour comparer avant/après dans le handler realtime
  // sans effet de bord dans un updater React.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  // Les joueurs que cet appareil connaît — c'est-à-dire ceux de sa ligue.
  // Sert à trier les événements temps réel : voir l'abonnement plus bas.
  // `null` = on ne sait pas encore qui joue ici. Distinct d'un ensemble
  // vide, qui voudrait dire « personne » — et ferait jeter les coches.
  const knownPlayersRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    knownPlayersRef.current = players
      ? new Set(players.map((p) => p.id))
      : null;
  }, [players]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  /**
   * Recharge tout. 12 joueurs × 42 jours max : une seule requête suffit.
   *
   * Les deux requêtes sont cadrées sur la ligue. Pour les joueurs c'est un
   * simple `league_id`. Pour les coches il n'y a pas de colonne à filtrer —
   * une entry appartient à un joueur, qui appartient à une ligue — d'où la
   * jointure interne `players!inner(league_id)` : PostgREST ne rend que les
   * coches dont le joueur est dans la ligue, en un seul aller-retour.
   *
   * Sans ce filtre, deux ligues actives sur des dates qui se chevauchent se
   * voient l'une l'autre : mesuré sur la preview, deux coches remontaient là
   * où il n'en fallait qu'une.
   */
  const refresh = useCallback(async () => {
    const colonnes = ligue
      ? "player_id, day, pushups, abs, squats, players!inner(league_id)"
      : "player_id, day, pushups, abs, squats";

    let joueurs = supabase.from("players").select("*").order("created_at");
    if (ligue) joueurs = joueurs.eq("league_id", ligue.id);

    let coches = supabase
      .from("entries")
      .select(colonnes)
      .gte("day", debut)
      .lte("day", fin);
    if (ligue) coches = coches.eq("players.league_id", ligue.id);

    const [p, e] = await Promise.all([joueurs, coches]);
    if (p.error || e.error) {
      setOffline(true);
      // premier chargement raté : on affiche quand même l'app (cache SW)
      setPlayers((prev) => prev ?? []);
      return;
    }
    setOffline(false);
    setPlayers(p.data as Player[]);
    const map = new Map<string, Entry>();
    // Champ par champ : la jointure ajoute un objet `players` dont personne
    // n'a besoin ici, et qui n'a rien à faire dans une `Entry`.
    for (const row of e.data as unknown as Entry[]) {
      map.set(entryKey(row.player_id, row.day), {
        player_id: row.player_id,
        day: row.day,
        pushups: row.pushups,
        abs: row.abs,
        squats: row.squats,
      });
    }
    setEntries(map);
  }, [ligue, debut, fin]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // Temps réel : la coche d'un pote arrive toute seule, sans re-fetch.
  // À 23h tout le monde est dans la même fenêtre — voir que l'autre vient
  // de finir pendant qu'on hésite, c'est la mécanique du produit en direct.
  //
  // L'abonnement porte sur TOUTE la table `entries`. Avec plusieurs ligues dans
  // le même schéma, cet appareil reçoit donc aussi les coches des autres
  // ligues : sans filtre, la ligne des potes se mettrait à pulser pour des
  // inconnus. On trie côté client — le hook connaît déjà les joueurs de sa
  // ligue, un événement dont le player_id n'y est pas est ignoré.
  //
  // Aujourd'hui ce filtre ne change rien (une seule ligue, tout le monde est
  // connu). Au volume visé — une poignée de ligues — c'est suffisant, et ça
  // évite un canal Supabase par ligue.
  useEffect(() => {
    const channel = supabase
      .channel("entries-live")
      .on(
        "postgres_changes",
        { event: "*", schema: SUPABASE_SCHEMA, table: "entries" },
        (payload) => {
          const row = payload.new as Entry | undefined;
          if (!row?.player_id || !row.day) return; // DELETE : new est vide
          // Joueur d'une autre ligue : on ne l'affiche pas, on ne le stocke pas.
          // Tant que la liste n'est pas chargée, on ne trie pas : jeter une
          // coche parce qu'on ne sait pas encore qui joue, c'est perdre
          // exactement le moment que le temps réel existe pour montrer.
          const connus = knownPlayersRef.current;
          if (connus && !connus.has(row.player_id)) return;
          const key = entryKey(row.player_id, row.day);
          const before = entriesRef.current.get(key);
          const next: Entry = {
            player_id: row.player_id,
            day: row.day,
            pushups: row.pushups,
            abs: row.abs,
            squats: row.squats,
          };
          setEntries((prev) => new Map(prev).set(key, next));
          // Seules les hausses du jour font pulser : cocher, pas corriger.
          if (row.day === parisToday() && entryCount(next) > entryCount(before)) {
            setLiveChecks((prev) => new Map(prev).set(row.player_id, Date.now()));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

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

  /** Force des exos à "fait" sans jamais en décocher (fin de séance
      guidée). Même chemin que toggleExercise : optimiste + rollback. */
  const setExercisesDone = useCallback(
    async (playerId: string, day: string, exos: Exercise[]) => {
      if (exos.length === 0) return true;
      const key = entryKey(playerId, day);
      const before = entries.get(key);
      const next: Entry = {
        player_id: playerId,
        day,
        pushups: before?.pushups ?? false,
        abs: before?.abs ?? false,
        squats: before?.squats ?? false,
      };
      for (const exo of exos) next[exo] = true;
      if (before && exos.every((e) => before[e])) return true; // rien à écrire
      setEntries((prev) => new Map(prev).set(key, next));

      const { error } = await supabase
        .from("entries")
        .upsert(next, { onConflict: "player_id,day" });
      if (error) {
        setEntries((prev) => {
          const map = new Map(prev);
          if (before) map.set(key, before);
          else map.delete(key);
          return map;
        });
        showToast(humanError(error.message));
        return false;
      }
      return true;
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
        .insert({
          name,
          color: nextColor(players?.length ?? 0),
          // `league_id` n'existe pas dans `public` : on ne l'envoie que si
          // l'app tourne effectivement en multi-ligues.
          ...(ligue ? { league_id: ligue.id } : {}),
        })
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
    [players, refresh, showToast, ligue],
  );

  /** Photo de profil : écriture optimiste, rollback si la base refuse.
      La photo est déjà réduite en data-URI côté client (lib/image.ts). */
  const setPhoto = useCallback(
    async (playerId: string, photo: string) => {
      const before =
        (players ?? []).find((p) => p.id === playerId)?.photo ?? null;
      setPlayers((prev) =>
        (prev ?? []).map((p) => (p.id === playerId ? { ...p, photo } : p)),
      );

      const { error } = await supabase
        .from("players")
        .update({ photo })
        .eq("id", playerId);
      if (error) {
        setPlayers((prev) =>
          (prev ?? []).map((p) =>
            p.id === playerId ? { ...p, photo: before } : p,
          ),
        );
        showToast("Photo non enregistrée, réessaie");
        return false;
      }
      return true;
    },
    [players, showToast],
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

  return {
    players,
    entries,
    liveChecks,
    offline,
    toast,
    showToast,
    refresh,
    toggleExercise,
    setExercisesDone,
    createPlayer,
    deletePlayer,
    setPhoto,
  };
}

export type ChallengeData = ReturnType<typeof useChallengeData>;
