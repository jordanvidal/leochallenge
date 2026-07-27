-- supabase/tests/multi-ligues.sql — le test qui commande la phase 1
--
-- « Un test sur une seule ligue ne prouve rien. » Deux ligues tournent ici sur
-- des dates qui SE CHEVAUCHENT, et la seconde est calibrée pour VOLER la
-- première si le moindre calcul restait global :
--
--   * ses joueurs finissent à 6h du matin → ils rafleraient le premier du jour ;
--   * ils cumulent ~2× les points de la meilleure joueuse de l'autre ligue sur
--     la semaine du 01/06 → ils rafleraient la prime hebdo ;
--   * ils arrivent tard, donc leur cumul est faible → ils rafleraient le jour
--     miroir, qui récompense le DERNIER au classement.
--
-- Si une seule de ces trois fuites subsiste, le classement de la ligue A bouge
-- quand on remplit la ligue B, et l'assertion 1 tombe.
--
-- Usage (cluster PostgreSQL 17 quelconque, base déjà migrée 36 → 37 → 38) :
--   psql -d <base> -v ON_ERROR_STOP=1 -f supabase/tests/multi-ligues.sql
--
-- Le script se termine par un ROLLBACK : il ne laisse rien derrière lui.
--
-- Les dates sont volontairement DANS LE PASSÉ : les vues ne closent une
-- journée, une semaine ou un jour miroir que si `day < today`. Un test posé sur
-- des dates futures ne réveillerait aucune des mécaniques à vérifier.

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Les gardes d'écriture refusent d'écrire dans le passé (« seul le jour en
-- cours est déclarable ») : on les met en sommeil le temps de poser le décor.
-- Elles sont réveillées avant les assertions qui les concernent (6, 7, 8).

alter table app.entries        disable trigger user;
alter table app.bonus_claims   disable trigger user;
alter table app.players        disable trigger user;
alter table app.daily_events   disable trigger user;

-- Ligue A : 6 semaines, du lundi 04/05 au dimanche 14/06/2026.
insert into app.leagues (id, slug, name, invite_code, start_day, end_day)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'alpha', 'Les Alpha', 'ALPHA1',
        '2026-05-04', '2026-06-14');

-- Ligue B : 1 semaine, du lundi 01/06 au dimanche 07/06/2026. Entièrement
-- incluse dans la fenêtre de la ligue A — c'est tout l'intérêt.
insert into app.leagues (id, slug, name, invite_code, start_day, end_day)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'bravo', 'Les Bravo', 'BRAVO2',
        '2026-06-01', '2026-06-07');

insert into app.players (id, league_id, name, color, recovery_code, created_at) values
  ('a1111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ana',   '#e11', 'AAA111', '2026-05-04 09:00+02'),
  ('a2222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Bruno', '#e22', 'AAA222', '2026-05-04 09:01+02'),
  ('a3333333-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Carla', '#e33', 'AAA333', '2026-05-04 09:02+02'),
  ('a4444444-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Dino',  '#e44', 'AAA444', '2026-05-04 09:03+02'),
  ('a5555555-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', 'Elsa',  '#e55', 'AAA555', '2026-05-04 09:04+02');

-- L'événement du jour est GLOBAL : les deux ligues partagent le tirage.
insert into app.daily_events (day, event_key) values
  ('2026-06-03', 'jour_miroir'),
  ('2026-06-04', 'pompes_double');

-- Les entrées de la ligue A. `completed_at` est posé explicitement : sans lui,
-- `done_ts` est nul et le premier du jour ne se calcule pas.
--   Ana   : parfaite tous les jours, finit à 21h.
--   Bruno : parfait les jours pairs, finit à 20h.
--   Carla : parfaite les 10 premiers jours seulement.
--   Dino  : parfait à partir du 01/06.
--   Elsa  : ne fait que les pompes.
insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a1111111-0000-0000-0000-000000000001', d::date, true, true, true, (d::date + time '21:00') at time zone 'Europe/Paris'
from generate_series('2026-05-04'::date, '2026-06-14'::date, interval '1 day') d;

insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a2222222-0000-0000-0000-000000000002', d::date,
       extract(day from d)::int % 2 = 0, extract(day from d)::int % 2 = 0, extract(day from d)::int % 2 = 0,
       case when extract(day from d)::int % 2 = 0 then (d::date + time '20:00') at time zone 'Europe/Paris' end
from generate_series('2026-05-04'::date, '2026-06-14'::date, interval '1 day') d;

-- Carla : deux séries de 5 jours ou plus, séparées par un trou — c'est le
-- profil qui décroche « retour de flamme ».
insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a3333333-0000-0000-0000-000000000003', d::date, true, true, true, (d::date + time '19:00') at time zone 'Europe/Paris'
from generate_series('2026-05-04'::date, '2026-05-13'::date, interval '1 day') d;

insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a3333333-0000-0000-0000-000000000003', d::date, true, true, true, (d::date + time '19:00') at time zone 'Europe/Paris'
from generate_series('2026-05-20'::date, '2026-05-26'::date, interval '1 day') d;

insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a4444444-0000-0000-0000-000000000004', d::date, true, true, true, (d::date + time '18:00') at time zone 'Europe/Paris'
from generate_series('2026-06-01'::date, '2026-06-14'::date, interval '1 day') d;

insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a5555555-0000-0000-0000-000000000005', d::date, true, false, false, null
from generate_series('2026-05-04'::date, '2026-06-14'::date, interval '1 day') d;

-- ---------------------------------------------------------------------------
-- Photo du classement de la ligue A, AVANT que la ligue B n'existe
-- ---------------------------------------------------------------------------

create temporary table photo_alpha as
select player_id, points, rank, perfect_days, exos_done, bonus_points
from app.leaderboard('aaaaaaaa-0000-0000-0000-000000000001');

create temporary table photo_miroir as
select mday, league_id, player_id from app.jours_miroir;

create temporary table photo_premiers as
select league_id, day, player_id from app.points_bruts where premier_du_jour;

-- ---------------------------------------------------------------------------
-- La ligue B débarque — calibrée pour tout rafler si le calcul était global
-- ---------------------------------------------------------------------------

