# Product

## Register

product

## Users

5-6 potes, sur téléphone, le soir, fatigués. Le moment d'usage type : dans un lit à 23h, lumière éteinte, ouvrir → cocher 3 exos → fermer. Moins de 10 secondes ou l'app meurt en une semaine. C'est le seul critère de succès qui compte.

## Product Purpose

Tracker un challenge quotidien (100 pompes, 100 abdos, 100 squats, du 13/07 au 31/08/2026) par pression sociale : chacun coche, tout le monde voit tout. L'app alimente le groupe WhatsApp existant (partage texte façon Wordle), elle ne le concurrence pas.

## Brand Personality

Physique, direct, nocturne. Un objet qu'on frappe avec le pouce, pas une interface qu'on consulte. Le micro-moment de validation (non-coché → coché) est le cœur du produit : réponse instantanée, transition nette, jamais d'animation qui traîne.

## Anti-references

- Le dashboard SaaS : cards grises, graphiques Recharts, KPI tiles.
- Les apps fitness gamifiées à badges et confettis de 5 secondes.
- Tout élément décoratif qui ne justifie pas sa présence.

## Design Principles

1. **10 secondes, point.** Chaque écran se juge au temps entre ouverture et coche.
2. **La couleur, c'est les joueurs.** Une couleur d'accent par joueur (palette fixe de 8), cohérente partout — pastilles, historique, stats. Le reste est neutre pur (chroma 0), sombre.
3. **Le tap est physique.** Touch targets ≥ 44px, feedback immédiat (couleur + coche + vibration), optimistic UI sans spinner bloquant.
4. **La pression sociale est l'interface.** La ligne des potes du jour et l'historique visible par tous sont la seule mécanique de rétention (phase 1).
5. **Dire la vérité.** Écriture échouée = rollback visible + toast, pas de faux succès.

## Accessibility & Inclusion

Contraste élevé sur fond sombre (ink ≥ 7:1), `prefers-reduced-motion` respecté partout, états `aria-pressed` / `aria-current` sur les contrôles, libellés explicites sur les cases de l'historique.
