"use client";

// Créer une ligue : un nom, un jour de départ, une durée. Trois champs, une
// seule vue, aucune étape suivante — c'est la règle des 10 secondes appliquée
// à l'écran qu'on ne voit qu'une fois.
//
// La création faite, on ne file pas dans l'app : on montre le lien. Une ligue
// sans invités n'existe pas, et le moment où on l'envoie, c'est maintenant,
// pas « plus tard dans les réglages ».

import { useState } from "react";
import { creeLigue } from "@/hooks/useLigue";
import { frenchDate, parisToday } from "@/lib/challenge";
import {
  finDeLigue,
  formateCode,
  lienInvitation,
  SEMAINES_MAX,
  SEMAINES_MIN,
  type Ligue,
} from "@/lib/ligue";
import { shareText } from "@/lib/share";
import { BigButton } from "../ui";

const DUREES = [1, 2, 3, 4, 5, 6];

export default function CreerLigue({
  onCreee,
  onRetour,
}: {
  onCreee: (ligue: Ligue) => void;
  onRetour: () => void;
}) {
  const [nom, setNom] = useState("");
  const [debut, setDebut] = useState(parisToday());
  const [semaines, setSemaines] = useState(4);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creee, setCreee] = useState<Ligue | null>(null);
  const [copie, setCopie] = useState(false);

  // La date peut être vidée par le clavier natif : on ne calcule la fin que
  // quand elle tient debout, sinon `finDeLigue` jetterait à chaque frappe.
  const fin = /^\d{4}-\d{2}-\d{2}$/.test(debut)
    ? finDeLigue(debut, semaines)
    : null;

  async function soumets(e: React.FormEvent) {
    e.preventDefault();
    if (!nom.trim() || busy || !fin) return;
    setBusy(true);
    setErreur(null);
    const r = await creeLigue(nom, debut, semaines);
    setBusy(false);
    if (r.statut === "creee") setCreee(r.ligue);
    else if (r.statut === "duree-refusee")
      setErreur(`Une ligue dure de ${SEMAINES_MIN} à ${SEMAINES_MAX} semaines.`);
    else setErreur(r.message);
  }

  if (creee) {
    const lien = lienInvitation(window.location.origin, creee.slug, creee.invite_code);
    return (
      <main className="flex min-h-dvh flex-col justify-center px-6 pt-safe pb-safe">
        <div className="mx-auto w-full max-w-sm">
          <h1 className="text-3xl font-bold">{creee.name}</h1>
          <p className="mt-1 text-muted">
            {frenchDate(creee.start_day)} → {frenchDate(creee.end_day)}
          </p>

          <p className="mt-8 text-sm font-medium text-muted">
            Le lien à envoyer aux potes
          </p>
          <p className="mt-2 rounded-2xl bg-surface px-5 py-4 text-sm break-all">
            {lien}
          </p>
          <p className="mt-3 text-sm text-muted">
            Ou le code, s&apos;ils préfèrent le taper&nbsp;:{" "}
            <span className="num-display text-ink">{formateCode(creee.invite_code)}</span>
          </p>

          <div className="mt-8">
            <BigButton
              onClick={async () => {
                const canal = await shareText(lien);
                if (canal === "clipboard") setCopie(true);
              }}
            >
              Envoyer aux potes
            </BigButton>
          </div>
          {copie && (
            <p className="mt-2 text-center text-sm text-muted">
              Lien copié, colle-le dans la conversation.
            </p>
          )}
          <button
            onClick={() => onCreee(creee)}
            className="mt-4 min-h-14 w-full rounded-2xl px-5 font-medium text-muted"
          >
            Entrer dans la ligue
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 pt-safe pb-safe">
      <form onSubmit={soumets} className="mx-auto w-full max-w-sm">
        <h1 className="text-3xl font-bold">Ta ligue</h1>

        <label htmlFor="nom" className="mt-8 block text-sm font-medium text-muted">
          Son nom
        </label>
        <input
          id="nom"
          value={nom}
          onChange={(e) => {
            setNom(e.target.value);
            setErreur(null);
          }}
          maxLength={40}
          autoComplete="off"
          autoFocus
          placeholder="Les potes du mardi"
          // focus:ring-2 à la couleur du joueur : il remplace l'outline
          // global, il ne le supprime pas (pattern ChatComposer).
          className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface px-5 text-lg focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--pc)" } as React.CSSProperties}
        />

        <label htmlFor="debut" className="mt-6 block text-sm font-medium text-muted">
          Premier jour
        </label>
        <input
          id="debut"
          type="date"
          value={debut}
          min={parisToday()}
          onChange={(e) => setDebut(e.target.value)}
          className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface px-5 text-lg focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": "var(--pc)" } as React.CSSProperties}
        />

        <p className="mt-6 text-sm font-medium text-muted">Combien de semaines</p>
        <div className="mt-2 flex gap-2">
          {DUREES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSemaines(s)}
              aria-pressed={s === semaines}
              className={`min-h-14 flex-1 rounded-2xl text-lg font-bold transition-transform active:scale-95 ${
                s === semaines
                  ? "bg-raised text-ink"
                  : "border border-line text-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {fin && (
          <p className="mt-3 text-sm text-muted">
            Jusqu&apos;au {frenchDate(fin)}, soit {semaines * 7} jours.
          </p>
        )}

        {erreur && (
          <p className="mt-3 text-sm font-medium text-danger" role="alert">
            {erreur}
          </p>
        )}

        <div className="mt-8">
          <BigButton disabled={!nom.trim() || !fin || busy}>
            {busy ? "…" : "Créer la ligue"}
          </BigButton>
        </div>
        <button
          type="button"
          onClick={onRetour}
          className="mt-2 min-h-14 w-full rounded-2xl px-5 font-medium text-muted"
        >
          Retour
        </button>
      </form>
    </main>
  );
}
