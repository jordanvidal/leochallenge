---
name: 100 · 100 · 100
description: PWA de challenge sportif entre potes, sombre, tenue à une main, pensée pour un lit à 23h.
colors:
  bg: "oklch(0.115 0 0)"
  surface: "oklch(0.17 0 0)"
  raised: "oklch(0.22 0 0)"
  line: "oklch(0.27 0 0)"
  faint: "oklch(0.45 0 0)"
  muted: "oklch(0.68 0 0)"
  ink: "oklch(0.965 0 0)"
  danger: "oklch(0.68 0.19 25)"
  x2: "oklch(0.85 0.17 88)"
  player-corail: "oklch(0.72 0.19 25)"
  player-ambre: "oklch(0.78 0.16 65)"
  player-jaune: "oklch(0.86 0.16 100)"
  player-vert: "oklch(0.74 0.17 150)"
  player-cyan: "oklch(0.80 0.13 195)"
  player-bleu: "oklch(0.70 0.15 255)"
  player-violet: "oklch(0.70 0.17 305)"
  player-rose: "oklch(0.73 0.17 350)"
typography:
  display:
    fontFamily: "Anton, Space Grotesk, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "0.01em"
    fontFeature: "tabular-nums"
  headline:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.15
  title:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.375
  label:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.25
  caption:
    fontFamily: "Space Grotesk, system-ui, -apple-system, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  full: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  exo-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "0 1.5rem"
    height: "6rem"
  exo-card-done:
    backgroundColor: "{colors.player-vert}"
    textColor: "{colors.player-vert}"
    rounded: "{rounded.xl}"
  exo-card-locked:
    backgroundColor: "color-mix(in oklch, {colors.surface} 55%, {colors.bg})"
    textColor: "{colors.muted}"
    rounded: "{rounded.xl}"
  button-primary:
    backgroundColor: "{colors.player-vert}"
    textColor: "{colors.bg}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 1.25rem"
    height: "3.5rem"
  button-neutral:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 1.25rem"
    height: "3.5rem"
  toggle-exo:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "2.75rem"
  toggle-exo-done:
    backgroundColor: "{colors.player-vert}"
    textColor: "{colors.player-vert}"
    rounded: "{rounded.md}"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.625rem 1rem"
    height: "2.75rem"
  tab-item:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.faint}"
    typography: "{typography.caption}"
    height: "3.5rem"
  tab-item-active:
    textColor: "{colors.player-vert}"
  toast:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.75rem 1.25rem"
  badge-x2:
    backgroundColor: "{colors.x2}"
    textColor: "{colors.bg}"
    rounded: "{rounded.full}"
    padding: "0.125rem 0.5rem"
---

# Design System: 100 · 100 · 100

## Overview

**Creative North Star: "L'interrupteur dans le noir"**

Un interrupteur, on le trouve au doigt sans le chercher des yeux, et il répond avant qu'on ait fini de le pousser. C'est le contrat de cette app : à 23h, lumière éteinte, le pouce arrive sur la cible, la cible claque, l'écran se ferme. Rien n'y est là pour être regardé — tout y est pour être atteint. Chaque écran se juge au temps entre l'ouverture et la coche.

Le système est donc noir profond, sans dégradé de fond, sans photo décorative, sans ombre portée. La profondeur se fabrique en empilant trois noirs (`bg` → `surface` → `raised`) et en posant des anneaux **intérieurs** (`inset box-shadow`) : rien ne flotte, tout est encastré, et le contraste reste lisible dans le noir sans halo qui bave. La densité est basse et assumée : trois cartes hautes de 96 px occupent tout l'écran d'accueil, parce qu'à moitié endormi on ne vise pas un chip de 28 px.

La couleur n'appartient pas au système, elle appartient aux joueurs. Huit accents fixes, un par personne, tous à la même clarté (L 0.70–0.86) pour que personne n'ait une couleur « plus faible » que les autres. Partout où l'interface veut dire « toi », elle prend `--pc`, l'accent du joueur courant, injecté à la racine. Le seul accent non-joueur de l'app est le doublement du jour (`x2`, hue 88) : il ne pouvait emprunter la couleur de personne sans mentir.

