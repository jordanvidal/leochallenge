"use client";

// Le compteur de série. Il n'anime pas sur le tap, il anime sur le
// changement de la valeur serveur : rescore() recharge le classement
// après une coche comme après une séance, et c'est ce chiffre-là qui
// fait foi. Conséquence voulue — si l'écriture échoue, le rollback
// remet l'ancienne valeur et rien ne monte. Pas de faux succès.
//
// Seul un +1 déclenche le roulement. Un saut plus large (rattrapage de
// jours, changement de joueur, premier rendu) se pose sans animation :
// un odomètre qui prétend passer de 0 à 9 d'un cran serait un mensonge.
//
// Le roulement est décidé PENDANT le rendu, jamais dans un useEffect.
// Un effet s'exécute après la peinture : l'écran affichait donc une
// image du nouveau chiffre, puis revenait à l'ancien pour le faire
// rouler. Ce clignotement à l'envers (nouveau → ancien → nouveau) est
// exactement ce qui donnait l'impression de ne voir que le résultat.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Roll = { from: number; to: number };

/** Temps pendant lequel l'ancien chiffre reste seul à l'écran, aligné sur
    --streak-hold dans globals.css. La variante `big` tient plus longtemps :
    le bloc de fin de séance apparaît en même temps que l'animation démarre,
    il faut laisser à l'œil le temps de descendre jusqu'à lui. */
const HOLD_MS = { small: 560, big: 900 } as const;
/** Ce qui reste après le maintien : recul, roulement, rebond. */
const TAIL_MS = 960;

type Props = {
  value: number;
  /** Série d'avant, imposée par l'appelant. Sans elle le composant compare
      aux rendus précédents — ce qui suppose qu'il était déjà monté quand la
      valeur serveur arrive. C'est vrai sur la ligne de statut, faux sur
      l'écran de fin de séance : lui se monte en pleine écriture, souvent
      après le rechargement, et naissait donc déjà au bon chiffre — plus rien
      à faire rouler. Le point de départ explicite rend l'animation
      indépendante de l'ordre d'arrivée. */
  from?: number;
  /** Séquence longue, pour un chiffre affiché en très grand (fin de séance). */
  big?: boolean;
  /** Classes du chiffre lui-même (taille, famille) — imposées par l'appelant. */
  className?: string;
  /** Prévient l'écran parent au démarrage du roulement (beat de fond). */
  onIncrement?: () => void;
};

export default function StreakCount({
  value,
  from,
  big = false,
  className,
  onIncrement,
}: Props) {
  // Valeur du premier rendu : sert de repère au tout premier passage de
  // l'effet, pour qu'il ne rejoue pas un roulement déjà décidé au montage.
  const mounted = useRef(value);
  const previous = useRef<number | null>(null);
  // Cas « monté trop tard » : la nouvelle valeur est déjà là au premier
  // rendu. On part de l'ancienne dès la première peinture.
  const [roll, setRoll] = useState<Roll | null>(() =>
    from !== undefined && value === from + 1 ? { from, to: value } : null,
  );

  // useLayoutEffect et pas useEffect : le passage à l'odomètre doit être
  // dans la même image que l'arrivée de la nouvelle valeur, sinon le
  // nouveau chiffre est peint une frame avant de reculer.
  useLayoutEffect(() => {
    const before = previous.current ?? mounted.current;
    previous.current = value;
    if (value !== before + 1) return;
    setRoll({ from: before, to: value });
  }, [value]);

  useEffect(() => {
    if (!roll) return;
    onIncrement?.();
    const t = setTimeout(
      () => setRoll(null),
      (big ? HOLD_MS.big : HOLD_MS.small) + TAIL_MS,
    );
    return () => clearTimeout(t);
    // onIncrement est stable côté appelants (useCallback ou setter d'état).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll, big]);

  // Au repos : un simple chiffre, aucun DOM en plus.
  if (!roll) return <span className={className}>{value}</span>;

  return (
    <span
      className={`streak-count streak-roll ${big ? "streak-big" : ""} ${className ?? ""}`}
    >
      {/* La valeur lue par les lecteurs d'écran : une seule, la bonne.
          L'odomètre affiche deux chiffres le temps du roulement, il ne
          doit pas être annoncé « 5 6 ». */}
      <span className="sr-only">{value}</span>
      <span className="streak-punch" aria-hidden>
        <span className="streak-odo">
          <span className="streak-strip">
            <span>{roll.from}</span>
            <span>{roll.to}</span>
          </span>
        </span>
      </span>
      <span className="streak-plus" aria-hidden>
        +1
      </span>
    </span>
  );
}
