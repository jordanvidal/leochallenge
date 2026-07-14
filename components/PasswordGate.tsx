"use client";

// Porte d'entrée à mot de passe partagé. Bloque le passant, pas le NSA.
// Un seul passage : le flag va en localStorage et on n'y revient plus.

import { useState } from "react";
import { BigButton } from "./ui";

export default function PasswordGate({ onPass }: { onPass: () => void }) {
  const [value, setValue] = useState("");
  const [wrong, setWrong] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const expected = process.env.NEXT_PUBLIC_GROUP_PASSWORD ?? "";
    if (expected !== "" && value.trim() === expected) {
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
          Pompes, abdos, squats. Tous les jours jusqu&apos;au 31 août.
        </p>

        <form onSubmit={submit} className={`mt-10 ${wrong ? "shake" : ""}`}>
          <label htmlFor="pw" className="text-sm font-medium text-muted">
            Mot de passe du groupe
          </label>
          <input
            id="pw"
            type="password"
            inputMode="text"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setWrong(false);
            }}
            className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface px-5 text-lg text-ink outline-none focus:border-faint"
            autoFocus
          />
          {wrong && (
            <p className="mt-2 text-sm font-medium text-danger" role="alert">
              Raté. Demande au groupe.
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