**Key Characteristics:**
- Sombre par défaut, neutres à chroma 0 : `color-scheme: dark`, aucun thème clair, aucun toggle.
- La couleur = l'identité du joueur ; l'UI elle-même n'a pas de couleur de marque.
- Zéro ombre portée hors toast : profondeur par empilement tonal + anneaux intérieurs.
- Mobile only, une seule colonne, zéro breakpoint responsive dans tout le code.
- Cibles ≥ 44 px, `active:scale`, `navigator.vibrate` : le tap est un événement physique.
- Anton pour les chiffres qui comptent, Space Grotesk pour tout le reste.

## Colors

Une palette de neutres purs (chroma 0, du noir presque total au blanc cassé) sur laquelle huit accents saturés viennent nommer les gens.

### Primary

- **Accent joueur courant — `--pc`** (`oklch(0.74 0.17 150)` par défaut) : la couleur du joueur connecté, réécrite à la racine à chaque identification. Elle porte l'action principale (`BigButton`), l'onglet actif, l'anneau de focus des champs, la pastille de non-lus, le halo de célébration. C'est la seule couleur que l'app s'autorise sur un élément d'UI, et elle change de personne en personne.

### Secondary

- **Les 8 accents joueurs** — Corail (25), Ambre (65), Jaune (100), Vert (150), Cyan (195), Bleu (255), Violet (305), Rose (350). Assignés en rotation à la création du compte, jamais choisis. Clarté homogène 0.70–0.86 : sur fond noir, aucune n'est plus faible qu'une autre, et toutes tiennent le contraste en texte comme en aplat. Elles vivent dans `lib/palette.ts`, jamais en dur dans un composant.

### Tertiary

- **Doublement — `x2`** (`oklch(0.85 0.17 88)`) : le tirage du jour qui double les points. Placé entre l'ambre et le jaune de la palette joueur, il ne s'en distingue que par sa **forme** : toujours un badge plein à texte sombre, jamais une pastille ronde. Une puce joueur ne prend jamais cette forme.
- **Danger** (`oklch(0.68 0.19 25)`) : erreur d'écriture, suppression, mot de passe raté. Sur du texte et des bordures, jamais en aplat plein écran.

### Neutral

- **Nuit — `bg`** (`oklch(0.115 0 0)`) : le fond de tous les écrans, et la couleur du texte posé sur un aplat d'accent (un `✓` blanc sur du vert clair serait illisible).
- **Nuit levée — `surface`** (`oklch(0.17 0 0)`) : cartes, champs de saisie, toggles au repos. Le premier étage.
- **Nuit claire — `raised`** (`oklch(0.22 0 0)`) : ce qui doit se détacher d'une carte — toast, bouton neutre, badge photo. Le deuxième étage, jamais un troisième.
- **Trait — `line`** (`oklch(0.27 0 0)`) : anneaux intérieurs et séparateurs. Jamais une bordure extérieure épaisse.
- **Fumée — `faint`** (`oklch(0.45 0 0)`) : onglets inactifs, compteurs de caractères, chiffre « 100 » en attente. Décoratif ou strictement redondant — jamais une information seule.
- **Brume — `muted`** (`oklch(0.68 0 0)`) : texte secondaire et placeholders. C'est le plancher de lisibilité (≈ 8:1 sur `bg`).
- **Néon — `ink`** (`oklch(0.965 0 0)`) : tout le texte qui doit être lu.

### Named Rules

**The Player-Owns-Color Rule.** Aucun élément d'interface n'a de couleur propre. Si quelque chose est coloré, c'est qu'il appartient à quelqu'un (`--pc` ou `player.color`), ou que c'est le doublement (`x2`), ou que c'est une erreur (`danger`). Un accent inventé pour « faire joli » n'existe pas dans ce système.

**The Zero-Chroma Rule.** Tous les neutres sont à chroma 0, exactement. Pas de neutre tiédi vers l'ambre, pas de gris bleuté : la moindre teinte dans le fond entre en conflit avec les huit accents joueurs, dont trois sont chauds.

**The Mix-Don't-Pick Rule.** Les états colorés se fabriquent par `color-mix(in oklch, <accent> N%, var(--color-surface))` — 18 % pour un avatar, 22–24 % pour une carte cochée, 55–65 % pour son anneau. Aucune variante d'accent n'est écrite en dur.

## Typography

**Display Font:** Anton (fallback Space Grotesk, sans-serif) — classe `.num-display`
**Body Font:** Space Grotesk (fallback `system-ui`, `-apple-system`, sans-serif) — poids 400 / 500 / 700

