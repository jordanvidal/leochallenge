-- migration40-badges-proportionnels.sql — phase 2 du multi-ligues
--
-- Se joue après migration38. Aucune instruction ne touche `public`.
--
-- Les seuils des badges ont été calibrés pour un challenge de 50 jours. Sur une
-- ligue d'une semaine, « increvable » (30 jours parfaits d'affilée) est
-- inatteignable, et « centurion » (100 exercices) demanderait 4,8 exercices par
-- jour alors qu'il n'y en a que 3 à cocher. Trois badges sur huit deviendraient
-- décoratifs.
--
-- Les seuils se calculent donc désormais depuis la durée N de la ligue :
--
--   premiere_semaine   max(3, ceil(0,14 × N)) jours parfaits consécutifs
--   machine            max(3, ceil(0,28 × N))
--   increvable         max(3, ceil(0,60 × N))
--   centurion          2 × N exercices cumulés
--
-- LE TEST QUI COMMANDE : à N = 50, les formules doivent redonner EXACTEMENT
-- 7 / 14 / 30 / 100 — les valeurs actuelles. Sinon le groupe d'origine verrait
-- ses badges changer le jour de sa migration. Vérifié dans
-- `supabase/tests/badges-proportionnels.sql`.
--
--     N     premiere   machine   increvable   centurion
--     7        3          3           5           14
--    14        3          4           9           28
--    21        3          6          13           42
--    28        4          8          17           56
--    35        5         10          21           70
--    42        6         12          26           84
--    50        7         14          30          100   ← les valeurs d'aujourd'hui
--
-- L'arithmétique est en `numeric`, pas en flottant : `0.14 * 50` vaut
-- exactement 7,00 et non 7,000000000000001, ce qui ferait passer `ceil()` à 8
-- et casserait la non-régression. (Le piège n'est pas théorique : écrites
-- naïvement en JavaScript, ces mêmes formules donnent 8 et 15 à N = 50.)
--
-- LES MÊMES FORMULES VIVENT CÔTÉ CLIENT, dans `seuilsBadges()` de
-- `lib/gamification.ts` — c'est ce qui écrit « 30 jours parfaits d'affilée »
-- sous le badge. Si l'une bouge sans l'autre, l'app promet un seuil que la base
-- n'applique pas. Les deux sont tenues par un test : `tests/seuils-badges.test.ts`
-- et `supabase/tests/badges-proportionnels.sql`.
--
-- LIMITE CONNUE, ACCEPTÉE : sur une ligue de 7 jours, `premiere_semaine` et
-- `machine` tombent tous les deux à 3 à cause du plancher. Le format sprint
-- reste pauvre en progression. Ne pas chercher à corriger ça ici.
--
-- CE QUI NE BOUGE PAS. Trois seuils restent en dur, parce qu'ils ne sont pas
-- dans la table de la spec :
--   * `retour_de_flamme` — deux séries de 5 jours ou plus ;
--   * `premier_de_la_classe` — n°1 pendant 7 jours consécutifs ;
--   * `sans_faute` et `finisseur` — sans seuil, ils suivent déjà la ligue.
-- Sur une ligue d'une semaine, `premier_de_la_classe` revient à être n°1 tous
-- les jours. C'est dur, mais atteignable — et c'est un choix à trancher avec
-- Jordan, pas à glisser dans une migration.

