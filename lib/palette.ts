// Palette fixe de 12 accents joueurs, bien distincts sur fond sombre.
// Assignée en rotation à la création, jamais choisie par l'utilisateur.
// OKLCH : lightness homogène (0.68–0.86) pour une lisibilité constante.
//
// Pourquoi 12 et pas 8 : le cap du groupe est à 12 joueurs (voir le trigger
// guard_player_insert), mais nextColor bouclait sur 8 — au 9ᵉ joueur, deux
// personnes partageaient une couleur, et l'identité par la couleur (le
// signal n°1 du produit) s'effondrait là où il n'y a que la pastille, sans
// prénom collé. Les 8 premières teintes sont INCHANGÉES — les joueurs déjà
// en base gardent leur couleur — et 4 teintes ont été ajoutées dans les
// quatre plus grands trous de la roue (citron, bleu-cyan, indigo, magenta).

export const PLAYER_COLORS = [
  "oklch(0.72 0.19 25)", // corail
  "oklch(0.78 0.16 65)", // ambre
  "oklch(0.86 0.16 100)", // jaune
  "oklch(0.74 0.17 150)", // vert
  "oklch(0.80 0.13 195)", // cyan
  "oklch(0.70 0.15 255)", // bleu
  "oklch(0.70 0.17 305)", // violet
  "oklch(0.73 0.17 350)", // rose
  "oklch(0.80 0.16 128)", // citron   (trou 100–150)
  "oklch(0.76 0.15 225)", // bleu-cyan (trou 195–255)
  "oklch(0.68 0.16 280)", // indigo   (trou 255–305)
  "oklch(0.70 0.18 335)", // magenta  (trou 305–350)
] as const;

/** Prochaine couleur en rotation selon le nombre de joueurs existants.
    Douze teintes, douze joueurs max : plus aucune collision sous le cap. */
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