**Character:** Une grotesque géométrique un peu technique pour toute l'interface, et une condensée massive réservée aux chiffres. Le contraste ne vient pas de deux familles qui se disputent les titres : Anton ne touche jamais une phrase, seulement des nombres. Les deux se croisent rarement sur le même écran, et quand ça arrive, la hiérarchie est évidente.

### Hierarchy

- **Display** (Anton 400, 2.25–5.5rem, line-height 0.9, `tabular-nums`) : le compte à rebours, la série en cours, le « 100 » d'un exo, le compteur du bilan. Uniquement des chiffres.
- **Headline** (Space Grotesk 700, 1.5rem) : le nom d'un exercice sur sa carte, les titres d'écran.
- **Title** (Space Grotesk 700, 1.125rem) : en-têtes de section, noms de joueurs dans le classement.
- **Body** (Space Grotesk 400, 1rem / 1.375) : messages du tchat, textes du fil, contenu des champs.
- **Label** (Space Grotesk 700, 0.875rem) : boutons secondaires, toggles d'exos, toasts.
- **Caption** (Space Grotesk 700, 0.6875rem) : libellés d'onglets, compteurs, badges de non-lus.

### Named Rules

**The 16px Floor Rule.** Tout champ de saisie est à `text-base` (16 px) minimum. En dessous, iOS zoome au focus et casse la mise en page pour le reste de la session.

**The Anton-Is-Numbers-Only Rule.** Anton ne porte jamais un mot. Un titre en display, c'est une décoration ; un score en display, c'est l'information principale de l'écran.

**The Tabular Rule.** Tout chiffre qui change en place (série, chrono, compteur) est en `font-variant-numeric: tabular-nums`. Sans ça, l'odomètre de la série tremble à chaque bascule.

## Layout

Une colonne, pleine largeur, `max-w-sm` uniquement sur les écrans d'entrée (mot de passe, choix du joueur, install). Le reste occupe la largeur du téléphone.

**Aucun breakpoint responsive n'existe dans le code** : pas un seul `sm:` / `md:` / `lg:` dans `components/` ni `app/`. C'est une décision, pas un oubli — l'app est installée sur un écran de téléphone et nulle part ailleurs.

Rythme vertical : `gap-3` (0.75rem) entre les cartes d'exos, `gap-2` dans une rangée de toggles, `mt-5` (1.25rem) entre blocs d'un écran. Padding horizontal : `px-5` par défaut sur les écrans, `px-6` à l'intérieur des grandes cartes, `px-4` dans les champs.

Structure d'écran : contenu défilant + `TabBar` collée en bas (`sticky bottom-0`, `min-h-14`). Deux variables CSS tiennent les zones fragiles — `--tabbar-h` (hauteur exacte de la barre, à garder synchronisée avec `min-h-14` + `pb-safe`) et `--kb` (hauteur mangée par le clavier, écrite par `hooks/useKeyboardInset.ts` pendant que le tchat est ouvert).

Zones sûres : `.pt-safe` / `.pb-safe` (`env(safe-area-inset-*)` avec un plancher) sur tout ce qui touche l'encoche ou la barre home.

### Named Rules

**The Five-Tabs-Max Rule.** Cinq onglets, c'est le maximum absolu. Au sixième, on fusionne (le tchat a coûté sa place à « Historique », descendu dans Stats).

**The Thumb-Zone Rule.** L'action principale d'un écran est en bas. Rien d'important ne vit dans le tiers supérieur : c'est la zone que le pouce n'atteint pas d'une main.

## Elevation & Depth

Ce système n'a pas d'ombres portées. La profondeur vient de deux mécanismes, et de deux seulement : l'**empilement tonal** (`bg` 0.115 → `surface` 0.17 → `raised` 0.22, jamais un quatrième étage) et les **anneaux intérieurs** (`inset 0 0 0 Npx`), qui délimitent sans agrandir la boîte ni décoller l'élément du fond.

L'unique exception est le toast (`shadow-lg shadow-black/40`), qui flotte réellement au-dessus de tout le reste : c'est la seule pièce de l'app qui n'appartient pas à l'écran en dessous.

### Shadow Vocabulary

