# Spec — la carte « nouveau record de volume »

Pour l'agent qui implémentera. Tout ce qui suit a été vérifié dans le code et
sur la base de prod le 25/07 ; les points laissés ouverts sont marqués comme
tels et se tranchent avec Jordan.

---

## 1. L'intention

Doren est à 295 points au général, Jerem à 51. Le classement n'a rien à dire à
Jerem, sinon qu'il est dernier. Les duels non plus — il vient d'en perdre un.

**Tout ce que l'appli dit aujourd'hui est relatif aux autres** : ton rang, ton
duel, qui a fini premier, qui a gagné la semaine. Elle ne te dit jamais que tu
as fait mieux qu'avant. Le record personnel est la seule mécanique où le dernier
peut gagner quelque chose.

C'est **une carte de fil, pas un bonus**. Aucun point n'est en jeu, donc rien à
optimiser : personne ne déclarera 400 pompes pour empocher quoi que ce soit. Si
le groupe s'en empare, on pourra y accrocher des points plus tard — l'inverse ne
se fait pas.

---

## 2. Ce qui existe déjà — à copier, pas à réinventer

**La carte de record de série est déjà là.** `app/api/moments/route.ts` (~l.172)
émet `kind: "record"` avec `payload: { streak }`, rendue par `lib/feed.ts`
(~l.149) en « bat sa meilleure série : 13 jours ».

Deux détails de sa conception valent d'être repris tels quels :

- **Le garde du sens** : `streak >= 3`, avec le commentaire « sinon tout est un
  record ». Un record qui tombe au premier jour ne veut rien dire.
- **La déduplication par îlot** : `dedupe_key = islandStart`. La carte tombe une
  fois par série, pas chaque jour où le record est encore battu. C'est ce qui
  l'empêche de devenir un salaire.

L'architecture de `/api/moments` fait le reste : elle est appelée après chaque
écriture qui compte, elle `upsert` avec `onConflict: player_id,kind,dedupe_key`
en `ignoreDuplicates`, donc **tout est rejouable** — un appel raté est rattrapé
au suivant, jamais de doublon.

**Point vérifié qui rend ce chantier léger** : déclarer un bonus appelle déjà ce
chemin. `useBonus(onScored)` → `onBonusScored` → `rescore()` → `notifyMoments()`
(`components/App.tsx` ~l.82-97). La détection tombe donc au bon moment, juste
après la déclaration.

**Conséquence : aucune migration SQL.** Le `kind` `'record'` est déjà autorisé
par la contrainte `feed_events_kind_check` (migration 14, l.56). On ne touche ni
à `supabase/`, ni au barème, ni à un écran.

---

## 3. La règle

**Le volume d'une journée** = la somme des répétitions déclarées **en plus** des
300 du contrat, sur les trois exos du contrat uniquement : pompes, abdos,
squats.

| Palier | Répétitions |
|---|---|
| `pompes_50` | 50 |
| `pompes_100` | 100 |
| `abdos_100` | 100 |
| `abdos_200` | 200 |
| `squats_100` | 100 |
| `squats_200` | 200 |

Les paliers d'une même échelle **se cumulent** depuis la migration 22 :
`pompes_50` + `pompes_100` cochés le même jour = 150 répétitions.

**La carte tombe** quand le volume du jour dépasse **strictement** le meilleur
volume de tous les jours précédents de ce joueur.

### Pourquoi les répétitions et pas les points

C'est le cœur de la spec, ne pas s'en écarter. Mesuré en points de bonus, le
record suit le **tarif**, pas l'effort : les records actuels tiennent entre 22 et
26 points, or une seule déclaration de 10 km vaut +20 depuis la S3. Presque
n'importe qui courant 10 km plus un autre bonus « battrait son record » sans
avoir fait une pompe de plus. Mesuré en répétitions, 350 veut dire la même chose
en S1, en S3 et l'an prochain.

C'est aussi pour ça que la course, le gainage, la corde et les 10 000 pas
**n'entrent pas** dans le calcul : ce sont des à-côtés, pas le contrat.

### Comment reconnaître « c'est un des trois exos »

Par `bonus_catalog.ladder in ('pompes','abdos','squats')` — **jamais** par une
liste de clés en dur. Un palier peut s'ajouter au catalogue, la colonne `ladder`
est la seule définition qui ne se périme pas.

