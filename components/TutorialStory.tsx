"use client";

// ESSAI — le tuto de première connexion habillé comme la story de mi-temps.
//
// Même contenu que `TutorialScreen` (mêmes phrases, mêmes chiffres), même
// nombre de cartes, mais le traitement visuel de `MiTempsScreen` : deux
// nappes de couleur qui dérivent au fond, un chiffre héros par carte qui
// monte de zéro, une entrée en cascade, et les zones de tap des stories
// (un tiers à gauche pour revenir).
//
// Ce que ça change, et qui se juge à l'œil : le tuto passe d'un écran de
// règles à un objet qu'on regarde. Ce que ça coûte : chaque carte doit se
// résumer à UN chiffre, sinon le héros ment. C'est facile pour « une
// journée vaut 7 » et « 3 points en jeu le lundi » ; ça force la main sur
// la carte des bonus, où le vrai message est « il y en a plein », et où le
// +20 des 10 km n'est qu'un exemple parmi vingt-trois.
//
// Les quatre briques (nappe, CountUp, Reveal, Hero) sont recopiées de
// MiTempsScreen, qui ne les exporte pas. Si cette direction est retenue,
// elles sortent dans un module partagé — pas avant : dupliquer pour un
// essai coûte moins cher que d'ouvrir une API commune qu'on jettera.

import { useEffect, useState } from "react";
import { frenchDayMonth, joursDeFenetre } from "@/lib/challenge";
import { PLAYER_COLORS } from "@/lib/palette";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

const FORCE_NAPPE = "70%";
const FORCE_NAPPE_B = "60%";

/** Une nappe : un dégradé radial doux, calé dans un coin. Les coordonnées
    sont celles de la COUCHE, qui déborde de 25 % (`inset: -25%`). */
function nappe(couleur: string, force: string, x: string, y: string) {
  return `radial-gradient(52% 44% at ${x} ${y},
    color-mix(in oklch, ${couleur} ${force}, transparent) 0%,
    color-mix(in oklch, ${couleur} calc(${force} * 0.55), transparent) 46%,
    transparent 80%)`;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Entier à la française, et les décimales quand il y en a : 10,5. */
const enNombre = (n: number) =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Compteur qui monte de 0 à `to`. Respecte reduced-motion. */
function CountUp({
  to,
  duree = 900,
  delai = 0,
  format = enNombre,
}: {
  to: number;
  duree?: number;
  delai?: number;
  format?: (n: number) => string;
}) {
  const [txt, setTxt] = useState(() => format(prefersReducedMotion() ? to : 0));
  useEffect(() => {
    if (prefersReducedMotion()) return setTxt(format(to));
    const debut = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - debut - delai) / duree));
      const s = format(to * (1 - Math.pow(1 - p, 3)));
      setTxt((avant) => (avant === s ? avant : s));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duree, delai, format]);
  return <>{txt}</>;
}

/** Un bloc qui monte à son tour, `ordre` étant son rang dans la cascade. */
function Reveal({
  ordre = 0,
  pas = 160,
  children,
}: {
  ordre?: number;
  pas?: number;
  children: React.ReactNode;
}) {
  const [vu, setVu] = useState(prefersReducedMotion());
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setTimeout(() => setVu(true), 90 + ordre * pas);
    return () => clearTimeout(id);
  }, [ordre, pas]);
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
        {suffixe && <span className="text-3xl text-faint"> {suffixe}</span>}
      </p>
      <p className="mt-3 text-lg text-muted">{legende}</p>
    </div>
  );
}

/** Petite stat de soutien, sous le chiffre héros. */
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

/** Une ligne d'événement : emoji + phrase. */
function Ligne({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-6 shrink-0 text-center text-base" aria-hidden>
        {emoji}
      </span>
      <p className="text-sm leading-snug text-muted">{children}</p>
    </div>
  );
}

type Props = {
  player: Player;
  replay?: boolean;
  onDone: () => void;
};