- **Anneau au repos** (`box-shadow: inset 0 0 0 1px var(--color-line)`) : contour d'une carte ou d'un toggle non coché.
- **Anneau actif** (`box-shadow: inset 0 0 0 2px color-mix(in oklch, <accent> 65%, transparent)`) : carte cochée. L'épaisseur passe de 1 à 2 px, c'est le seul saut d'élévation du système.
- **Anneau discret** (`box-shadow: inset 0 0 0 1.5px color-mix(in oklch, <accent> 55%, transparent)`) : anneau d'avatar, pastille d'exo vide.
- **Détourage** (`box-shadow: 0 0 0 2px var(--color-surface)`) : un badge posé à cheval sur un autre élément (icône photo sur l'avatar). Ce n'est pas une ombre, c'est un trou dans le fond.
- **Toast** (`box-shadow` Tailwind `shadow-lg` teintée `black/40`) : l'unique élément flottant.

### Named Rules

**The Inset-Only Rule.** Une bordure se fait avec `inset box-shadow`, jamais avec `border`. La boîte ne change pas de taille entre l'état coché et non coché, donc rien ne saute sous le pouce.

**The Two-Floors Rule.** `bg` → `surface` → `raised`, et c'est fini. S'il faut un troisième étage, c'est que la hiérarchie de l'écran est fausse.

## Shapes

Le rayon dit la taille de la cible. Plus la surface est grande, plus le coin est rond : `rounded-3xl` (1.5rem) pour les cartes d'exos pleine largeur, `rounded-2xl` (1rem) pour la majorité des blocs et des champs, `rounded-xl` (0.75rem) pour les toggles compacts, `rounded-full` pour tout ce qui est rond par nature (avatars, pastilles, boutons d'icône, toasts, badges).

Aucun angle vif nulle part. Aucune bordure extérieure. Aucun trait de séparation autre que `border-t border-line` sous la barre d'onglets. Les icônes sont des SVG 24×24 à trait `currentColor`, épaisseur 1.7–2.2, extrémités arrondies : le même geste que les coins.

### Named Rules

**The Round-By-Size Rule.** 1.5rem au-dessus de 80 px de haut, 1rem entre 40 et 80, 0.75rem en dessous, plein rond si c'est un cercle. Un rayon choisi au hasard se voit.

## Components

### Buttons

- **Shape:** coins très arrondis (`rounded-2xl`, 1rem), pleine largeur, hauteur minimum 3.5rem (`min-h-14`).
- **Primary (`BigButton tone="accent"`):** aplat `var(--pc)`, texte `oklch(0.15 0 0)`. Du texte sombre sur l'accent, toujours — c'est ce qui garde le contraste quel que soit le joueur.
- **Neutral (`BigButton tone="neutral"`):** aplat `raised`, texte `ink`. Pour l'action secondaire d'un écran.
- **Active:** `active:scale-[0.98]` (0.95 sur les boutons ronds), `transition-transform`. Pas d'état `:hover` : il n'y a pas de souris.
- **Disabled:** `opacity-40`, aucun changement de couleur.
- **Icon button:** `size-11` (44 px) minimum, `rounded-full`, SVG 16–18 px au centre.

### Cards / Containers

- **Corner Style:** `rounded-3xl` (1.5rem) pour la carte d'exo, `rounded-2xl` (1rem) partout ailleurs.
- **Background:** `surface` au repos ; `color-mix(in oklch, <accent joueur> 22%, var(--color-surface))` une fois cochée.
- **Shadow Strategy:** anneau intérieur uniquement (voir Elevation).
- **Internal Padding:** `px-6` sur les grandes cartes, `px-5` sur les blocs standards.
- **Carte verrouillée:** fond en retrait (`color-mix(in oklch, surface 55%, bg)`) + cadenas à droite, libellé en `muted` à pleine opacité. Elle reste tappable et ouvre le lanceur de séance — elle ne refuse jamais, elle redirige. Le retrait vit dans le fond et **jamais** dans une opacité posée sur toute la carte : composer l'ensemble à 50 % éteignait le libellé (2,4:1) et l'anneau intérieur (1,03:1) en même temps que le fond, si bien que les trois cartes ne se percevaient plus comme des surfaces et que l'objet qui criait le plus fort « indisponible » était en réalité le raccourci principal de l'écran.

### Toggles (signature)

