-- supabase/tests/bareme-s4-jour-off.sql — la S4 touche-t-elle au passé ?
--
-- La migration 46 réécrit `public.daily_points` pour y injecter le jour off
-- (série, spine, semaine pleine, joker, retour) et deux événements. La thèse
-- de cette migration est que la non-régression est STRUCTURELLE : la table
-- `jours_off` est vide avant le 03/08 et son CHECK interdit d'y écrire un jour
-- antérieur, donc aucune injection ne peut toucher un jour passé.
--
-- Une thèse, ça se prouve. Ce fichier la prouve, et vérifie au passage les six
-- comportements que la S4 promet.
--
-- Protocole — les deux versions de la vue côte à côte sur le même jeu de
-- données, sur une base jetable :
--
--   createdb s4lab
--   psql -d s4lab -v ON_ERROR_STOP=1 -f bareme-s4-jour-off.sql
--
-- La vue « avant » est celle de la migration 33 (sa dernière définition en
-- prod), renommée `daily_points_avant`. Extraire ses lignes 83 à 541 :
--
--   sed -n '83,541p' supabase/migration33-doublement-elargi.sql \
--     | sed 's/create or replace view public.daily_points/create or replace view public.daily_points_avant/' \
--     > /tmp/avant.sql
--
-- ⚠️ Sur un Postgres < 15, retirer aussi `with (security_invoker = true)` des
-- deux vues (`sed 's/with (security_invoker = true)//'`). L'option ne change
-- rien au résultat du calcul — elle décide QUI a le droit de lire, pas ce que
-- la vue rend. Un PG 17 la garde et ne demande rien.
--
-- ---------------------------------------------------------------------------
-- COUVERT : l'équivalence sur tout jour antérieur au 03/08, le pont de série
-- au-dessus du jour off, le joker qui ne brûle pas dessus mais qui reste
-- capable de sauver le lendemain, le 🔙 retour qui ne paie plus le jour
-- suivant, la semaine pleine qui reste atteignable, et les deux nouveaux
-- événements.
--
-- Les quatre autres porteurs du moteur — `player_breakdown`,
-- `duel_results`, `leaderboard()` et `player_badges` — se vérifient avec le
-- MÊME protocole : charger leur définition d'avant sous un autre nom, puis
-- diffusion `except all` dans les deux sens, jours_off vide. Les définitions
-- d'avant se prennent respectivement dans migration34, migration39,
-- migration35 et migration2.
--
-- NON COUVERT : rien de ce qui est daté au 03/08 ne peut être testé sur les
-- vraies données, puisqu'aucune n'existe après cette date. Une faute de
-- frappe dans un `day >= date '2026-08-03'` passerait sans bruit sur la
-- prod — d'où la section 4, qui la fabrique.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Le socle : les tables que daily_points lit, et rien d'autre.
-- ===========================================================================

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table if not exists public.entries (
  player_id uuid not null references public.players (id),
  day date not null,
  pushups boolean not null default false,
  abs boolean not null default false,
  squats boolean not null default false,
  completed_at timestamptz,
  primary key (player_id, day)
);

create table if not exists public.bonus_catalog (
  key text primary key,
  kind text not null check (kind in ('exercise', 'execution', 'event', 'cap')),
  emoji text not null default '',
  label text not null default '',
  points numeric not null check (points >= 0),
  sort integer not null default 0,
  ladder text,
  family text,
  double_event text
);

create table if not exists public.bonus_claims (
  player_id uuid not null references public.players (id),
  day date not null,
  bonus_key text not null references public.bonus_catalog (key),
  points numeric not null default 0,
  primary key (player_id, day, bonus_key)
);

create table if not exists public.daily_events (
  day date primary key,
  event_key text not null
);

create table if not exists public.workout_sessions (
  player_id uuid not null references public.players (id),
  day date not null,
  duration_seconds int,
  finished_at timestamptz,
  primary key (player_id, day)
);

create table if not exists public.duel_results (day date not null, winner uuid, loser uuid);

-- jours_off est créée par la migration 46 elle-même ; ce fichier suppose
-- qu'elle a déjà été appliquée sur la base jetable.

create or replace function public.bonus_value(p_key text) returns numeric
language sql stable as $$ select points from public.bonus_catalog where key = p_key $$;

-- Le catalogue réduit à ce que le moteur lit par bonus_value.
insert into public.bonus_catalog (key, kind, points, sort, double_event) values
  ('pompes_50','exercise',4,30,'pompes_double'),
  ('pompes_100','exercise',7,31,'pompes_double'),
  ('abdos_100','exercise',4,40,'abdos_double'),
  ('squats_100','exercise',4,50,'squats_double'),
  ('corde_10min','exercise',5,18,null),
  ('premier_du_jour','execution',3,10,null),
  ('avant_8h','execution',3,11,null),
  ('apres_22h','execution',2,12,null),
  ('seance_20min','execution',2,13,null),
  ('seance_rapide','execution',2,14,null),
  ('retour','execution',3,15,null),
  ('jour_parfait_collectif','execution',5,16,null),
  ('duel_hebdo','execution',3,17,null),
  ('prime_hebdo','execution',3,18,null),
  ('semaine_pleine','execution',5,19,null),
  ('pompes_double','event',1,20,null),
  ('abdos_double','event',1,20,null),
  ('squats_double','event',1,20,null),
  ('happy_hour','event',5,21,null),
  ('boss_dimanche','event',10,23,null),
  ('leve_tot','event',6,24,null),
  ('quitte_ou_double','event',0,25,null),
  ('jour_miroir','event',8,26,null),
  ('cap_seance_20min','cap',1200,32,null),
  ('cap_seance_min','cap',300,33,null)