export default function TutorialStory({ player, replay = false, onDone }: Props) {
  const f = useFenetre();
  const jours = joursDeFenetre(f);
  // L'or du ×2 : la seule couleur de l'app qui n'appartienne à personne.
  const chance = "var(--color-x2)";
  // La carte du duel prend une AUTRE couleur de joueur que la sienne :
  // c'est la carte où quelqu'un d'autre entre dans l'écran.
  const adverse =
    PLAYER_COLORS.find((c) => c !== player.color) ?? PLAYER_COLORS[0];

  const eyebrow = "text-xs font-bold uppercase tracking-[0.18em] text-faint";

  const [i, setI] = useState(0);
  const teintes = [player.color, player.color, adverse, player.color, chance];
  const teinte = teintes[i];
  const suivante = teintes[(i + 1) % teintes.length];

  const cards: React.ReactNode[] = [
    // 1 — Le cadre : combien de jours, et le geste du soir.
    <div key="principe" className="space-y-6">
      <Reveal ordre={0}>
        <p className={eyebrow}>Le challenge</p>
      </Reveal>
      <Reveal ordre={1}>
        <Hero
          valeur={<CountUp to={jours} />}
          suffixe="jours"
          legende={`du ${frenchDayMonth(f.start)} au ${frenchDayMonth(f.end)}`}
          couleur={teinte}
        />
      </Reveal>
      <Reveal ordre={2}>
        {/* Le « chaque jour » est déjà dans le héros (28 jours, du … au …) :
            le répéter ici coûtait une quatrième ligne de titre. */}
        <h1 className="text-4xl font-black leading-[1.05]">
          100 pompes, 100 abdos, 100 squats.
        </h1>
      </Reveal>
      <Reveal ordre={3}>
        <p className="text-muted">
          Le soir, tu appuies sur « Lancer ma séance ». L&apos;app affiche un
          chiffre, tu le fais, tu tapes « Terminé ». Une douzaine de fois, un
          quart d&apos;heure.
        </p>
      </Reveal>
      <Reveal ordre={4}>
        <p className="text-lg font-bold">Pas de séance, pas de journée.</p>
      </Reveal>
    </div>,

    // 2 — Le chiffre du jeu, et ce que la régularité en fait.
    <div key="points" className="space-y-6">
      <Reveal ordre={0}>
        <p className={eyebrow}>Les points</p>
      </Reveal>
      <Reveal ordre={1}>
        <Hero
          valeur={<CountUp to={7} />}
          legende="points pour une journée complète"
          couleur={teinte}
        />
      </Reveal>
      <Reveal ordre={2}>
        <div className="flex gap-8 border-t border-line pt-5">
          <Stat valeur={10.5} label="le même soir, à 3 jours d'affilée" rang={0} />
          <Stat valeur={14} label="le même soir, à 7 jours d'affilée" rang={1} />
        </div>
      </Reveal>
      <Reveal ordre={3}>
        <p className="text-muted">
          Un jour sauté remet ce compteur à zéro. Ce n&apos;est pas le gros
          soir qui gagne le challenge, c&apos;est celui qui ne s&apos;arrête
          pas.
        </p>
      </Reveal>
    </div>,

    // 3 — Le duel. La carte où quelqu'un d'autre entre dans l'écran.
    <div key="duel" className="space-y-6">
      <Reveal ordre={0}>
        <p className={eyebrow}>Le lundi</p>
      </Reveal>
      <Reveal ordre={1}>
        <Hero
          valeur={<CountUp to={3} />}
          legende="points en jeu, contre un seul joueur"
          couleur={teinte}
        />
      </Reveal>
      <Reveal ordre={2}>
        <p className="text-muted">
          Chaque lundi, tu es mis face au joueur qui te colle au classement.
          Celui qui a le plus de journées complètes d&apos;ici dimanche les
          prend à l&apos;autre.{" "}
          <b className="text-ink">
            C&apos;est le seul endroit du jeu où on peut en perdre.
          </b>
        </p>
      </Reveal>
      <Reveal ordre={3}>
        <div className="flex gap-8 border-t border-line pt-5">
          <Stat valeur={3} label="au meilleur de la semaine" rang={0} />
          <Stat valeur={5} label="à qui fait ses sept jours" rang={1} />
        </div>
      </Reveal>
    </div>,

    // 4 — Ce qu'on ajoute. Le héros est un exemple, pas une règle : c'est
    // la carte qui résiste le plus au gabarit « un chiffre par écran ».
    <div key="bonus" className="space-y-6">
      <Reveal ordre={0}>
        <p className={eyebrow}>En faire plus</p>
      </Reveal>
      <Reveal ordre={1}>
        <Hero
          valeur={<CountUp to={20} />}
          legende="points pour 10 km de course, déclarés le soir même"
          couleur={teinte}
        />
      </Reveal>
      <Reveal ordre={2}>
        <div className="flex gap-8 border-t border-line pt-5">
          <Stat valeur={4} label="50 pompes de plus" rang={0} />
          <Stat valeur={4} label="100 abdos de plus" rang={1} />
          <Stat valeur={8} label="5 km de course" rang={2} />
        </div>
      </Reveal>
      <Reveal ordre={3}>
        <p className="text-muted">
          Deux gars qui font leurs trois exos tous les soirs finissent à
          égalité. C&apos;est ici que ça se décide.
        </p>
      </Reveal>
    </div>,

    // 5 — Le tirage, et la phrase de sortie.
    <div key="tirage" className="space-y-6">
      <Reveal ordre={0}>
        <p className={eyebrow}>Chaque matin</p>
      </Reveal>
      <Reveal ordre={1}>
        <Hero
          valeur={<CountUp to={14} />}
          suffixe="au lieu de 7"
          legende="ta journée, un jour de quitte ou double"
          couleur={teinte}
        />
      </Reveal>
      <Reveal ordre={2}>
        <div className="space-y-2.5 border-t border-line pt-5">
          <Ligne emoji="🎲">
            un exo compte double. Si ce sont les pompes, tes pompes du jour
            valent le double
          </Ligne>
          <Ligne emoji="🎰">
            quitte ou double : tu finis tes trois exos, ta journée compte
            double. Tu ne finis pas, tu ne perds rien
          </Ligne>
          <Ligne emoji="👊">
            le boss du dimanche : 200 pompes dans la journée, et tu prends +10
          </Ligne>
        </div>
      </Reveal>
      <Reveal ordre={3}>
        <p className="text-muted">
          Le {frenchDayMonth(f.end)}, il y aura un premier au classement. Ce
          soir, tout le monde est à zéro.
        </p>
      </Reveal>
    </div>,
  ];

  const last = i === cards.length - 1;

  return (
    <main
      style={
        {
          // Le texte secondaire monte d'un cran : il reste posé sur un fond
          // teinté, où les gris de l'app perdent du contraste.
          "--color-muted": "oklch(0.78 0 0)",
          "--color-faint": "oklch(0.68 0 0)",
          color: "var(--color-ink)",
          background: "var(--color-bg)",
        } as React.CSSProperties
      }
      className="fixed inset-0 z-50 isolate flex flex-col overflow-hidden pt-safe pb-safe"
    >
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

      {/* En-tête : progression + sortie. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
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
          onClick={onDone}
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          {replay ? "Fermer" : "Passer"}
        </button>
      </div>

      {/* Les zones de tap des stories : un tiers à gauche pour revenir. */}
      <div className="relative flex flex-1 flex-col justify-center px-8 text-left">
        <div key={i} className="pointer-events-none relative z-10">
          {cards[i]}
        </div>
        {i > 0 && (
          <button
            onClick={() => setI((v) => Math.max(0, v - 1))}
            aria-label="Carte précédente"
            className="absolute inset-y-0 left-0 z-0 w-1/3"
          />
        )}
        {!last && (
          <button
            onClick={() => setI((v) => v + 1)}
            aria-label="Carte suivante"
            className={`absolute inset-y-0 right-0 z-0 ${i > 0 ? "w-2/3" : "w-full"}`}
          />
        )}
      </div>

      <div className="px-6 pb-3">
        {last ? (
          <BigButton onClick={onDone}>{replay ? "Fermer" : "C'est parti"}</BigButton>
        ) : (
          <p className="py-3 text-center text-sm text-faint">
            Tape pour continuer
          </p>
        )}
      </div>
    </main>
  );
}
