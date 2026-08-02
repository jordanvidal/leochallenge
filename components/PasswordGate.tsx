"use client";

// Porte d'entrée à secret partagé. Bloque le passant, pas le NSA.
// Un seul passage : le flag va en localStorage et on n'y revient plus.
//
// En groupe unique, le secret est le mot de passe du groupe. En ligue, c'est
// son code d'invitation — le même rôle, tenu par la chose que les gens ont
// déjà reçue. Leur demander un mot de passe *en plus* du lien serait une
// deuxième porte sur le chemin critique, et il n'y en a qu'une.

import { useEffect, useState } from "react";
import { useLigueCourante } from "./ligue/LigueContexte";
import { litCode, litLienInvitation, normaliseCode } from "@/lib/ligue";
import { BigButton } from "./ui";

export default function PasswordGate({ onPass }: { onPass: () => void }) {
  const ligue = useLigueCourante();
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);

  // Le lien d'invitation porte déjà le code (`?c=…`). Le redemander à celui
  // qui vient de cliquer dessus, ce serait lui faire recopier ce qu'il a sous
  // les yeux. On ouvre, et on ne dit rien : une porte franchie sans effort ne
  // se raconte pas.
  useEffect(() => {
    if (!ligue) return;
    const lu = litLienInvitation(window.location.href);
    if (lu?.code && lu.code === ligue.invite_code) onPass();
  }, [ligue, onPass]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const attendu = ligue
      ? ligue.invite_code
      : (process.env.NEXT_PUBLIC_GROUP_PASSWORD ?? "");
    // En ligue le secret est un code : on le normalise comme partout ailleurs,
    // sinon une minuscule ou un tiret de séparation le ferait rater.
    const saisi = ligue ? normaliseCode(value) : value.trim();
    const lu = ligue ? litCode(value) : null;
    const propose = lu?.ok ? lu.code : saisi;

    if (attendu !== "" && propose === attendu) {
      onPass();
    } else {
      setWrong(true);
      setValue("");
      navigator.vibrate?.(60);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-8 pb-safe">
      <div className="mx-auto w-full max-w-sm">
        <p className="num-display text-6xl leading-none">
          100
          <span className="text-faint"> · </span>100
          <span className="text-faint"> · </span>100
        </p>
        <p className="mt-3 text-muted">
          {ligue
            ? `Pompes, abdos, squats. Tous les jours, avec ${ligue.name}.`
            : "Pompes, abdos, squats. Tous les jours jusqu'au 31 août."}
        </p>

        <form onSubmit={submit} className={`mt-10 ${wrong ? "shake" : ""}`}>
          <label htmlFor="pw" className="text-sm font-medium text-muted">
            {ligue ? "Le code de la ligue" : "Mot de passe du groupe"}
          </label>
          <input
            id="pw"
            type={ligue ? "text" : "password"}
            inputMode="text"
            autoComplete="off"
            autoCapitalize={ligue ? "characters" : "off"}
            spellCheck={false}
            placeholder={ligue ? "K7M-2QP" : undefined}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setWrong(false);
            }}
            // Anneau intérieur au lieu d'une border (Inset-Only Rule : la
            // boîte ne change pas de taille), et le focus reprend le pattern
            // de l'app (ChatComposer) : ring-2 à la couleur du joueur, au
            // lieu d'un outline-none qui supprimait le focus clavier.
            className="mt-2 min-h-14 w-full rounded-2xl bg-surface px-5 text-lg text-ink inset-ring inset-ring-line focus:outline-none focus:ring-2"
            style={{ "--tw-ring-color": "var(--pc)" } as React.CSSProperties}
            autoFocus
          />
          {wrong && (
            <p className="mt-2 text-sm font-medium text-danger" role="alert">
              {ligue ? "Ce n'est pas le code. Redemande-le au groupe." : "Raté. Demande au groupe."}
            </p>
          )}
          <div className="mt-4">
            <BigButton>Entrer</BigButton>
          </div>
        </form>
      </div>
    </main>
  );
}
