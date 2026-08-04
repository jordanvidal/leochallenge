"use client";

// L'accueil d'une ligue qui n'a pas encore commencé.
//
// Il existe parce que ces jours-là étaient un trou, et même un piège. Une
// ligue créée le mardi pour un départ le lundi suivant laisse six jours
// pendant lesquels l'app affichait l'accueil normal : « 28 jours restants »
// (le compte de la ligue entière, pas du temps qui reste avant le départ) et
// un lanceur de séance qui ne pouvait pas marcher. Le trigger
// `trg_sessions_a_fenetre` refuse tout `workout_sessions` hors de la fenêtre,
// et `HORS_FENETRE` n'était traduit nulle part : le message affiché était
// « Écriture échouée, re-tape pour réessayer ». On invitait donc quelqu'un à
// réessayer, tous les soirs, une chose qui ne pouvait pas aboutir.
//
// L'autre moitié du problème n'est pas un bug : pendant ces six jours, aucun
// cron ne passe (`terrainsActifs` filtre sur `start_day <= today`), donc le
// produit ne relance jamais ceux qui viennent de s'inscrire. Cet écran a une
// seule mission à ce titre — obtenir la permission de notification avant le
// jour 1, sans quoi le départ passera inaperçu.
//
// Ce que l'écran ne fait pas : promettre. Pas de « prépare-toi », pas de
// compte à rebours à la seconde. Un jour, une date, les gens déjà là, et le
// lien à envoyer aux autres.

import { useEffect, useState } from "react";
import { diffDays, frenchDate, parisToday } from "@/lib/challenge";
import { pushSupported, subscribePush } from "@/lib/gamification";
import { lienInvitation, type Ligue } from "@/lib/ligue";
import { shareText } from "@/lib/share";
import { Player } from "@/lib/types";
import { Avatar, BigButton } from "./ui";

export default function AvantPremiere({
  player,
  players,
  ligue,
  debut,
  showToast,
}: {
  player: Player;
  players: Player[];
  /** `null` sur le challenge d'origine, qui n'a pas de lien d'invitation. */
  ligue: Ligue | null;
  /** Premier jour de la ligue, 'YYYY-MM-DD'. */
  debut: string;
  showToast: (message: string) => void;
}) {
  const jours = diffDays(parisToday(), debut);

  return (
    <div className="flex flex-1 flex-col px-5 pt-safe">
      {/* Même en-tête que l'accueil : la date à gauche, le chiffre qui
          compte à droite. Ici il compte à l'envers — pas les jours de jeu
          restants, les jours avant qu'il y en ait. */}
      <header className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-muted first-letter:uppercase">
            {frenchDate(parisToday())}
          </p>
          <p className="mt-1 text-2xl font-bold">Ça n&apos;a pas commencé</p>
        </div>
        <div className="text-right">
          <p className="num-display text-6xl">{jours}</p>
          <p className="-mt-0.5 text-xs font-medium text-muted">
            jour{jours > 1 ? "s" : ""} à attendre
          </p>
        </div>
      </header>

      <p className="mt-5 rounded-2xl bg-surface px-5 py-4">
        <span className="font-bold first-letter:uppercase">
          {frenchDate(debut)}
        </span>
        <span className="text-muted">
          {" "}
          — premier jour. 100 pompes, 100 abdos, 100 squats, et tous les jours
          jusqu&apos;au bout.
        </span>
      </p>

      <NotifBloc player={player} showToast={showToast} />

      {/* Les gens déjà là. C'est le signal n°1 du produit, et c'est aussi la
          seule chose qui change d'ici lundi — donc la seule raison de
          rouvrir l'app cette semaine. */}
      <section className="mt-5">
        <h2 className="text-sm font-medium text-muted">
          {players.length} déjà là
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <Avatar name={p.name} color={p.color} photo={p.photo} />
              <span className="font-medium">
                {p.name}
                {p.id === player.id && (
                  <span className="text-muted"> — toi</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Le ressort entre le contenu et l'action : le bouton reste sous le
          pouce même quand la liste est courte. */}
      <div className="flex-1" />

      {ligue && (
        <div className="mt-5 mb-3">
          <BigButton
            onClick={async () => {
              const lien = lienInvitation(
                window.location.origin,
                ligue.slug,
                ligue.invite_code,
              );
              const canal = await shareText(
                `${ligue.name} — on commence ${frenchDate(debut)}. ${lien}`,
              );
              showToast(
                canal === "share" ? "Lien envoyé" : "Lien copié",
              );
            }}
          >
            Envoyer le lien aux potes
          </BigButton>
        </div>
      )}
    </div>
  );
}

/**
 * La demande de notification, avec la raison qui vaut ici.
 *
 * `NotifBanner` existe déjà sur l'accueil, mais il ne se propose qu'une fois
 * et il promet « un rappel à 20h » — vrai quand la ligue tourne, hors sujet
 * avant. L'enjeu de cette semaine est ailleurs : sans permission accordée
 * avant lundi, le jour 1 ne se signale pas. On le redemande donc tant que la
 * question n'est pas tranchée, ce que l'accueil ne s'autorise pas — mais cet
 * écran n'a rien d'autre à faire, et il disparaît de lui-même le jour 1.
 */
function NotifBloc({
  player,
  showToast,
}: {
  player: Player;
  showToast: (message: string) => void;
}) {
  const [etat, setEtat] = useState<"charge" | "proposable" | "muet">("charge");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // `pushSupported()` est faux sur iPhone tant que la PWA n'est pas
    // installée sur l'écran d'accueil : la permission n'y est même pas
    // proposable. `InstallScreen` s'en charge en amont, on n'ajoute pas une
    // seconde consigne d'installation par-dessus la sienne.
    if (!pushSupported() || Notification.permission !== "default") {
      setEtat("muet");
      return;
    }
    setEtat("proposable");
  }, []);

  if (etat !== "proposable") return null;

  async function activer() {
    setBusy(true);
    const ok = await subscribePush(player.id);
    setBusy(false);
    setEtat("muet");
    showToast(
      ok
        ? "C'est noté. Tu sauras quand ça démarre 🔔"
        : "Notifications refusées — pense à revenir lundi",
    );
  }

  return (
    <div className="mt-5 rounded-2xl bg-surface p-4">
      <p className="font-bold">Être prévenu du départ ?</p>
      <p className="mt-0.5 text-sm text-muted">
        Sans ça, rien ne te dira que le challenge a commencé.
      </p>
      {/* « Accent en retrait » (DESIGN.md § Buttons) et non un aplat plein :
          l'écran a déjà son aplat d'accent, en bas, sur l'envoi du lien. Deux
          aplats et plus rien ne hiérarchise — la couleur est le seul outil de
          hiérarchie ici, la surface n'en est pas un. */}
      <button
        onClick={activer}
        disabled={busy}
        className="mt-3 min-h-11 w-full rounded-xl font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
        style={{
          background: `color-mix(in oklch, ${player.color} 12%, var(--color-surface))`,
          boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 45%, transparent)`,
          color: player.color,
        }}
      >
        {busy ? "…" : "Me prévenir"}
      </button>
    </div>
  );
}
