"use client";

// Le rappel d'installation, posé sur l'accueil tant que l'app n'est pas sur
// l'écran d'accueil.
//
// Il existe parce que l'écran d'installation ne se montre qu'une fois : son
// « Plus tard » vit en sessionStorage, et un onglet Safari qu'on ne ferme
// jamais, c'est une session qui ne finit jamais. Passé ce tap, plus aucun
// chemin ne ramenait vers l'installation — donc plus aucune notification, et
// un profil que Safari efface au bout d'une semaine d'inactivité.
//
// Contrairement à `NotifBanner`, il n'a pas de « Non merci » : ce n'est pas
// une permission à accorder une fois, c'est un état de l'appareil. Il
// disparaît quand il devient faux, et à ce moment-là seulement.

import { Player } from "@/lib/types";

export default function InstallBanner({
  player,
  onInstaller,
}: {
  player: Player;
  onInstaller: () => void;
}) {
  return (
    <div className="mt-3 rounded-2xl bg-surface p-4">
      <p className="font-bold">L&apos;app n&apos;est pas sur ton écran d&apos;accueil</p>
      <p className="mt-0.5 text-sm text-muted">
        Sans elle, pas de rappel le soir — et Safari efface ton profil au bout
        d&apos;une semaine.
      </p>
      <button
        onClick={onInstaller}
        className="mt-3 min-h-11 w-full rounded-xl font-bold"
        style={{ background: player.color, color: "oklch(0.15 0 0)" }}
      >
        L&apos;installer — 10 secondes
      </button>
    </div>
  );
}
