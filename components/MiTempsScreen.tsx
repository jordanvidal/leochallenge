"use client";

// La mi-temps : écran story one-shot en 5 cartes tapables. Pur affichage —
// toutes les stats arrivent en props, figées au dernier jour de la première
// mi-temps par `lib/mitemps`. Il ne lit rien lui-même, il ne score rien.
//
// Direction visuelle (03/08, demande de Jordan « type Spotify Wrapped ») :
// la story quitte le gabarit sobre des carrousels de saison pour un
// traitement plein cadre. Trois leviers, et trois seulement :
//
//  1. **Le fond prend une couleur par carte** et se fond de l'une à
//     l'autre. La recette est celle de `.celebrate-bg` (globals.css), juste
//     poussée plus haut — et la couleur reste TOUJOURS une couleur de
//     joueur : celle du lecteur, celle du leader, ou l'or du ×2. DESIGN.md
//     dit « la couleur, c'est les joueurs » ; ici on l'applique à fond,
//     on n'invente pas une palette de plus. Baisser l'intensité, c'est la
//     constante `TEINTE` ci-dessous, rien d'autre.
//  2. **Un chiffre héros par carte**, en `num-display`, qui monte de zéro.
//  3. **Une entrée en cascade** : les blocs arrivent l'un après l'autre.
//     Coupée net par `prefers-reduced-motion`, comme le reste de l'app.
//
// Concept et contenu : docs/mi-temps.md.

import { useEffect, useState } from "react";
import { fmtPoints, frenchRank } from "@/lib/gamification";
import { MiTempsData } from "@/lib/mitemps";
import { Player } from "@/lib/types";
import { Avatar, BigButton } from "./ui";

/** Force du voile de couleur derrière chaque carte, en ambiance « halo ». */
const TEINTE = "34%";

/**
 * L'ambiance visuelle de la story. **Trois propositions, une seule à garder** —
 * ce commutateur ne doit pas survivre à la revue de Jordan.
 *
 *  * `halo`  — fond sombre, halo de la couleur du moment. La sobriété de
 *              l'app, poussée d'un cran. C'est la moins risquée.
 *  * `aplat` — la couleur prend TOUT l'écran, l'encre passe en noir. C'est le
 *              geste de Wrapped, et le plus gros écart jamais pris avec
 *              DESIGN.md — mais la couleur reste celle d'un joueur.
 *  * `duo`   — dégradé diagonal entre la couleur du moment et celle de la
 *              carte suivante : la story change de couleur en continu.
 *
 * Les trois ne changent QUE des couleurs. La typo, les espacements et les
 * animations sont partagés — on compare une ambiance, pas cinq écrans.
 */
type Ambiance = "halo" | "aplat" | "duo";
const AMBIANCE: Ambiance = "aplat";

type Look = {
  /** Le `background` de l'écran. */
  fond: string;
  /** Surcharges des tokens de couleur : tout ce qui est en `text-ink`,
      `text-muted`, `border-line`… suit sans qu'on touche une classe. */
  vars: React.CSSProperties;
  /** La couleur du chiffre héros. */
  chiffre: string;
  /** La couleur des éléments d'interface posés sur le fond (pastille,
      barres de progression) — jamais la teinte en aplat, elle y serait
      invisible. */
  surFond: string;
};

function lookDe(teinte: string, suivante: string): Look {
  if (AMBIANCE === "aplat") {
    return {
      fond: teinte,
      // L'encre passe en sombre : sur un aplat à 0.72 de clarté, du blanc
      // ne tient aucun contraste. Les gris sont neutres, pas teintés — la
      // couleur est déjà partout, elle n'a pas besoin d'aide.
      vars: {
        "--color-ink": "oklch(0.14 0 0)",
        "--color-muted": "oklch(0.30 0 0)",
        "--color-faint": "oklch(0.40 0 0)",
        "--color-line": "oklch(0.14 0 0 / 0.22)",
        "--color-surface": "oklch(1 0 0 / 0.18)",
      } as React.CSSProperties,
      chiffre: "oklch(0.14 0 0)",
      surFond: "oklch(0.14 0 0)",
    };
  }
  if (AMBIANCE === "duo") {
    return {
      fond: `linear-gradient(158deg,
        color-mix(in oklch, ${teinte} 62%, var(--color-bg)) 0%,
        color-mix(in oklch, ${suivante} 46%, var(--color-bg)) 62%,
        var(--color-bg) 100%)`,
      vars: {},
      chiffre: "var(--color-ink)",
      surFond: teinte,
    };
  }
  return {
    fond: `radial-gradient(125% 95% at 50% -10%,
      color-mix(in oklch, ${teinte} ${TEINTE}, transparent),
      transparent 68%),
      var(--color-bg)`,
    vars: {},
    chiffre: teinte,
    surFond: teinte,
  };
}

