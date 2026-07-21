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

import { useEffect, useRef, useState } from "react";

/** Durée totale de la séquence, alignée sur les keyframes de globals.css. */
const SEQUENCE_MS = 1500;

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
  /** Classes du chiffre lui-même (taille, famille) — imposées par l'appelant. */
  className?: string;
  /** Prévient l'écran parent au démarrage du roulement (beat de fond). */
  onIncrement?: () => void;
};

export default function StreakCount({
  value,
  from,
  className,
  onIncrement,
}: Props) {
  const previous = useRef<number | null>(null);
  const [roll, setRoll] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => {
    // `from` ne sert qu'au premier passage : ensuite c'est le composant qui
    // sait d'où il vient. `??` et pas `||` — une série d'avant à 0 est une
    // valeur, pas une absence.
    const before = previous.current ?? from ?? null;
    previous.current = value;
    if (before === null || value !== before + 1) return;
    setRoll({ from: before, to: value });
    onIncrement?.();
    const t = setTimeout(() => setRoll(null), SEQUENCE_MS);
    return () => clearTimeout(t);
    // onIncrement est stable côté appelants (useCallback ou setter d'état),
    // et `from` est volontairement hors des dépendances : c'est une valeur
    // de départ, pas une entrée à écouter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Au repos : un simple chiffre, aucun DOM en plus.
  if (!roll) return <span className={className}>{value}</span>;

  return (
    <span className={`streak-count streak-roll ${className ?? ""}`}>
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
