"use client";

// La ligne de statut : une seule phrase sous le header, tappable vers le
// classement. Rang et série cohabitent — et le soir, quand la série est
// en jeu, elle prend toute la place : c'est la peur de la casser qui fait
// cocher, pas l'écart de points. Le détail (écarts, paliers) vit au
// Classement, un tap plus loin.
//
// Quand la série monte, la ligne se remplit à la couleur du joueur le
// temps que le chiffre bascule. Le déclencheur n'est pas le tap mais
// l'arrivée de la nouvelle valeur serveur — voir StreakCount.

import { useCallback, useEffect, useState } from "react";
import { daysLeft, parisToday } from "@/lib/challenge";
import { fmtPoints, frenchRank, Gamification } from "@/lib/gamification";
import { streakEnSursis } from "@/lib/stats";
import { Entry, Player } from "@/lib/types";
import StreakCount from "./StreakCount";
import { IconJoker, Skeleton } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  players: Player[];
  /** Pour la série en sursis : le serveur ne la connaît pas encore. */
  entries: Map<string, Entry>;
  gamification: Gamification | null;
  /** Les reprises sont épuisées : on ne fera plus patienter personne. */
  enPanne: boolean;
  perfect: boolean; // le 3/3 du jour est-il déjà fait ?
  onGoLeaderboard: () => void;
  /** 😴 Aujourd'hui est le jour off du groupe. */
  jourOff: boolean;
};

/** Durée du beat de fond, alignée sur .streak-beat dans globals.css. */
const BEAT_MS = 1500;

/** ×1 avant 3 jours parfaits consécutifs, ×1,5 dès 3, ×2 dès 7.
    Même barème que la vue daily_points — copie assumée, 3 lignes. */
function multFor(pos: number): number {
  return pos >= 7 ? 2 : pos >= 3 ? 1.5 : 1;
}

/** "×1,5" / "×2" */
function fmtMult(m: number): string {
  return `×${String(m).replace(".", ",")}`;
}

export default function RankLine({
  player,
  players,
  entries,
  gamification,
  enPanne,
  perfect,
  jourOff,
  onGoLeaderboard,
}: Props) {
  const f = useFenetre();
  const [beating, setBeating] = useState(false);
  const onIncrement = useCallback(() => setBeating(true), []);
  useEffect(() => {
    if (!beating) return;
    const t = setTimeout(() => setBeating(false), BEAT_MS);
    return () => clearTimeout(t);
  }, [beating]);

  if (players.length < 2) return null;
  // Le classement met ~500 ms à revenir du serveur. Sans rien à cette
  // place, la ligne surgit après coup et pousse les trois cartes vers le
  // bas — au moment précis où le pouce descend vers la première.
  //
  // En panne, en revanche, on ne fait plus patienter : un bloc qui respire
  // sans fin promet une ligne qui ne viendra pas. La page perd sa ligne de
  // statut comme avant, et le Classement, lui, explique et propose de
  // réessayer — c'est là que la question se pose.
  if (!gamification)
    return enPanne ? null : (
      <div role="status" aria-label="Classement en cours de chargement">
        <Skeleton className="mt-3" h={41} radius={16} />
      </div>
    );

  const rows = [...gamification.total].sort((a, b) => a.rank - b.rank);
  const mine = rows.find((r) => r.player_id === player.id);
  if (!mine) return null;

  // current_streak inclut le jour même s'il est à 3/3, et reste vivant si
  // le dernier jour parfait est hier (la série ne casse qu'à minuit).
  const streak = mine.current_streak;

  // La série que le joker peut encore rattraper. Nulle sauf le lendemain
  // d'un trou unique, joker intact — voir streakEnSursis.
  // 😴 Un jour off, rien n'est en jeu et rien n'est en sursis : c'est
  // toute la promesse du jour. Sans ces deux gardes, cette ligne dirait
  // « Série : 12 j en jeu » trois centimètres sous le bandeau qui vient
  // d'annoncer que la série tient sans rien cocher — et c'est la ligne
  // du soir, celle qu'on lit dans son lit. On retombe alors sur
  // l'affichage neutre (🏆 rang · points · 🔥 série), qui dit la série
  // sans la menacer.
  const sursis =
    !perfect && streak === 0 && !jourOff
      ? streakEnSursis(player.id, entries, mine.joker_day, parisToday())
      : 0;

  // ReactNode et plus string : la bouée du joker est dessinée depuis le
  // 31/07 (l'emoji 🛟 est un anneau sombre, invisible sur ce fond), là où
  // le 🔥 et le 🏆 restent des emoji — eux se voient très bien.
  let emoji: React.ReactNode;
  let body: React.ReactNode;

  if (sursis > 0) {
    // Le seul moment où cette ligne parle du joker : celui où il peut
    // encore servir. Le reste du temps son état vit au Classement.
    //
    // La phrase nomme le prix (le joker part) en même temps que le gain :
    // une règle qui touche au score et qu'on découvre après coup passe
    // pour de la triche, c'est la raison d'être de la migration 24. Elle
    // ne promet rien de faux — si le 3/3 ne vient pas, rien ne se déclenche
    // et la série tombe, ce qu'elle faisait déjà en silence.
    emoji = <IconJoker size={15} className="inline-block align-[-2px]" />;
    body = `Série de ${sursis} j en sursis — ton joker la sauve si tu fais ton 3/3`;
  } else if (!perfect && streak > 0 && !jourOff) {
    // La série est en jeu : la phrase du soir, celle qui fait cocher.
    // Rien n'a encore bougé, donc pas de compteur animé ici.
    emoji = "🔥";
    const posIfDone = streak + 1;
    const multIfDone = multFor(posIfDone);
    if (multIfDone > 1) {
      body = `Série : ${streak} j en jeu — ton 3/3 vaut ${fmtMult(multIfDone)}`;
    } else if (daysLeft(f) - 1 >= 3 - posIfDone) {
      // posIfDone < 3 ⇒ le ×1,5 tombe dans (3 - posIfDone) jours
      const k = 3 - posIfDone;
      body = `Série : ${streak} j en jeu — ×1,5 ${k === 1 ? "demain" : `dans ${k} j`}`;
    } else {
      body = `Série : ${streak} j en jeu`;
    }
  } else {
    emoji = "🏆";
    const head = `${frenchRank(mine.rank)} · ${fmtPoints(mine.points)} pts`;
    if (streak > 0) {
      const mult = multFor(streak);
      // Le prochain palier n'est annoncé que s'il tombe demain (le hook le
      // plus fort) et avant la fin du challenge — pas de promesse en l'air.
      const next = streak < 3 ? 3 : streak < 7 ? 7 : null;
      const tail =
        next && next - streak === 1 && daysLeft(f) > 1
          ? ` — ${fmtMult(multFor(next))} demain`
          : "";
      body = (
        <>
          {head} · 🔥 <StreakCount value={streak} onIncrement={onIncrement} /> j
          {mult > 1 ? ` ${fmtMult(mult)}` : ""}
          {tail}
        </>
      );
    } else {
      body = head;
    }
  }

  return (
    <button
      onClick={onGoLeaderboard}
      className={`mt-3 w-full rounded-2xl px-4 py-2.5 text-left text-sm font-bold ${beating ? "streak-beat" : ""}`}
      style={{
        background: `color-mix(in oklch, ${player.color} 10%, var(--color-surface))`,
        color: player.color,
      }}
    >
      <span aria-hidden>{emoji}</span> {body}
    </button>
  );
}
