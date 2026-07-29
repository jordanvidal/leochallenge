-- supabase/tests/duel-bareme-s3.sql — migration39 ne réécrit pas l'histoire
--
-- La propriété qui compte : `duel_results` touche un challenge qui tourne, avec
-- des duels déjà résolus et affichés dans le fil. Le correctif doit laisser les
-- semaines closes STRICTEMENT identiques.
--
-- Le test tire parti du fait que le DDL est transactionnel dans Postgres : on
-- photographie la vue, on joue la migration, on rephotographie, on compare, et
-- on annule tout.
--
-- Usage (base portant `public`, les 38 migrations rejouées, migration39 NON
-- appliquée) :
--   psql -d <base> -v ON_ERROR_STOP=1 -f supabase/tests/duel-bareme-s3.sql
--
-- ---------------------------------------------------------------------------
-- Ce que ce test couvre, et ce qu'il ne couvre pas
-- ---------------------------------------------------------------------------
-- COUVERT : la non-régression sur les semaines closes — c'est le risque réel
-- aujourd'hui — et le fait que le moteur de `duel_results` soit désormais
-- rigoureusement celui de `daily_points`.
--
-- NON COUVERT par une observation directe : le comportement sur une semaine S3.
-- Un duel n'est résolu que si `week_monday + 7 <= today` ; le barème S3 est
-- entré en vigueur le lundi 27/07, donc la première semaine S3 ne se clôture
-- que début août. Il n'y a rien à observer avant. L'assertion 2 compense en
-- prouvant l'égalité des deux moteurs, ce qui est plus fort qu'un échantillon.

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Décor : deux semaines closes, dont une qui se joue au départage
-- ---------------------------------------------------------------------------

alter table public.entries      disable trigger user;
alter table public.bonus_claims disable trigger user;
alter table public.players      disable trigger user;
alter table public.daily_events disable trigger user;

insert into public.players (id, name, color, created_at) values
  ('d0000000-0000-0000-0000-00000000000a', 'Alpha',   '#a', '2026-07-13 09:00+02'),
  ('d0000000-0000-0000-0000-00000000000b', 'Beta',    '#b', '2026-07-13 09:01+02'),
  ('d0000000-0000-0000-0000-00000000000c', 'Gamma',   '#c', '2026-07-13 09:02+02'),
  ('d0000000-0000-0000-0000-00000000000d', 'Delta',   '#d', '2026-07-13 09:03+02');

-- Les événements du jour, calqués sur ce que le challenge a RÉELLEMENT tiré
-- entre le 14 et le 26/07 : `rien`, `happy_hour`, `quitte_ou_double`,
-- `pompes_double`, `leve_tot`. Aucun `abdos_double` ni `squats_double` n'est
-- sorti avant le 27/07 — le premier est celui du 27, qui n'est pas encore dans
-- une semaine close. C'est ce qui rend la migration sans effet sur le passé de
-- CE challenge, et l'assertion 1 le vérifie sur cette distribution-là.
insert into public.daily_events (day, event_key) values
  ('2026-07-15', 'happy_hour'),
  ('2026-07-17', 'quitte_ou_double'),
  ('2026-07-18', 'pompes_double'),
  ('2026-07-22', 'pompes_double'),
  ('2026-07-24', 'rien'),
  ('2026-07-26', 'leve_tot');

-- Alpha et Beta : parfaits partout → départage aux points.
insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select p, d::date, true, true, true, (d::date + time '20:00') at time zone 'Europe/Paris'
from unnest(array['d0000000-0000-0000-0000-00000000000a',
                  'd0000000-0000-0000-0000-00000000000b']::uuid[]) p,
     generate_series('2026-07-13'::date, '2026-07-26'::date, interval '1 day') d;

-- Gamma et Delta : irréguliers, le duel se tranche sur les jours parfaits.
insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select 'd0000000-0000-0000-0000-00000000000c', d::date, true, true, true,
       (d::date + time '21:00') at time zone 'Europe/Paris'
from generate_series('2026-07-13'::date, '2026-07-26'::date, interval '1 day') d;

insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select 'd0000000-0000-0000-0000-00000000000d', d::date,
       extract(day from d)::int % 2 = 0, extract(day from d)::int % 2 = 0, extract(day from d)::int % 2 = 0,
       case when extract(day from d)::int % 2 = 0
            then (d::date + time '21:30') at time zone 'Europe/Paris' end
from generate_series('2026-07-13'::date, '2026-07-26'::date, interval '1 day') d;

insert into public.bonus_claims (player_id, day, bonus_key, points) values
  ('d0000000-0000-0000-0000-00000000000a', '2026-07-22', 'abdos_200',  7),
  ('d0000000-0000-0000-0000-00000000000b', '2026-07-24', 'squats_200', 7),
  ('d0000000-0000-0000-0000-00000000000a', '2026-07-18', 'pompes_100', 7);

insert into public.duels (week_monday, player_a, player_b) values
  ('2026-07-13', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000b'),
  ('2026-07-13', 'd0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000d'),
  ('2026-07-20', 'd0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000b'),
  ('2026-07-20', 'd0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000d');

-- ---------------------------------------------------------------------------
-- Photo AVANT
-- ---------------------------------------------------------------------------

create temporary table duels_avant as select * from public.duel_results;
create temporary table points_avant as select * from public.daily_points;
create temporary table badges_avant as select * from public.player_badges;

do $$
declare n int;
begin
  select count(*) into n from duels_avant;
  if n < 4 then
    raise exception 'FIXTURE INVALIDE : % duel(s) résolu(s), attendu 4 — le test ne prouverait rien', n;
  end if;
  select count(*) into n from duels_avant where tiebreak_used;
  if n < 1 then
    raise exception 'FIXTURE INVALIDE : aucun duel ne se joue au départage aux points';
  end if;
  raise notice 'Décor : % duels résolus, dont % au départage aux points',
    (select count(*) from duels_avant), (select count(*) from duels_avant where tiebreak_used);
end $$;

-- ---------------------------------------------------------------------------
-- On joue la migration, à l'intérieur de la transaction
-- ---------------------------------------------------------------------------

\ir ../migration39-duel-bareme-s3.sql

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  n int;
  moteur_dp text;
  moteur_dr text;
begin

  -- 1. Les semaines closes ne bougent pas d'un point. C'EST la propriété qui
  --    protège le challenge en cours.
  select count(*) into n
  from duels_avant a
  full join public.duel_results b on b.id = a.id
  where a.id is distinct from b.id
     or a.winner is distinct from b.winner
     or a.loser is distinct from b.loser
     or a.points_a is distinct from b.points_a
     or a.points_b is distinct from b.points_b
     or a.perfect_a is distinct from b.perfect_a
     or a.perfect_b is distinct from b.perfect_b
     or a.tiebreak_used is distinct from b.tiebreak_used;
  if n <> 0 then
    raise exception 'ASSERTION 1 ECHOUEE : % duel(s) résolu(s) ont changé — la migration réécrit l''histoire', n;
  end if;
  raise notice 'OK 1 — les duels des semaines closes sont strictement inchangés';

  -- 2. Le moteur de `duel_results` est maintenant RIGOUREUSEMENT celui de
  --    `daily_points`. C'est plus fort qu'un échantillon : ça interdit la
  --    divergence, y compris sur la semaine S3 qu'on ne peut pas encore
  --    observer. Et si quelqu'un modifie `daily_points` sans reporter ici,
  --    ce test tombera — c'est le garde-fou contre une nouvelle dérive.
  --    Une normalisation est nécessaire : Postgres renomme automatiquement les
  --    alias courts qui entrent en collision (`timed t` devient `timed t_1`
  --    dans `duel_results`, où `t` est déjà pris par `tally`). C'est cosmétique
  --    et propre au rendu de `pg_get_viewdef`, pas au sens de la requête.
  select regexp_replace(
           substring(pg_get_viewdef('public.daily_points'::regclass, true)
                     from '^(.*), full_weeks AS \('),
           '\m([a-z]{1,2})_[0-9]\M', '\1', 'g')
    into moteur_dp;
  select regexp_replace(
           substring(pg_get_viewdef('public.duel_results'::regclass, true)
                     from '^(.*), weekpts AS \('),
           '\m([a-z]{1,2})_[0-9]\M', '\1', 'g')
    into moteur_dr;
  if moteur_dp is null or moteur_dr is null then
    raise exception 'ASSERTION 2 ECHOUEE : impossible d''isoler le moteur de l''une des deux vues';
  end if;
  if moteur_dp <> moteur_dr then
    raise exception 'ASSERTION 2 ECHOUEE : les deux moteurs ont divergé (% vs % caractères)',
      length(moteur_dp), length(moteur_dr);
  end if;
  raise notice 'OK 2 — duel_results et daily_points partagent exactement le même moteur (% caractères)',
    length(moteur_dp);

  -- 3. Le moteur connaît bien ce que l'ancienne copie ignorait.
  if moteur_dr not like '%abdos_double%'
     or moteur_dr not like '%squats_double%'
     or moteur_dr not like '%2026-07-27%' then
    raise exception 'ASSERTION 3 ECHOUEE : le moteur du duel ignore encore le doublement élargi ou le barème S3';
  end if;
  raise notice 'OK 3 — abdos_double, squats_double et la bascule du 27/07 sont dans le moteur du duel';

  -- 4. Les vues qui dépendent de duel_results ont survécu au remplacement, et
  --    donnent toujours la même chose. `create or replace` et non
  --    `drop cascade` : daily_points dépend de duel_results, et player_badges
  --    dépend de daily_points.
  select count(*) into n
  from points_avant a
  full join public.daily_points b on b.player_id = a.player_id and b.day = a.day
  where a.points is distinct from b.points
     or a.bonus_points is distinct from b.bonus_points
     or a.base_points is distinct from b.base_points;
  if n <> 0 then
    raise exception 'ASSERTION 4 ECHOUEE : % ligne(s) de daily_points ont changé', n;
  end if;

  select count(*) into n
  from badges_avant a
  full join public.player_badges b on b.player_id = a.player_id and b.badge = a.badge
  where a.player_id is distinct from b.player_id or a.badge is distinct from b.badge;
  if n <> 0 then
    raise exception 'ASSERTION 4 ECHOUEE : % badge(s) ont changé', n;
  end if;
  raise notice 'OK 4 — daily_points et player_badges intacts (ni droppés, ni modifiés)';
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 5 : et le correctif n'est pas vide
-- ---------------------------------------------------------------------------
-- L'assertion 1 dit « rien ne change ». Encore faut-il montrer que ce n'est pas
-- parce que la migration ne fait rien.
--
-- On prend le 24/07, jour sans événement (`rien`) au moment de la photo, et on
-- y tire un `abdos_double`. Le nouveau moteur le compte pour Alpha, qui coche
-- les abdos ce jour-là. L'ancien n'avait tout simplement pas de branche
-- `abdos_double` : il aurait rendu le même total qu'avec `rien`.
--
-- C'est exactement le scénario qui attend le challenge : le `squats_double`
-- tiré le 27/07 tombe dans la première semaine S3, qui se clôture début août.

update public.daily_events set event_key = 'abdos_double' where day = '2026-07-24';

do $$
declare
  avant numeric;
  apres numeric;
  attendu numeric;
begin
  select points_a into avant from duels_avant
  where week_monday = '2026-07-20' and player_a = 'd0000000-0000-0000-0000-00000000000a';
  select points_a into apres from public.duel_results
  where week_monday = '2026-07-20' and player_a = 'd0000000-0000-0000-0000-00000000000a';

  -- Alpha coche les abdos le 24/07 : il touche le bonus d'événement.
  -- Avant le 27/07 le doublement ne suit pas le multiplicateur de série,
  -- il vaut sa valeur nue — c'est la garde de date qui le veut.
  attendu := public.bonus_value('abdos_double');

  if apres - avant <> attendu then
    raise exception 'ASSERTION 5 ECHOUEE : le départage a bougé de % au lieu de % — l''événement doublant n''est pas compté comme attendu',
      apres - avant, attendu;
  end if;
  raise notice 'OK 5 — un abdos_double sur une semaine close change bien le départage de % pts (l''ancienne copie l''ignorait)', attendu;

  raise notice '';
  raise notice '=== 5 assertions au vert — migration39 corrige le départage sans toucher au passé de CE challenge ===';
end $$;

rollback;
