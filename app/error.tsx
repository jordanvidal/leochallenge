"use client";

// Le filet. Toute l'app tient dans un seul composant client (`<App />`),
// et le HTML servi est vide : une exception au rendu ne laissait donc
// rien du tout à l'écran — pas un message, pas un bouton, juste du blanc.
// Personne ne sait si ça charge ou si c'est mort, et le réflexe est de
// fermer l'app.
//
// Ce fichier ne répare aucun bug : il rend la panne lisible et laisse une
// porte de sortie. React remonte l'arbre au `reset()`, ce qui suffit quand
// l'erreur venait d'un état transitoire (une donnée à moitié arrivée). Si
// elle revient, le rechargement complet repart d'un bundle propre.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Pas de service de tracking dans ce projet : la console reste le seul
    // endroit où lire ce qui s'est passé quand quelqu'un tend son téléphone.
    console.error("[100·100·100] écran d'erreur :", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-lg font-bold">Ça a cassé</p>
      <p className="text-muted">
        L&apos;app s&apos;est arrêtée en cours de route. Rien n&apos;est
        perdu : tes coches sont en base.
      </p>
      <div className="mt-2 flex flex-col items-center gap-2">
        <button
          onClick={reset}
          className="min-h-11 rounded-xl px-6 font-bold"
          style={{ background: "var(--color-raised)", color: "var(--color-ink)" }}
        >
          Réessayer
        </button>
        <button
          onClick={() => window.location.reload()}
          className="min-h-11 px-4 text-sm text-faint"
        >
          Recharger l&apos;app
        </button>
      </div>
      {error.digest && (
        <p className="mt-2 text-[11px] text-faint">Code : {error.digest}</p>
      )}
    </main>
  );
}