`ExoToggles` est la pièce centrale du produit : trois boutons `flex-1`, `min-h-11`, `rounded-xl`, poids 700.
- **Non coché:** fond `surface`, texte `muted`, anneau `line` 1px.
- **Coché:** fond mixé 24 % accent, texte à l'accent, anneau 60 % accent 1.5px, préfixe `✓ `.
- **Feedback:** `navigator.vibrate(10)` au tap, `.check-pop` (220 ms) sur la coche.
- **`aria-pressed`:** sur ce qui bascule vraiment, et seulement là. Une carte d'exercice verrouillée est un bouton qui *ouvre le lanceur* — rien à basculer, donc pas d'`aria-pressed`, et un `aria-label` qui dit ce que le tap va faire. Séance lancée, la carte n'est plus une commande : elle se rend en `div`, pas en `<button disabled>`, qui s'annoncerait « coché, bouton, non disponible » — la description d'un contrôle cassé, pas d'un exercice fait. Le ✓ étant `aria-hidden`, l'état passe par un `sr-only`.

### Inputs / Fields

- **Style:** fond `surface`, `rounded-2xl`, `px-4 py-2.5`, `text-base` (16 px obligatoire), placeholder en `muted`.
- **Focus:** `focus:outline-none focus:ring-2` avec `--tw-ring-color: var(--pc)`. L'anneau de focus est à la couleur du joueur, comme le reste.
- **Multiligne (tchat):** `resize-none`, `rows=1`, croissance jusqu'à `max-h-40`.

### Navigation

`TabBar` collée en bas, `border-t border-line`, `bg-bg/95 backdrop-blur`, `pb-safe`.
- **Item:** colonne icône 22 px + libellé 11 px bold, `min-h-14`, `flex-1`.
- **Inactif:** `faint`. **Actif:** `var(--pc)` + `aria-current="page"`.
- **Non-lus:** pastille `--pc` à texte sombre, en haut à droite de l'icône, masquée sur l'onglet actif. Au-delà de 9 : `9+`.

### Skeleton (signature)

Un bloc `surface` à la forme et à la place exactes du contenu qui arrive. Deux règles indissociables : il **tient la place finale** (rien ne saute sous le pouce quand la donnée tombe) et il **reste invisible 250 ms** (un loader qui clignote 80 ms fait paraître l'app plus lente qu'un écran vide). Respiration en opacité 1 → 0.6, jamais en couleur.

### Toast

`rounded-full`, fond `raised`, `px-5 py-3`, texte 0.875rem/500, posé à `bottom-24`, `pointer-events-none`. Entrée `.toast-in` (200 ms). Sert aux échecs d'écriture et aux confirmations de copie — jamais aux succès ordinaires.

## Do's and Don'ts

### Do:

- **Do** prendre la couleur dans `lib/palette.ts` ou dans `var(--pc)`. Une couleur écrite en dur dans un composant est un bug.
- **Do** fabriquer les états colorés avec `color-mix(in oklch, <accent> N%, var(--color-surface))`.
- **Do** poser du texte `oklch(0.15 0 0)` sur tout aplat d'accent joueur.
- **Do** délimiter avec `inset box-shadow`, pour que la boîte ne change pas de taille entre deux états.
- **Do** viser ≥ 44 px de cible et accompagner le tap d'un `active:scale` + `navigator.vibrate`.
- **Do** ajouter chaque nouvelle animation au bloc `@media (prefers-reduced-motion: reduce)` de `globals.css`, avec sa fin d'état — une animation coupée ne doit jamais laisser un élément bloqué sur sa valeur de départ.
- **Do** utiliser `Skeleton` pour toute attente réseau, à la forme du contenu final.
- **Do** garder les transitions entre 120 et 260 ms sur la courbe `cubic-bezier(0.22, 1, 0.36, 1)`.

### Don't:

- **Don't** ajouter d'ombre portée. La profondeur se fait en empilant `bg` / `surface` / `raised`.
- **Don't** teinter un neutre. Chroma 0, sans exception.
- **Don't** introduire un accent qui n'appartient à personne : les seuls non-joueurs sont `x2` et `danger`.
- **Don't** utiliser Anton pour autre chose que des chiffres.
- **Don't** descendre un champ de saisie sous 16 px.
- **Don't** écrire un `sm:` / `md:` / `lg:` : cette app n'a pas d'écran large.
- **Don't** empiler un quatrième niveau de fond, ni imbriquer une carte dans une carte.
- **Don't** mettre un spinner bloquant : l'UI est optimiste, l'échec se rattrape par rollback + toast.
- **Don't** styler un `:hover` comme porteur d'information. Il n'y a pas de souris.
- **Don't** faire clignoter, boucler ou traîner une animation. Une seule fois, courte, puis plus rien.
