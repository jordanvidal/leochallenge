-- supabase/tests/badges-proportionnels.sql — phase 2
--
-- LE test de cette phase : à N = 50 jours, les formules proportionnelles
-- doivent redonner EXACTEMENT les seuils d'aujourd'hui — 7 / 14 / 30 / 100.
-- Si elles dérivent ne serait-ce que d'une unité, le groupe d'origine verrait
-- ses badges changer le jour de sa migration, et la formule serait fausse.
--
-- Usage (base migrée 36 → 38 puis 40) :
--   psql -d <base> -v ON_ERROR_STOP=1 -f supabase/tests/badges-proportionnels.sql
--
-- Se termine par un ROLLBACK.

\set ON_ERROR_STOP on
begin;

alter table app.entries disable trigger user;
alter table app.players disable trigger user;
alter table app.leagues disable trigger user;

-- ---------------------------------------------------------------------------
-- Assertion 1 : la table des seuils, dont la non-régression à N = 50
-- ---------------------------------------------------------------------------
-- Vérifiée directement sur la formule, avant même de créer une ligue : c'est
-- de l'arithmétique, autant la tester comme telle.

do $$
declare
  r record;
  attendu int[];
  obtenu int[];
begin
  for r in
    select n,
           greatest(3, ceil(0.14 * n))::int as premiere,
           greatest(3, ceil(0.28 * n))::int as machine,
           greatest(3, ceil(0.60 * n))::int as increvable,
           (2 * n)::int as centurion
    from unnest(array[7, 14, 21, 28, 35, 42, 50]) n
  loop
    obtenu := array[r.premiere, r.machine, r.increvable, r.centurion];
    attendu := case r.n
      when 7  then array[3, 3, 5, 14]
      when 14 then array[3, 4, 9, 28]
      when 21 then array[3, 6, 13, 42]
      when 28 then array[4, 8, 17, 56]
      when 35 then array[5, 10, 21, 70]
      when 42 then array[6, 12, 26, 84]
      when 50 then array[7, 14, 30, 100]   -- les valeurs d'aujourd'hui
    end;
    if obtenu is distinct from attendu then
      raise exception 'ASSERTION 1 ECHOUEE : à N=%, seuils % au lieu de %', r.n, obtenu, attendu;
    end if;
  end loop;
  raise notice 'OK 1 — les formules donnent 7/14/30/100 à N=50, et la table complète est conforme';
end $$;

-- ---------------------------------------------------------------------------
-- Décor : trois ligues de durées très différentes
-- ---------------------------------------------------------------------------
-- Les dates sont dans le passé : `sans_faute` et le classement quotidien ne se
-- calculent que sur des journées écoulées.
--
-- La ligue de 50 jours dépasse le plafond de 6 semaines — c'est justement le
-- cas du challenge d'origine. Le trigger est en sommeil, comme le fera l'import
-- de la phase 5.

insert into app.leagues (id, slug, name, invite_code, start_day, end_day) values
  ('50000000-0000-0000-0000-000000000050', 'n50', 'Ligue de 50 jours', 'NN0050', '2026-03-02', '2026-04-20'),
  ('42000000-0000-0000-0000-000000000042', 'n42', 'Ligue de 42 jours', 'NN0042', '2026-03-02', '2026-04-12'),
  ('07000000-0000-0000-0000-000000000007', 'n07', 'Ligue de 7 jours',  'NN0007', '2026-03-02', '2026-03-08');

do $$
declare n int;
begin
  select count(*) into n from app.leagues
   where id in ('50000000-0000-0000-0000-000000000050',
                '42000000-0000-0000-0000-000000000042',
                '07000000-0000-0000-0000-000000000007')
     and (end_day - start_day + 1) in (50, 42, 7);
  if n <> 3 then
    raise exception 'FIXTURE INVALIDE : les trois ligues ne font pas 50 / 42 / 7 jours';
  end if;
end $$;

-- Dans chaque ligue, un joueur parfait de bout en bout et un joueur qui ne
-- coche que les pompes.
-- L'identifiant du joueur dérive de celui de sa ligue : on remplace le premier
-- caractère hexadécimal par `a` (Parfait) ou `b` (Moyen). Concaténer allongerait
-- la chaîne au-delà des 32 caractères d'un uuid.
insert into app.players (id, league_id, name, color, recovery_code, created_at)
select ('a' || substr(replace(l.id::text, '-', ''), 2))::uuid,
       l.id, 'Parfait', '#0f0', 'PARF' || substr(l.slug, 2, 2), l.start_day::timestamptz
