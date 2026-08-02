"use client";

// Le déroulé d'une séance bonus : bloc → repos → bloc → … → fin.
// La composition, elle, vit dans BonusPlanner. Ce fichier ne fait
// qu'exécuter la suite qu'on lui donne.
//
// Rien ne part en base pendant la séance. Un bloc terminé coche un
// brouillon, et c'est « Valider » à l'écran de fin qui écrit — le même
// contrat que la feuille de déclaration depuis le 30/07, et pour la même
// raison : une déclaration partie réveille cinq personnes, et la seule
// réparation possible (décocher) n'efface pas la notification déjà
// envoyée. Déclarer bloc par bloc, c'étaient cinq occasions de se tromper
// au lieu d'une.

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
  showToast,
}: {
  player: Player;
  blocks: PlanBlock[];
  catalog: BonusCatalogItem[];
  claimedKeys: Set<string>;
  onClaim: (item: BonusCatalogItem) => void;
  onQuit: () => void;
  showToast: (msg: string) => void;
}) {
  const [i, setI] = useState(0);
  const [resting, setResting] = useState(false);
  const [left, setLeft] = useState(0);
  // Le brouillon : ce qui est fait, pas encore déclaré. L'écran de fin dit
  // la vérité même si un bloc a été sauté en route.
  const [done, setDone] = useState<PlanBlock[]>([]);
  // Sortir avec des blocs faits pose une question au lieu de les jeter en
  // silence : un quart d'heure d'effort ne s'abandonne pas sans un mot.
  const [confirmQuit, setConfirmQuit] = useState(false);
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

  /** Bloc terminé : il entre au brouillon, puis repos (ou fin). Rien
      n'est écrit — c'est « Valider » qui déclare, une seule fois. */
  function finishBlock() {
    navigator.vibrate?.(18);
    const b = blocks[i];
    setDone((d) => [...d, b]);
    if (i + 1 >= blocks.length) {
      setI(blocks.length);
      return;
    }
    setI(i + 1);
    setLeft(REST_MINUTES * 60);
    setResting(true);
  }

  /** Le seul chemin qui écrit. Les blocs partent en une passe, par le
      chemin existant (optimiste, rollback + toast en cas d'échec). */
  function valider() {
    navigator.vibrate?.(18);
    for (const b of done) onClaim(b);
    onQuit();
  }

  /** Sortie sans validation. Le brouillon est jeté, et c'est dit. */
  function abandonner() {
    if (done.length > 0) showToast("Bonus non validés");
    onQuit();
  }

  function quitter() {
    if (done.length > 0) setConfirmQuit(true);
    else onQuit();
  }

  if (i >= blocks.length) {
    const points = done.reduce((s, b) => s + b.todayPoints, 0);
    return (
      <div className="celebrate-bg -mx-5 flex min-h-full flex-col px-5">
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p
            className="rise-in text-2xl font-bold"
            style={{ color: player.color }}
          >
            Séance bonus bouclée 💪
          </p>
          <p className="num-display mt-4 text-8xl">+{fmtPoints(points)}</p>
          <p className="mt-1 text-sm font-medium text-muted">
            {done.length} bloc{done.length > 1 ? "s" : ""} fait
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
          <p className="mt-6 text-[13px] text-quiet">
            Rien n&apos;est encore parti au groupe. Valide pour déclarer.
          </p>
        </div>
        <button
          onClick={valider}
          className="mb-3 flex min-h-15 w-full items-center justify-center gap-1.5 rounded-2xl text-lg font-bold transition-transform active:scale-[0.98]"
          style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
        >
          Valider
          <span className="num-display">+{fmtPoints(points)}</span>
        </button>
        <button
          onClick={abandonner}
          className="mb-2 min-h-11 w-full text-sm font-medium text-quiet"
        >
          Sortir sans déclarer
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
      {/* L'étape en cours est annoncée aux lecteurs d'écran quand elle
          change — pas les secondes du décompte, qui bavarderaient. */}
      <p
        className="mt-4 text-center text-sm font-bold text-muted"
        aria-live="polite"
      >
        {resting
          ? `Repos — bloc ${i + 1}/${blocks.length} ensuite`
          : `Bloc ${i + 1}/${blocks.length} — ${label(cur)}`}
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
              {fmtPoints(cur.todayPoints)} pts
            </p>
          </>
        )}
      </div>

      {resting ? (
        <button
          onClick={() => setResting(false)}
          className="mb-3 min-h-15 w-full rounded-2xl bg-surface text-lg font-bold transition-transform active:scale-[0.98]"
        >
          Passer le repos
        </button>
      ) : (
        <button
          onClick={finishBlock}
          className="mb-3 min-h-15 w-full rounded-2xl text-lg font-bold transition-transform active:scale-[0.98]"
          style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
        >
          Bloc terminé
        </button>
      )}
      <button
        onClick={quitter}
        className="mb-2 min-h-11 w-full text-sm font-medium text-quiet"
      >
        Quitter la séance
      </button>

      {confirmQuit && (
        <QuitConfirm
          player={player}
          done={done}
          label={label}
          onValidate={valider}
          onDrop={abandonner}
          onCancel={() => setConfirmQuit(false)}
        />
      )}
    </div>
  );
}

/** Sortir avec des blocs faits mais rien de déclaré. Trois issues, et la
    première est celle qui garde le travail : on propose de valider ce qui
    est fait avant de partir. Même forme que la sortie de la séance du
    contrat — feuille montante, deux boutons côte à côte. */
function QuitConfirm({
  player,
  done,
  label,
  onValidate,
  onDrop,
  onCancel,
}: {
  player: Player;
  done: PlanBlock[];
  label: (b: PlanBlock) => string;
  onValidate: () => void;
  onDrop: () => void;
  onCancel: () => void;
}) {
  const points = done.reduce((s, b) => s + b.todayPoints, 0);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/60 px-5 pb-safe"
      role="dialog"
      aria-modal="true"
      aria-label="Quitter la séance bonus"
    >
      <div className="rise-in mb-4 w-full rounded-3xl bg-raised p-5">
        <p className="text-lg font-bold">
          {done.length} bloc{done.length > 1 ? "s" : ""} fait
          {done.length > 1 ? "s" : ""}, rien de déclaré
        </p>
        <ul className="mt-3 space-y-1">
          {done.map((b) => (
            <li
              key={b.key}
              className="flex items-baseline justify-between text-sm"
            >
              <span className="text-muted">
                <span aria-hidden>{b.emoji}</span> {label(b)}
              </span>
              <span className="font-bold" style={{ color: player.color }}>
                +{fmtPoints(b.todayPoints)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onValidate}
            className="min-h-12 flex-1 rounded-2xl font-bold"
            style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
          >
            Valider +{fmtPoints(points)}
          </button>
          <button
            onClick={onDrop}
            className="min-h-12 flex-1 rounded-2xl bg-surface font-bold text-muted"
          >
            Sortir sans rien
          </button>
        </div>
        <button
          onClick={onCancel}
          className="mt-2 min-h-11 w-full text-sm font-medium text-quiet"
        >
          Continuer la séance
        </button>
      </div>
    </div>
  );
}
