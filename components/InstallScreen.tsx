"use client";

// Écran d'installation PWA. Le seul endroit où l'app a le droit d'être lourde :
// sans installation, pas de notifs (phase 2) et Safari purge le localStorage
// des sites peu visités — l'identité du joueur saute au bout de 7 jours.

import { useState } from "react";
import { BigButton } from "./ui";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Props = {
  installPrompt: InstallPromptEvent | null;
  onLater: () => void;
  /** Le libellé de la sortie. « Plus tard » quand l'écran s'impose à
      l'ouverture, « Retour » quand c'est le bandeau de l'accueil qui l'a
      ouvert — on ne repousse pas une chose qu'on vient de demander. */
  libelleRetour?: string;
};

/**
 * Le navigateur intégré d'une appli de messagerie (WhatsApp, Instagram,
 * Messenger…).
 *
 * C'est le cas par défaut, pas le cas rare : le lien d'une ligue se colle
 * dans une conversation, donc il s'ouvre dans le navigateur de cette
 * conversation. Or « Sur l'écran d'accueil » n'y existe pas — la marche à
 * suivre iOS ci-dessous désignait un bouton Partager que ces gens n'ont
 * jamais eu sous les yeux. Il faut d'abord ressortir dans Safari.
 */
function navigateurIntegre(ua: string, isIOS: boolean) {
  if (
    /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Messenger|Snapchat|LinkedInApp|MicroMessenger|BytedanceWebview|musical_ly/i.test(
      ua,
    )
  )
    return true;
  // Repli iOS pour les webviews qui ne se nomment pas : une WKWebView tierce
  // perd le jeton « Safari/ » que Safari garde — comme Chrome iOS (CriOS) et
  // Firefox iOS (FxiOS), qui sont de vrais navigateurs et restent donc dehors.
  return isIOS && !/Safari\//.test(ua);
}

/** Icône "Partager" iOS (carré + flèche vers le haut). */
function ShareIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12M8 6.5 12 3l4 3.5M6 10H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4 rounded-2xl bg-surface p-4">
      <span className="num-display text-2xl text-faint">{n}</span>
      <span className="flex items-center gap-2 font-medium">{children}</span>
    </li>
  );
}

export default function InstallScreen({
  installPrompt,
  onLater,
  libelleRetour = "Plus tard",
}: Props) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const integre = navigateurIntegre(ua, isIOS);
  const [copie, setCopie] = useState(false);

  async function installAndroid() {
    if (!installPrompt) return;
    await installPrompt.prompt();
  }

  /** Le lien de la ligue, pour le recoller dans la barre d'adresse du vrai
      navigateur. Le seul geste qui marche quand le menu « Ouvrir dans… »
      est introuvable — et il l'est, d'une appli à l'autre. */
  async function copierLien() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopie(true);
    } catch {
      setCopie(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-safe pb-safe">
      <header className="mt-10">
        <h1 className="text-3xl font-bold">
          {integre ? "Ouvre-la d'abord dans Safari" : "Installe l'app, sérieux"}
        </h1>
        <p className="mt-2 text-muted">
          {integre
            ? "Tu es dans le navigateur de la messagerie, et lui ne sait pas ajouter à l'écran d'accueil. Deux taps pour en sortir."
            : "Sans elle sur ton écran d'accueil, Safari efface ton profil au bout d'une semaine et tu repars de zéro. 10 secondes, une fois."}
        </p>
      </header>

      <div className="mt-8 flex-1">
        {integre ? (
          <>
            <ol className="flex flex-col gap-3">
              <Step n={1}>
                Ouvre le menu <b>{isIOS ? "⋯" : "⋮"}</b> de la page
              </Step>
              <Step n={2}>
                Choisis{" "}
                <b>
                  «&nbsp;Ouvrir dans {isIOS ? "Safari" : "Chrome"}&nbsp;»
                </b>
              </Step>
              <Step n={3}>
                Là-bas, {isIOS ? <ShareIcon /> : <b>⋮</b>}{" "}
                <b>«&nbsp;Sur l&apos;écran d&apos;accueil&nbsp;»</b>
              </Step>
            </ol>
            <button
              onClick={copierLien}
              className="mt-4 min-h-12 w-full rounded-2xl border border-line bg-surface px-5 font-medium"
            >
              {copie ? "Lien copié — colle-le là-bas" : "Copier le lien"}
            </button>
          </>
        ) : isIOS ? (
          <ol className="flex flex-col gap-3">
            <Step n={1}>
              Tape sur <ShareIcon /> <b>Partager</b> en bas de Safari
            </Step>
            <Step n={2}>
              Choisis <b>«&nbsp;Sur l&apos;écran d&apos;accueil&nbsp;»</b>
            </Step>
            <Step n={3}>
              Tape <b>Ajouter</b>, puis ouvre l&apos;app depuis l&apos;icône
            </Step>
          </ol>
        ) : installPrompt ? (
          <BigButton onClick={installAndroid}>
            Installer sur l&apos;écran d&apos;accueil
          </BigButton>
        ) : (
          <ol className="flex flex-col gap-3">
            <Step n={1}>
              Ouvre le menu <b>⋮</b> de Chrome
            </Step>
            <Step n={2}>
              Choisis <b>«&nbsp;Ajouter à l&apos;écran d&apos;accueil&nbsp;»</b>
            </Step>
          </ol>
        )}
      </div>

      <button
        onClick={onLater}
        className="min-h-12 self-center px-6 text-sm font-medium text-faint"
      >
        {libelleRetour}
      </button>
    </main>
  );
}