create or replace view app.player_badges
with (security_invoker = true) as
with
paris as (select (now() at time zone 'Europe/Paris')::date as today),
pl as (
  select p.id as player_id, p.league_id, l.start_day, l.end_day
  from app.players p join app.leagues l on l.id = p.league_id
),
-- Les seuils de chaque ligue, déduits de sa durée.
seuils as (
  select l.id as league_id,
         (l.end_day - l.start_day + 1) as n,
         greatest(3, ceil(0.14 * (l.end_day - l.start_day + 1)))::int as s_premiere_semaine,
         greatest(3, ceil(0.28 * (l.end_day - l.start_day + 1)))::int as s_machine,
         greatest(3, ceil(0.60 * (l.end_day - l.start_day + 1)))::int as s_increvable,
         (2 * (l.end_day - l.start_day + 1))::int as s_centurion
  from app.leagues l
),
e as (
  select pl.league_id, en.player_id, en.day,
         en.pushups::int + en.abs::int + en.squats::int as exos,
         en.pushups and en.abs and en.squats as perfect
  from app.entries en join pl on pl.player_id = en.player_id
),
-- Les jours écoulés DE CHAQUE LIGUE, sur sa propre fenêtre.
elapsed as (
  select l.id as league_id, d.d::date as day
  from app.leagues l, paris,
       lateral generate_series(
         l.start_day::timestamptz,
         least(paris.today, l.end_day)::timestamptz,
         interval '1 day') d(d)
),
runs as (
  select t.player_id, count(*) as len
  from (
    select e.player_id, e.day,
           e.day - row_number() over (partition by e.player_id order by e.day)::int as island
    from e where e.perfect
  ) t
  group by t.player_id, t.island
),
-- Deux agrégats SÉPARÉS : les joindre dans un même group by multiplierait le
-- total d'exercices par le nombre de séries du joueur.
series as (
  select pl.player_id,
         coalesce(max(r.len), 0) as meilleure_serie,
         count(*) filter (where r.len >= 5) as nb_series_5
  from pl left join runs r on r.player_id = pl.player_id
  group by pl.player_id
),
volume as (
  select pl.player_id, coalesce(sum(e.exos), 0) as exos_total
  from pl left join e on e.player_id = pl.player_id
  group by pl.player_id
),
-- Le classement cumulé jour après jour, DANS SA LIGUE.
grid as (
  select pl.player_id, pl.league_id, el.day, coalesce(dp.points, 0::numeric) as pts
  from pl
  join elapsed el on el.league_id = pl.league_id
  left join app.daily_points dp on dp.player_id = pl.player_id and dp.day = el.day
),
dayrank as (
  select c.player_id, c.league_id, c.day,
         rank() over (partition by c.league_id, c.day order by c.cum_pts desc) as r
  from (
    select grid.player_id, grid.league_id, grid.day,
           sum(grid.pts) over (partition by grid.player_id order by grid.day) as cum_pts
    from grid
  ) c
),
top_runs as (
  select t.player_id, count(*) as len
  from (
    select dayrank.player_id, dayrank.day,
           dayrank.day - row_number() over (partition by dayrank.player_id order by dayrank.day)::int as island
    from dayrank where dayrank.r = 1
  ) t
  group by t.player_id, t.island
),
gagnes as (
  -- Les quatre badges à seuil proportionnel.
  select s.player_id, 'premiere_semaine'::text as badge
  from series s join pl on pl.player_id = s.player_id
  join seuils q on q.league_id = pl.league_id
  where s.meilleure_serie >= q.s_premiere_semaine
  union all
  select s.player_id, 'machine'::text
  from series s join pl on pl.player_id = s.player_id
  join seuils q on q.league_id = pl.league_id
  where s.meilleure_serie >= q.s_machine
  union all
  select s.player_id, 'increvable'::text
  from series s join pl on pl.player_id = s.player_id
  join seuils q on q.league_id = pl.league_id
  where s.meilleure_serie >= q.s_increvable
  union all
  select v.player_id, 'centurion'::text
  from volume v join pl on pl.player_id = v.player_id
  join seuils q on q.league_id = pl.league_id
  where v.exos_total >= q.s_centurion
  union all
  -- Les quatre autres, seuils inchangés.
  select p.player_id, 'sans_faute'::text
  from pl p
  where exists (select 1 from e where e.player_id = p.player_id and e.perfect)
    and not exists (
      select 1 from elapsed d
      where d.league_id = p.league_id
        and d.day < (select paris.today from paris)
        and not exists (
          select 1 from e
          where e.player_id = p.player_id and e.day = d.day and e.perfect
        )
    )
  union all
  select s.player_id, 'retour_de_flamme'::text
  from series s where s.nb_series_5 >= 2
  union all
  select top_runs.player_id, 'premier_de_la_classe'::text
  from top_runs group by top_runs.player_id having max(top_runs.len) >= 7
  union all
  select e.player_id, 'finisseur'::text
  from e join pl on pl.player_id = e.player_id
  where e.day = pl.end_day and e.perfect
)
select g.player_id, pl.league_id, g.badge
from gagnes g
join pl on pl.player_id = g.player_id;
