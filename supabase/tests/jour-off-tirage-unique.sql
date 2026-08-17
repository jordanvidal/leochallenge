-- supabase/tests/jour-off-tirage-unique.sql — le jour off se tire-t-il UNE fois ?
--
-- La migration 46 promet « marginale exacte de 1/5 par jour et EXACTEMENT un
-- jour off par semaine, garanti par construction ». La section 5 de
-- bareme-s4-jour-off.sql le vérifie… en appelant get_jour_off() une seule fois
-- par jour. C'est là que le test d'origine passait à côté : en prod la
-- fonction est appelée DEUX fois par jour ouvré — le cron de 6h, puis le
-- premier get_daily_event() de la journée (cron de 7h, ou n'importe quel
-- joueur qui ouvre l'app avant lui).
--
-- Ce fichier rejoue le tirage tel qu'il est vraiment appelé, sur les deux
-- versions de la fonction côte à côte.
--
--   createdb jofflab
--   psql -d jofflab -v ON_ERROR_STOP=1 -f jour-off-tirage-unique.sql
--
-- COUVERT : la stabilité de la réponse dans la journée (le cœur du bug du
-- 17/08), la garantie d'un seul jour off par semaine, et la marginale de 20 %
-- par jour — les trois sous deux appels quotidiens.
--
-- NON COUVERT : la course entre deux appels SIMULTANÉS. Elle se joue sur le
-- verrou de `on conflict do nothing`, que psql en mono-session ne peut pas
-- mettre en défaut.

-- ===========================================================================
-- 1. Le socle. jours_off telle que la migration 46 la crée, et la table de
--    mémoire que la migration 48 ajoute.
-- ===========================================================================

drop table if exists public.jours_off;
create table public.jours_off (
  day         date primary key,
  week_monday date not null,
  constraint jour_off_ouvre check (extract(isodow from day) between 1 and 5),
  constraint jour_off_lundi check (week_monday = day - (extract(isodow from day)::int - 1)),
  constraint jour_off_un_par_semaine unique (week_monday)
);

drop table if exists public.jour_off_tirages;
create table public.jour_off_tirages (
  day     date primary key,
  tire_at timestamptz not null default now()
);

-- ===========================================================================
-- 2. Les deux tirages, datés au lieu de lire now().
--
--    Copies fidèles : même fenêtre, même échelle croissante, mêmes
--    `on conflict`. Seule la date change de source.
-- ===========================================================================

-- AVANT (migration 46) : la mémoire ne retient que les OUI.
create or replace function public.sim_avant(p_day date) returns boolean
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

-- APRÈS (migration 48) : le tirage se réserve avant de lancer le dé.
create or replace function public.sim_apres(p_day date) returns boolean
language plpgsql as $$
declare dow int; lundi date; deja date; restants int; reserve date;
begin
  if p_day < date '2026-08-03' or p_day > date '2026-08-28' then return false; end if;
  dow := extract(isodow from p_day)::int;
  if dow > 5 then return false; end if;
  lundi := p_day - (dow - 1);
  select day into deja from public.jours_off where day between lundi and lundi + 6;
  if found then return deja = p_day; end if;
  insert into public.jour_off_tirages (day) values (p_day)
  on conflict (day) do nothing
  returning day into reserve;
  if not found then
    return exists (select 1 from public.jours_off where day = p_day);
  end if;
  restants := 6 - dow;
  if random() >= 1.0 / restants then return false; end if;
  insert into public.jours_off (day, week_monday) values (p_day, lundi) on conflict do nothing;
  return exists (select 1 from public.jours_off where day = p_day);
end; $$;

-- ===========================================================================
-- 3. LE test : deux appels le même jour disent-ils la même chose ?
--
--    C'est le 17/08 en miniature. Lundi, semaine vierge, on appelle deux
--    fois — comme le font le lève-tôt de minuit puis le cron de 6h.
--
--    AVANT : le premier appel tire NON quatre fois sur cinq sans laisser de
--    trace, le second re-tire et touche une fois sur cinq. ~16 % de
--    contradictions, et chacune est un « jour off + événement du jour » en
--    prod.
--
--    APRÈS : attendu 0. Zéro, pas « peu ».
-- ===========================================================================

\echo ''
\echo '=== 1/3 — deux appels le même lundi se contredisent-ils ? ==='
\echo 'Attendu : avant ~16 % (le bug du 17/08), apres 0 '

do $$
declare i int; a boolean; b boolean; ko_avant int := 0; ko_apres int := 0;
begin
  for i in 1..20000 loop
    delete from public.jours_off;
    a := public.sim_avant(date '2026-08-03');
    b := public.sim_avant(date '2026-08-03');
    if a is distinct from b then ko_avant := ko_avant + 1; end if;

    delete from public.jours_off;
    delete from public.jour_off_tirages;
    a := public.sim_apres(date '2026-08-03');
    b := public.sim_apres(date '2026-08-03');
    if a is distinct from b then ko_apres := ko_apres + 1; end if;
  end loop;
  raise notice 'contradictions avant : % / 20000 (%)',
    ko_avant, round(100.0 * ko_avant / 20000, 2) || ' %';
  raise notice 'contradictions apres : % / 20000', ko_apres;
  if ko_apres <> 0 then
    raise exception 'REGRESSION : % contradictions apres correctif', ko_apres;
  end if;
end $$;

-- ===========================================================================
-- 4. La garantie d'un jour off par semaine, sous deux appels quotidiens.
--
--    Elle tient dans les deux versions — c'est l'unicité de week_monday qui
--    la porte, pas le tirage. On la revérifie parce qu'une mémoire mal posée
--    aurait pu la casser.
-- ===========================================================================

\echo ''
\echo '=== 2/3 — jours off par semaine, 2 appels par jour : attendu min = max = 1 ==='

do $$
declare i int; d date;
begin
  create temp table par_semaine (version text, n int);
  for i in 1..5000 loop
    delete from public.jours_off;
    for d in select generate_series(date '2026-08-03', date '2026-08-07', interval '1 day')::date loop
      perform public.sim_avant(d);
      perform public.sim_avant(d);
    end loop;
    insert into par_semaine select 'avant', count(*) from public.jours_off;

    delete from public.jours_off;
    delete from public.jour_off_tirages;
    for d in select generate_series(date '2026-08-03', date '2026-08-07', interval '1 day')::date loop
      perform public.sim_apres(d);
      perform public.sim_apres(d);
    end loop;
    insert into par_semaine select 'apres', count(*) from public.jours_off;
  end loop;
end $$;

select version, min(n) as mini, max(n) as maxi from par_semaine group by version order by version;

-- ===========================================================================
-- 5. La marginale de 20 % par jour, sous deux appels quotidiens.
--
--    C'est la promesse écrite dans la migration 46. AVANT, deux appels par
--    jour la font dériver : chaque jour ouvré voit sa chance passer de 1/5 à
--    1-(1-1/r)², et le repos se tasse en début de semaine — lundi part à
--    36 %. APRÈS, les cinq jours reviennent à 20 %.
-- ===========================================================================

\echo ''
\echo '=== 3/3 — répartition des jours off : attendu 20 % partout APRES ==='

do $$
declare i int; d date;
begin
  create temp table tirages (version text, jour int);
  for i in 1..20000 loop
    delete from public.jours_off;
    for d in select generate_series(date '2026-08-03', date '2026-08-07', interval '1 day')::date loop
      perform public.sim_avant(d);
      perform public.sim_avant(d);
    end loop;
    insert into tirages select 'avant', extract(isodow from day)::int from public.jours_off;

    delete from public.jours_off;
    delete from public.jour_off_tirages;
    for d in select generate_series(date '2026-08-03', date '2026-08-07', interval '1 day')::date loop
      perform public.sim_apres(d);
      perform public.sim_apres(d);
    end loop;
    insert into tirages select 'apres', extract(isodow from day)::int from public.jours_off;
  end loop;
end $$;

select case jour when 1 then 'lundi' when 2 then 'mardi' when 3 then 'mercredi'
                 when 4 then 'jeudi' when 5 then 'vendredi' end as jour,
       round(100.0 * count(*) filter (where version = 'avant') / 20000, 1) || ' %' as avant,
       round(100.0 * count(*) filter (where version = 'apres') / 20000, 1) || ' %' as apres
from tirages group by jour order by jour;
