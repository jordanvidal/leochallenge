# Product

## Register

product

## Users

5-6 potes, sur téléphone, le soir, fatigués. Le moment d'usage type (réécrit le 02/08) : chez soi le soir, ouvrir → lancer sa séance → la dérouler l'app en main — une douzaine de blocs, ~15 minutes, un tap « Terminé » par bloc — → fermer. L'ancien critère « ouvrir → cocher 3 exos → fermer en moins de 10 secondes » décrivait l'app d'avant le 31/07, celle des trois cartes. Ce qui reste chronométré, c'est l'entrée : ouvrir → « Lancer ma séance » en moins de 10 secondes, ou l'app meurt en une semaine. Pendant la séance, l'app n'a le droit d'exiger aucun geste de plus que le tap de fin de bloc.

Depuis le 21/07, « Lancer ma séance » est un passage obligé, et depuis le 31/07 c'est le seul chemin : les trois cartes à cocher ont été supprimées. Valider sa journée, c'est dérouler la séance — ou déclarer qu'on l'a déjà faite ailleurs. La marche a changé de nature les yeux ouverts : cocher trois exos qu'on n'avait pas faits ne coûtait rien ; dérouler une séance entière pour mentir coûte plus cher que la faire.

## Product Purpose

Tracker un challenge quotidien (100 pompes, 100 abdos, 100 squats, du 13/07 au 31/08/2026) par pression sociale : chacun déroule sa séance, tout le monde voit tout.

Jusqu'au 28/07, cette section disait : « L'app alimente le groupe WhatsApp existant, elle ne le concurrence pas. » C'est terminé, et c'est une décision, pas une dérive. Pendant les sept semaines du challenge, on cherche à ce que la conversation du groupe se déplace dans l'app (`docs/spec-tchat.md`). L'app fabriquait la matière sociale et la donnait à une autre app ; le tchat la garde.

Le pari est risqué et il a un critère de sortie écrit à froid : moins de 5 messages par jour ouvré à trois semaines, l'onglet du tchat est retiré. Un salon mort dans la barre de navigation coûte plus cher au produit que l'absence de salon.

## Brand Personality

Physique, direct, nocturne. Un objet qu'on frappe avec le pouce, pas une interface qu'on consulte. Le micro-moment cœur du produit a changé avec le pivot séance (31/07) : ce n'est plus la coche, c'est la fin de bloc — le tap « Terminé » de 80 px qui claque et vibre — et l'écran de fin, qui rend la monnaie de l'effort (durée, série, points du jour). Réponse instantanée, transition nette, jamais d'animation qui traîne.

## Anti-references

- Le dashboard SaaS : cards grises, graphiques Recharts, KPI tiles.
- Les apps fitness gamifiées à badges et confettis de 5 secondes.
- Tout élément décoratif qui ne justifie pas sa présence.

## Design Principles

1. **L'entrée en 10 secondes, la séance sans un geste de trop.** (Réécrit le 02/08 — « 10 secondes, point » jugeait chaque écran au temps entre ouverture et coche, un critère mort avec les cartes le 31/07.) Ouvrir → « Lancer ma séance » reste sous les 10 secondes, et toute feature qui allonge ce chemin est refusée d'office. Pendant la séance, un écran = un chiffre + un bouton : chaque écran de séance se juge au nombre de gestes exigés en plus du tap « Terminé », et la bonne réponse est zéro.
2. **La couleur, c'est les joueurs.** Une couleur d'accent par joueur (palette fixe de 8), cohérente partout — pastilles, historique, stats. Le reste est neutre pur (chroma 0), sombre.
3. **Le tap est physique.** Touch targets ≥ 44px, feedback immédiat (couleur + coche + vibration), optimistic UI sans spinner bloquant.
4. **La pression sociale est l'interface.** La ligne des potes du jour et l'historique visible par tous portent la rétention ; le fil raconte ce qui s'est passé, et le tchat (28/07) héberge ce que le groupe en dit. Un salon n'est jamais sur le chemin d'une séance : c'est une destination, jamais une interception.
5. **Dire la vérité.** Écriture échouée = rollback visible + toast, pas de faux succès.

## Accessibility & Inclusion

Contraste élevé sur fond sombre (ink ≥ 7:1), `prefers-reduced-motion` respecté partout, états `aria-pressed` / `aria-current` sur les contrôles, libellés explicites sur les cases de l'historique.
