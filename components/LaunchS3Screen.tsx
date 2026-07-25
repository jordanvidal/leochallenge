"use client";

// Écran de lancement de la saison 3 : un carrousel qu'on tape pour avancer,
// calqué sur TutorialScreen (plein écran, barres de progression, BigButton).
// Montré une fois à partir du 27/07 (flag localStorage, garde côté App),
// rejouable. Bilan S2 + ce qui change, ton vannard.
//
// ⚠️ Les chiffres S2 sont FIGÉS À LA MAIN le dimanche 23h30, une fois la
// saison close. N'éditer que le bloc S2 ci-dessous — rien d'autre.

import { useEffect, useState } from "react";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";

const S2 = {
  // Moyenne de répétitions par joueur (à définir dimanche : dénominateur =
  // joueurs ayant coché au moins une fois). Placeholder en attendant.
  moyenneReps: 2500,
  totalReps: 17300,
  joursParfaits: 57,
  // Podium du classement général au soir de la S2. Révélé 3e → 2e → 1er.
  podium: [
    { medaille: "🥇", nom: "Doren", note: "En tête au général. Le stratège des points." },
    { medaille: "🥈", nom: "Hichem", note: "12/12 parfaits. La machine n'a jamais calé." },
    { medaille: "🥉", nom: "Pierre", note: "11 sans-faute, collé au train." },
  ],
};

type Props = {
  player: Player;
  /** Rejeu manuel : le bouton final dit « Fermer » au lieu du CTA séance. */
  replay?: boolean;
  onDone: () => void;
  /** CTA de la dernière slide : ferme l'écran ET lance la première séance. */
  onLaunchSession?: () => void;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Compteur qui monte de 0 à `to` au montage. Respecte reduced-motion. */
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setN(to);
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const dur = 1000;
    const step = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n.toLocaleString("fr-FR")}</>;
}

