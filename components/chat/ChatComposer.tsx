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
import { fileToChatPhoto, PhotoPrete } from "@/lib/image";
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
  showToast: (msg: string) => void;
  onSend: (body: string, photo: PhotoPrete | null) => void;
};

export default function ChatComposer({
  citation,
  mentionnables,
  showToast,
  onSend,
}: Props) {
  const [draft, setDraft] = useState("");
  /** La photo choisie, DÉJÀ réduite. Le redimensionnement se fait à la
      sélection et pas à l'envoi : une photo illisible se dit tout de
      suite, et l'appui sur Envoyer n'a plus qu'à téléverser. */
  const [photo, setPhoto] = useState<PhotoPrete | null>(null);
  /** L'aperçu, révoqué dès que la photo change ou part. */
  const [apercu, setApercu] = useState<string | null>(null);
  const [prepare, setPrepare] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);
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

  // Un miroir de l'aperçu, parce que le nettoyage ci-dessous ne tourne
  // qu'au démontage et ne doit donc dépendre d'aucune valeur qui change.
  const apercuRef = useRef<string | null>(null);
  apercuRef.current = apercu;

  // Quitter le tchat avec une photo en attente ne doit pas laisser ses
  // octets accrochés au document.
  useEffect(() => {
    return () => {
      if (apercuRef.current) URL.revokeObjectURL(apercuRef.current);
    };
  }, []);

  function envoyer() {
    const texte = draft.trim();
    // Une photo part sans légende ; un message sans photo ne part pas vide.
    if (!texte && !photo) return;
    onSend(texte, photo);
    setDraft("");
    setCaret(0);
    // Révoquer notre aperçu ne casse pas la bulle qui part : le hook
    // fabrique sa PROPRE URL à partir du même blob, qu'il tient encore.
    oublierPhoto();
  }

  /** Range la photo choisie et rend la mémoire de son aperçu. */
  function oublierPhoto() {
    setApercu((url) => {
      if (url) URL.revokeObjectURL(url);
      return null;
    });
    setPhoto(null);
    // Sans ça, rechoisir LE MÊME fichier juste après ne déclencherait
    // aucun change : le champ garde sa valeur, donc rien ne bouge.
    if (fichier.current) fichier.current.value = "";
  }

  async function choisirPhoto(f: File | undefined) {
    if (!f) return;
    setPrepare(true);
    try {
      const prete = await fileToChatPhoto(f);
      if (!prete) {
        // Le choix précédent, s'il y en avait un, reste en place : une
        // photo illisible ne doit pas emporter celle qui marchait.
        showToast("Photo illisible, essaie une autre");
        return;
      }
      // On remplace une éventuelle photo déjà choisie : une seule par
      // message, c'est ce que la base sait porter.
      setApercu((url) => {
        if (url) URL.revokeObjectURL(url);
        return URL.createObjectURL(prete.blob);
      });
      setPhoto(prete);
      zone.current?.focus();
    } finally {
      setPrepare(false);
      // Rechoisir LE MÊME fichier doit rester possible : sans cette
      // remise à zéro, le champ garde sa valeur et n'émet plus rien.
      if (fichier.current) fichier.current.value = "";
    }
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

      {apercu && (
        // La photo choisie attend au-dessus de la saisie, comme la
        // citation : c'est la même idée — « voilà ce qui part avec ce que
        // tu écris » — et donc la même place.
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={apercu}
            alt=""
            className="size-14 shrink-0 rounded-xl object-cover"
          />
          <span className="min-w-0 flex-1 text-xs text-muted">
            Photo prête. Ajoute une légende, ou envoie.
          </span>
          <button
            onClick={oublierPhoto}
            aria-label="Retirer la photo"
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
        {/* `accept` sans `capture` : on ouvre la pellicule ET l'appareil
            photo, et c'est iOS qui propose le choix. Avec `capture`, le
            bouton forcerait l'appareil photo, alors que neuf fois sur dix
            la photo de la séance est déjà prise. */}
        <input
          ref={fichier}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => choisirPhoto(e.target.files?.[0])}
        />
        <button
          onClick={() => fichier.current?.click()}
          disabled={prepare}
          aria-label="Ajouter une photo"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted transition-transform active:scale-95 disabled:opacity-40"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect
              x="3"
              y="5"
              width="18"
              height="14"
              rx="3"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
            <path
              d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
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
          disabled={draft.trim().length === 0 && !photo}
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