from app.leagues l where l.slug in ('n50', 'n42', 'n07');

insert into app.players (id, league_id, name, color, recovery_code, created_at)
select ('b' || substr(replace(l.id::text, '-', ''), 2))::uuid,
       l.id, 'Moyen', '#f00', 'MOYE' || substr(l.slug, 2, 2), l.start_day::timestamptz
from app.leagues l where l.slug in ('n50', 'n42', 'n07');

-- « Parfait » coche les trois exos tous les jours de sa ligue.
insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select p.id, d::date, true, true, true, (d::date + time '20:00') at time zone 'Europe/Paris'
from app.players p
join app.leagues l on l.id = p.league_id,
     lateral generate_series(l.start_day, l.end_day, interval '1 day') d
where p.name = 'Parfait';

-- « Moyen » ne fait que les pompes : jamais de jour parfait, jamais de série.
insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select p.id, d::date, true, false, false, null
from app.players p
join app.leagues l on l.id = p.league_id,
     lateral generate_series(l.start_day, l.end_day, interval '1 day') d
where p.name = 'Moyen';

-- ---------------------------------------------------------------------------
-- Assertions 2 et 3 : les badges suivent la durée de la ligue
-- ---------------------------------------------------------------------------

do $$
declare
  n int;
  manquants text;
begin

  -- 2. Le joueur parfait décroche les quatre badges à seuil, dans les TROIS
  --    ligues. Avec les anciens seuils en dur, la ligue de 7 jours n'en
  --    aurait donné aucun : ni 7 jours parfaits d'affilée pour
  --    `premiere_semaine`, ni 100 exercices pour `centurion` (21 au maximum).
  for n in select (l.end_day - l.start_day + 1) from app.leagues l
           where l.slug in ('n50', 'n42', 'n07')
  loop
    select string_agg(b, ', ') into manquants
    from unnest(array['premiere_semaine', 'machine', 'increvable', 'centurion']) b
    where not exists (
      select 1
      from app.player_badges pb
      join app.players p on p.id = pb.player_id
      join app.leagues l on l.id = p.league_id
      where pb.badge = b and p.name = 'Parfait'
        and (l.end_day - l.start_day + 1) = n
    );
    if manquants is not null then
      raise exception 'ASSERTION 2 ECHOUEE : ligue de % jours, le joueur parfait n''a pas : %', n, manquants;
    end if;
  end loop;
  raise notice 'OK 2 — un sans-faute décroche les 4 badges à seuil sur 7, 42 comme 50 jours';

  -- 3. Le joueur qui ne coche que les pompes n'en décroche aucun, quelle que
  --    soit la durée. Un seuil proportionnel ne doit pas devenir gratuit.
  select count(*) into n
  from app.player_badges pb
  join app.players p on p.id = pb.player_id
  where p.name = 'Moyen'
    and pb.badge in ('premiere_semaine', 'machine', 'increvable', 'centurion');
  if n <> 0 then
    raise exception 'ASSERTION 3 ECHOUEE : le joueur irrégulier décroche % badge(s) à seuil', n;
  end if;

  -- Sur 50 jours il cumule pourtant 50 exercices : sous l'ancien seuil fixe de
  -- 100 il n'avait rien non plus, mais sur 7 jours (seuil 14) il en a 7 — le
  -- proportionnel ne doit pas l'avoir rendu atteignable.
  select count(*) into n
  from app.player_badges pb
  join app.players p on p.id = pb.player_id
  where p.name = 'Moyen' and pb.badge = 'centurion';
  if n <> 0 then
    raise exception 'ASSERTION 3 ECHOUEE : centurion décroché sans faire le volume';
  end if;
  raise notice 'OK 3 — un joueur irrégulier ne décroche aucun badge à seuil, même sur une ligue courte';

  raise notice '';
  raise notice '=== 3 assertions au vert — les seuils suivent la ligue sans bouger à N=50 ===';
end $$;

rollback;
