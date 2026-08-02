"use client";

// L'écran qu'on voit quand cet appareil ne connaît aucune ligue : soit on en
// crée une, soit on entre dans celle d'un pote.
//
// Un seul champ pour entrer, pas deux. Le lien collé depuis WhatsApp et le
// code recopié d'une capture d'écran arrivent au même endroit, et `lib/ligue`
// démêle. Demander « c'est un lien ou un code ? » à quelqu'un qui vient de
// faire un copier-coller, c'est lui faire lire une question dont il se fiche.

import { useState } from "react";
import { chercheParCode, chercheParSlug } from "@/hooks/useLigue";
import { litCode, litLienInvitation, type Ligue } from "@/lib/ligue";
import { BigButton } from "../ui";

export default function AccueilLigue({
  onTrouvee,
  onCreer,
  message,
}: {
  onTrouvee: (ligue: Ligue) => void;
  onCreer: () => void;
  /** Pourquoi on se retrouve ici, quand ce n'est pas la première ouverture. */
  message?: string;
}) {
  const [saisie, setSaisie] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  // Le message venu du portier s'efface dès qu'on tape : il explique pourquoi
  // on est là, il n'a pas à commenter la saisie en cours. On le dérive au lieu
  // de l'installer dans l'état — sinon un changement de motif (« introuvable »
  // après « aucune ») n'apparaîtrait jamais, l'état initial ayant déjà été pris.
  const [touche, setTouche] = useState(false);
  const affiche = erreur ?? (touche ? null : (message ?? null));

  async function soumets(e: React.FormEvent) {
    e.preventDefault();
    if (!saisie.trim() || busy) return;
    setBusy(true);
    setErreur(null);

    // Un lien d'abord : c'est le chemin normal, et un lien contient un slug
    // qu'aucune lecture de code ne saurait retrouver.
    const lien = litLienInvitation(saisie);
    const trouvaille = lien
      ? await chercheParSlug(lien.slug)
      : await (async () => {
          const lu = litCode(saisie);
          if (!lu.ok) return { statut: "saisie" as const, message: lu.message };
          return chercheParCode(lu.code);
        })();

    setBusy(false);
    if (trouvaille.statut === "trouvee") onTrouvee(trouvaille.ligue);
    else if (trouvaille.statut === "saisie") setErreur(trouvaille.message);
    // « Injoignable » couvre le réseau coupé comme le serveur qui refuse : on
    // ne sait pas laquelle des deux, donc on n'en nomme aucune. Annoncer « pas
    // de réseau » à quelqu'un dont les cinq barres sont pleines, c'est lui
    // faire chercher une panne qui n'existe pas.
    else if (trouvaille.statut === "injoignable")
      setErreur("Impossible de vérifier pour l'instant. Réessaie.");
    else setErreur("Aucune ligue derrière ça. Redemande le lien au groupe.");
  }

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 pt-safe pb-safe">
      <div className="mx-auto w-full max-w-sm">
        <p className="num-display text-6xl leading-none">
          100
          <span className="text-faint"> · </span>100
          <span className="text-faint"> · </span>100
        </p>
        <p className="mt-3 text-muted">
          Pompes, abdos, squats. Tous les jours, avec tes potes.
        </p>

        <form onSubmit={soumets} className={`mt-10 ${affiche ? "shake" : ""}`}>
          <label htmlFor="entree" className="text-sm font-medium text-muted">
            Le lien ou le code reçu
          </label>
          <input
            id="entree"
            value={saisie}
            onChange={(e) => {
              setSaisie(e.target.value);
              setErreur(null);
              setTouche(true);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="K7M-2QP"
            // focus:ring-2 à la couleur du joueur : il remplace l'outline
            // global, il ne le supprime pas (pattern ChatComposer).
            className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface px-5 text-lg focus:outline-none focus:ring-2"
            style={{ "--tw-ring-color": "var(--pc)" } as React.CSSProperties}
          />
          {affiche && (
            <p className="mt-2 text-sm font-medium text-danger" role="alert">
              {affiche}
            </p>
          )}
          <div className="mt-4">
            <BigButton disabled={!saisie.trim() || busy}>
              {busy ? "…" : "Rejoindre"}
            </BigButton>
          </div>
        </form>

        <button
          onClick={onCreer}
          className="mt-6 min-h-14 w-full rounded-2xl border border-dashed border-line px-5 font-medium text-muted"
        >
          Créer ma ligue
        </button>
      </div>
    </main>
  );
}
