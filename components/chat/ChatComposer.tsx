"use client";

// La barre de saisie. Collée en bas, juste au-dessus des onglets — et
// au-dessus du clavier dès qu'il s'ouvre, via --kb (hooks/useKeyboardInset).
//
// `bottom: max(--tabbar-h, --kb)` fait les deux cas d'un coup : sans
// clavier, --kb vaut 0 et la barre se pose sur les onglets ; clavier
// ouvert, --kb dépasse la hauteur des onglets (que le clavier recouvre
// de toute façon) et la barre monte avec lui.

import { useEffect, useRef, useState } from "react";
import {
  CHAT_BODY_MAX,
  insertMention,
  mentionQuery,
  nameStartsWith,
} from "@/lib/chat";
import { Player } from "@/lib/types";
import { Avatar } from "../ui";

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
  /** Les potes proposés au `@`. Moi exclu par l'appelant : se mentionner
      soi-même ne prévient personne et n'informe personne. */
  mentionnables: Player[];
  onSend: (body: string) => void;
};

export default function ChatComposer({
  citation,
  mentionnables,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  // La position du curseur, suivie à la main : c'est elle qui dit si on
  // est en train de taper une mention, et où l'insérer.
  const [caret, setCaret] = useState(0);
  // Le curseur à reposer après une insertion. React réécrit la valeur du
  // textarea au rendu suivant et remet le curseur à la fin ; sans ce
  // report, insérer « @Léo » au milieu d'une phrase renvoie la frappe
  // tout au bout.
  const aReplacer = useRef<number | null>(null);
  const zone = useRef<HTMLTextAreaElement>(null);

  // La hauteur suit le contenu, jusqu'à quatre lignes.
  useEffect(() => {
    const el = zone.current;
    if (!el) return;
    el.style.height = "auto";
    const ligne = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, ligne * LIGNES_MAX + 16)}px`;
  }, [draft]);

  useEffect(() => {
    const pos = aReplacer.current;
    if (pos === null || !zone.current) return;
    aReplacer.current = null;
    zone.current.setSelectionRange(pos, pos);
    zone.current.focus();
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
    setCaret(0);
  }

  /** Suit le curseur à chaque événement qui peut le déplacer. */
  function suivreCurseur(e: { currentTarget: HTMLTextAreaElement }) {
    setCaret(e.currentTarget.selectionStart ?? 0);
  }

  const requete = mentionQuery(draft, caret);
  const suggestions = requete
    ? mentionnables.filter((p) => nameStartsWith(p.name, requete.terme))
    : [];

  function choisir(p: Player) {
    const next = insertMention(draft, caret, p.name);
    aReplacer.current = next.caret;
    setDraft(next.body);
    setCaret(next.caret);
    navigator.vibrate?.(8);
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
      {suggestions.length > 0 && (
        // Au-dessus de la saisie, pas en dessous : en dessous, la liste
        // naît sous le clavier et personne ne la voit jamais.
        <ul
          className="mb-2 max-h-52 overflow-y-auto rounded-2xl bg-raised"
          aria-label="Mentionner un pote"
        >
          {suggestions.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => choisir(p)}
                className="flex min-h-13 w-full items-center gap-2.5 border-b border-line px-3 py-2 text-left last:border-b-0"
              >
                <Avatar name={p.name} color={p.color} photo={p.photo} size={28} />
                <span className="font-bold" style={{ color: p.color }}>
                  {p.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

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
          onChange={(e) => {
            setDraft(e.target.value.slice(0, CHAT_BODY_MAX));
            suivreCurseur(e);
          }}
          onSelect={suivreCurseur}
          onClick={suivreCurseur}
          onKeyUp={suivreCurseur}
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