/** Podium révélé de bas en haut : le 3e d'abord, puis le 2e, puis le 1er. */
function PodiumReveal({ color }: { color: string }) {
  const rows = S2.podium;
  const [step, setStep] = useState(prefersReducedMotion() ? rows.length : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const ids = rows.map((_, i) =>
      setTimeout(() => setStep((s) => Math.max(s, i + 1)), 350 + i * 650),
    );
    return () => ids.forEach(clearTimeout);
  }, [rows.length]);

  return (
    <div className="mt-5 space-y-3">
      {rows.map((p, k) => {
        // index k=0 (or) est en haut mais révélé en dernier : il faut
        // step >= rows.length - k pour qu'une ligne apparaisse.
        const shown = step >= rows.length - k;
        return (
          <div
            key={p.nom}
            className="flex items-baseline gap-3 border-b border-line pb-3 last:border-0"
            style={{
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : "translateY(10px)",
              transition: "opacity .45s ease, transform .45s ease",
            }}
          >
            <span className="text-2xl leading-none" aria-hidden>
              {p.medaille}
            </span>
            <div>
              <p className="text-xl font-bold" style={{ color }}>
                {p.nom}
              </p>
              <p className="text-sm text-muted">{p.note}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

export default function LaunchS3Screen({
  player,
  replay = false,
  onDone,
  onLaunchSession,
}: Props) {
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
        Saison 3 · lundi 27 juillet
      </p>
      <h1 className="mt-4 text-4xl font-black">On remet ça.</h1>
      <p className="mt-4 text-lg text-muted">
        La S2 est pliée. Douze jours dans les pattes, et déjà l&apos;envie
        d&apos;y retourner.
      </p>
      <p className={vanne} style={{ borderColor: player.color }}>
        Spoiler : personne n&apos;a assez souffert. On rempile. 💪
      </p>
    </div>,

    // 2 — La moyenne
    <div key="reps">
      <p className={eyebrow} style={accent}>
        Ce que vous avez encaissé
      </p>
      <p className="num-display mt-4 text-6xl font-black" style={accent}>
        <CountUp to={S2.moyenneReps} />
      </p>
      <p className="mt-3 text-lg font-semibold">
        répétitions chacun, en moyenne.
      </p>
      <p className="mt-1 text-sm text-muted">
        {S2.totalReps.toLocaleString("fr-FR")} en tout · en douze jours
      </p>
      <p className={vanne} style={{ borderColor: player.color }}>
        Vos muscles vous détestent. C&apos;est le but.
      </p>
    </div>,

    // 3 — Jours parfaits
    <div key="parfaits">
      <p className={eyebrow} style={accent}>
        Le contrat
      </p>
      <p className="num-display mt-4 text-6xl font-black" style={accent}>
        <CountUp to={S2.joursParfaits} />
      </p>
      <p className="mt-3 text-lg font-semibold">
        journées bouclées à 100 / 100 / 100.
      </p>
      <p className={vanne} style={{ borderColor: player.color }}>
        {S2.joursParfaits} fois le carton plein. La flemme n&apos;a pas gagné
        souvent.
      </p>
    </div>,

    // 4 — Podium (révélé 3e → 2e → 1er)
    <div key="podium">
      <p className={eyebrow} style={accent}>
        Le podium S2
      </p>
      <PodiumReveal color={player.color} />
      <p className={vanne} style={{ borderColor: player.color }}>
        Cinq acharnés, un mouchoir de poche au classement. La S3 va faire mal.
      </p>
    </div>,

    // 5 — Ce qui arrive
    <div key="arrive">
      <span className={badge} style={badgeStyle}>
        ⚡ À partir d&apos;aujourd&apos;hui
      </span>
      <h1 className="mt-4 text-3xl font-black">Ce qui arrive</h1>
      <div className="mt-5 space-y-3">
        <NewsRow icon="✅">
          Jour parfait :{" "}
          <b className="font-bold" style={accent}>
            +4
          </b>{" "}
          — le double d&apos;avant.
        </NewsRow>
        <NewsRow icon="📅">
          <b className="text-ink">La semaine pleine</b> — 7/7 du lundi au
          dimanche :{" "}
          <b className="font-bold" style={accent}>
            +5
          </b>
          .
        </NewsRow>
        <NewsRow icon="🎲">
          Le doublement ne vise plus que les pompes :{" "}
          <b className="text-ink">abdos et squats aussi</b>.
        </NewsRow>
        <NewsRow icon="🏃">
          Nouveau : le <b className="text-ink">10 km</b>,{" "}
          <b className="font-bold" style={accent}>
            +20
          </b>{" "}
          d&apos;un coup.
        </NewsRow>
        <NewsRow icon="🚶">
          <b className="text-ink">Un seul déplacement par jour</b> : 5 km, 10 km
          ou 10 000 pas — un 10 km, c&apos;est déjà 11 000 pas.
        </NewsRow>
      </div>
      <p className={vanne} style={{ borderColor: player.color }}>
        Fini de briller un jour sur trois : c&apos;est la constance qui rafle
        tout.
      </p>
    </div>,

    // 6 — Ce qui dégage
    <div key="degage">
      <span className={badge} style={badgeStyle}>
        ✂️ Ça, c&apos;est fini
      </span>
      <h1 className="mt-4 text-3xl font-black">Ce qui dégage</h1>
      <div className="mt-5 space-y-3">
        <NewsRow icon="⏱️">
          <b className="text-ink">Les bonus de chrono</b> — séance éclair &amp;
          la plus rapide (+2 chacun).
        </NewsRow>
        <NewsRow icon="🕘">
          <b className="text-ink">Les bonus d&apos;horaire</b> — 8h, 22h, happy
          hour, lève-tôt (+2 à +6).
        </NewsRow>
        <NewsRow icon="🥇">
          <b className="text-ink">Le premier du jour</b> (+3) — c&apos;était
          plus une question d&apos;heure que d&apos;effort, on l&apos;assume.
        </NewsRow>
        <NewsRow icon="🤝">
          <b className="text-ink">Le jour parfait collectif</b> (+5 chacun) — il
          devenait plus facile à mesure que le groupe se vidait.
        </NewsRow>
      </div>
      <p className={vanne} style={{ borderColor: player.color }}>
        On garde ce qui récompense l&apos;effort. On range ce qui récompensait
        l&apos;agenda.
      </p>
    </div>,

    // 7 — Coup d'envoi
    <div key="envoi">
      <p className={eyebrow} style={accent}>
        Coup d&apos;envoi
      </p>
      <h1 className="mt-4 text-4xl font-black">
        Lundi.
        <br />
        Minuit pile.
      </h1>
      <p className="mt-4 text-lg text-muted">
        Nouveau barème. Le classement général, lui, ne s&apos;efface pas.
      </p>
      <p className={vanne} style={{ borderColor: player.color }}>
        Seuls les compteurs de la semaine repartent à zéro. Ta place au général,
        tu la défends — ou tu la voles. 💥
      </p>
    </div>,
  ];

  const [i, setI] = useState(0);
  const last = i === cards.length - 1;

  function next() {
    if (!last) setI((v) => v + 1);
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

      {/* Zone de tap : tape n'importe où pour avancer (sauf sur la dernière). */}
      <button
        onClick={next}
        disabled={last}
        aria-label="Slide suivante"
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
            {replay ? "Fermer" : "Lancer ma séance 💥"}
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
