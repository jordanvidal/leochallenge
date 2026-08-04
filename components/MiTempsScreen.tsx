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

/**
 * Les deux nappes de couleur du fond.
 *
 * Direction retenue par Jordan le 04/08, après comparaison de trois
 * ambiances : le dégradé, mais lisible. Le dégradé plein cadre de la
 * première version montait en clarté au milieu de l'écran — deux couleurs
 * chaudes qui se mélangent donnent un brun clair — et c'est exactement là
 * que le texte se pose. Le texte y était illisible.
 *
 * La correction tient en trois points :
 *
 *  1. **Les couleurs vont aux coins.** Deux nappes floues en diagonale,
 *     jamais au centre : la bande où vit le texte reste sur le fond sombre
 *     de l'app, donc au contraste de l'app.
 *  2. **Elles plafonnent.** `FORCE_NAPPE` borne le mélange — au-delà, la
 *     clarté du fond rattrape celle du texte secondaire.
 *  3. **Le texte secondaire monte d'un cran** (`--color-muted` et
 *     `--color-faint`), parce qu'il reste posé sur un fond teinté.
 *
 * Et elles dérivent lentement (`globals.css`), ce que l'aplat n'offrait
 * pas : la story n'est jamais tout à fait la même image.
 */
const FORCE_NAPPE = "70%";
const FORCE_NAPPE_B = "60%";

/** Une nappe : un dégradé radial doux, calé dans un coin. */
/**
 * Une nappe : un dégradé radial doux, calé dans un coin.
 *
 * Les coordonnées sont celles de la COUCHE, qui déborde de 25 % de chaque
 * côté (`inset: -25%`, pour que la dérive ne découvre jamais de bord). Un
 * point à x % de la couche tombe donc à (x × 1,5 − 25) % de l'écran : 26 %
 * ici, c'est 14 % à l'écran. Se tromper là-dessus pousse la couleur hors
 * cadre et rend la story presque noire — c'est arrivé.
 */
function nappe(couleur: string, force: string, x: string, y: string) {
  // Trois arrêts et pas deux : avec un simple centre → transparent, la
  // couleur ne tient qu'au point central et l'écran repart au noir en
  // quelques pour cent. Le palier intermédiaire lui donne un corps.
  return `radial-gradient(52% 44% at ${x} ${y},
    color-mix(in oklch, ${couleur} ${force}, transparent) 0%,
    color-mix(in oklch, ${couleur} calc(${force} * 0.55), transparent) 46%,
    transparent 80%)`;
}

