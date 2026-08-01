"use client";

// Le compteur de points de l'écran de fin. Il monte de 0 jusqu'à la valeur
// serveur en une seconde, crans haptiques compris (voir lib/roulette.ts).
//
// Il ne se déclenche pas au tap mais à l'apparition : ce composant n'est
// monté qu'une fois les points lus en base, après l'upsert de la journée.
// Le chiffre qui défile est donc toujours un chiffre acquis — la roulette
// ne promet rien qu'elle ne tienne, contrairement à une animation lancée
// avant l'écriture.
//
// Le nombre de décimales est figé sur la cible dès la première image :
// laisser toFixed() suivre les valeurs intermédiaires ferait passer la
// colonne de « 7 » à « 12.5 » en cours de route, et sauter d'un cran.

import { useEffect, useState } from "react";
import { fmtPoints } from "@/lib/gamification";
import { courbe, crans, motifHaptique, ROULETTE_MS } from "@/lib/roulette";

type Props = {
  value: number;
  /** Classes du chiffre lui-même (taille, famille) — imposées par l'appelant. */
  className?: string;
};

export default function PointsCount({ value, className }: Props) {
  const [affiche, setAffiche] = useState<number | null>(null);
  const decimales = Number.isInteger(value) ? 0 : 1;

  useEffect(() => {
    const reduit = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduit || !(value > 0)) {
      setAffiche(null);
      return;
    }

    navigator.vibrate?.(motifHaptique(crans(value)));

    let frame = 0;
    const debut = performance.now();
    const tick = (now: number) => {
      const t = (now - debut) / ROULETTE_MS;
      if (t >= 1) {
        setAffiche(null);
        return;
      }
      setAffiche(value * courbe(t));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      // L'écran peut partir avant la fin (« Enchaîner des bonus », retour
      // arrière) : le motif, lui, continuerait à tourner dans la main.
      navigator.vibrate?.(0);
    };
  }, [value]);

  // Au repos — avant, après, ou en mouvement réduit : le chiffre juste.
  if (affiche === null) return <span className={className}>{fmtPoints(value)}</span>;

  return (
    <span className={className}>
      {/* Un lecteur d'écran ne doit pas égrener la montée : il lit la
          valeur d'arrivée, une fois, et le défilé lui est masqué. */}
      <span className="sr-only">{fmtPoints(value)}</span>
      <span aria-hidden>{affiche.toFixed(decimales)}</span>
    </span>
  );
}
