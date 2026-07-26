"use client";

// Le déroulé d'une séance bonus : bloc → repos → bloc → … → fin.
// La composition, elle, vit dans BonusPlanner. Ce fichier ne fait
// qu'exécuter la suite qu'on lui donne — et déclarer ce qui est fait.

import { useEffect, useRef, useState } from "react";
import { BonusCatalogItem } from "@/lib/bonus";
import { fmtPoints } from "@/lib/gamification";
import { Player } from "@/lib/types";
import {
  PlanBlock,
  planLabel,
  planMinutes,
  REST_MINUTES,
  zoneLabel,
} from "@/lib/bonusPlan";

export default function BonusRun({
  player,
  blocks,
  catalog,
  claimedKeys,
  onClaim,
  onQuit,
}: {
  player: Player;
  blocks: PlanBlock[];
  catalog: BonusCatalogItem[];
  claimedKeys: Set<string>;
  onClaim: (item: BonusCatalogItem) => void;
  onQuit: () => void;
}) {
  const [i, setI] = useState(0);
  const [resting, setResting] = useState(false);
  const [left, setLeft] = useState(0);
  // Ce qui a été déclaré pendant cette séance : l'écran de fin dit la
  // vérité même si un bloc a été sauté en route.
  const [done, setDone] = useState<PlanBlock[]>([]);
  // Les libellés sont figés au lancement : déclarer un palier change le
  // « de plus » des autres, et une ligne qui se réécrit sous les yeux au
  // milieu d'une séance donne l'impression d'un bug.
  const labels = useRef(
    new Map(blocks.map((b) => [b.key, planLabel(b, claimedKeys, catalog)])),
  );
  const label = (b: PlanBlock) => labels.current.get(b.key) ?? b.label;

  useEffect(() => {
    if (!resting) return;
    const t = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [resting]);

  useEffect(() => {
    if (resting && left === 0) setResting(false);
  }, [resting, left]);

  /** Bloc terminé : on le déclare, puis repos (ou fin). Le tap vaut la
      déclaration — c'est le même geste volontaire que sur la feuille,
      fait au bon moment plutôt qu'en fin de séance. */
  function finishBlock() {
    navigator.vibrate?.(18);
    const b = blocks[i];
    onClaim(b);
    setDone((d) => [...d, b]);
    if (i + 1 >= blocks.length) {
      setI(blocks.length);
      return;
    }
    setI(i + 1);
    setLeft(REST_MINUTES * 60);
    setResting(true);
  }

  if (i >= blocks.length) {
    const points = done.reduce((s, b) => s + b.points, 0);
    return (
      <div className="celebrate-bg -mx-5 flex min-h-full flex-col px-5">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="rise-in text-2xl font-bold" style={{ color: player.color }}>
            Séance bonus bouclée 💪
          </p>
          <p className="num-display mt-4 text-8xl">+{fmtPoints(points)}</p>
          <p className="mt-1 text-sm font-medium text-muted">
            {done.length} bloc{done.length > 1 ? "s" : ""} déclaré
            {done.length > 1 ? "s" : ""} · {planMinutes(done)} min
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {done.map((b) => (
              <span
                key={b.key}
                className="rounded-full px-3 py-2 text-sm font-bold"
                style={{
                  background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                  boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 65%, transparent)`,
                  color: player.color,
                }}
              >
                <span aria-hidden>{b.emoji}</span> {label(b)} ✓
              </span>
            ))}
          </div>
          <p className="mt-6 text-[13px] text-muted">
            Tout est déclaré. Une erreur ? Décoche-la dans la feuille de bonus.
          </p>
        </div>
        <button
          onClick={onQuit}
          className="mb-2 min-h-14 w-full rounded-2xl text-base font-bold transition-transform active:scale-[0.98]"
          style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
        >
          Fermer
        </button>
      </div>
    );
  }

  // Pendant le repos, `cur` est déjà le bloc SUIVANT : `i` avance dès que
  // le bloc est terminé, le repos appartient à ce qui vient.
  const cur = blocks[i];
  const progress = done.length / blocks.length;

  return (
    <div className="flex min-h-full flex-col">
      <p className="mt-4 text-center text-sm font-bold text-muted">
        {resting ? `Repos — bloc ${i + 1}/${blocks.length} ensuite` : `Bloc ${i + 1}/${blocks.length}`}
      </p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${progress * 100}%`, background: player.color }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        {resting ? (
          <>
            <p className="num-display text-8xl" style={{ color: player.color }}>
              {left}
            </p>
            <p className="mt-1 text-sm font-medium text-muted">
              secondes de repos
            </p>
            <p className="mt-8 text-lg font-bold">
              Ensuite : <span aria-hidden>{cur.emoji}</span> {label(cur)}
            </p>
          </>
        ) : (
          <>
            <p className="text-6xl" aria-hidden>
              {cur.emoji}
            </p>
            <p className="mt-4 text-3xl font-bold">{label(cur)}</p>
            <p className="mt-2 text-sm font-medium text-muted">
              {zoneLabel(cur.family)} · ~{cur.minutes} min · +
              {fmtPoints(cur.points)} pts
            </p>
          </>
        )}
      </div>

      {resting ? (
        <button
          onClick={() => setResting(false)}
          className="mb-2 min-h-16 w-full rounded-2xl bg-surface text-lg font-bold"
        >
          Passer le repos
        </button>
      ) : (
        <button
          onClick={finishBlock}
          className="mb-2 min-h-16 w-full rounded-2xl text-lg font-bold transition-transform active:scale-[0.98]"
          style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
        >
          Terminé — je déclare
        </button>
      )}
      <button
        onClick={onQuit}
        className="mb-2 min-h-11 w-full text-sm font-medium text-faint"
      >
        Quitter la séance
      </button>
    </div>
  );
}
