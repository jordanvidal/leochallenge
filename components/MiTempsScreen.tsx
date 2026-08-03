"use client";

// La mi-temps : écran story one-shot en 5 cartes tapables, même gabarit que
// TutorialScreen / LaunchS4Screen. Ce composant est PUR AFFICHAGE : toutes
// les stats arrivent en props, figées au dernier jour de la première mi-temps
// par `lib/mitemps`. Il ne lit rien lui-même, il ne score rien.
//
// Concept figé le 17/07, visuel revu à cette date : docs/mi-temps.md.

import { useState } from "react";
import { fmtPoints, frenchRank } from "@/lib/gamification";
import { joinNoms, MiTempsData } from "@/lib/mitemps";
import { Player } from "@/lib/types";
import { Avatar, BigButton } from "./ui";

type Props = {
  player: Player;
  data: MiTempsData;
  onShare: () => void;
  onClose: () => void;
};

/** Une grosse stat : chiffre massif + légende. */
function Big({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="num-display text-4xl text-ink">{value}</p>
      <p className="mt-1 text-sm text-muted">{label}</p>
    </div>
  );
}

/** Une ligne MVP : le trophée, le ou les noms, l'exploit. */
function Mvp({
  emoji,
  noms,
  exploit,
}: {
  emoji: string;
  noms: string[];
  exploit: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-7 shrink-0 text-center text-lg" aria-hidden>
        {emoji}
      </span>
      <p className="text-base text-muted">
        <span className="font-bold text-ink">{joinNoms(noms)}</span> {exploit}
      </p>
    </div>
  );
}

/** Nombre à la française : 35100 → "35 100". */
function frNum(n: number): string {
  return n.toLocaleString("fr-FR");
}