type Props = {
  player: Player;
  data: MiTempsData;
  onShare: () => void;
  onClose: () => void;
};

/** Dupliqué de LaunchS3Screen : cinq lignes pures, et cet écran ne doit
    rien devoir à un carrousel de saison qui finira supprimé. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Compteur qui monte de 0 à `to` au montage. Respecte reduced-motion.
    Même patron que le bilan de la S3 — c'est le geste qui fait qu'un
    chiffre se regarde au lieu de se lire. */
function CountUp({ to, duree = 900 }: { to: number; duree?: number }) {
  const [n, setN] = useState(prefersReducedMotion() ? to : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return setN(to);
    const debut = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - debut) / duree);
      // Décélération franche : le chiffre part vite et se pose, il ne
      // rampe pas sur les vingt derniers pour cent.
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duree]);
  return <>{n.toLocaleString("fr-FR")}</>;
}

/** Un bloc qui monte à son tour. `ordre` est son rang dans la cascade. */
function Reveal({
  ordre = 0,
  children,
}: {
  ordre?: number;
  children: React.ReactNode;
}) {
  const [vu, setVu] = useState(prefersReducedMotion());
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setTimeout(() => setVu(true), 90 + ordre * 160);
    return () => clearTimeout(id);
  }, [ordre]);
  return (
    <div
      style={{
        opacity: vu ? 1 : 0,
        transform: vu ? "none" : "translateY(14px)",
        transition: "opacity .5s ease, transform .5s cubic-bezier(.22,1,.36,1)",
      }}
    >
      {children}
    </div>
  );
}

/** Le chiffre héros d'une carte. */
function Hero({
  valeur,
  suffixe,
  legende,
  couleur,
}: {
  valeur: React.ReactNode;
  suffixe?: string;
  legende: string;
  couleur: string;
}) {
  return (
    <div>
      <p
        className="num-display text-[5.5rem] leading-[0.85]"
        style={{
          color: couleur,
          filter: `drop-shadow(0 10px 40px color-mix(in oklch, ${couleur} 40%, transparent))`,
        }}
      >
        {valeur}
        {suffixe && <span className="text-4xl text-faint"> {suffixe}</span>}
      </p>
      <p className="mt-3 text-lg text-muted">{legende}</p>
    </div>
  );
}

