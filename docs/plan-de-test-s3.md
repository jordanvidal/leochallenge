# Plan de test — feuille de bonus (S3)

Destiné à un agent qui pilote un navigateur. Couvre les deux changements de la
feuille de bonus avant la release du 27/07 :

- **PR #34** — un seul déplacement par jour (5 km, 10 km ou 10 000 pas).
- **PR #35** — la feuille se ferme au glissé vers le bas.

Ce que ce plan **ne couvre pas** : le calcul des points côté base (c'est
`supabase/tests/testplan-s3.sql`) et la règle elle-même en tant que fonction
(c'est `tests/bonus-movement.test.ts`, 15 cas, `npm test`). Ici, on teste
uniquement ce que le composant fait à l'écran.

---

## 1. Lire ceci avant de toucher quoi que ce soit

**Toute déclaration de bonus écrit une carte définitive dans le fil du groupe.**
Le trigger `trg_bonus_claims_feed` (migration 5) insère dans `feed_events` à
chaque `insert` sur `bonus_claims`, et **annuler la déclaration ne retire pas la
carte** — c'est une règle assumée du produit : « une séance est un fait, un
bonus est une déclaration ». Les six joueurs verront donc « Jordan a couru
5 km » apparaître pour de vrai.

Ce qui est en revanche silencieux : **aucune notification ne part d'une
preview**. `pushAutorise()` exige `VERCEL_ENV === "production"` ; en preview la
variable vaut `preview`. Personne n'est réveillé.

**La simulation de date ne marche pas en preview.** `simulatedToday()` rend
`null` dès que `NODE_ENV === "production"`, et un build Vercel — preview
comprise — a `NODE_ENV=production`. Le paramètre `?date=2026-07-27` est donc
mort sur une preview. Comme la règle de #34 est bornée à `SAISON3_START`
(27/07), **elle est dormante sur la preview tant qu'on est avant lundi.**

Pour la réveiller avant l'heure, il faut poser `NEXT_PUBLIC_SAISON3_START` à la
date du jour, **scopée Preview**, sur le projet Vercel, puis redéployer la
preview. C'est une modification d'environnement : elle se décide avec Jordan,
et se retire après le test.

---

## 2. Les trois terrains

| Terrain | Ce qu'il prouve | Ce qu'il ne prouve pas | Écrit en base ? |
|---|---|---|---|
| **Le banc** (artefact autonome) | La règle dans tous ses cas, le geste au doigt, la date librement réglable | Que le vrai composant React se comporte pareil — c'est un portage, pas le code | Non, rien |
| **`npm run dev` en local** | Le vrai composant, `?date=2026-07-27` fonctionne (`NODE_ENV=development`) | Le rendu iOS réel (Safari, safe areas, retour haptique) | **Oui, base de prod** |
| **Preview Vercel** | Le vrai composant sur un vrai téléphone | Rien de la règle #34 avant lundi, sauf env posée (voir §1) | **Oui, base de prod** |

**Ordre conseillé :** le banc d'abord (gratuit, sans conséquence), le local
ensuite pour le composant, la preview en dernier et sur téléphone, uniquement
pour le geste de #35 — qui, lui, ne dépend d'aucune date et ne déclare rien.

---

## 3. Préconditions

1. Ouvrir l'app, passer la porte du groupe, choisir un joueur.
2. Le tutoriel s'affiche au premier passage : le dérouler jusqu'au bout.
3. Rester sur l'onglet **Aujourd'hui**.

**Pas besoin de lancer une séance.** Le portier de séance ferme les cartes
d'exercices, pas la feuille de bonus : `TodayScreen` ne conditionne
`BonusSection` qu'à `!over` (challenge non terminé). La rangée
`＋ Déclarer un bonus` est donc disponible tout de suite.

**Repères dans le DOM :**

| Élément | Comment le viser |
|---|---|
| La rangée qui ouvre la feuille | bouton contenant le texte `Déclarer un bonus` |
| La feuille | `[role="dialog"][aria-label="Déclarer un bonus"]` |
| Une puce | bouton dont le texte contient le libellé (`5 km de course`, `10 km de course`, `10 000 pas`) |
| Puce déclarée | `aria-pressed="true"` + un `✓` en fin de libellé |
| Puce fermée | attribut `disabled` + opacité 35 % |
| La ligne d'explication | paragraphe commençant par `🚶 Un seul déplacement par jour` |
| La poignée | le trait gris de 40×4 px, centré, tout en haut de la feuille |

---

## 4. PR #34 — un seul déplacement par jour

> **Prérequis** : être au 27/07 ou après (en local : `?date=2026-07-27`).
> Avant cette date, tous ces cas doivent au contraire montrer **zéro
> fermeture** — c'est le cas T4.7, à faire en premier.

Après chaque cas, **remettre à zéro** : re-taper les puces déclarées pour les
annuler (la déclaration part, la carte de fil reste — voir §1).

### T4.1 — Le 5 km ferme les deux autres

1. Ouvrir la feuille. Taper `5 km de course`.
2. **Attendu** : la puce passe à la couleur du joueur, `aria-pressed="true"`, `✓`.
3. **Attendu** : `10 km de course` et `10 000 pas` sont `disabled` et estompées.
4. **Attendu** : la ligne `🚶 Un seul déplacement par jour…` apparaît sous les puces.
5. **Attendu** : aucune autre puce n'est fermée (pompes, gainage, 500 marches, dips…).

### T4.2 — Le 10 km ferme les deux autres

Comme T4.1 en partant de `10 km de course`. `5 km de course` et `10 000 pas`
doivent être `disabled`.

### T4.3 — Les 10 000 pas ferment les deux courses

Comme T4.1 en partant de `10 000 pas`. Les deux puces de course doivent être
`disabled`.

### T4.4 — Le changement d'avis reste possible

1. Déclarer `10 km de course`.
2. Re-taper `10 km de course`.
3. **Attendu** : la déclaration s'annule, les trois puces redeviennent
   actionnables, la ligne d'explication disparaît.

C'est le cas qui compte le plus : une règle qui enferme le joueur dans son
premier tap coûterait une journée entière à qui s'est trompé de puce.

### T4.5 — La ligne d'explication ne s'affiche jamais pour rien

1. Feuille ouverte, rien de déclaré → **la ligne est absente**.
2. Déclarer `3 min de gainage` → **la ligne reste absente**.
3. Déclarer `5 km de course` → **la ligne apparaît**.

### T4.6 — Les paliers des autres exos se cumulent toujours

1. Déclarer `+50 pompes` **et** `+100 pompes`.
2. **Attendu** : les deux sont déclarées en même temps, aucune n'est fermée.

Anti-régression : #34 ne doit pas ré-interdire ce que la migration 22 a ouvert.

### T4.7 — Avant le 27/07, la règle dort

1. Se placer au 26/07 (en local : `?date=2026-07-26`).
2. Déclarer `5 km de course`.
3. **Attendu** : `10 000 pas` reste **actionnable**, aucune ligne d'explication.

### T4.8 — Le total du jour suit

1. Déclarer `10 km de course`.
2. Fermer la feuille.
3. **Attendu** : la rangée `＋ Déclarer un bonus` affiche `🏃` et `+20`
   (et non `+12` : le 10 km est une puce entière depuis #34).

---

## 5. PR #35 — le glissé pour fermer

Aucune déclaration, aucune date : ces cas se testent n'importe quand, y compris
sur la preview. **À faire au doigt sur un vrai téléphone** — c'est le seul
endroit où le geste compte.

### T5.1 — Un glissé franc ferme

1. Ouvrir la feuille. Poser le doigt sur la poignée.
2. Tirer vers le bas de plus de 88 px, puis relâcher.
3. **Attendu** : la feuille suit le doigt pendant le geste, puis sort par le bas
   (~200 ms) et disparaît. Le fond noir part avec elle.

### T5.2 — Un coup sec ferme aussi

1. Depuis la poignée, un geste vif d'environ 40 px, relâché rapidement.
2. **Attendu** : elle se ferme, sans qu'on ait eu à parcourir les 88 px.

### T5.3 — En dessous du seuil, elle revient

1. Tirer de ~30 px, lentement, puis relâcher.
2. **Attendu** : elle remonte se remettre en place, animée. La feuille **reste
   ouverte** et rien n'est déclaré.

### T5.4 — Vers le haut, elle ne bouge pas

1. Depuis la poignée, tirer vers le **haut**.
2. **Attendu** : la feuille ne se déplace pas d'un pixel.

### T5.5 — La liste de puces garde son défilement

1. Poser le doigt **sur les puces** (pas sur la poignée) et tirer vers le bas.
2. **Attendu** : c'est la liste qui défile, la feuille ne bouge pas et ne se
   ferme pas.

C'est le cas qui protège le geste principal : si la prise couvrait toute la
feuille, déclarer un bonus deviendrait un concours d'adresse.

### T5.6 — Les autres sorties marchent encore

1. Taper le bouton `Fermer` → elle se ferme.
2. Rouvrir, taper le fond noir en dehors de la feuille → elle se ferme.
3. Rouvrir, appuyer sur `Échap` (clavier) → elle se ferme.

### T5.7 — Le glissé ne déclare rien par accident

1. Ouvrir la feuille, glisser pour fermer.
2. Rouvrir.
3. **Attendu** : aucune puce n'est passée à `aria-pressed="true"`.

---

## 6. En cas d'échec

Rapporter, pour chaque cas rouge : le numéro (T4.x / T5.x), le terrain, la date
simulée s'il y en a une, l'état `disabled` / `aria-pressed` réellement observé
sur les trois puces de déplacement, et la présence ou non de la ligne
d'explication.

Deux pièges connus valent la peine d'être écartés avant de conclure à un bug :

- **Tout est ouvert alors que ça devrait être fermé** → vérifier la date
  effective. En preview, `?date=` ne fait rien (§1), et la règle dort avant le
  27/07. Ce n'est pas une régression, c'est le bornage qui fait son travail.
- **Le 10 km est absent de la feuille** → `migration29` n'est pas encore
  appliquée en base. La règle tient quand même sur le 5 km seul (T4.1 et T4.3
  restent valides), le 10 km apparaîtra après la migration.
