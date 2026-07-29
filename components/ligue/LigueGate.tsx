"use client";

// Le portier de la ligue : tant qu'on ne sait pas dans quelle ligue on est,
// l'app ne se monte pas. En groupe unique (schéma `public`), il ne fait rien
// et laisse passer — c'est exactement l'app d'aujourd'hui.

import { useState, type ReactNode } from "react";
import { useLigue } from "@/hooks/useLigue";
import type { Ligue } from "@/lib/ligue";
import AccueilLigue from "./AccueilLigue";
import CreerLigue from "./CreerLigue";

function Splash() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <p className="num-display animate-pulse text-4xl text-faint">
        100 · 100 · 100
      </p>
    </main>
  );
}

export default function LigueGate({
  slugUrl,
  children,
}: {
  slugUrl?: string;
  children: ReactNode;
}) {
  const ligue = useLigue(slugUrl);
  const [creation, setCreation] = useState(false);

  if (ligue.etat === "chargement") return <Splash />;

  // `ligue: null` = groupe unique. Rien à choisir, rien à afficher.
  if (ligue.etat === "prete") return <>{children}</>;

  const entre = (l: Ligue) => {
    ligue.installe(l);
    setCreation(false);
  };

  if (creation) {
    return <CreerLigue onCreee={entre} onRetour={() => setCreation(false)} />;
  }

  // Injoignable : le réseau, pas la ligue. On ne propose surtout pas de
  // recréer une ligue à quelqu'un qui en a déjà une et qui est dans le métro
  // — il repartirait avec un doublon.
  if (ligue.etat === "injoignable") {
    return (
      <main className="flex min-h-dvh flex-col justify-center px-6 pb-safe">
        <div className="mx-auto w-full max-w-sm text-center">
          <p className="num-display text-4xl text-faint">100 · 100 · 100</p>
          <p className="mt-6 text-muted">
            Impossible de joindre ta ligue. Vérifie ta connexion.
          </p>
          <button
            onClick={ligue.recharge}
            className="mt-6 min-h-14 w-full rounded-2xl bg-raised px-5 font-bold"
          >
            Réessayer
          </button>
        </div>
      </main>
    );
  }

  return (
    <AccueilLigue
      onTrouvee={entre}
      onCreer={() => setCreation(true)}
      message={
        ligue.etat === "introuvable"
          ? "Cette ligue n'existe plus. Redemande le lien au groupe."
          : undefined
      }
    />
  );
}
