// La roulette de l'écran de fin : le chiffre des points monte de 0 jusqu'à
// sa valeur, et des crans haptiques l'accompagnent.
//
// Le mouvement est en sortie quadratique — ça part vite, ça se dépose. Les
// crans, eux, sont posés à pas de VALEUR constant, pas à pas de temps :
// c'est l'inverse exact de la courbe. Les écarts s'allongent donc d'eux-
// mêmes vers la fin, et c'est précisément ce que la main reconnaît comme
// une roulette qui ralentit. Des crans à intervalle fixe donneraient un
// métronome, qui ne raconte rien.
//
// Tout est ici plutôt que dans le composant parce qu'un motif de vibration
// mal formé ne se voit pas : navigator.vibrate() avale un tableau invalide
// en silence, sur un écran de fin qu'on ne revoit qu'à la séance suivante.

/** Durée du défilé, en ms. Le chiffre et le dernier cran tombent ensemble. */
export const ROULETTE_MS = 900;

/** Longueur d'une impulsion. Le repo tape à 6-10 ms pour un retour léger. */
export const IMPULSION_MS = 6;

/** Au-delà, les crans se marchent dessus et la main n'entend qu'un buzz. */
export const CRANS_MAX = 12;

/** Sortie quadratique : fraction de la valeur atteinte à l'instant t (0→1). */
export function courbe(t: number): number {
  const borne = Math.min(1, Math.max(0, t));
  return 1 - (1 - borne) ** 2;
}

/** Instants (ms) où le chiffre franchit chaque cran — l'inverse de courbe().
    Un cran par point entier, plafonné, et jamais moins d'un : une séance à
    0,5 point mérite quand même sa secousse d'arrivée. */
export function crans(valeur: number, duree = ROULETTE_MS): number[] {
  if (!(valeur > 0)) return [];
  const n = Math.min(Math.max(Math.round(valeur), 1), CRANS_MAX);
  return Array.from({ length: n }, (_, i) => {
    const v = (i + 1) / n;
    return (1 - Math.sqrt(1 - v)) * duree;
  });
}

/** Motif pour navigator.vibrate : [impulsion, pause, impulsion, …].
    Un motif DOIT commencer par une durée de vibration — pour retarder le
    premier cran on ouvre donc sur une impulsion nulle suivie de l'attente.
    Les pauses ne descendent jamais sous zéro : deux crans trop serrés se
    collent en une impulsion plus longue plutôt que de décaler la suite. */
export function motifHaptique(instants: number[]): number[] {
  if (instants.length === 0) return [];
  const motif: number[] = [0, Math.round(instants[0])];
  for (let i = 0; i < instants.length; i++) {
    motif.push(IMPULSION_MS);
    const suivant = instants[i + 1];
    if (suivant === undefined) break;
    motif.push(Math.max(0, Math.round(suivant - instants[i]) - IMPULSION_MS));
  }
  return motif;
}
