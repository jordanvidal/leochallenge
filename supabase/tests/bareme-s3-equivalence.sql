-- supabase/tests/bareme-s3-equivalence.sql — l'élagage du barème est-il fidèle ?
--
-- `app.daily_points` n'implémente que le barème courant (S3). Les ~60 littéraux
-- `2026-07-20` / `2026-07-27` de `public.daily_points` ont été supprimés parce
-- qu'ils sont statiquement faux pour toute ligue neuve. Reste à le PROUVER :
-- si une branche a été coupée à tort, les points divergent.
--
-- Protocole — le même jeu de données, joué des deux côtés, puis comparé :
--
--   1. Sur une base portant `public` (les 37 migrations d'origine rejouées) :
--        psql -d leo_baseline -v ON_ERROR_STOP=1 -f bareme-s3-equivalence.sql > /tmp/public.txt
--   2. Sur une base portant `app` (migrations 36 → 38) :
--        psql -d leo_app      -v ON_ERROR_STOP=1 -f bareme-s3-equivalence.sql > /tmp/app.txt
--   3. diff /tmp/public.txt /tmp/app.txt   →   doit être VIDE.
--
-- Le script détecte tout seul le schéma présent. Il se termine par un ROLLBACK.
--
-- ---------------------------------------------------------------------------
-- Ce que ce test couvre, et ce qu'il ne couvre pas — à lire avant de s'y fier
-- ---------------------------------------------------------------------------
-- COUVERT : la base du jour (exos + prime du jour parfait × multiplicateur), les
-- séries et le joker, le retour, le ×2 du jour et son interaction avec les
-- bonus d'exercice doublés, quitte ou double, les bonus déclarés. Soit tout le
-- barème hors classement.
--
-- NON COUVERT : le jour miroir, la prime hebdo, la semaine pleine et les duels.
-- Ces quatre-là ne se calculent que sur des journées CLOSES (`day < today`), et
-- le barème S3 est entré en vigueur le 27/07/2026 — il n'existe donc pas encore
-- une seule journée S3 close à comparer. C'est une limite du calendrier, pas du
-- test. Ces mécaniques sont vérifiées séparément, et par ligue, dans
-- `multi-ligues.sql`.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

-- ---------------------------------------------------------------------------
-- Décor commun
-- ---------------------------------------------------------------------------

do $$
declare
  a_app boolean := exists (select 1 from information_schema.schemata where schema_name = 'app');
begin
  if a_app then
    execute 'alter table app.entries      disable trigger user';
    execute 'alter table app.bonus_claims disable trigger user';
    execute 'alter table app.players      disable trigger user';
    execute 'alter table app.daily_events disable trigger user';

    execute $q$insert into app.leagues (id, slug, name, invite_code, start_day, end_day)
              values ('11111111-1111-1111-1111-111111111111', 'equiv', 'Equivalence', 'EQUIV1',
                      '2026-07-27', '2026-08-31')$q$;

    execute $q$insert into app.players (id, league_id, name, color, recovery_code, created_at) values
      ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Un',     '#1', 'EQ0001', '2026-07-27 08:00+02'),
      ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Deux',   '#2', 'EQ0002', '2026-07-27 08:01+02'),
      ('00000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Trois',  '#3', 'EQ0003', '2026-07-27 08:02+02'),
      ('00000000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111', 'Quatre', '#4', 'EQ0004', '2026-07-27 08:03+02')$q$;
  else
    execute 'alter table public.entries      disable trigger user';
    execute 'alter table public.bonus_claims disable trigger user';
    execute 'alter table public.players      disable trigger user';
    execute 'alter table public.daily_events disable trigger user';

    execute $q$insert into public.players (id, name, color, created_at) values
      ('00000000-0000-0000-0000-0000000000a1', 'Un',     '#1', '2026-07-27 08:00+02'),
      ('00000000-0000-0000-0000-0000000000a2', 'Deux',   '#2', '2026-07-27 08:01+02'),
      ('00000000-0000-0000-0000-0000000000a3', 'Trois',  '#3', '2026-07-27 08:02+02'),
      ('00000000-0000-0000-0000-0000000000a4', 'Quatre', '#4', '2026-07-27 08:03+02')$q$;
  end if;
end $$;

-- Le schéma courant pour le reste du script : `app` s'il existe, `public` sinon.
select set_config(
  'search_path',
  case when exists (select 1 from information_schema.schemata where schema_name = 'app')
       then 'app' else 'public' end,
  true
) \gset ignore_

-- Les événements du jour. Ils sont globaux des deux côtés.
insert into daily_events (day, event_key) values
  ('2026-07-28', 'pompes_double'),
  ('2026-07-30', 'quitte_ou_double'),
  ('2026-08-02', 'jour_miroir'),
  ('2026-08-05', 'abdos_double'),
  ('2026-08-09', 'squats_double'),
  ('2026-08-16', 'quitte_ou_double');

-- Un : parfait tous les jours → la série monte à ×2 et y reste.
insert into entries (player_id, day, pushups, abs, squats, completed_at)
select '00000000-0000-0000-0000-0000000000a1', d::date, true, true, true,
       (d::date + time '21:30') at time zone 'Europe/Paris'
from generate_series('2026-07-27'::date, '2026-08-31'::date, interval '1 day') d;

-- Deux : parfait sauf un trou le 05/08, et il revient le 06 → joker + retour.
insert into entries (player_id, day, pushups, abs, squats, completed_at)
select '00000000-0000-0000-0000-0000000000a2', d::date,
       d::date <> '2026-08-05', d::date <> '2026-08-05', d::date <> '2026-08-05',
       case when d::date <> '2026-08-05'
            then (d::date + time '07:30') at time zone 'Europe/Paris' end
from generate_series('2026-07-27'::date, '2026-08-31'::date, interval '1 day') d;

-- Trois : parfait un jour sur deux → jamais de série, multiplicateur à 1.
insert into entries (player_id, day, pushups, abs, squats, completed_at)
select '00000000-0000-0000-0000-0000000000a3', d::date,
       extract(day from d)::int % 2 = 0, extract(day from d)::int % 2 = 0, extract(day from d)::int % 2 = 0,
       case when extract(day from d)::int % 2 = 0
            then (d::date + time '22:15') at time zone 'Europe/Paris' end
from generate_series('2026-07-27'::date, '2026-08-31'::date, interval '1 day') d;

-- Quatre : pompes seulement → jamais parfait, mais touche le ×2 des pompes.
insert into entries (player_id, day, pushups, abs, squats, completed_at)
select '00000000-0000-0000-0000-0000000000a4', d::date, true, false, false, null
from generate_series('2026-07-27'::date, '2026-08-31'::date, interval '1 day') d;

-- Des bonus déclarés, dont deux rattachés à un événement doublant
-- (pompes_100 → pompes_double, abdos_200 → abdos_double).
insert into bonus_claims (player_id, day, bonus_key, points) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-07-28', 'pompes_100', 7),
  ('00000000-0000-0000-0000-0000000000a1', '2026-08-05', 'abdos_200',  7),
  ('00000000-0000-0000-0000-0000000000a2', '2026-07-28', 'pompes_50',  4),
  ('00000000-0000-0000-0000-0000000000a2', '2026-07-30', 'course_5km', 8),
  ('00000000-0000-0000-0000-0000000000a3', '2026-08-09', 'squats_100', 4),
  ('00000000-0000-0000-0000-0000000000a4', '2026-08-16', 'burpees_30', 4);

-- ---------------------------------------------------------------------------
-- La sortie à comparer
-- ---------------------------------------------------------------------------
-- Toutes les colonnes de scoring, dans un ordre déterministe. `league_id`
-- n'est pas sélectionné : il n'existe que du côté `app`, et c'est justement la
-- colonne qui n'a pas d'équivalent à comparer.

select player_id || '|' || day || '|' || exos || '|' || perfect || '|'
    || streak_pos || '|' || multiplier || '|' || round(points, 4) || '|'
    || round(base_points, 4) || '|' || round(bonus_points, 4) || '|'
    || jokered || '|' || premier_du_jour
from daily_points
order by player_id, day;

rollback;
