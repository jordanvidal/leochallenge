# Runbook — mise en production de la saison 3 (lundi 27/07)

Trois chantiers convergent sur la même nuit. Ce fichier est la seule
séquence à suivre : il dit ce qui est déjà parti, ce qui reste à appliquer,
et comment vérifier que rien n'a bougé pour la S1 et la S2.

---

## Ce qui est parti — fait

| Ordre | PR | Contenu | Migration |
|---|---|---|---|
| 1 | **#34** | Barème S3, 10 km, un seul déplacement par jour | `29` |
| 2 | **#38** | Six bonus de cardio, rangement par zone | `31` |
| 3 | **#35** | La feuille se ferme au glissé | aucune |
| 4 | **#39** | Le carrousel de lancement | aucune |

Les quatre sont mergées sur `main` et déployées. Deux PR ont été fermées en
préparant cette MEP :

- **#30** — son unique apport (le correctif du doublement, `47772f3`) est
  greffé sur #34. Vérifié après coup : hors du bloc catalogue, sa migration
  29 et celle de `main` sont identiques octet pour octet.
- **#36** — sa spec est déjà sur `main` depuis #37, dans une version plus
  récente. La merger aurait *retiré* la correction sur l'angle mort RLS.

---

## Le passage en deux blocs

Le plan d'origine appliquait 1168 lignes de SQL à 00h05, sans personne
devant l'écran. Il a été découpé, parce que **la migration 29 est
auto-datée** : 34 bornes `day < date '2026-07-27'` / `day >= date
'2026-07-27'` font que la vue et le RPC portent les deux barèmes à la fois
et basculent seuls à minuit.

Ce qui oblige à attendre minuit, ce n'est donc pas le calcul des points.
C'est uniquement **ce que le groupe voit dans la feuille de bonus**.

| | Contenu | Visible avant l'heure ? |
|---|---|---|
| **Bloc A** | Vue `daily_points`, RPC `player_breakdown`, roue du tirage, `semaine_pleine` / `abdos_double` / `squats_double`, colonne `family` vide | **Non** |
| **Bloc B** | `course_10km`, les six puces de cardio, les familles | **Oui** — ce sont des puces `exercise` |

Pourquoi le bloc A ne fuite pas, ligne par ligne :

- la vue et le RPC gardent le barème S2 sur tout jour antérieur au 27/07 ;
- la roue ne tire que pour aujourd'hui et relit `daily_events` pour les
  jours déjà tirés — le 26/07 est figé sur `leve_tot` avant même le passage,
  donc la remplacer ne peut rien changer à la journée en cours ;
- `semaine_pleine` est un `execution`, `abdos_double` et `squats_double` des
  `event` : `claimables()` ne retient que les `exercise`, aucun des trois
  n'est une puce ;
- la colonne `family` est ajoutée vide, et `claimableGroups()` ne range que
  si au moins une ligne a une famille — sinon elle retombe sur la liste à
  plat d'avant.

### Le fichier

> **Déjà appliqué le 26/07. Ne pas rejouer.** Il est rangé dans `docs/` et
> pas dans `supabase/` pour cette raison : ce n'est pas une migration, c'est
> la trace de ce qui a tourné. Rejoué après le 27/07, son `delete` du
> `course_10km` et son décalage `sort - 1` supprimeraient le 10 km et
> feraient glisser d'un cran tous les rangs posés par la migration 31 — le
> garde `not exists` de la migration 29 ne protège pas de ça.

`docs/mep-s3-applique.sql` fait les deux : il applique le bloc A immédiatement et
**programme le bloc B** via un job `pg_cron`, qui se désinscrit après son
passage.

Le job ne tire pas une seule fois : il se présente **toutes les 5 minutes
entre 00h00 et 02h00** Paris et s'arrête dès qu'il réussit. Son corps est
idempotent et tient dans une transaction, donc un échec n'applique rien et
le passage suivant rattrape. Un tir unique qui rate laisserait le carrousel
annoncer des puces absentes de la feuille jusqu'au réveil de quelqu'un.

Il a été **assemblé mécaniquement** depuis `migration29-bareme-s3.sql` et
`migration31-bonus-cardio.sql` — aucune ligne de SQL n'a été recopiée à la
main, et le `diff` contre les sources est vide. Ça compte : le protocole de
non-régression compare les jours déjà joués, or aucune donnée n'existe
encore après le 27/07. Une faute de frappe dans une branche `day >=
'2026-07-27'` passerait le contrôle sans bruit et ne se verrait que lundi.

Contrôlé avant livraison : zéro faute de syntaxe sur les 1407 lignes
(analyse `psql` sur base vide — seules subsistent les erreurs d'objets
absents), guillemets dollar équilibrés, et le corps `$MEPS3$` du job lu
comme une seule chaîne.

### Sécurité

Tout le bloc A tient dans **une transaction**. Elle se termine par le
protocole §5 de la migration 29 — photographie de `daily_points`,
comparaison de `points`, `bonus_points` et `streak_pos` ligne à ligne — sous
forme d'un bloc `do` qui **lève une exception** si un seul compte n'est pas
nul. L'exception annule l'intégralité du fichier, job `pg_cron` compris.
Vérifié en amont : un `raise` au milieu d'un envoi multi-instructions annule
bien tout ce qui précède.

