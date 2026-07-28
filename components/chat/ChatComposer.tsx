"use client";

// La barre de saisie. Collée en bas, juste au-dessus des onglets — et
// au-dessus du clavier dès qu'il s'ouvre, via --kb (hooks/useKeyboardInset).
//
// `bottom: max(--tabbar-h, --kb)` fait les deux cas d'un coup : sans
// clavier, --kb vaut 0 et la barre se pose sur les onglets ; clavier
// ouvert, --kb dépasse la hauteur des onglets (que le clavier recouvre
// de toute façon) et la barre monte avec lui.

import { useEffect, useRef, useState } from "react";
import { CHAT_BODY_MAX } from "@/lib/chat";

/** Quatre lignes puis on défile : au-delà, la saisie mange la
    conversation qu'on est en train de commenter. */
const LIGNES_MAX = 4;

/** Ce à quoi le message qu'on écrit se rattache : une réponse à un
    message, ou un moment du fil qu'on vient commenter. La saisie ne sait
    pas lequel des deux c'est, et n'a aucune raison de le savoir. */
export type Citation = {
  titre: string;
  couleur: string;
  texte: string;
  onCancel: () => void;
};

type Props = {
  citation: Citation | null;
  onSend: (body: string) => void;
};

export default function ChatComposer({ citation, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const zone = useRef<HTMLTextAreaElement>(null);

  // La hauteur suit le contenu, jusqu'à quatre lignes.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    el.style.height = "auto";
    const ligne = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, ligne * LIGNES_MAX + 16)}px`;
  }, [draft]);

  // Citer place le curseur dans la saisie : sans ça, répondre ou arriver
  // du fil demande un tap de plus pour rien.
  useEffect(() => {
    if (citation) zone.current?.focus();
  }, [citation]);

  function envoyer() {
    const texte = draft.trim();
    if (!texte) return;
    onSend(texte);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Entrée envoie au clavier physique seulement. Sur un clavier iOS,
    // Entrée doit faire un retour à la ligne : envoyer à sa place rend
    // impossible d'écrire deux lignes, et c'est irrattrapable.
    if (e.key !== "Enter" || e.shiftKey) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    e.preventDefault();
    envoyer();
  }

  const reste = CHAT_BODY_MAX - draft.length;

  return (
    <div
      className="sticky z-20 -mx-5 border-t border-line bg-bg/95 px-5 pt-2 pb-2 backdrop-blur"
      style={{ bottom: "max(var(--tabbar-h), var(--kb))" }}
    >
      {citation && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface px-3 py-2">
          <span className="min-w-0 flex-1">
            <span
              className="block text-[11px] font-bold"
              style={{ color: citation.couleur }}
            >
              {citation.titre}
            </span>
            <span className="block truncate text-xs text-muted">
              {citation.texte}
            </span>
          </span>
          <button
            onClick={citation.onCancel}
            aria-label="Retirer la citation"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={zone}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, CHAT_BODY_MAX))}
          onKeyDown={onKeyDown}
          maxLength={CHAT_BODY_MAX}
          placeholder="Écrire un message"
          aria-label="Écrire un message"
          // text-base = 16px : en dessous, iOS zoome au focus et casse
          // la mise en page pour le reste de la session.
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-2xl bg-surface px-4 py-2.5 text-base leading-snug text-ink placeholder:text-muted focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--pc)" } as React.CSSProperties}
        />
        <button
          onClick={envoyer}
          disabled={draft.trim().length === 0}
          aria-label="Envoyer le message"
          className="flex size-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40"
          style={{ background: "var(--pc)", color: "oklch(0.15 0 0)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12h13M13 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {reste <= 60 && (
        <p className="mt-1 text-right text-[11px] text-faint">
          {reste} caractères restants
        </p>
      )}
    </div>
  );
}
