"use client";

// Écran de lancement de la saison 4 : même carrousel que LaunchS3Screen —
// plein écran, barres de progression, tap pour avancer, BigButton à la fin.
// Montré une fois à partir du 03/08 (flag localStorage, garde côté App),
// rejouable depuis Stats la première semaine.
//
// Quatre slides, pas sept. La S3 était une refonte du barème : il fallait
// un bilan chiffré, « ce qui arrive » et « ce qui dégage ». La S4 ajoute
// trois règles et n'en retire aucune — un carrousel de la longueur de la
// S3 mentirait sur l'ampleur du changement, et un joueur qui tape sept
// fois pour apprendre trois choses n'en retient aucune.
//
// Pas de bilan tiré de la base ici, pour la même raison : rien ne se
// clôt le 02/08. Le classement général continue, les compteurs de la
// semaine aussi. Il n'y a pas de saison à enterrer, juste des règles à
// annoncer la veille au soir de leur entrée en vigueur.

import { useState } from "react";
import { SAISON4_START, diffDays, frenchDate } from "@/lib/challenge";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  /** Rejeu manuel : le bouton final dit « Fermer » au lieu du CTA séance. */
  replay?: boolean;
  onDone: () => void;
  /** CTA de la dernière slide : ferme l'écran ET lance la séance du jour. */
  onLaunchSession?: () => void;
};

/** Une ligne « ce qui change » : emoji + phrase courte. */
function NewsRow({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
        {icon}
      </span>
      <span className="text-sm leading-snug text-muted">{children}</span>
    </div>
  );
}