on conflict (key) do nothing;

-- ===========================================================================
-- 2. Le jeu de données. Quatre joueurs, quatre histoires différentes.
-- ===========================================================================

insert into public.players (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'A'),   -- ne rate jamais rien
  ('22222222-2222-2222-2222-222222222222', 'B'),   -- prend son jour off
  ('33333333-3333-3333-3333-333333333333', 'C'),   -- off PUIS un vrai trou
  ('44444444-4444-4444-4444-444444444444', 'D')    -- décroché
on conflict (id) do nothing;

-- L'historique S1 → S3, avec les trous qui font travailler le joker.
insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select p.id, d::date, true, true, true, (d::date + time '21:00') at time zone 'Europe/Paris'
from public.players p, generate_series(date '2026-07-13', date '2026-08-02', interval '1 day') d
where not (p.name = 'B' and d::date = date '2026-07-22')
  and not (p.name = 'C' and d::date in (date '2026-07-18', date '2026-07-19'))
  and not (p.name = 'D' and d::date > date '2026-07-25')
on conflict do nothing;

insert into public.daily_events (day, event_key) values
  (date '2026-07-15', 'pompes_double'),
  (date '2026-07-18', 'jour_miroir'),
  (date '2026-07-21', 'quitte_ou_double'),
  (date '2026-07-28', 'squats_double'),
  (date '2026-08-01', 'abdos_double')
on conflict (day) do nothing;

insert into public.bonus_claims (player_id, day, bonus_key, points) values
  ('11111111-1111-1111-1111-111111111111', date '2026-07-28', 'squats_100', 4),
  ('11111111-1111-1111-1111-111111111111', date '2026-08-01', 'abdos_100', 4),
  ('22222222-2222-2222-2222-222222222222', date '2026-07-15', 'pompes_50', 4),
  ('22222222-2222-2222-2222-222222222222', date '2026-07-15', 'corde_10min', 5)
on conflict do nothing;

insert into public.workout_sessions (player_id, day, duration_seconds, finished_at)
select p.id, d::date, 900, (d::date + time '21:10') at time zone 'Europe/Paris'
from public.players p, generate_series(date '2026-07-13', date '2026-07-26', interval '1 day') d
on conflict do nothing;

-- ===========================================================================
-- 3. LE test : jours_off vide, les deux vues doivent dire exactement pareil.
--
--    C'est la preuve de la thèse. Zéro ligne, ou la migration ne part pas.
-- ===========================================================================

\echo ''
\echo '=== 1/3 — équivalence avec le barème S3 (jours_off vide) : attendu 0 ==='
select count(*) as lignes_divergentes from (
  select player_id, day, exos, perfect, streak_pos, multiplier,
         points, base_points, bonus_points, jokered, premier_du_jour
    from public.daily_points
  except
  select player_id, day, exos, perfect, streak_pos, multiplier,
         points, base_points, bonus_points, jokered, premier_du_jour
    from public.daily_points_avant
  union all
  select player_id, day, exos, perfect, streak_pos, multiplier,
         points, base_points, bonus_points, jokered, premier_du_jour
    from public.daily_points_avant
  except
  select player_id, day, exos, perfect, streak_pos, multiplier,
         points, base_points, bonus_points, jokered, premier_du_jour
    from public.daily_points
) d;

-- ===========================================================================
-- 4. La semaine S4. Jour off le mercredi 05/08.
--
--    L'horloge : daily_points lit now(). Pour voir une semaine CLOSE (donc la
--    semaine pleine et la prime hebdo), rejouer la vue avec `paris` figé :
--
--      sed "s/select (now() at time zone 'Europe\/Paris')::date as today/\
--           select date '2026-08-17' as today/" migration46-bareme-s4.sql
--
--    et la nommer `dp_sim`. Les attendus ci-dessous sont ceux de `dp_sim`.
-- ===========================================================================

insert into public.jours_off (day, week_monday)
  values (date '2026-08-05', date '2026-08-03') on conflict do nothing;

-- A s'entraîne les 7 jours, jour off compris.
insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select '11111111-1111-1111-1111-111111111111', d::date, true, true, true,
       (d::date + time '21:00') at time zone 'Europe/Paris'
from generate_series(date '2026-08-03', date '2026-08-09', interval '1 day') d
on conflict do nothing;

