# La mi-temps du 6 août — concept figé le 17/07

Concept validé par Jordan le 17/07. À construire la semaine du 3 août,
en prod avant le 6 août au soir. Rien à coder avant.

## Le principe

Le challenge fait 50 jours (13/07 → 31/08). Le 6 août au soir, 25 jours
sont joués : la moitié exacte. La mi-temps est un événement one-shot qui
marque le coup — et surtout qui relance ceux qui ont décroché, au moment
du creux d'août. Le message central : « 25 jours faits, 25 restants — la
deuxième mi-temps commence maintenant. »

## Ce que voit un joueur

Un écran story plein écran, cartes qu'on tape pour avancer (pattern
exact de `DuelAnnounceModal` / `TutorialScreen`), montré une fois par
joueur à partir du **7 août au matin** (flag localStorage
`lc100.miTempsSeen`). Contenu :

1. **Mi-temps.** Le cadre : 25 jours faits, 25 restants. Gros chiffre,
   une phrase.
2. **La bande.** Les stats collectives : total d'exos du groupe (le
   « 4 350 exos à nous tous »), jours parfaits collectifs, nombre de
   séances guidées. Une stat = un MVP nommé (plus longue série, plus
   régulier, plus rapide au 3/3…) — chacun doit pouvoir trouver son nom
   quelque part, pas seulement le premier.
3. **La course.** Top 3 avec écarts, bilan des duels (gagnés/nuls), et
   la bascule : « tout se joue en deuxième mi-temps ».
4. **Toi.** Les chiffres perso : exos, jours parfaits, meilleure série,
   et un angle de relance individuel (ta série à défendre, ton duel en
   cours, ta meilleure semaine).
5. **CTA + partage.** Bouton de partage de la carte collective vers
   WhatsApp (réutiliser `lib/share.ts`).

## Le push

Un seul, **jeudi 7 août à 9h Paris** : réveille tout le monde vers
l'écran. Le pattern est celui de feu `announce-duels.yml` (supprimé
depuis, à relire dans l'historique git) : workflow GitHub à cron
date-gated (8h UTC, garde `date -u +%F = 2026-08-07`), route
`/api/cron/mi-temps` gardée par `isAuthorizedCron`, envoi via
`sendToPlayers`. Copy à écrire au moment du build, ton chambreur
habituel.

## Données (tout existe, zéro migration)

- `leaderboard(p_until: '2026-08-06')` — classement et stats à la mi-temps.
- `daily_points` — séries, jours parfaits, bonus.
- `duel_results` — bilan des duels des semaines du 20/07 et 27/07 (+ celle du 03/08 en cours).
- `workout_sessions` — séances guidées, plus rapide au 3/3 (`completed_at`).
- `entries` — totaux d'exos.

## Garde-fous décidés

- Aucune migration, aucun point distribué : la mi-temps raconte, elle ne
  score pas.
- Code date-gated : rien de visible avant le 7 août au matin
  (`parisToday() >= '2026-08-07'`), test en dev via `?date=2026-08-07`.
- L'écran doit rester vrai si un joueur l'ouvre tard (le 10 août) : les
  stats sont figées au 6 août au soir (bornes `p_until`), pas « à
  aujourd'hui ».
- Supprimer `mi-temps.yml` après le 7, comme `announce-duels.yml` l'a
  été une fois son annonce partie.

## Vérifs prévues au build

Captures Playwright avec `?date=2026-08-07` (script
`showcase-duels.mjs` du scratchpad comme modèle, mocks par interception
réseau), test du push en local avec le Bearer, et revue des textes par
Jordan avant merge — comme pour l'annonce des duels.