export default function MiTempsScreen({ player, data, onShare, onClose }: Props) {
  const glow = {
    filter: `drop-shadow(0 8px 24px color-mix(in oklch, ${player.color} 45%, transparent))`,
  };
  const total = data.joursFaits + data.joursRestants;

  const cards = [
    // 1 — Le cadre : la moitié exacte.
    <div key="cadre">
      <p className="num-display text-7xl" style={{ color: player.color, ...glow }}>
        {data.joursFaits}
        <span className="text-4xl text-faint"> / {total}</span>
      </p>
      <h1 className="mt-6 text-3xl font-bold">La mi-temps</h1>
      <p className="mt-4 text-lg text-muted">
        {data.joursFaits} jours de challenge dans les jambes,{" "}
        {data.joursRestants} devant.
      </p>
      <p className="mt-3 text-lg text-muted">
        Voilà ce que la première moitié raconte — et pourquoi la deuxième
        n&apos;est écrite pour personne.
      </p>
    </div>,

    // 2 — La bande : le collectif d'abord, puis les distinctions nommées.
    <div key="bande">
      <h1 className="text-2xl font-bold">La bande</h1>
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6">
        <Big value={frNum(data.totalExos)} label="exos à nous tous" />
        <Big value={frNum(data.totalReps)} label="répétitions" />
        <Big
          value={String(data.joursParfaitsCollectifs)}
          label="jours parfaits cumulés"
        />
        <Big value={String(data.seances)} label="séances guidées" />
      </div>
      {data.mvps.length > 0 && (
        <div className="mt-8 space-y-4 border-t border-line pt-6">
          {data.mvps.map((m) => (
            <Mvp key={m.emoji} emoji={m.emoji} noms={m.noms} exploit={m.exploit} />
          ))}
        </div>
      )}
    </div>,

    // 3 — La course : le podium et les duels, sans enterrer personne.
    <div key="course">
      <h1 className="text-2xl font-bold">La course</h1>
      <div className="mt-6 space-y-3">
        {data.top3.map((p, i) => (
          <div key={p.name} className="flex items-center gap-3">
            <span className="num-display w-7 text-2xl text-faint">{i + 1}</span>
            <Avatar name={p.name} color={p.color} size={36} />
            <span className="flex-1 truncate font-bold">{p.name}</span>
            <span className="num-display text-xl" style={{ color: p.color }}>
              {fmtPoints(p.points)}
            </span>
          </div>
        ))}
      </div>
      {data.duels.tranches + data.duels.nuls > 0 && (
        <p className="mt-6 border-t border-line pt-4 text-base text-muted">
          ⚔️ Duels : {data.duels.tranches} tranché
          {data.duels.tranches > 1 ? "s" : ""}, {data.duels.nuls} nul
          {data.duels.nuls > 1 ? "s" : ""}.
        </p>
      )}
      <p className="mt-3 text-base text-muted">
        Les multiplicateurs de série et les duels peuvent tout renverser en{" "}
        {data.joursRestants} jours. Personne n&apos;est à l&apos;abri, personne
        n&apos;est condamné.
      </p>
    </div>,

    // 4 — Toi : tes chiffres, puis TA raison d'attaquer la 2e mi-temps.
    <div key="toi">
      <h1 className="text-2xl font-bold">Toi</h1>
      <p className="mt-2 text-lg font-medium" style={{ color: player.color }}>
        {frenchRank(data.me.rank)} — {fmtPoints(data.me.points)} pts à la
        mi-temps.
      </p>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <Big value={String(data.me.exos)} label="exos validés" />
        <Big value={String(data.me.perfectDays)} label="jours parfaits" />
        <Big value={String(data.me.bestStreak)} label="meilleure série" />
      </div>
      <p className="mt-8 border-t border-line pt-6 text-lg text-muted">
        {data.me.relance}
      </p>
    </div>,

    // 5 — La suite : le partage et la relance collective.
    <div key="suite">
      <p className="text-7xl" aria-hidden style={glow}>
        🏁
      </p>
      <h1 className="mt-6 text-3xl font-bold">Deuxième mi-temps</h1>
      <p className="mt-4 text-lg text-muted">
        {data.joursRestants} jours. Les compteurs hebdo repartent de zéro chaque
        lundi, les duels distribuent leurs points, et la série de quelqu&apos;un
        va craquer — ou pas.
      </p>
      <p className="mt-3 text-lg text-muted">
        Balance le bilan dans le groupe, et que le meilleur tienne.
      </p>
      <button
        onClick={onShare}
        className="mt-6 min-h-11 w-full rounded-2xl px-4 py-3 text-center font-bold"
        style={{
          background: `color-mix(in oklch, ${player.color} 14%, var(--color-surface))`,
          color: player.color,
        }}
      >
        Partager le bilan de la bande 📤
      </button>
    </div>,
  ];

  const [i, setI] = useState(0);
  const last = i === cards.length - 1;

  function next() {
    setI((v) => v + 1);
  }

  return (
    <main
      style={{ "--pc": player.color } as React.CSSProperties}
      className="fixed inset-0 z-[60] flex flex-col bg-bg pt-safe pb-safe"
    >
      {/* En-tête : pastille, progression, sortie. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
          style={{
            background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
            color: player.color,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 55%, transparent)`,
          }}
        >
          Mi-temps
        </span>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {cards.map((_, n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: n <= i ? player.color : "var(--color-line)" }}
            />
          ))}
        </div>
        <button
          onClick={onClose}
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          Passer
        </button>
      </div>

      {/* Zone de tap : tape n'importe où pour avancer. La dernière carte
          n'en est pas une — elle porte le bouton de partage, et un bouton
          dans un bouton est du HTML invalide autant qu'un tap qui
          déclencherait les deux actions à la fois. On en sort par le
          bouton du pied, comme sur les carrousels de saison. */}
      {last ? (
        <div className="flex flex-1 flex-col justify-center px-8 text-left">
          <div key={i} className="rise-in">
            {cards[i]}
          </div>
        </div>
      ) : (
        <button
          onClick={next}
          aria-label="Carte suivante"
          className="flex flex-1 flex-col justify-center px-8 text-left"
        >
          <div key={i} className="rise-in">
            {cards[i]}
          </div>
        </button>
      )}

      {/* Pied : bouton net sur la dernière carte, sinon indice de tap. */}
      <div className="px-6 pb-3">
        {last ? (
          <BigButton onClick={onClose}>On y retourne</BigButton>
        ) : (
          <p className="py-3 text-center text-sm text-faint">
            Tape pour continuer
          </p>
        )}
      </div>
    </main>
  );
}
