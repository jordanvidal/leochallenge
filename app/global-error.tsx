"use client";

// Le filet du filet : `app/error.tsx` ne rattrape que ce qui casse SOUS le
// layout racine. Si c'est le layout lui-même qui tombe, Next remplace tout
// l'arbre par ce fichier — d'où le <html> et le <body> à écrire à la main.
//
// Conséquence : ni globals.css ni les fonts ne sont chargés ici. Les
// styles sont donc en dur, et volontairement minimaux. Un écran qu'on ne
// verra probablement jamais n'a pas à être joli, il a à s'afficher même
// quand tout le reste a échoué.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "2rem",
          textAlign: "center",
          background: "#131313",
          color: "#f4f4f4",
          font: "16px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        }}
      >
        <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700 }}>
          Ça a cassé
        </p>
        <p style={{ margin: 0, color: "#adadad" }}>
          L&apos;app n&apos;a pas pu démarrer. Rien n&apos;est perdu : tes
          coches sont en base.
        </p>
        <button
          onClick={reset}
          style={{
            minHeight: 44,
            marginTop: "0.5rem",
            padding: "0 1.5rem",
            border: 0,
            borderRadius: 12,
            background: "#383838",
            color: "#f4f4f4",
            font: "inherit",
            fontWeight: 700,
          }}
        >
          Réessayer
        </button>
        {error.digest && (
          <p style={{ margin: 0, fontSize: 11, color: "#737373" }}>
            Code : {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