-- B se repose le jour off, parfait les six autres.
insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select '22222222-2222-2222-2222-222222222222', d::date, true, true, true,
       (d::date + time '21:00') at time zone 'Europe/Paris'
from generate_series(date '2026-08-03', date '2026-08-09', interval '1 day') d
where d::date <> date '2026-08-05'
on conflict do nothing;

-- C se repose le jour off PUIS rate le jeudi, et revient le vendredi.
insert into public.entries (player_id, day, pushups, abs, squats, completed_at)
select '33333333-3333-3333-3333-333333333333', d::date, true, true, true,
       (d::date + time '21:00') at time zone 'Europe/Paris'
from generate_series(date '2026-08-03', date '2026-08-09', interval '1 day') d
where d::date not in (date '2026-08-05', date '2026-08-06')
on conflict do nothing;

insert into public.daily_events (day, event_key) values
  (date '2026-08-06', 'bonus_doubles'),
  (date '2026-08-07', 'jour_de_fete')
on conflict (day) do nothing;

-- A déclare 11 pts de puces le jeudi, plus un boss (kind = 'event').
insert into public.bonus_claims (player_id, day, bonus_key, points) values
  ('11111111-1111-1111-1111-111111111111', date '2026-08-06', 'pompes_50', 4),
  ('11111111-1111-1111-1111-111111111111', date '2026-08-06', 'pompes_100', 7),
  ('11111111-1111-1111-1111-111111111111', date '2026-08-06', 'boss_dimanche', 10),
  ('11111111-1111-1111-1111-111111111111', date '2026-08-07', 'corde_10min', 5)
on conflict do nothing;

\echo ''
\echo '=== 2/3 — la semaine du jour off (vue dp_sim, horloge au 17/08) ==='
\echo 'Attendu :'
\echo '  A mer 05/08 : jour_off = t, perfect = t, la série continue (24)'
\echo '  B mar 22 -> B jeu 23   : le jour off ENJAMBE sans consommer de rang'
\echo '  B jeu 06/08 : 14 pts et NON 17 — le 🔙 retour ne paie pas apres un off'
\echo '  B dim 09/08 : 19 = 14 + 5  — la semaine pleine reste atteignable'
\echo '  C jeu 06/08 : jokered = t  — le joker saute par-dessus le jour off'
\echo '  C mer 05/08 : jokered = f  — il ne brûle JAMAIS sur un jour off'
\echo '  A jeu 06/08 : 46 = 14 + 21 de puces + 11 doublés (le boss ne double pas)'
\echo '  A ven 07/08 : 24 = 14 + 5 corde + 5 fête   |   B ven : 19 = 14 + 5'

select p.name, dp.day, to_char(dp.day, 'Dy') as j, dp.exos, dp.perfect,
       dp.streak_pos, dp.jour_off, dp.jokered, dp.points
from public.dp_sim dp
join public.players p on p.id = dp.player_id
where dp.day between date '2026-08-03' and date '2026-08-09'
order by p.name, dp.day;

-- ===========================================================================
-- 5. Le tirage : un jour off par semaine, et cinq jours équiprobables.
--
--    Copie paramétrée de get_jour_off() — même échelle, la date injectée au
--    lieu de now(). Sur 20 000 semaines : min = max = 1, et 20 % par jour.
-- ===========================================================================

create or replace function public.sim_jour_off(p_day date) returns boolean
language plpgsql as $$
declare dow int; lundi date; deja date; restants int;
begin
  if p_day < date '2026-08-03' or p_day > date '2026-08-28' then return false; end if;
  dow := extract(isodow from p_day)::int;
  if dow > 5 then return false; end if;
  lundi := p_day - (dow - 1);
  select day into deja from public.jours_off where day between lundi and lundi + 6;
  if found then return deja = p_day; end if;
  restants := 6 - dow;
  if random() >= 1.0 / restants then return false; end if;
  insert into public.jours_off (day, week_monday) values (p_day, lundi) on conflict do nothing;
  return exists (select 1 from public.jours_off where day = p_day);
end; $$;

\echo ''
\echo '=== 3/3 — 20 000 semaines tirées : attendu min = max = 1, et 20 % par jour ==='

do $$
declare i int; d date; nb int;
begin
  create temp table tirages (jour int);
  create temp table par_semaine (n int);
  for i in 1..20000 loop
    delete from public.jours_off;
    for d in select generate_series(date '2026-08-03', date '2026-08-07', interval '1 day')::date loop
      perform public.sim_jour_off(d);
    end loop;
    select count(*) into nb from public.jours_off;
    insert into par_semaine values (nb);
    insert into tirages select extract(isodow from day)::int from public.jours_off;
  end loop;
end $$;

select 'jours off par semaine : min = ' || min(n) || ', max = ' || max(n) as garantie
from par_semaine;

select case jour when 1 then 'lundi' when 2 then 'mardi' when 3 then 'mercredi'
                 when 4 then 'jeudi' when 5 then 'vendredi' end as jour,
       count(*) as tirages,
       round(100.0 * count(*) / 20000, 2) || ' %' as part
from tirages group by jour order by jour;