Le job de minuit porte sa propre garde : il refuse de s'exécuter si la date
de Paris est antérieure au 27/07, pour qu'un déclenchement manuel malheureux
ne fasse pas apparaître les puces en avance.

---

## Le carrousel — rien à figer

Il n'y a ni chiffre à recopier, ni build à passer à minuit : le carrousel
appelle `fetchBilanSaison()` au montage et calcule moyenne, total, jours
parfaits et podium depuis la base, bornés à la veille de la S3.

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

---

## État

**Bloc A : appliqué le 26/07 à 11h30**, directement depuis ce dépôt — le
fichier a été récupéré par la base via son URL GitHub figée sur le SHA du
commit, empreinte `md5` vérifiée des deux côtés avant exécution, de sorte
qu'aucune ligne de SQL n'est passée par une recopie. Le contrôle §5 a rendu
zéro écart. Constaté juste après : job armé, 17 puces d'exercice, aucune
famille posée, pas de 10 km, droits `anon` intacts sur la vue et les trois
RPC, classement inchangé.

**Bloc B : armé**, premier déclenchement le 27/07 à 00h00 Paris.

---

## Vérifier

### Après le bloc A — tout de suite

```sql
-- (a) Le job de minuit est bien armé.
select jobname, schedule, active from cron.job where jobname = 'mep-s3-bloc-b';
-- Attendu : une ligne, '*/5 22-23 26 7 *', active = true.
```

```sql
-- (b) Rien de visible n'a fuité : toujours 17 puces, aucune famille posée.
select count(*) filter (where kind = 'exercise')            as puces,
       count(*) filter (where family is not null)           as familles_posees,
       count(*) filter (where key = 'course_10km')          as le_10km
from bonus_catalog;
-- Attendu : 17, 0, 0.
```

Le contrôle de non-régression, lui, n'est pas à lancer à la main : il est
dans le fichier et conditionne le `commit`.

### Après le bloc B — lundi

```sql
-- (c) Le job est passé, et il s'est désinscrit.
select status, return_message, start_time
from cron.job_run_details where jobname = 'mep-s3-bloc-b'
order by start_time desc limit 5;
-- Attendu : un `succeeded`. D'éventuels `failed` avant lui ne sont pas
-- inquiétants en soi — le job réessaie toutes les 5 minutes et n'applique
-- rien tant qu'il échoue — mais leur `return_message` mérite un coup d'œil.
-- Et `select * from cron.job` ne doit plus contenir le job.
```

```sql
-- (d) Le catalogue : 24 puces, toutes rangées, aucun orphelin.
select family, count(*), string_agg(key, ', ' order by sort) as puces
from bonus_catalog where kind = 'exercise'
group by family order by min(sort);
-- Attendu : cardio 13, haut 3, abdos 3, jambes 5. Aucune ligne family = null.
```

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

### Contrôle applicatif

Ouvrir la prod sur téléphone :

- La feuille de bonus s'ouvre sur quatre paquets titrés, pas de « Autres ».
- Cocher 5 km éteint 10 km et 10 000 pas, avec la phrase 🚶 sous les groupes.
- Le carrousel de lancement s'affiche au premier lancement de la journée.

---

## Si ça tourne mal

Les deux migrations sont additives ; aucune ne supprime de donnée.

- **Le bloc A refuse de passer** : l'exception dit combien de jours bougent.
  Rien n'est appliqué, on a la journée pour comprendre. C'est tout l'intérêt
  de l'avoir sorti de la nuit.
- **Le job de minuit n'est pas passé** (contrôle (c) vide ou `failed`) :
  le seul dégât est cosmétique — le carrousel annonce des puces absentes de
  la feuille. Rejouer le corps du job à la main ; il est idempotent
  (`on conflict do nothing`, et le décalage de `sort` est gardé par un
  `not exists`). Ne pas réveiller le groupe pour ça.
- **La vue `daily_points` est fausse** : le seul cas grave, et il ne peut
  survenir qu'après un `commit` forcé. Restaurer la définition d'avant en
  rejouant `migration28-premier-du-jour-feed.sql`, puis prévenir Jordan.
- **Les six puces de cardio doivent disparaître** :
  `delete from bonus_catalog where key like 'jumping_jacks%' or key like 'climbers%' or key like 'squats_jump%';`
  — ne marche que si personne ne les a encore déclarées (FK depuis
  `bonus_claims`), donc dans l'heure qui suit, pas après.

---

## Dette laissée derrière

`supabase/tests/testplan-s3.sql` est sur `main` dans une version **qui ne
s'exécute pas**. Deux correctifs existent sur la branche locale
`feature/bareme-s3-27-07`, jamais poussés, restés là quand la PR #30 a été
fermée :

1. le désarmement des triggers était placé après la création des cobayes,
   alors que `guard_player_insert` plafonne la table à 12 joueurs — 8 réels
   + 8 cobayes = 16 ;
2. le test T9 cherchait la forme source du SQL dans `pg_get_viewdef`, ce qui
   ne peut jamais matcher : Postgres normalise le SQL d'une vue quand il le
   stocke, alors qu'un corps de fonction est gardé verbatim.

Sans conséquence sur cette MEP — le plan de test ne fait pas partie de la
séquence — mais à porter sur `main` avant de s'en resservir.
