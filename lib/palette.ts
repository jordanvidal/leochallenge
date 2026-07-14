// Palette fixe de 8 accents joueurs, bien distincts sur fond sombre.
// Assignée en rotation à la création, jamais choisie par l'utilisateur.
// OKLCH : lightness homogène (0.70–0.86) pour une lisibilité constante.

export const PLAYER_COLORS = [
  "oklch(0.72 0.19 25)", // corail
  "oklch(0.78 0.16 65)", // ambre
  "oklch(0.86 0.16 100)", // jaune
  "oklch(0.74 0.17 150)", // vert
  "oklch(0.80 0.13 195)", // cyan
  "oklch(0.70 0.15 255)", // bleu
  "oklch(0.70 0.17 305)", // violet
  "oklch(0.73 0.17 350)", // rose
] as const;

/** Prochaine couleur en rotation selon le nombre de joueurs existants. */
export function nextColor(existingCount: number): string {
  return PLAYER_COLORS[existingCount % PLAYER_COLORS.length];
}

/**
 * Normalisation d'un prénom pour la détection de doublons côté client :
 * minuscules + accents retirés. Le vrai garde-fou est l'index unique en base.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
