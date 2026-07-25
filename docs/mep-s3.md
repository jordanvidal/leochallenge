# Runbook — mise en production de la saison 3 (lundi 27/07)

Trois chantiers convergent sur la même nuit. Ce fichier est la seule
séquence à suivre : il dit quoi merger, dans quel ordre, quelles migrations
appliquer, et comment vérifier que rien n'a bougé pour la S1 et la S2.

La partie base est exécutée par un agent programmé à **00h05 le lundi
27/07**. La seule chose qui demande une main humaine, c'est le merge des
trois PR — dans l'ordre, mais à n'importe quelle heure.

---

## Ce qui part

| Ordre | PR | Branche | Contenu | Migration |
|---|---|---|---|---|
| 1 | **#34** | `feature/pas-hors-course` | Barème S3, 10 km, un seul déplacement par jour | `29` |
| 2 | **#38** | `feature/bonus-cardio` | Six bonus de cardio, rangement par zone | `31` |
| 3 | **#35** | `fix/feuille-bonus-glisser` | La feuille se ferme au glissé | aucune |
| 4 | **#39** | `feature/lancement-s3` | Le carrousel de lancement | aucune |

Deux PR ont été fermées en préparant cette MEP :

- **#30** — son unique apport (le correctif du doublement, `47772f3`) est
  greffé sur #34, cherry-pick sans conflit.
- **#36** — sa spec est déjà sur `main` depuis #37, dans une version plus
  récente. La merger aurait *retiré* la correction sur l'angle mort RLS.

#35 n'a rien à voir avec la S3 et pourrait partir seule, mais elle réécrit
l'intérieur de la même feuille que #38 : elle est empilée dessus, conflit
déjà résolu.

**L'ordre n'est pas négociable.** #38 est basée sur #34 sur GitHub : la
merger d'abord ferait entrer le barème S3 sans son plan de test. Et côté
base, la 29 ajoute `course_10km` puis la 31 le range dans le cardio — dans
l'autre sens, le 10 km arrive sans famille et atterrit dans un paquet
« Autres » en bas de la feuille.

---

## Avant lundi — quand tu veux

### 1. Rien à figer

Il y avait ici une étape « recopier les chiffres S2 dans
`LaunchS3Screen.tsx` avant minuit ». **Elle n'existe plus** : le carrousel
appelle `fetchBilanSaison()` au montage et calcule moyenne, total, jours
parfaits et podium depuis la base, bornés à la veille de la S3. Il n'y a
donc ni chiffre à recopier, ni build à passer à minuit, et le bilan est juste
même si personne ne touche à rien.

Ne comptent que les joueurs ayant coché **au moins la moitié des jours**
(7 sur 14). Au 25/07 ça retient cinq joueurs sur huit, avec une marge large :
11 à 13 jours d'un côté, 0 à 3 de l'autre.

Pour contrôler ce que l'écran affichera, sans l'ouvrir :

```sql
with jours as (
  select player_id,
         count(*) filter (where pushups or abs or squats) as j,
         sum(pushups::int + abs::int + squats::int) * 100  as reps
  from entries where day <= date '2026-07-26' group by player_id
),
retenus as (
  select lb.*, j.reps, p.name
  from leaderboard(null, date '2026-07-26') lb
  join jours j   on j.player_id = lb.player_id
  join players p on p.id = lb.player_id
  where j.j >= ceil(14 / 2.0)
)
select (select count(*) from retenus)                                as joueurs,
       (select sum(reps) from retenus)                               as total_reps,
       (select round(sum(reps)::numeric / count(*)) from retenus)    as moyenne_reps,
       (select sum(perfect_days) from retenus)                       as jours_parfaits,
       (select string_agg(name, ' > ' order by points desc)
          from (select name, points from retenus order by points desc limit 3) t) as podium;
```

Seules les vannes sous les noms du podium restent écrites à la main, dans
`NOTES` (indexées par prénom). Un prénom absent retombe sur ses stats, donc
un podium inattendu ne laisse jamais l'écran muet.

### 2. Merger, dans cet ordre

1. **#34** → `main`
2. **#38** → `main`
3. **#35** → `main`
4. **#39** → `main`

Les bases sont chaînées sur GitHub (#35 vise #38, qui vise #34) : chacune
bascule sur `main` toute seule quand la précédente est mergée, et la revue
ne montre que le diff propre à la PR. Merger dans le désordre n'est pas
possible — GitHub refusera.

Après chaque merge, attendre que le déploiement Vercel passe au vert.

**Rien n'est visible pour le groupe tant que les migrations ne sont pas
passées**, et c'est vérifié fichier par fichier :

| Ce qui pourrait fuiter | Ce qui l'en empêche |
|---|---|
| Les six puces de cardio, le 10 km | N'existent pas au catalogue sans la 29 et la 31 |
| Le rangement par zone | Sans la colonne `family`, `claimableGroups()` retombe sur la liste à plat |
| Un seul déplacement par jour | `movementLocked()` est gardé par `saison3Started()` |
| Le carrousel de lancement | Même garde, côté `App` |
| Le tuto et le mini-barème | Mêmes gardes : ils affichent le barème S2 jusqu'à lundi |
| Les cartes de fil « collectif » et « premier du jour » | Bornées à `< 2026-07-27` dans `/api/moments` |

C'est ce tableau qui autorise à merger n'importe quand. Il a coûté un
correctif : le tuto et le mini-barème annonçaient « +4 journée parfaite »
et retiraient quatre règles encore actives — mergés tôt, ils auraient
décrit la S3 pendant le week-end où la prime et les duels de la S2 se
jouent.

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

## Points en suspens

Les trois relevés en préparant cette MEP sont **traités** :

1. « Douze jours » → le nombre est calculé depuis `CHALLENGE_START` et
   `SAISON3_START`, il affiche quatorze et suivra une saison décalée.
2. La moyenne de répétitions ne compte plus que les joueurs ayant coché au
   moins la moitié des jours — 3 660 au lieu de 2 771.
3. Le podium placeholder est supprimé : il vient de la base.

Il ne reste donc rien à trancher avant dimanche. La seule chose qui demande
une main humaine, c'est le merge des trois PR dans l'ordre.
