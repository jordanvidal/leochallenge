# Runbook — mise en production de la saison 3 (lundi 27/07)

Trois chantiers convergent sur la même nuit. Ce fichier est la seule
séquence à suivre : il dit quoi merger, dans quel ordre, quelles migrations
appliquer, et comment vérifier que rien n'a bougé pour la S1 et la S2.

À exécuter par un agent programmé à **00h05 le lundi 27/07** pour la partie
base, et à la main par Jordan pour la partie dimanche soir.

---

## Ce qui part

| PR | Branche | Contenu | Migration |
|---|---|---|---|
| **#34** | `feature/pas-hors-course` | Barème S3, 10 km, un seul déplacement par jour | `29` |
| **#38** | `feature/bonus-cardio` | Six bonus de cardio, rangement par zone | `31` |
| **#39** | `feature/lancement-s3` | Le carrousel de lancement | aucune |

#30 est fermée : son unique apport (le correctif du doublement, `47772f3`)
est greffé sur #34.

**L'ordre n'est pas négociable.** #38 est basée sur #34 sur GitHub : la
merger d'abord ferait entrer le barème S3 sans son plan de test. Et côté
base, la 29 ajoute `course_10km` puis la 31 le range dans le cardio — dans
l'autre sens, le 10 km arrive sans famille et atterrit dans un paquet
« Autres » en bas de la feuille.

---

## D-1 — dimanche 26/07, après 23h00

### 1. Figer les chiffres S2 du carrousel

Le bloc `S2` en tête de `components/LaunchS3Screen.tsx` contient des
placeholders. Il se remplit **une fois la journée de dimanche finie**, sinon
les derniers 3/3 du soir manquent.

```sql
-- Les trois compteurs de la slide « Ce que vous avez encaissé »
with lb as (select * from leaderboard(null, date '2026-07-26'))
select
  (select count(*) from lb where exos_done > 0)                as joueurs_actifs,
  (select sum(exos_done) * 100 from lb)                        as total_reps,
  (select round((sum(exos_done) * 100.0)
              / nullif(count(*) filter (where exos_done > 0), 0)) from lb) as moyenne_reps,
  (select sum(perfect_days) from lb)                           as jours_parfaits;
```

```sql
-- Le podium, et de quoi écrire les notes sous chaque nom
select p.name, lb.rank, lb.points, lb.perfect_days, lb.exos_done * 100 as reps
from leaderboard(null, date '2026-07-26') lb
join players p on p.id = lb.player_id
order by lb.rank, p.name;
```

Reporter dans `S2 = { moyenneReps, totalReps, joursParfaits, podium }`.
**Ne toucher à rien d'autre dans ce fichier.**

### 2. Merger, dans cet ordre

1. **#34** → `main`
2. **#38** → `main` (sa base bascule automatiquement de `feature/pas-hors-course` vers `main` une fois #34 mergée)
3. **#39** → `main`

Après chaque merge, attendre que le déploiement Vercel passe au vert. Rien
n'est visible pour le groupe à ce stade : les six puces de cardio, le 10 km
et le rangement par zone n'existent qu'une fois les migrations passées, et
le carrousel est gardé par `saison3Started()`, faux jusqu'à lundi.

---

## J — lundi 27/07, 00h05

S2 est gelée depuis minuit : `guard_bonus_claim`, `guard_bonus_delete` et
`guard_entry_write` refusent tous les trois toute écriture sur un jour
antérieur à aujourd'hui (`JOUR_VERROUILLE`). Rien de ce qui suit ne peut
déplacer un point de S1 ou de S2.

### 1. Appliquer les migrations, dans cet ordre

```
supabase/migration29-bareme-s3.sql   ← le barème S3
supabase/migration31-bonus-cardio.sql ← le cardio et les familles
```

Les deux sont rejouables : `on conflict do nothing` sur les insertions,
`add column if not exists` sur la colonne `family`, et le décalage de `sort`
de la 29 est gardé par un `not exists` sur `course_10km`.

### 2. Vérifier

```sql
-- (a) Le catalogue : 24 bonus d'exercice, tous rangés, aucun orphelin.
select family, count(*), string_agg(key, ', ' order by sort) as puces
from bonus_catalog where kind = 'exercise'
group by family order by min(sort);
-- Attendu : cardio 13, haut 3, abdos 3, jambes 5. Aucune ligne family = null.
```

```sql
-- (b) Le 10 km est bien dans le cardio et pas dans les orphelins.
select key, points, sort, ladder, family from bonus_catalog where key = 'course_10km';
-- Attendu : 20 pts, sort 20, ladder null, family 'cardio'.
```