type Props = {
  player: Player;
  data: MiTempsData;
  /** Partage l'image de la carte : Instagram, Facebook, tout ce qui prend
      une image. C'est le partage mis en avant. */
  onShareImage: () => void;
  /** Partage le bloc de texte : WhatsApp, Messages. Le format qui marche
      dans le groupe, gardé en second. */
  onShareTexte: () => void;
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

/** Entier à la française : 30500 → "30 500". Le format par défaut. */
const enEntier = (n: number) => Math.round(n).toLocaleString("fr-FR");

/**
 * Compteur qui monte de 0 à `to`. Respecte reduced-motion.
 *
 * Même patron que le bilan de la S3 — c'est le geste qui fait qu'un chiffre
 * se regarde au lieu de se lire. Sur cet écran, TOUS les chiffres passent
 * par lui : le héros, les stats de soutien et les scores du podium. Chacun
 * avec son `delai`, pour qu'ils arrivent l'un après l'autre plutôt qu'en
 * bloc — un tableau de bord affiche, une story raconte.
 *
 * L'état retient la chaîne formatée et pas le nombre : à 30 500, deux
 * images successives donnent souvent le même texte, et React court-circuite
 * alors le rendu. Sans ça, sept compteurs simultanés font sept rendus par
 * image sur un téléphone qui n'en demandait pas tant.
 */
function CountUp({
  to,
  duree = 900,
  delai = 0,
  format = enEntier,
}: {
  to: number;
  duree?: number;
  delai?: number;
  format?: (n: number) => string;
}) {
  const [txt, setTxt] = useState(() =>
    format(prefersReducedMotion() ? to : 0),
  );
  useEffect(() => {
    if (prefersReducedMotion()) return setTxt(format(to));
    const debut = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      // Le délai n'est pas un setTimeout : la course démarre tout de suite
      // et reste bloquée à zéro, donc le nettoyage d'un seul rAF suffit.
      const p = Math.min(1, Math.max(0, (t - debut - delai) / duree));
      // Décélération franche : le chiffre part vite et se pose, il ne
      // rampe pas sur les vingt derniers pour cent.
      const s = format(to * (1 - Math.pow(1 - p, 3)));
      setTxt((avant) => (avant === s ? avant : s));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duree, delai, format]);
  return <>{txt}</>;
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

/**
 * Le chiffre héros d'une carte.
 *
 * `arrivee` est le moment où le compteur se pose : le chiffre prend alors
 * le petit coup d'échelle de `reel-land`, l'animation d'arrivée de la roue
 * du tirage. Un délai plutôt qu'un état : rien à synchroniser entre le
 * compteur et son enveloppe, et le `both` de l'animation tient l'échelle à
 * 1 pendant toute l'attente. En reduced-motion, `globals.css` la coupe.
 */
function Hero({
  valeur,
  suffixe,
  legende,
  couleur,
  arrivee = 900,
}: {
  valeur: React.ReactNode;
  suffixe?: string;
  legende: string;
  couleur: string;
  arrivee?: number;
}) {
  return (
    <div>
      <p
        className="num-display reel-land inline-block text-[5.5rem] leading-[0.85]"
        style={{
          color: couleur,
          animationDelay: `${arrivee}ms`,
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

/** Petite stat de soutien, sous un chiffre héros. Le chiffre monte aussi,
    plus vite que le héros et décalé de `rang` — les trois d'une rangée
    arrivent en escalier, pas en bloc. */
function Stat({
  valeur,
  label,
  rang = 0,
}: {
  valeur: number;
  label: string;
  rang?: number;
}) {
  return (
    <div>
      <p className="num-display text-3xl text-ink">
        <CountUp to={valeur} duree={700} delai={260 + rang * 130} />
      </p>
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
              {/* Le score monte pile quand sa ligne arrive : même formule
                  de délai que la révélation, un cran plus tard. */}
              <CountUp
                to={p.points}
                duree={620}
                delai={520 + (top3.length - 1 - k) * 700}
                format={fmtPoints}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function MiTempsScreen({
  player,
  data,
  onShareImage,
  onShareTexte,
  onClose,
}: Props) {
  const total = data.joursFaits + data.joursRestants;
  const leader = data.top3[0]?.color || player.color;
  // L'or du ×2 : la seule couleur de l'app qui n'appartienne à personne.
  // C'est donc elle qui porte la carte du collectif.
  const collectif = "var(--color-x2)";

  const eyebrow =
    "text-xs font-bold uppercase tracking-[0.18em] text-faint";

  // La couleur de chaque carte : la tienne pour ce qui te concerne, l'or du
  // collectif pour l'équipe, celle du leader pour la course. La carte suivante
  // donne la seconde nappe — la story change de couleur en continu, sans
  // coupure d'un écran à l'autre.
  const [i, setI] = useState(0);
  const teintes = [player.color, collectif, leader, player.color, player.color];
  const teinte = teintes[i];
  const suivante = teintes[(i + 1) % teintes.length];

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
              couleur={teinte}
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
              couleur={teinte}
            />
          </Reveal>
          <Reveal ordre={2}>
            <div className="grid grid-cols-3 gap-4 border-t border-line pt-5">
              <Stat valeur={data.totalExos} label="exos validés" rang={0} />
              <Stat
                valeur={data.joursParfaitsCollectifs}
                label="jours parfaits"
                rang={1}
              />
              <Stat valeur={data.seances} label="séances guidées" rang={2} />
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
            couleurScore={null}
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
              <span style={{ color: teinte }}>personne n&apos;est condamné.</span>
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
              couleur={teinte}
            />
          </Reveal>
          <Reveal ordre={2}>
            <div className="grid grid-cols-3 gap-4 border-t border-line pt-5">
              <Stat valeur={data.me.exos} label="exos validés" rang={0} />
              <Stat valeur={data.me.perfectDays} label="jours parfaits" rang={1} />
              <Stat valeur={data.me.bestStreak} label="meilleure série" rang={2} />
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
              couleur={teinte}
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
            {/* Deux partages, et l'image d'abord : c'est elle qui ouvre
                Instagram et Facebook, qui ne savent rien faire d'un bloc de
                texte. Le texte reste juste en dessous — c'est le format qui
                se colle dans le groupe WhatsApp. */}
            <div className="space-y-2.5">
              <button
                onClick={onShareImage}
                className="min-h-11 w-full rounded-2xl px-4 py-3.5 text-center font-bold"
                style={{
                  background: teinte,
                  color: "var(--color-bg)",
                }}
              >
                Partager la carte 📸
              </button>
              <button
                onClick={onShareTexte}
                className="min-h-11 w-full rounded-2xl px-4 py-3 text-center text-sm font-bold"
                style={{
                  color: "var(--color-muted)",
                  boxShadow: "inset 0 0 0 1.5px var(--color-line)",
                }}
              >
                Envoyer le bilan en texte
              </button>
            </div>
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
          // Le texte secondaire monte d'un cran : il reste posé sur un fond
          // teinté, où les gris de l'app perdent du contraste.
          "--color-muted": "oklch(0.78 0 0)",
          "--color-faint": "oklch(0.68 0 0)",
          color: "var(--color-ink)",
          background: "var(--color-bg)",
        } as React.CSSProperties
      }
      className="fixed inset-0 z-[60] isolate flex flex-col overflow-hidden pt-safe pb-safe"
    >
      {/* Les deux nappes, sous tout le reste. `aria-hidden` : c'est du fond. */}
      <div
        aria-hidden
        className="nappe nappe-a"
        style={{
          background: nappe(teinte, FORCE_NAPPE, "26%", "18%"),
          transition: "background 700ms ease-out",
        }}
      />
      <div
        aria-hidden
        className="nappe nappe-b"
        style={{
          background: nappe(suivante, FORCE_NAPPE_B, "74%", "82%"),
          transition: "background 700ms ease-out",
        }}
      />
      {/* En-tête : pastille, progression, sortie. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide uppercase"
          style={{
            background: `color-mix(in oklch, ${teinte} 22%, var(--color-surface))`,
            color: teinte,
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${teinte} 55%, transparent)`,
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
              style={{ background: n <= i ? teinte : "var(--color-line)" }}
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