insert into app.players (id, league_id, name, color, recovery_code, created_at) values
  ('b1111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Zoé',    '#b11', 'BBB111', '2026-06-01 08:00+02'),
  ('b2222222-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'Yann',   '#b22', 'BBB222', '2026-06-01 08:01+02'),
  ('b3333333-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'Wanda',  '#b33', 'BBB333', '2026-06-01 08:02+02'),
  -- Même prénom qu'en ligue A : l'unicité est par ligue, ça doit passer.
  ('b4444444-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002', 'Ana',    '#b44', 'BBB444', '2026-06-01 08:03+02');

-- Parfaits tous les jours, et finis à 6h du matin : sous un calcul global ils
-- rafleraient le premier du jour à tout le monde.
insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select p.id, d::date, true, true, true, (d::date + time '06:00') at time zone 'Europe/Paris'
from app.players p,
     generate_series('2026-06-01'::date, '2026-06-07'::date, interval '1 day') d
where p.league_id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- Et un tas de bonus déclarés : sous un calcul global, la prime hebdo de la
-- semaine du 01/06 leur reviendrait, au nez d'Ana.
insert into app.bonus_claims (player_id, day, bonus_key, points)
select p.id, d::date, 'course_10km', 20
from app.players p,
     generate_series('2026-06-01'::date, '2026-06-07'::date, interval '1 day') d
where p.league_id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  n int;
  v numeric;
  w uuid;
  msg text;
begin

  -- 1. LE TEST QUI COMMANDE TOUT : la ligue B n'a pas touché la ligue A.
  select count(*) into n
  from photo_alpha avant
  full join app.leaderboard('aaaaaaaa-0000-0000-0000-000000000001') apres
    on apres.player_id = avant.player_id
  where avant.player_id is distinct from apres.player_id
     or avant.points is distinct from apres.points
     or avant.rank is distinct from apres.rank
     or avant.perfect_days is distinct from apres.perfect_days
     or avant.exos_done is distinct from apres.exos_done
     or avant.bonus_points is distinct from apres.bonus_points;
  if n <> 0 then
    raise exception 'ASSERTION 1 ECHOUEE : le classement de la ligue A a bougé sur % ligne(s) quand la ligue B s''est remplie', n;
  end if;
  raise notice 'OK 1 — cocher dans la ligue B ne bouge pas d''un point le classement de la ligue A';

  -- 2. Jour miroir : un gagnant PAR LIGUE, chacun le dernier de la sienne.
  select count(*) into n from app.jours_miroir where mday = '2026-06-03';
  if n <> 2 then
    raise exception 'ASSERTION 2 ECHOUEE : % gagnant(s) du jour miroir le 03/06, attendu 2 (un par ligue)', n;
  end if;
  -- Chaque gagnant appartient bien à la ligue qu'on lui attribue.
  select count(*) into n
  from app.jours_miroir jm
  join app.players p on p.id = jm.player_id
  where jm.league_id is distinct from p.league_id;
  if n <> 0 then
    raise exception 'ASSERTION 2 ECHOUEE : % gagnant(s) du miroir rattaché(s) à la mauvaise ligue', n;
  end if;
  -- Et c'est bien le dernier au cumul de SA ligue. On recalcule l'attendu à
  -- part plutôt que de le supposer : le cumul se lit sur les joueurs de la
  -- ligue A SEULEMENT, jamais sur la base entière.
  select expected.player_id into w
  from (
    select p.id as player_id,
           coalesce((select sum(pb.pts) from app.points_bruts pb
                      where pb.player_id = p.id and pb.day < '2026-06-03'), 0) as cum
    from app.players p
    where p.league_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    order by cum, p.id
    limit 1
  ) expected;

  if w is distinct from (
    select jm.player_id from app.jours_miroir jm
    where jm.mday = '2026-06-03' and jm.league_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  ) then
    raise exception 'ASSERTION 2 ECHOUEE : le miroir de la ligue A ne revient pas au dernier de la ligue A (attendu %)', w;
  end if;
  -- Et surtout : ce n'est pas un joueur de la ligue B, alors qu'ils sont
  -- arrivés le 01/06 et ont donc le plus petit cumul de toute la base.
  if w in (select id from app.players where league_id = 'bbbbbbbb-0000-0000-0000-000000000002') then
    raise exception 'ASSERTION 2 ECHOUEE : le miroir de la ligue A est parti à la ligue B';
  end if;
  raise notice 'OK 2 — le jour miroir désigne un dernier par ligue, jamais celui d''à côté';

  -- 3. Prime hebdo : la photo d'avant/après (assertion 1) prouve déjà qu'elle
  --    n'a pas fui. On vérifie ici qu'elle EXISTE des deux côtés — une prime
  --    calculée globalement n'aurait produit qu'un seul gagnant au total.
  --    Semaine du 01/06 : les points tombent le dimanche 07/06.
  select count(distinct dp.league_id) into n
  from app.daily_points dp
  where dp.day = '2026-06-07' and dp.bonus_points > 0;
  if n <> 2 then
    raise exception 'ASSERTION 3 ECHOUEE : les bonus de fin de semaine du 07/06 ne touchent que % ligue(s)', n;
  end if;
  raise notice 'OK 3 — la semaine close du 01/06 a un gagnant dans chaque ligue';

  -- 4. Premier du jour : un par ligue et par jour, jamais deux, jamais celui
  --    d'en face. Les joueurs de B finissent à 6h — sous un calcul global ils
  --    auraient pris tous les premiers de A entre le 01 et le 07/06.
  select count(*) into n
  from (
    select day, league_id, count(*) as c
    from app.points_bruts where premier_du_jour
    group by day, league_id having count(*) > 1
  ) t;
  if n <> 0 then
    raise exception 'ASSERTION 4 ECHOUEE : % jour(s) avec plusieurs premiers dans la même ligue', n;
  end if;
  select count(*) into n
  from app.points_bruts pb
  join app.players p on p.id = pb.player_id
  where pb.premier_du_jour and pb.league_id is distinct from p.league_id;
  if n <> 0 then
    raise exception 'ASSERTION 4 ECHOUEE : % premier(s) du jour attribué(s) hors de leur ligue', n;
  end if;
  -- Les premiers de la ligue A entre le 01 et le 07/06 sont inchangés.
  select count(*) into n
  from photo_premiers avant
  full join (select league_id, day, player_id from app.points_bruts where premier_du_jour) apres
    on apres.league_id = avant.league_id and apres.day = avant.day
  where avant.league_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    and avant.player_id is distinct from apres.player_id;
  if n <> 0 then
    raise exception 'ASSERTION 4 ECHOUEE : la ligue B a volé % premier(s) du jour à la ligue A', n;
  end if;
  raise notice 'OK 4 — le premier du jour se calcule ligue par ligue';

  -- 5. Le ×2 du jour (pompes_double le 04/06) double bien, PAR JOUEUR, sans
  --    que le volume de l'autre ligue n'entre dans le calcul. Ana est à 3/3 ce
  --    jour-là avec une série longue : multiplicateur 2,0.
  select pb.event_bonus into v
  from app.points_bruts pb
  where pb.player_id = 'a1111111-0000-0000-0000-000000000001' and pb.day = '2026-06-04';
  if v is distinct from (select points * 2.0 from app.bonus_catalog where key = 'pompes_double') then
    raise exception 'ASSERTION 5 ECHOUEE : le ×2 du 04/06 vaut % pour Ana, attendu %',
      v, (select points * 2.0 from app.bonus_catalog where key = 'pompes_double');
  end if;
  -- Elsa n'a coché que les pompes : elle touche le ×2 aussi, mais sans série.
  select pb.event_bonus into v
  from app.points_bruts pb
  where pb.player_id = 'a5555555-0000-0000-0000-000000000005' and pb.day = '2026-06-04';
  if v is distinct from (select points * 1.0 from app.bonus_catalog where key = 'pompes_double') then
    raise exception 'ASSERTION 5 ECHOUEE : le ×2 du 04/06 vaut % pour Elsa, attendu sans multiplicateur', v;
  end if;
  raise notice 'OK 5 — le ×2 du jour double par joueur et par ligue, jamais sur l''activité d''à côté';

end $$;

-- ---------------------------------------------------------------------------
-- Assertions 6 à 8 : les gardes d'écriture, réveillées
-- ---------------------------------------------------------------------------
-- Une troisième ligue, celle-là en cours aujourd'hui : les gardes refusent
-- d'inscrire un joueur dans une ligue déjà terminée, ce qui est justement ce
-- qu'on veut vérifier séparément.

alter table app.entries      enable trigger user;
alter table app.bonus_claims enable trigger user;
alter table app.players      enable trigger user;
alter table app.daily_events enable trigger user;

insert into app.leagues (id, slug, name, invite_code, start_day, end_day)
values ('cccccccc-0000-0000-0000-000000000003', 'charlie', 'Les Charlie', 'CHARL3',
        (now() at time zone 'Europe/Paris')::date - 2,
        (now() at time zone 'Europe/Paris')::date + 20);

do $$
declare
  n int;
  ok boolean;
begin

  -- 7. Le même prénom vit dans deux ligues, mais jamais deux fois dans une.
  --    « Ana » existe déjà en ligue A ET en ligue B (posé plus haut) :
  --    c'est déjà la preuve que l'unicité est devenue locale.
  select count(*) into n from app.players where lower(app.f_unaccent(trim(name))) = 'ana';
  if n <> 2 then
    raise exception 'ASSERTION 7 ECHOUEE : % joueuse(s) nommée(s) Ana, attendu 2 (une par ligue)', n;
  end if;

  insert into app.players (league_id, name, color)
  values ('cccccccc-0000-0000-0000-000000000003', 'Charlie1', '#ccc');

  ok := false;
  begin
    -- Casse différente : c'est le même prénom pour l'index.
    insert into app.players (league_id, name, color)
    values ('cccccccc-0000-0000-0000-000000000003', 'CHARLIE1', '#ccc');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'ASSERTION 7 ECHOUEE : un prénom en double est passé dans la même ligue';
  end if;
  raise notice 'OK 7 — « Ana » des deux côtés, mais jamais deux fois du même';

  -- 6. Le cap de 12 joueurs est PAR LIGUE, plus global à la base.
  --    18 joueurs existent déjà ailleurs : sous l'ancien cap global, aucune de
  --    ces insertions ne passerait.
  insert into app.players (league_id, name, color)
  select 'cccccccc-0000-0000-0000-000000000003', 'Charlie' || i, '#ccc'
  from generate_series(2, 12) i;

  select count(*) into n from app.players where league_id = 'cccccccc-0000-0000-0000-000000000003';
  if n <> 12 then
    raise exception 'ASSERTION 6 ECHOUEE : % joueurs dans la ligue C, attendu 12', n;
  end if;

  ok := false;
  begin
    insert into app.players (league_id, name, color)
    values ('cccccccc-0000-0000-0000-000000000003', 'Treizieme', '#ccc');
  exception when others then
    if sqlerrm like 'CAP_JOUEURS%' then ok := true; else raise; end if;
  end;
  if not ok then
    raise exception 'ASSERTION 6 ECHOUEE : le 13e joueur de la ligue C est passé';
  end if;
  raise notice 'OK 6 — 12 joueurs par ligue, et le 13e est refusé (cap devenu local)';

  -- 8. La fenêtre de la ligue est tenue par trigger (ex-contraintes CHECK).
  ok := false;
  begin
    insert into app.entries (player_id, day, pushups, abs, squats)
    values ((select id from app.players where league_id = 'cccccccc-0000-0000-0000-000000000003' limit 1),
            (now() at time zone 'Europe/Paris')::date + 30, true, false, false);
  exception when others then
    if sqlerrm like 'HORS_FENETRE%' then ok := true; else raise; end if;
  end;
  if not ok then
    raise exception 'ASSERTION 8 ECHOUEE : une entrée hors de la fenêtre de la ligue est passée';
  end if;

  -- Et dans la fenêtre, ça passe (jour en cours, ligue C en cours).
  insert into app.entries (player_id, day, pushups, abs, squats)
  values ((select id from app.players where league_id = 'cccccccc-0000-0000-0000-000000000003' order by name limit 1),
          (now() at time zone 'Europe/Paris')::date, true, false, false);
  raise notice 'OK 8 — hors fenêtre refusé, dans la fenêtre accepté';

  -- 8bis. Un duel ne traverse pas deux ligues.
  ok := false;
  begin
    insert into app.duels (week_monday, player_a, player_b)
    values ('2026-06-01', 'a1111111-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like 'DUEL_INTER_LIGUES%' then ok := true; else raise; end if;
  end;
  if not ok then
    raise exception 'ASSERTION 8bis ECHOUEE : un duel entre deux ligues est passé';
  end if;
  raise notice 'OK 8bis — pas de duel entre deux ligues';

end $$;

-- ---------------------------------------------------------------------------
-- Assertion 9 : l'arrivée tardive démarre à zéro sans casser le classement
-- ---------------------------------------------------------------------------

alter table app.players disable trigger user;

insert into app.players (id, league_id, name, color, recovery_code, created_at)
values ('a6666666-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Fred', '#e66', 'AAA666', '2026-06-10 12:00+02');

alter table app.entries disable trigger user;
insert into app.entries (player_id, day, pushups, abs, squats, completed_at)
select 'a6666666-0000-0000-0000-000000000006', d::date, true, true, true,
       (d::date + time '22:00') at time zone 'Europe/Paris'
from generate_series('2026-06-10'::date, '2026-06-14'::date, interval '1 day') d;

do $$
declare
  n int;
  v numeric;
begin
  -- Les points des joueurs déjà là n'ont pas bougé d'un iota.
  select count(*) into n
  from photo_alpha avant
  join app.leaderboard('aaaaaaaa-0000-0000-0000-000000000001') apres
    on apres.player_id = avant.player_id
  where avant.points is distinct from apres.points
     or avant.perfect_days is distinct from apres.perfect_days
     or avant.exos_done is distinct from apres.exos_done;
  if n <> 0 then
    raise exception 'ASSERTION 9 ECHOUEE : l''arrivée de Fred a modifié % joueur(s) déjà classé(s)', n;
  end if;

  -- Fred n'a rien sur les jours d'avant son arrivée : pas de rattrapage.
  select count(*) into n
  from app.daily_points
  where player_id = 'a6666666-0000-0000-0000-000000000006' and day < '2026-06-10';
  if n <> 0 then
    raise exception 'ASSERTION 9 ECHOUEE : Fred a % ligne(s) avant son arrivée', n;
  end if;

  -- Il est bien dans le classement, avec ses seuls points à lui.
  select points into v
  from app.leaderboard('aaaaaaaa-0000-0000-0000-000000000001')
  where player_id = 'a6666666-0000-0000-0000-000000000006';
  if v is null or v <= 0 then
    raise exception 'ASSERTION 9 ECHOUEE : Fred n''apparaît pas au classement (points = %)', v;
  end if;
  raise notice 'OK 9 — arrivée au jour 38 : Fred démarre à zéro, personne ne bouge';
end $$;

-- ---------------------------------------------------------------------------
-- Assertion 10 : les 8 badges, et le n°1 mesuré dans SA ligue
-- ---------------------------------------------------------------------------

do $$
declare
  n int;
  manquants text;
begin
  -- Les 8 badges du catalogue client (lib/gamification.ts) sont tous
  -- atteignables. Un badge qui n'apparaît jamais est un badge mort.
  select string_agg(b, ', ') into manquants
  from unnest(array['premiere_semaine', 'machine', 'increvable', 'sans_faute',
                    'retour_de_flamme', 'premier_de_la_classe', 'finisseur',
                    'centurion']) b
  where not exists (select 1 from app.player_badges pb where pb.badge = b);
  if manquants is not null then
    raise exception 'ASSERTION 10 ECHOUEE : badge(s) jamais décerné(s) : %', manquants;
  end if;

  -- Chaque badge est rattaché à la ligue de son joueur.
  select count(*) into n
  from app.player_badges pb
  join app.players p on p.id = pb.player_id
  where pb.league_id is distinct from p.league_id;
  if n <> 0 then
    raise exception 'ASSERTION 10 ECHOUEE : % badge(s) rattaché(s) à la mauvaise ligue', n;
  end if;

  -- LE point sensible : « premier de la classe » (n°1 pendant 7 jours
  -- d'affilée) se mesurait avec un rank() sur TOUTE la base. Les joueurs de la
  -- ligue B, écrasés par le cumul d'Ana, n'auraient jamais pu l'obtenir.
  -- Il doit exister dans les deux ligues.
  select count(distinct pb.league_id) into n
  from app.player_badges pb
  where pb.badge = 'premier_de_la_classe';
  if n <> 2 then
    raise exception 'ASSERTION 10 ECHOUEE : « premier de la classe » n''existe que dans % ligue(s) — le classement fuit', n;
  end if;
  raise notice 'OK 10 — les 8 badges sont vivants, et le n°1 se mesure dans sa ligue';

  raise notice '';
  raise notice '=== 10 assertions au vert — deux ligues aux dates chevauchantes, étanches ===';
end $$;

rollback;