```sql
-- (c) Les six nouveaux existent et sont déclarables.
select key, label, points, family from bonus_catalog
where key in ('jumping_jacks_100','jumping_jacks_200','climbers_100',
              'climbers_200','squats_jump_50','squats_jump_100')
order by sort;
-- Attendu : 6 lignes, +3/+5/+4/+7/+4/+7, toutes en cardio.
```

**(d) Le contrôle qui compte : aucun point de S1 ou S2 n'a bougé.**

Ne pas inventer de requête ici — la migration 29 porte son propre protocole,
en fin de fichier (§5). Il est meilleur que tout ce qu'on improviserait : il
enveloppe l'application dans une transaction, photographie `daily_points`
dans une table temporaire, compare `points`, `bonus_points` et `streak_pos`
ligne à ligne, et **se termine par `commit` ou `rollback` selon le
résultat**. Les deux comptes attendus sont nuls.

C'est donc ce protocole qui pilote l'application de la 29, pas l'inverse :
si un des deux comptes n'est pas nul, `rollback`, et la MEP s'arrête là. La
31 ne s'applique pas — elle ne sert à rien sans la 29, et son seul effet
serait de laisser un catalogue à moitié rangé.

```sql
-- (e) Les échelles sont intactes. Le record de volume ne reconnaît les exos
--     du contrat que par `ladder` : une échelle de trop du côté des trois
--     exos et le calcul se suspend pour tout le monde.
select ladder, string_agg(key, ', ' order by sort) as paliers
from bonus_catalog where ladder is not null
group by ladder order by ladder;
-- Attendu, huit échelles : abdos, burpees, climbers, fentes, jumping_jacks,
-- pompes, squats, squats_jump.
-- CRITIQUE : `squats` ne contient QUE squats_100 et squats_200. Les squats
-- jump ont leur échelle à eux, et la course n'en a aucune (deux distances
-- entières, pas des paliers).
```

### 3. Contrôle applicatif

Ouvrir la prod sur téléphone :

- La feuille de bonus s'ouvre sur quatre paquets titrés, pas de « Autres ».
- Cocher 5 km éteint 10 km et 10 000 pas, avec la phrase 🚶 sous les groupes.
- Le carrousel de lancement s'affiche au premier lancement de la journée.

---

## Si ça tourne mal

Les deux migrations sont additives ; aucune ne supprime de donnée. Le retour
arrière se fait par la vue, pas par les lignes.

- **Le catalogue est faux** (familles, sorts) : purement cosmétique, ça se
  corrige par `update` à froid le lendemain. Ne pas réveiller le groupe.
- **La vue `daily_points` est fausse** (le contrôle (d) sort des lignes) :
  c'est le seul cas grave. Restaurer la définition d'avant en rejouant
  `migration28-premier-du-jour-feed.sql`, puis prévenir Jordan.
- **Les six puces de cardio doivent disparaître** :
  `delete from bonus_catalog where key like 'jumping_jacks%' or key like 'climbers%' or key like 'squats_jump%';`
  — ne marche que si personne ne les a encore déclarées (FK depuis
  `bonus_claims`), donc dans l'heure qui suit, pas après.

---

## Points en suspens — à trancher avant dimanche soir

Trois choses relevées dans le carrousel en préparant cette MEP. Elles ne
bloquent aucune migration, mais elles partent devant six personnes.

1. **« Douze jours dans les pattes ».** Le challenge a commencé le 13/07 ;
   au soir du 26/07 ça fait **quatorze** jours. La phrase apparaît deux fois
   (slides 1 et 2).

2. **La moyenne de répétitions est tirée vers le bas.** Le dénominateur est
   « les joueurs ayant coché au moins une fois », soit **7** comptes — dont
   deux quasi inactifs (Nathan 200 reps, Hugo 0, Jerem 900). Résultat au
   25/07 : 2 771 de moyenne, alors que les cinq qui jouent vraiment sont à
   ~3 700 chacun. La slide dit « répétitions chacun, en moyenne » — c'est
   exact, mais ça sous-vend le groupe qu'elle s'adresse.

3. **Le podium placeholder est faux.** Au 25/07 c'est Doren, **Pierre**,
   Hichem — le fichier annonce Doren, Hichem, Pierre. Et les notes sont
   fausses aussi : Hichem est à 13 jours parfaits (pas « 12/12 »), Pierre à
   13 (pas 11). Tout ça se recalcule dimanche soir de toute façon, mais la
   grammaire des notes (« 12/12 parfaits ») ne tiendra plus sur 14 jours.