export default function LaunchS4Screen({
  player,
  replay = false,
  onDone,
  onLaunchSession,
}: Props) {
  const f = useFenetre();
  // Jours restants comptés depuis le 03/08, pas depuis aujourd'hui : la
  // phrase doit dire la même chose à celui qui ouvre l'écran le dimanche
  // soir en aperçu et à celui qui le découvre lundi matin.
  const joursRestants = diffDays(SAISON4_START, f.end) + 1;

  const accent = { color: player.color } as React.CSSProperties;
  const eyebrow = "text-sm font-semibold uppercase tracking-widest";
  const vanne = "mt-6 border-l-2 pl-3 text-ink";
  const badge =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide";
  const badgeStyle = {
    background: player.color,
    color: "var(--color-bg)",
  } as React.CSSProperties;

  const cards = [
    // 1 — Ouverture
    <div key="ouverture">
      <p className={eyebrow} style={accent}>
        Saison 4 · {frenchDate(SAISON4_START)}
      </p>
      <h1 className="mt-4 text-4xl font-black">Trois règles de plus.</h1>
      <p className="mt-4 text-lg text-muted">
        Rien ne disparaît : le barème de la S3 tient. On lui ajoute un jour de
        repos et deux tirages.
      </p>
      <p className={vanne} style={{ borderColor: player.color }}>
        Un jour de repos dans la poche, et deux façons de plus de rafler des
        points. Personne n&apos;a dit que ça serait plus facile. 💪
      </p>
    </div>,

    // 2 — Le jour off. Sa propre slide : c'est le seul changement qui
    // touche la série, donc le seul qu'on ne peut pas résumer en trois mots.
    <div key="jour-off">
      <span className={badge} style={badgeStyle}>
        😴 Nouveau
      </span>
      <h1 className="mt-4 text-3xl font-black">Le jour off</h1>
      <p className="mt-3 text-lg text-muted">
        Un jour par semaine, le même pour tout le monde, où ta série tient sans
        que tu coches quoi que ce soit.
      </p>
      <div className="mt-5 space-y-3">
        <NewsRow icon="🎲">
          Tiré <b className="text-ink">au hasard du lundi au vendredi</b> —
          jamais le week-end, un par semaine.
        </NewsRow>
        <NewsRow icon="🔔">
          Tu le découvres <b className="text-ink">le matin même</b>, par une
          notif vers 6h. Personne ne le connaît à l&apos;avance.
        </NewsRow>
        <NewsRow icon="🛟">
          Il <b className="text-ink">préserve ta série sans l&apos;allonger</b>,
          comme le joker — et ton joker, lui, ne part jamais dessus.
        </NewsRow>
        <NewsRow icon="📅">
          Il compte comme rempli pour{" "}
          <b className="text-ink">la semaine pleine</b> : six jours parfaits
          plus le jour off valent les{" "}
          <b className="font-bold" style={accent}>
            +5
          </b>
          .
        </NewsRow>
        <NewsRow icon="💪">
          Tu peux <b className="text-ink">t&apos;entraîner quand même</b> : rien
          n&apos;est verrouillé, et ta journée compte comme un vrai 3/3.
        </NewsRow>
      </div>
      <p className={vanne} style={{ borderColor: player.color }}>
        C&apos;est une permission, pas une fermeture. Personne ne t&apos;en
        voudra d&apos;y aller quand même.
      </p>
    </div>,

    // 3 — Les deux nouveaux tirages
    <div key="tirages">
      <span className={badge} style={badgeStyle}>
        ⚡ Nouveau
      </span>
      <h1 className="mt-4 text-3xl font-black">Deux nouveaux bonus</h1>
      <p className="mt-3 text-lg text-muted">
        Deux tirages de plus dans la roue du matin, à partir de lundi.
      </p>
      <div className="mt-5 space-y-3">
        <NewsRow icon="🔁">
          <b className="text-ink">Bonus doublés</b> — toutes les puces que tu
          déclares ce jour-là sont payées <b className="text-ink">deux fois</b>.
          Sans plafond : c&apos;est le plus gros tirage du jeu.
        </NewsRow>
        <NewsRow icon="🎁">
          <b className="text-ink">Jour de fête</b> —{" "}
          <b className="font-bold" style={accent}>
            +5
          </b>{" "}
          si tu boucles ton 3/3. Rien à déclarer, aucune heure à viser.
        </NewsRow>
        <NewsRow icon="😴">
          Un <b className="text-ink">jour off n&apos;a pas d&apos;événement</b>{" "}
          : « repose-toi » à 6h et « charge sur les bonus » à 9h se
          contrediraient.
        </NewsRow>
      </div>
      <p className={vanne} style={{ borderColor: player.color }}>
        Le jour où ça tombe, tes puces comptent double. Autant en avoir sous le
        coude. 🎰
      </p>
    </div>,

    // 4 — Coup d'envoi
    <div key="envoi">
      <p className={eyebrow} style={accent}>
        Coup d&apos;envoi
      </p>
      <h1 className="mt-4 text-4xl font-black">
        {joursRestants} jours.
        <br />
        Ça se joue là.
      </h1>
      <p className="mt-4 text-lg text-muted">
        Le classement de la semaine repart à zéro, comme chaque lundi. Le
        général, lui, ne s&apos;efface pas : tout ce que tu as encaissé reste
        acquis.
      </p>
      <p className={vanne} style={{ borderColor: player.color }}>
        Personne ne se souviendra du soir où t&apos;as eu la flemme. Tout le
        monde verra le classement du 31 août. 💥
      </p>
    </div>,
  ];

  const [i, setI] = useState(0);
  const last = i === cards.length - 1;

  // Sur la dernière slide, la zone de tap termine au lieu de se désactiver :
  // un « bouton, non disponible » qui recouvre le CTA final décrivait un
  // contrôle cassé (même pattern que TutorialScreen).
  function next() {
    if (last) finish();
    else setI((v) => v + 1);
  }

  function finish() {
    if (!replay && onLaunchSession) onLaunchSession();
    else onDone();
  }

  return (
    <main className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      {/* En-tête : progression + passer. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
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
          onClick={onDone}
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          {replay ? "Fermer" : "Passer"}
        </button>
      </div>

      {/* Zone de tap : tape n'importe où pour avancer, terminer sur la dernière. */}
      <button
        onClick={next}
        aria-label={last ? "Terminer" : "Slide suivante"}
        className="flex flex-1 flex-col justify-center px-8 text-left"
      >
        <div key={i} className="rise-in">
          {cards[i]}
        </div>
      </button>

      {/* Pied : CTA net sur la dernière slide, sinon indice de tap. */}
      <div className="px-6 pb-3">
        {last ? (
          <BigButton onClick={finish}>
            {replay ? "Fermer" : "Démarrer la S4"}
          </BigButton>
        ) : (
          <p className="py-3 text-center text-sm text-faint">
            Tape pour continuer
          </p>
        )}
      </div>
    </main>
  );
}
