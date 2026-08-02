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
  demarrerVocal,
  dureeLisible,
  Enregistrement,
  VOCAL_MAX_MS,
  VocalPret,
  vocalSupporte,
} from "@/lib/audio";
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
  /** Rend `true` si le message est bien parti. C'est ce retour qui décide
      du sort du brouillon : parti, on l'oublie ; échoué, on le remet. */
  onSend: (
    body: string,
    photo: PhotoPrete | null,
    vocal: VocalPret | null,
  ) => Promise<boolean>;
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
  // Même miroir pour la photo : `envoyer` en a besoin APRÈS son await,
  // quand la valeur figée dans sa fermeture peut avoir vieilli.
  const photoRef = useRef<PhotoPrete | null>(null);
  photoRef.current = photo;

  // Quitter le tchat avec une photo en attente ne doit pas laisser ses
  // octets accrochés au document.
  useEffect(() => {
    return () => {
      if (apercuRef.current) URL.revokeObjectURL(apercuRef.current);
    };
  }, []);

  async function envoyer() {
    const texte = draft.trim();
    // Une photo part sans légende ; un message sans photo ne part pas vide.
    if (!texte && !photo) return;
    const photoEnvoyee = photo;
    const apercuEnvoye = apercu;
    // Vidage optimiste : le champ se rend tout de suite, comme la bulle
    // s'affiche tout de suite. L'aperçu, lui, n'est pas encore révoqué —
    // c'est lui qui permet de remettre la photo en place si l'envoi rate.
    setDraft("");
    setCaret(0);
    setApercu(null);
    setPhoto(null);
    if (fichier.current) fichier.current.value = "";

    const ok = await onSend(texte, photoEnvoyee, null);
    if (ok) {
      // Révoquer notre aperçu ne casse pas la bulle qui est partie : le
      // hook fabrique sa PROPRE URL à partir du même blob, qu'il tient.
      if (apercuEnvoye) URL.revokeObjectURL(apercuEnvoye);
      return;
    }
    // Échec. Le toast dit « réessaie » : il faut donc qu'il reste quelque
    // chose à réessayer. On remet le brouillon — sauf si l'utilisateur a
    // déjà retapé entre-temps : son texte gagne, on ne l'écrase pas.
    setDraft((cur) => (cur ? cur : texte));
    if (photoEnvoyee && apercuEnvoye) {
      // Les miroirs (refs) disent l'état d'APRÈS l'attente : si aucune
      // autre photo n'a pris la place, l'ancienne revient telle quelle.
      if (photoRef.current === null && apercuRef.current === null) {
        setPhoto(photoEnvoyee);
        setApercu(apercuEnvoye);
      } else {
        URL.revokeObjectURL(apercuEnvoye);
      }
    }
  }

  // ---- La note vocale ----
  //
  // Trois taps en tout, et c'est le maximum que la règle des 10 secondes
  // laisse à une fonction accessoire : micro, on parle, envoyer. Pas
  // d'écoute de contrôle avant l'envoi — se réécouter avant d'envoyer un
  // vocal à cinq potes n'est pas un besoin de ce produit, et ce serait un
  // tap de plus sur le seul chemin qui compte.
  //
  // Le bouton micro prend la place du bouton envoyer quand il n'y a rien
  // à envoyer. Deux raisons : c'est le geste que tout le monde connaît
  // d'ailleurs, et ça évite un quatrième rond de 44 px sur une rangée qui
  // n'en a plus la largeur sur un petit téléphone.

  /** L'enregistrement en cours. Dans une ref et pas dans l'état : ses
      méthodes ne se rejouent pas au rendu, et le minuteur de lib/audio
      doit pouvoir l'atteindre depuis une fermeture qui ne vieillit pas. */
  const enr = useRef<Enregistrement | null>(null);
  const [enregistre, setEnregistre] = useState(false);
  const [ecoule, setEcoule] = useState(0);
  /** Ce navigateur sait-il enregistrer ? Lu après le montage : la réponse
      dépend d'API absentes au rendu serveur. */
  const [microDispo, setMicroDispo] = useState(false);
  useEffect(() => setMicroDispo(vocalSupporte()), []);

  async function demarrer() {
    if (enr.current) return;
    // La limite d'une minute est gardée par lib/audio, pas par le
    // compteur ci-dessous : un `setInterval` est ralenti quand l'app
    // passe en arrière-plan, et laisserait courir l'enregistrement.
    const r = await demarrerVocal(() => finirRef.current());
    // Quitter le tchat pendant que le système demande l'autorisation : le
    // nettoyage au démontage est déjà passé, et sans ce test le micro
    // resterait ouvert pour un écran qui n'existe plus.
    if (!monte.current) {
      if (!("error" in r)) r.annuler();
      return;
    }
    if ("error" in r) {
      showToast(
        r.error === "MICRO_REFUSE"
          ? "Micro refusé. Autorise-le dans les réglages du téléphone."
          : "Ton navigateur ne sait pas enregistrer",
      );
      return;
    }
    enr.current = r;
    setEcoule(0);
    setEnregistre(true);
    navigator.vibrate?.(10);
  }

  /** Arrête et envoie. C'est aussi ce que fait la minute écoulée : un
      vocal qu'on vient de passer soixante secondes à dire ne doit pas
      disparaître parce qu'on a atteint la borne annoncée à l'écran. */
  async function finirEtEnvoyer() {
    const r = enr.current;
    if (!r) return;
    enr.current = null;
    setEnregistre(false);
    setEcoule(0);
    const pret = await r.arreter();
    if (!pret) {
      showToast("Trop court, reste appuyé un peu plus longtemps");
      return;
    }
    navigator.vibrate?.(10);
    const texteEnvoye = draft.trim();
    setDraft("");
    setCaret(0);
    const ok = await onSend(texteEnvoye, null, pret);
    // Le vocal, lui, est perdu si l'envoi rate : ses octets ont été
    // abandonnés par le hook et le toast dit de réenregistrer. On ne
    // remet que la légende — et seulement si le champ est resté vide.
    if (!ok) setDraft((cur) => (cur ? cur : texteEnvoye));
  }

  // Le minuteur de lib/audio appelle ce qu'il a reçu au démarrage : sans
  // ce miroir, il rappellerait la version de `finirEtEnvoyer` figée au
  // moment du premier rendu, avec le brouillon d'alors.
  const finirRef = useRef(finirEtEnvoyer);
  finirRef.current = finirEtEnvoyer;

  function annulerVocal() {
    enr.current?.annuler();
    enr.current = null;
    setEnregistre(false);
    setEcoule(0);
  }

  // Le compteur à l'écran. Deux fois par seconde suffit pour des
  // secondes, et ça ne réveille pas le rendu pour rien.
  useEffect(() => {
    if (!enregistre) return;
    const id = setInterval(() => setEcoule(enr.current?.ecoule() ?? 0), 200);
    return () => clearInterval(id);
  }, [enregistre]);

  // Quitter le tchat en pleine phrase referme le micro. Sans ça, la
  // pastille rouge du système reste allumée et le téléphone continue
  // d'écouter un salon que personne ne regarde.
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
      enr.current?.annuler();
      enr.current = null;
    };
  }, []);

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

      {enregistre ? (
        // Pendant l'enregistrement, la rangée entière change de métier :
        // il n'y a plus rien à taper, et deux issues seulement — jeter,
        // ou envoyer. La saisie et le bouton photo disparaissent plutôt
        // que de rester là, inertes.
        <div className="flex items-center gap-2">
          <button
            onClick={annulerVocal}
            aria-label="Annuler l'enregistrement"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted transition-transform active:scale-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div
            className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-surface px-4"
            // Le compteur est la seule chose qui bouge à l'écran : c'est
            // lui qui dit que ça tourne vraiment. Annoncé poliment, pour
            // qu'un lecteur d'écran ne récite pas chaque demi-seconde.
            role="timer"
            aria-live="off"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger motion-reduce:animate-none"
            />
            <span className="text-base tabular-nums text-ink">
              {dureeLisible(ecoule)}
            </span>
            <span className="text-xs text-muted">
              / {dureeLisible(VOCAL_MAX_MS)}
            </span>
          </div>

          <button
            onClick={finirEtEnvoyer}
            aria-label="Envoyer la note vocale"
            className="flex size-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95"
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
      ) : (
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
        {/* Rien à envoyer : le rond de droite propose le micro. Dès qu'un
            caractère est tapé ou qu'une photo est prête, il redevient le
            bouton d'envoi. Un seul rond, deux métiers, et jamais les deux
            en même temps — un message ne porte de toute façon qu'une
            pièce jointe (chat_piece_unique, migration45). */}
        {microDispo && draft.trim().length === 0 && !photo ? (
          <button
            onClick={demarrer}
            aria-label="Enregistrer une note vocale"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-muted transition-transform active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect
                x="9"
                y="3"
                width="6"
                height="11"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
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
        )}
      </div>
      )}

      {reste <= 60 && (
        // `quiet` : le compteur n'apparaît que quand il faut le lire —
        // à 2,7:1, `faint` en faisait une info illisible au moment utile.
        <p className="mt-1 text-right text-[11px] text-quiet">
          {reste} caractères restants
        </p>
      )}
    </div>
  );
}