/** Petite stat de soutien, sous un chiffre héros. */
function Stat({ valeur, label }: { valeur: string; label: string }) {
  return (
    <div>
      <p className="num-display text-3xl text-ink">{valeur}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

/**
 * Une ligne de distinction : le trophée, le joueur, son terrain.
 *
 * Un nom par ligne, et chaque actif a la sienne — c'est le critère
 * d'acceptance de la carte (voir `distinctions()`). Le tiret sépare le nom
 * du fait : « Hichem — 13 séances guidées bouclées » se lit comme une
 * ligne de palmarès, pas comme une phrase à rallonge.
 */
function Mvp({
  emoji,
  nom,
  exploit,
}: {
  emoji: string;
  nom: string;
  exploit: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-6 shrink-0 text-center text-base" aria-hidden>
        {emoji}
      </span>
      <p className="text-sm leading-snug text-muted">
        <span className="font-bold text-ink">{nom}</span> — {exploit}
      </p>
    </div>
  );
}

/**
 * Le podium révélé de bas en haut : le 3e d'abord, puis le 2e, puis le 1er.
 *
 * Repris tel quel de l'écran de lancement de la S3 — c'est le geste que le
 * groupe connaît déjà, et le seul endroit de l'app où un classement se
 * regarde arriver au lieu de s'afficher. Le suspense tient à ça : on sait
 * qui est 3e avant de savoir qui est 1er.
 */
function PodiumReveal({
  top3,
  couleurScore,
}: {
  top3: MiTempsData["top3"];
  /** null = la couleur de chaque joueur. Une couleur = celle de tous, quand
      le fond est déjà l'aplat de l'un d'eux et les avalerait. */
  couleurScore: string | null;
}) {
  const medailles = ["🥇", "🥈", "🥉"];
  const [step, setStep] = useState(prefersReducedMotion() ? top3.length : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const ids = top3.map((_, i) =>
      setTimeout(() => setStep((s) => Math.max(s, i + 1)), 500 + i * 700),
    );
    return () => ids.forEach(clearTimeout);
  }, [top3.length]);

  return (
    <div className="space-y-3">
      {top3.map((p, k) => {
        // k=0 est en haut mais révélé en dernier : il faut step >= n - k.
        const vu = step >= top3.length - k;
        return (
          <div
            key={p.name}
            className="flex items-center gap-3 border-b border-line pb-3 last:border-0"
            style={{
              opacity: vu ? 1 : 0,
              transform: vu ? "none" : "translateY(12px) scale(0.97)",
              transition:
                "opacity .45s ease, transform .45s cubic-bezier(.22,1,.36,1)",
            }}
          >
            <span className="text-2xl leading-none" aria-hidden>
              {medailles[k]}
            </span>
            <Avatar name={p.name} color={p.color} size={34} />
            <span className="flex-1 truncate text-lg font-bold">{p.name}</span>
            <span
              className="num-display text-2xl"
              style={{ color: couleurScore ?? p.color }}
            >
              {fmtPoints(p.points)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Nombre à la française : 30200 → "30 200". */
function frNum(n: number): string {
  return n.toLocaleString("fr-FR");
}

export default function MiTempsScreen({ player, data, onShare, onClose }: Props) {
  const total = data.joursFaits + data.joursRestants;
  const leader = data.top3[0]?.color || player.color;
  // L'or du ×2 : la seule couleur de l'app qui n'appartienne à personne.
  // C'est donc elle qui porte la carte du collectif.
  const collectif = "var(--color-x2)";

  const eyebrow =
    "text-xs font-bold uppercase tracking-[0.18em] text-faint";

  // La couleur de chaque carte : la tienne pour ce qui te concerne, l'or du
  // collectif pour l'équipe, celle du leader pour la course. L'index vit ici
  // parce que le look en dépend, et que les cartes dépendent du look.
  const [i, setI] = useState(0);
  const teintes = [player.color, collectif, leader, player.color, player.color];
  const teinte = teintes[i];
  const look = lookDe(teinte, teintes[(i + 1) % teintes.length]);

  const cards: React.ReactNode[] = [
    // 1 — Le cadre. Un seul chiffre, et ce qu'il veut dire.
    (
        <div key="cadre" className="space-y-6">
          <Reveal ordre={0}>
            <p className={eyebrow}>Mi-temps</p>
          </Reveal>
          <Reveal ordre={1}>
            <Hero
              valeur={<CountUp to={data.joursFaits} />}
              suffixe={`/ ${total}`}
              legende="jours de challenge dans les jambes"
              couleur={look.chiffre}
            />
          </Reveal>
          <Reveal ordre={2}>
            <h1 className="text-4xl font-black leading-[1.05]">
              On est à la moitié du challenge.
            </h1>
          </Reveal>
          <Reveal ordre={3}>
            <p className="text-lg text-muted">
              {data.joursRestants} jours devant. Voilà ce que la première
              moitié raconte — et pourquoi la deuxième n&apos;est écrite pour
              personne.
            </p>
          </Reveal>
        </div>
    ),

    // 2 — Le collectif. Le gros chiffre, c'est les répétitions : c'est
    // celui qui fait « on a fait ÇA ? », pas le compte d'exos.
    (
        <div key="equipe" className="space-y-6">
          <Reveal ordre={0}>
            <p className={eyebrow}>L&apos;équipe</p>
          </Reveal>
          <Reveal ordre={1}>
            <Hero
              valeur={<CountUp to={data.totalReps} duree={1300} />}
              legende="répétitions à nous tous"
              couleur={look.chiffre}
            />
          </Reveal>
          <Reveal ordre={2}>
            <div className="grid grid-cols-3 gap-4 border-t border-line pt-5">
              <Stat valeur={frNum(data.totalExos)} label="exos validés" />
              <Stat
                valeur={String(data.joursParfaitsCollectifs)}
                label="jours parfaits"
              />
              <Stat valeur={String(data.seances)} label="séances guidées" />
            </div>
          </Reveal>
          {data.mvps.length > 0 && (
            <Reveal ordre={3}>
              <div className="space-y-3 border-t border-line pt-5">
                {data.mvps.map((m) => (
                  <Mvp
                    key={m.emoji}
                    emoji={m.emoji}
                    nom={m.nom}
                    exploit={m.exploit}
                  />
                ))}
              </div>
            </Reveal>
          )}
        </div>
    ),

    // 3 — La course. Le podium arrive du 3e au 1er, et la phrase de
    // suspense tombe en grand, après — pas en note de bas de carte.
    (
        <div key="course" className="space-y-6">
          <Reveal ordre={0}>
            <p className={eyebrow}>La course</p>
          </Reveal>
          <PodiumReveal
            top3={data.top3}
            couleurScore={AMBIANCE === "aplat" ? "var(--color-ink)" : null}
          />
          {data.duels.tranches + data.duels.nuls > 0 && (
            <Reveal ordre={4}>
              <p className="text-sm text-muted">
                ⚔️ {data.duels.tranches} duel
                {data.duels.tranches > 1 ? "s" : ""} tranché
                {data.duels.tranches > 1 ? "s" : ""}, {data.duels.nuls} nul
                {data.duels.nuls > 1 ? "s" : ""} depuis le début.
              </p>
            </Reveal>
          )}
          <Reveal ordre={5}>
            <p className="text-3xl leading-[1.15] font-black text-balance">
              Personne n&apos;est à l&apos;abri,
              <br />
              <span style={{ color: look.chiffre }}>personne n&apos;est condamné.</span>
            </p>
          </Reveal>
          <Reveal ordre={6}>
            <p className="text-base text-muted">
              Les multiplicateurs de série et les duels peuvent tout renverser
              en {data.joursRestants} jours.
            </p>
          </Reveal>
        </div>
    ),

    // 4 — Toi. La seule carte qui change d'un joueur à l'autre.
    (
        <div key="toi" className="space-y-6">
          <Reveal ordre={0}>
            <p className={eyebrow}>Toi</p>
          </Reveal>
          <Reveal ordre={1}>
            <Hero
              valeur={frenchRank(data.me.rank)}
              legende={`${fmtPoints(data.me.points)} pts à la mi-temps`}
              couleur={look.chiffre}
            />
          </Reveal>
          <Reveal ordre={2}>
            <div className="grid grid-cols-3 gap-4 border-t border-line pt-5">
              <Stat valeur={String(data.me.exos)} label="exos validés" />
              <Stat valeur={String(data.me.perfectDays)} label="jours parfaits" />
              <Stat valeur={String(data.me.bestStreak)} label="meilleure série" />
            </div>
          </Reveal>
          <Reveal ordre={3}>
            <p className="border-t border-line pt-5 text-lg text-muted">
              {data.me.relance}
            </p>
          </Reveal>
        </div>
    ),

    // 5 — La suite. Le partage, puis la sortie.
    (
        <div key="suite" className="space-y-6">
          <Reveal ordre={0}>
            <p className={eyebrow}>Ce qui reste</p>
          </Reveal>
          <Reveal ordre={1}>
            <Hero
              valeur={<CountUp to={data.joursRestants} />}
              legende="jours de deuxième mi-temps"
              couleur={look.chiffre}
            />
          </Reveal>
          <Reveal ordre={2}>
            <p className="text-lg text-muted">
              Les compteurs hebdo repartent de zéro chaque lundi, les duels
              distribuent leurs points, et la série de quelqu&apos;un va
              craquer — ou pas.
            </p>
          </Reveal>
          <Reveal ordre={3}>
            <button
              onClick={onShare}
              className="min-h-11 w-full rounded-2xl px-4 py-3.5 text-center font-bold"
              style={{
                background: "var(--color-surface)",
                color: look.chiffre,
                boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${look.chiffre} 40%, transparent)`,
              }}
            >
              Balancer le bilan dans le groupe 📤
            </button>
          </Reveal>
        </div>
    ),
  ];

  const last = i === cards.length - 1;

  function next() {
    setI((v) => v + 1);
  }

  return (
    <main
      style={
        {
          "--pc": player.color,
          ...look.vars,
          color: "var(--color-ink)",
          background: look.fond,
          transition: "background 600ms ease-out",
        } as React.CSSProperties
      }
      className="fixed inset-0 z-[60] flex flex-col pt-safe pb-safe"
    >
      {/* En-tête : pastille, progression, sortie. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
          style={{
            background: "var(--color-surface)",
            color: look.surFond,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${look.surFond} 55%, transparent)`,
            transition: "background 600ms ease-out, color 600ms ease-out",
          }}
        >
          Mi-temps
        </span>
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {cards.map((_, n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: n <= i ? look.surFond : "var(--color-line)" }}
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
          déclencherait les deux actions à la fois. */}
      {last ? (
        <div className="flex flex-1 flex-col justify-center px-8 text-left">
          <div key={i}>{cards[i]}</div>
        </div>
      ) : (
        <button
          onClick={next}
          aria-label="Carte suivante"
          className="flex flex-1 flex-col justify-center px-8 text-left"
        >
          <div key={i}>{cards[i]}</div>
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