⚠️ **Le catalogue ne stocke pas les répétitions**, seulement les points. La table
ci-dessus doit donc vivre dans une constante côté code (`lib/`), et elle peut se
désynchroniser du catalogue. Garde-fou obligatoire : **si une clé appartenant à
l'une des trois échelles est absente de la table, on abandonne le calcul du
record pour ce joueur ce jour-là** plutôt que de compter un total partiel. Un
record sous-évalué qui s'annonce quand même est pire qu'une carte manquante.

*(Alternative plus propre, hors périmètre : une colonne `reps` sur
`bonus_catalog`. Elle demande une migration, donc l'accord de Jordan.)*

---

## 4. Les cas limites

| Cas | Comportement attendu |
|---|---|
| Première déclaration de la vie du joueur | **Aucune carte.** Il faut un record antérieur à dépasser. |
| Volume égal au record | **Aucune carte.** Égaler n'est pas battre — comparaison `>` stricte. |
| Deux déclarations le même jour qui franchissent le seuil | **Une seule carte.** `dedupe_key` = le jour. |
| Le joueur décoche et repasse sous son record | **La carte disparaît.** Voir ci-dessous. |
| Jours S1 / S2 | **Comptent.** Le record est à vie, il ne se réinitialise pas à chaque saison. C'est ce qui le rend rare et mérité. |
| Journée sans déclaration sur les trois exos | Volume = 0, jamais un record. |

### La carte doit disparaître au décochage

L'appli a deux comportements opposés, et c'est assumé : un **bonus** annulé garde
sa carte (« une déclaration est une déclaration »), une **séance** décochée perd
la sienne (migration 26, « un journal qui garde une affirmation devenue fausse
contredit le principe *dire la vérité* »).

Un record appartient à la seconde famille : c'est une affirmation sur l'histoire
du joueur. S'il retire la déclaration, il n'a plus le record, et la carte ment.

Implémentation : `/api/moments` est **aussi** appelée au décochage (même
`rescore()`). La route doit donc, dans la même passe, supprimer la carte
`record`/`vol:<jour>` du jour si le volume recalculé ne dépasse plus le record
antérieur. Pas de trigger SQL : tout se fait dans la route.

⚠️ **Correction — ce paragraphe avait un angle mort.** « Tout se fait dans la
route » ne suffisait pas : la route tourne avec la clé anon, et `feed_events`
n'avait aucune politique RLS de suppression. Le `delete()` partait sans erreur
et n'effaçait rien. La migration 26, citée en précédent, supprime via un trigger
`security definer` qui contourne RLS — un privilège que la route n'a pas.

D'où `supabase/migration30-record-volume-suppression.sql` : une politique de
suppression, volontairement limitée à `kind = 'record' AND dedupe_key LIKE
'vol:%'`. Le record de série se dédup sur une date nue, il reste hors d'atteinte,
comme le reste du fil. Vérifié en prod : la carte de volume part, celle de série
résiste.

---

## 5. Les points d'accroche

| Fichier | Ce qu'il faut y faire |
|---|---|
| `app/api/moments/route.ts` | Charger les `bonus_claims` joints au catalogue, calculer le volume par (joueur, jour), détecter le dépassement, pousser le `FeedInsert`. Ajouter la passe de suppression au décochage. Le type `FeedInsert.kind` (~l.36) inclut déjà `"record"`. |
| `lib/feed.ts` | Étendre `FeedPayload` avec `reps` et `before`. Dans le `case "record"` (~l.149), **discriminer sur le payload** : `reps` présent → volume, sinon → série. |
| `supabase/` | ~~**Rien.** Aucune migration.~~ Une seule : le droit de supprimer une carte de volume (voir ci-dessous). |

### La discrimination sans nouveau `kind`

Réutiliser `kind: "record"` évite d'étendre `feed_events_kind_check`, donc évite
une migration. Le `dedupe_key` sépare proprement les deux familles :

- record de série → `dedupe_key` = date de début d'îlot (existant, ne pas toucher)
- record de volume → `dedupe_key` = `vol:<jour>`

Payload proposé : `{ day, reps: 350, before: 200 }`.

---

## 6. La carte

> 💥 **Jordan** — nouveau record : 350 répétitions de rab (avant 200)

Trois choses s'y jouent :

- **L'emoji distingue les deux records.** 📈 reste au record de série, 💥 pour le
  volume. Deux cartes de même `kind` qui se ressemblent seraient illisibles.
- **L'ancien record est affiché.** C'est ce qui rend la carte auto-référentielle
  : sans lui, « 350 répétitions » n'est qu'un chiffre ; avec, c'est une
  progression. C'est tout l'objet de la fonctionnalité.
- **Le ton reste celui du fil** : troisième personne, court, pas de félicitations
  appuyées. « de rab » est du vocabulaire maison (voir l'écran de lancement S3).

---

## 7. Ce qu'il ne faut PAS faire

- **Pas de points.** C'est ce qui garantit qu'il n'y a rien à optimiser.
- **Pas de trigger** : le `kind` existe, la route suffit à décider. Une seule
  migration, et pas sur le schéma : le droit de supprimer une carte de volume
  (§4). Le barème, les tables et les contraintes ne bougent pas.
- **Pas d'écran, pas de compteur, pas de « ton record actuel » sur Aujourd'hui.**
  Rien sur le chemin des 10 secondes. La carte se découvre dans le fil.
- **Pas de record hebdomadaire ni mensuel.** Un seul record, à vie, par joueur.
- **Pas de record sur le temps de séance.** La S3 vient de retirer les deux bonus
  de chrono ; battre son temps sur 100 pompes récompense la dégradation de la
  forme, pas le progrès.

---

## 8. Recette

La règle est déterministe et rejouable : elle se vérifie sur les données réelles.
Au 25/07, en rejouant l'historique complet, la carte serait tombée **13 fois en
13 jours** — environ une par jour pour le groupe entier :

| Joueur | Cartes | Aux dates (volume) |
|---|---|---|
| Jordan | 3 | 16/07 (100) · 19/07 (200) · 24/07 (350) |
| Doren | 3 | 16/07 (150) · 17/07 (200) · 25/07 (300) |
| Pierre | 2 | 15/07 (100) · 20/07 (300) |
| Léo | 2 | 15/07 (150) · 25/07 (200) |
| Hichem | 2 | 15/07 (50) · 16/07 (150) |
| Jerem | 1 | 20/07 (200) |

⚠️ Ces chiffres comptent la **première** déclaration de chacun comme un record.
La règle du §4 l'exclut : **l'implémentation correcte doit en produire 7, pas
13** (une de moins par joueur). C'est le meilleur test de la règle du premier
record — si l'agent en obtient 13, le garde n'est pas posé.

Le rythme attendu ensuite est d'environ une carte tous les deux jours pour le
groupe : Hichem n'a rien battu depuis le 16/07, et c'est le comportement voulu.

Tests unitaires à ajouter dans `tests/` : le premier record ne déclenche pas,
l'égalité ne déclenche pas, les paliers cumulés s'additionnent, une clé inconnue
d'une des trois échelles annule le calcul, la course et les pas n'entrent pas
dans le total.

⚠️ Correction : cette spec annonçait « Vitest, déjà en place ». C'était faux —
le repo n'avait aucune infra de test. L'implémentation l'installe (devDependency,
`npm test`, `vitest.config.ts` pour l'alias `@/`).

---

## 9. Tranché avec Jordan avant de coder

1. **Notification : aucune.** `/api/moments` envoie un push aux autres joueurs
   pour chaque moment réellement inséré ; le record de volume en est exclu, comme
   le « premier du jour ». À ~1 carte par jour, ce serait une notification de plus
   par jour pour cinq personnes, et la règle du produit est « l'appli motive, elle
   ne harcèle pas ». La carte se découvre en ouvrant le fil. Le record de **série**,
   lui, continue de partir en push : le filtre porte sur le payload, pas sur le `kind`.
2. **Formulation retenue** : `💥 Jordan explose son record de rab : 350 répétitions,
   contre 200 avant`. Le contraste est appuyé plutôt que mis entre parenthèses —
   c'est l'ancien record qui fait la carte.
3. **Seuil : aucun**, au-delà de « un record antérieur doit exister ». Le rythme
   mesuré sur les données réelles (~1 carte tous les deux jours pour le groupe) est
   déjà assez rare pour se passer d'un plancher, et c'est une règle de moins à
   expliquer.
