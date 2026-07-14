"use client";

// Écran d'installation PWA. Le seul endroit où l'app a le droit d'être lourde :
// sans installation, pas de notifs (phase 2) et Safari purge le localStorage
// des sites peu visités — l'identité du joueur saute au bout de 7 jours.

import { BigButton } from "./ui";

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Props = {
  installPrompt: InstallPromptEvent | null;
  onLater: () => void;
};

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

export default function InstallScreen({ installPrompt, onLater }: Props) {
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  async function installAndroid() {
    if (!installPrompt) return;
    await installPrompt.prompt();
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-safe pb-safe">
      <header className="mt-10">
        <h1 className="text-3xl font-bold">Installe l&apos;app, sérieux</h1>
        <p className="mt-2 text-muted">
          Sans elle sur ton écran d&apos;accueil, Safari efface ton profil au
          bout d&apos;une semaine et tu repars de zéro. 10 secondes, une fois.
        </p>
      </header>

      <div className="mt-8 flex-1">
        {isIOS ? (
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
        Plus tard
      </button>
    </main>
  );
}
