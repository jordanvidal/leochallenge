-- migration38-app-scoring.sql — socle multi-ligues, phase 1 (vues et scoring)
--
-- Se joue après migration36 et migration37. Aucune instruction ne touche `public`.
--
-- C'est ici que se cachaient les bugs, pas dans les colonnes. Dans `public`, tous
-- ces objets raisonnent sur LA TOTALITÉ de la base — c'est précisément ce qui
-- rendait le multi-ligue impossible. Deux fuites étaient vivantes et silencieuses :
--
--   * le JOUR MIROIR faisait `cross join players` sur toute la base, puis prenait
--     le dernier du classement cumulé : une ligue de 5 potes aurait fait perdre le
--     miroir au dernier d'une autre ligue ;
--   * la PRIME HEBDO faisait `rank() over (partition by monday order by pts desc)`
--     sur tous les joueurs de la base, toutes ligues confondues.
--
-- Rien ne cassait à l'affichage. Seuls les points étaient faux.
--
-- ---------------------------------------------------------------------------
-- Deux partis pris, décidés avec Jordan
-- ---------------------------------------------------------------------------
--
-- 1. BARÈME S3 PUR. Dans `public`, ~60 littéraux `2026-07-20` / `2026-07-27`
--    encodent l'histoire des changements de règles du groupe d'origine. Pour une
--    ligue neuve ils sont tous statiquement faux. Ils sautent donc : une ligue
--    neuve ne traîne pas l'historique d'une autre bande. Concrètement, la pile de
--    bonus d'exécution pré-S3 (premier_du_jour, avant_8h, apres_22h, seance_20min,
--    seance_rapide, jour_parfait_collectif) disparaît du calcul — elle valait déjà
--    0 depuis le 27/07. `premier_du_jour` survit comme DRAPEAU D'AFFICHAGE, plus
--    comme source de points ; il reste cadré par ligue pour que le fil soit juste.
--
--    Conséquence assumée : l'historique du groupe d'origine (antérieur au 27/07)
--    ne peut pas être recalculé par ces vues. Il sera recopié tel quel dans
--    `app.legacy_daily_points` en phase 5, et repris ici sans recalcul.
--
-- 2. UN SEUL CALCUL DE POINTS. Dans `public`, `duel_results` embarque sa PROPRE
--    copie du barème — restée sur l'ancienne version (jour parfait à 2 points au
--    lieu de 4, bonus pré-S3 non gardés). Les deux ont divergé sans que personne
--    ne le voie, parce que ça ne sert que de départage. Ici le calcul de base vit
--    à un seul endroit, `app.points_bruts`, dont `duel_results` et `daily_points`
--    dérivent tous les deux.

-- ---------------------------------------------------------------------------
-- app.points_bruts — le point par joueur et par jour, AVANT les extras
-- ---------------------------------------------------------------------------
-- « Extras » = les bonus qui dépendent d'un classement (jour miroir, duel,
-- prime hebdo, semaine pleine). Ils ne peuvent pas être calculés ici sans
-- circularité : `duel_results` s'appuie sur `points_bruts`.

create or replace view app.points_bruts
with (security_invoker = true) as
with recursive
paris as (
  select (now() at time zone 'Europe/Paris')::date as today
),
-- Le joueur et sa ligue : c'est la jointure qui cadre tout le reste.
pl as (
  select p.id as player_id, p.league_id, l.start_day, l.end_day
  from app.players p
  join app.leagues l on l.id = p.league_id
),
e as (
  select pl.league_id,
         en.player_id,
         en.day,
         en.pushups::int + en.abs::int + en.squats::int as exos,
         en.pushups and en.abs and en.squats as perfect,
         en.pushups, en.abs, en.squats,
         en.completed_at,
         case
           when en.completed_at is not null
            and (en.completed_at at time zone 'Europe/Paris')::date = en.day
           then (en.completed_at at time zone 'Europe/Paris')
         end as done_ts
  from app.entries en
  join pl on pl.player_id = en.player_id
),
-- Séries de jours parfaits, joker compris. Tout est partitionné par joueur :
-- aucune fuite inter-ligues possible ici.
base_islands as (
  select e.player_id, e.day,
         e.day - row_number() over (partition by e.player_id order by e.day)::int as island
  from e where e.perfect
),
base_streaks as (
  select bi.player_id, bi.day,
         row_number() over (partition by bi.player_id, bi.island order by bi.day)::int as pos
  from base_islands bi
),
-- Le joker : un trou d'un jour après 3 jours parfaits, si le joueur revient.
joker as (
  select distinct on (bs.player_id) bs.player_id, bs.day + 1 as day
  from base_streaks bs
  where bs.pos >= 3
    and not exists (select 1 from e gap where gap.player_id = bs.player_id and gap.day = bs.day + 1 and gap.perfect)
    and exists (select 1 from e back where back.player_id = bs.player_id and back.day = bs.day + 2 and back.perfect)
  order by bs.player_id, bs.day
),
kept as (
  select e.player_id, e.day, true as is_perfect from e where e.perfect
  union all
  select j.player_id, j.day, false from joker j
),
islands as (
  select k.player_id, k.day, k.is_perfect,
         k.day - row_number() over (partition by k.player_id order by k.day)::int as island
  from kept k
),
streaks as (
  select i.player_id, i.day,
         row_number() over (partition by i.player_id, i.island order by i.day)::int as streak_pos
  from islands i
  where i.is_perfect
),
-- Le retour : 3/3 après un jour à zéro. Seul bonus d'exécution encore vivant.
comeback as (
  select cur.player_id, cur.day
  from e cur
  where cur.perfect
    and not exists (select 1 from e prev where prev.player_id = cur.player_id and prev.day = cur.day - 1 and prev.exos > 0)
    and exists (select 1 from e hist where hist.player_id = cur.player_id and hist.day < cur.day - 1)
),
spine as (
  select e.league_id, e.player_id, e.day from e
  union
  select pl.league_id, bc.player_id, bc.day from app.bonus_claims bc join pl on pl.player_id = bc.player_id
  union
  select pl.league_id, j.player_id, j.day from joker j join pl on pl.player_id = j.player_id
),
-- Premier arrivé du jour, PAR LIGUE. Rotation : le vainqueur de la veille est
-- écarté le lendemain. L'ancre n'est plus une date en dur — c'est le premier
-- jour de chaque ligue.
finishers as (
  select e.league_id, e.day, e.player_id, e.done_ts
  from e, paris
  where e.done_ts is not null and e.day < paris.today
),
first_rot as (
  select l.id as league_id, l.start_day as day,
         (select f.player_id from finishers f
           where f.league_id = l.id and f.day = l.start_day
           order by f.done_ts limit 1) as winner
  from app.leagues l, paris
  where l.start_day < paris.today
  union all
  select r.league_id, r.day + 1,
         (select f.player_id from finishers f
           where f.league_id = r.league_id
             and f.day = r.day + 1
             and (r.winner is null or f.player_id <> r.winner)
           order by f.done_ts limit 1)
  from first_rot r
  join app.leagues l on l.id = r.league_id
  where (r.day + 1) < (select paris.today from paris)
    and (r.day + 1) <= l.end_day
),
first_done as (
  select fr.league_id, fr.day, fr.winner as player_id
  from first_rot fr
  where fr.winner is not null
),
claims as (
  select bc.player_id, bc.day, sum(bc.points) as pts
  from app.bonus_claims bc
  group by bc.player_id, bc.day
),
-- Le ×2 du jour : un bonus d'exercice rattaché à l'événement tiré double aussi.
-- Tout est par joueur — l'activité d'une autre ligue n'entre jamais dans ce calcul.
claims_double as (
  select bc.player_id, bc.day, cat.double_event, sum(bc.points) as pts
  from app.bonus_claims bc
  join app.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.double_event is not null
  group by bc.player_id, bc.day, cat.double_event
),
base as (
  select s.league_id,
         s.player_id,
         s.day,
         coalesce(e.exos, 0) as exos,
         coalesce(e.perfect, false) as perfect,
         coalesce(st.streak_pos, 0) as streak_pos,
         jk.day is not null as jokered,
         fd.player_id is not null as premier_du_jour,
         case
           when coalesce(st.streak_pos, 0) >= 7 then 2.0
           when coalesce(st.streak_pos, 0) >= 3 then 1.5
           else 1.0
         end as multiplier,
         -- Barème S3 : le retour est le seul bonus d'exécution restant.
         case when cb.player_id is not null then app.bonus_value('retour') else 0::numeric end
           as execution_bonus,
         -- L'événement du jour. Le doublement suit le multiplicateur de série,
         -- comme la base — c'est ce que fait le barème S3.
         (case
            when ev.event_key = 'pompes_double' and coalesce(e.pushups, false) then app.bonus_value('pompes_double')
            when ev.event_key = 'abdos_double'  and coalesce(e.abs, false)     then app.bonus_value('abdos_double')
            when ev.event_key = 'squats_double' and coalesce(e.squats, false)  then app.bonus_value('squats_double')
            else 0::numeric
          end)
         * (case
              when coalesce(st.streak_pos, 0) >= 7 then 2.0
              when coalesce(st.streak_pos, 0) >= 3 then 1.5
              else 1.0
            end)
         + coalesce(dcl.pts, 0::numeric) as event_bonus,
         coalesce(c.pts, 0::numeric) as claim_bonus,
         ev.event_key
  from spine s
  left join e            on e.player_id  = s.player_id and e.day = s.day
  left join streaks st   on st.player_id = s.player_id and st.day = s.day
  left join joker jk     on jk.player_id = s.player_id and jk.day = s.day
  left join comeback cb  on cb.player_id = s.player_id and cb.day = s.day
  left join first_done fd on fd.league_id = s.league_id and fd.day = s.day and fd.player_id = s.player_id
  left join claims c     on c.player_id  = s.player_id and c.day = s.day
  left join app.daily_events ev on ev.day = s.day
  left join claims_double dcl on dcl.player_id = s.player_id and dcl.day = s.day
                             and dcl.double_event = ev.event_key
)
select b.league_id,
       b.player_id,
       b.day,
       b.exos,
       b.perfect,
       b.streak_pos,
       b.multiplier,
       b.jokered,
       b.premier_du_jour,
       b.event_key,
       (b.exos + case when b.perfect then 4 else 0 end)::numeric * b.multiplier as base_pts,
       b.execution_bonus,
       b.event_bonus,
       b.claim_bonus,
       -- Quitte ou double : la base du jour compte double si 3/3.
       case
         when b.event_key = 'quitte_ou_double' and b.perfect
         then (b.exos + case when b.perfect then 4 else 0 end)::numeric * b.multiplier
         else 0::numeric
       end as quitte_bonus,
       (b.exos + case when b.perfect then 4 else 0 end)::numeric * b.multiplier
         + b.execution_bonus + b.event_bonus + b.claim_bonus
         + case
             when b.event_key = 'quitte_ou_double' and b.perfect
             then (b.exos + case when b.perfect then 4 else 0 end)::numeric * b.multiplier
             else 0::numeric
           end as pts
from base b;

-- ---------------------------------------------------------------------------
-- app.jours_miroir — le dernier de SA ligue, pas de la base
-- ---------------------------------------------------------------------------
-- `daily_events` est global : le jour miroir tombe le même jour pour tout le
-- monde. Mais le « dernier au classement » se lit ligue par ligue. Une ligue qui
-- ne tourne pas ce jour-là n'a simplement pas de gagnant.

create or replace view app.jours_miroir
with (security_invoker = true) as
with
paris as (select (now() at time zone 'Europe/Paris')::date as today),
pl as (
  select p.id as player_id, p.league_id, l.start_day, l.end_day,
         -- Le jour où le joueur est entré dans la ligue. Sans cette borne, un
         -- arrivant tardif se retrouve classé sur des jours miroir ANTÉRIEURS à
         -- son arrivée, avec un cumul de zéro — donc dernier, donc gagnant. Il
         -- raflerait rétroactivement un bonus d'une journée qu'il n'a pas jouée.
         -- (Défaut hérité de `public.daily_points`, corrigé ici.)
         greatest(l.start_day, (p.created_at at time zone 'Europe/Paris')::date) as entre_le
  from app.players p join app.leagues l on l.id = p.league_id
),
mirror_days as (
  select de.day
  from app.daily_events de, paris
  where de.event_key = 'jour_miroir' and de.day < paris.today
),
standings as (
  select md.day as mday, pl.league_id, pl.player_id,
         coalesce(sum(pb.pts), 0::numeric) as cum
  from mirror_days md
  join pl on md.day between pl.entre_le and pl.end_day
  left join app.points_bruts pb on pb.player_id = pl.player_id and pb.day < md.day
  group by md.day, pl.league_id, pl.player_id
)
select distinct on (s.mday, s.league_id)
       s.mday, s.league_id, s.player_id
from standings s
order by s.mday, s.league_id, s.cum, s.player_id;

-- ---------------------------------------------------------------------------
-- app.duel_results — les duels de la semaine, cadrés par ligue
-- ---------------------------------------------------------------------------
-- Départage : d'abord les jours parfaits, puis les points de la semaine. Ces
-- points viennent de `points_bruts` + le jour miroir — jamais des duels
-- eux-mêmes, sinon la vue se référencerait.

create or replace view app.duel_results
with (security_invoker = true) as
with
paris as (select (now() at time zone 'Europe/Paris')::date as today),
pl as (select p.id as player_id, p.league_id from app.players p),
weekpts as (
  select pb.player_id, pb.day, pb.pts from app.points_bruts pb
  union all
  select jm.player_id, jm.mday as day, app.bonus_value('jour_miroir') as pts
  from app.jours_miroir jm
),
finished as (
  select d.id, d.week_monday, d.player_a, d.player_b, pa.league_id
  from app.duels d
  join pl pa on pa.player_id = d.player_a,
       paris
  where d.player_b is not null and (d.week_monday + 7) <= paris.today
),
tally as (
  select f.id, f.week_monday, f.player_a, f.player_b, f.league_id,
         count(*) filter (where en.player_id = f.player_a and en.pushups and en.abs and en.squats)::int as perfect_a,
         count(*) filter (where en.player_id = f.player_b and en.pushups and en.abs and en.squats)::int as perfect_b,
         coalesce(sum(en.pushups::int + en.abs::int + en.squats::int) filter (where en.player_id = f.player_a), 0)::int as exos_a,
         coalesce(sum(en.pushups::int + en.abs::int + en.squats::int) filter (where en.player_id = f.player_b), 0)::int as exos_b
  from finished f
  left join app.entries en
    on (en.player_id = f.player_a or en.player_id = f.player_b)
   and en.day >= f.week_monday and en.day <= f.week_monday + 6
  group by f.id, f.week_monday, f.player_a, f.player_b, f.league_id
),
duel_points as (
  select f.id,
         coalesce(sum(w.pts) filter (where w.player_id = f.player_a), 0::numeric) as points_a,
         coalesce(sum(w.pts) filter (where w.player_id = f.player_b), 0::numeric) as points_b
  from finished f
  left join weekpts w
    on (w.player_id = f.player_a or w.player_id = f.player_b)
   and w.day >= f.week_monday and w.day <= f.week_monday + 6
  group by f.id
)
select t.id,
       t.league_id,
       t.week_monday,
       t.week_monday + 6 as day,
       t.player_a, t.player_b,
       t.perfect_a, t.perfect_b,
       t.exos_a, t.exos_b,
       case
         when t.perfect_a > t.perfect_b then t.player_a
         when t.perfect_b > t.perfect_a then t.player_b
         when p.points_a > p.points_b then t.player_a
         when p.points_b > p.points_a then t.player_b
       end as winner,
       case
         when t.perfect_a > t.perfect_b then t.player_b
         when t.perfect_b > t.perfect_a then t.player_a
         when p.points_a > p.points_b then t.player_b
         when p.points_b > p.points_a then t.player_a
       end as loser,
       t.perfect_a = t.perfect_b as tiebreak_used,
       round(p.points_a, 1) as points_a,
       round(p.points_b, 1) as points_b
from tally t
join duel_points p using (id);

-- ---------------------------------------------------------------------------
-- app.daily_points — points bruts + extras de classement, PAR LIGUE
-- ---------------------------------------------------------------------------

create or replace view app.daily_points
with (security_invoker = true) as
with
paris as (select (now() at time zone 'Europe/Paris')::date as today),
lig as (
  select l.id as league_id,
         -- Les semaines de la ligue partent du lundi de son premier jour, comme
         -- le découpage lundi→dimanche du front. Plus de date d'ancrage en dur.
         l.start_day - (extract(isodow from l.start_day)::int - 1) as lundi_zero,
         l.end_day
  from app.leagues l
),
closed_weeks as (
  select lg.league_id, g.monday::date as monday
  from lig lg, paris,
       lateral generate_series(
         lg.lundi_zero::timestamptz,
         least(paris.today, lg.end_day)::timestamptz,
         interval '7 days') g(monday)
  where (g.monday::date + 7) <= paris.today
),
-- La semaine pleine : 7 jours parfaits sur une semaine close.
full_weeks as (
  select cw.league_id, cw.monday, pb.player_id
  from closed_weeks cw
  join app.points_bruts pb
    on pb.league_id = cw.league_id and pb.perfect
   and pb.day >= cw.monday and pb.day <= cw.monday + 6
  group by cw.league_id, cw.monday, pb.player_id
  having count(*) = 7
),
extras_core as (
  select jm.player_id, jm.league_id, jm.mday as day, app.bonus_value('jour_miroir') as pts
  from app.jours_miroir jm
  union all
  select dr.winner, dr.league_id, dr.day, app.bonus_value('duel_hebdo')
  from app.duel_results dr where dr.winner is not null
  union all
  select dr.loser, dr.league_id, dr.day, - app.bonus_value('duel_hebdo')
  from app.duel_results dr where dr.winner is not null
  union all
  select fw.player_id, fw.league_id, fw.monday + 6, app.bonus_value('semaine_pleine')
  from full_weeks fw
),
-- La prime hebdo : le meilleur de LA SEMAINE, dans SA ligue. C'était un
-- `rank() over (partition by monday)` sur tous les joueurs de la base.
week_standing as (
  select cw.league_id, cw.monday, s.player_id, sum(s.pts) as pts
  from closed_weeks cw
  join (
    select pb.player_id, pb.league_id, pb.day, pb.pts from app.points_bruts pb
    union all
    select ec.player_id, ec.league_id, ec.day, ec.pts from extras_core ec
  ) s on s.league_id = cw.league_id and s.day >= cw.monday and s.day <= cw.monday + 6
  group by cw.league_id, cw.monday, s.player_id
),
week_winner as (
  select r.league_id, r.monday, r.player_id
  from (
    select ws.*, rank() over (partition by ws.league_id, ws.monday order by ws.pts desc) as rk
    from week_standing ws
  ) r
  where r.rk = 1 and r.pts > 0
),
extras as (
  select ec.player_id, ec.league_id, ec.day, ec.pts from extras_core ec
  union all
  select ww.player_id, ww.league_id, ww.monday + 6, app.bonus_value('prime_hebdo')
  from week_winner ww
),
extras_by_day as (
  select x.player_id, x.league_id, x.day, sum(x.pts) as pts
  from extras x
  group by x.player_id, x.league_id, x.day
),
-- Les journées jouées sous un barème antérieur (groupe d'origine, avant le
-- 27/07/2026) ne se recalculent pas : elles sont figées et reprises telles quelles.
-- Table vide tant que la phase 5 n'a pas tourné.
gelees as (
  select ldp.player_id, p.league_id, ldp.day
  from app.legacy_daily_points ldp
  join app.players p on p.id = ldp.player_id
)
select pb.player_id,
       pb.league_id,
       pb.day,
       pb.exos,
       pb.perfect,
       pb.streak_pos,
       pb.multiplier,
       pb.pts + coalesce(x.pts, 0::numeric) as points,
       pb.base_pts as base_points,
       pb.execution_bonus + pb.event_bonus + pb.claim_bonus + pb.quitte_bonus
         + coalesce(x.pts, 0::numeric) as bonus_points,
       pb.jokered,
       pb.premier_du_jour
from app.points_bruts pb
left join extras_by_day x on x.player_id = pb.player_id and x.day = pb.day
where not exists (select 1 from gelees g where g.player_id = pb.player_id and g.day = pb.day)

union all

-- Les jours où un joueur ne touche que des extras (duel perdu une semaine sans
-- avoir coché, par exemple) : ils n'ont pas de ligne dans points_bruts.
select x.player_id, x.league_id, x.day,
       0, false, 0, 1.0,
       x.pts, 0, x.pts, false, false
from extras_by_day x
where not exists (
  select 1 from app.points_bruts pb
  where pb.player_id = x.player_id and pb.day = x.day
)
and not exists (select 1 from gelees g where g.player_id = x.player_id and g.day = x.day)

union all

select ldp.player_id, p.league_id, ldp.day,
       ldp.exos, ldp.perfect, ldp.streak_pos, ldp.multiplier,
       ldp.points, ldp.base_points, ldp.bonus_points,
       ldp.jokered, ldp.premier_du_jour
from app.legacy_daily_points ldp
join app.players p on p.id = ldp.player_id;

-- ---------------------------------------------------------------------------
-- app.leaderboard — le classement d'UNE ligue
-- ---------------------------------------------------------------------------
-- `as materialized` n'est pas cosmétique : sans lui Postgres inline la CTE dans
-- chacune des quatre références et on retombe sur la lenteur corrigée par
-- migration35. Le `rank()` est désormais borné à la ligue demandée.

create or replace function app.leaderboard(
  p_league uuid,
  p_from date default null,
  p_until date default null
)
returns table (
  player_id uuid,
  points numeric,
  rank bigint,
  perfect_days bigint,
  exos_done bigint,
  current_streak integer,
  bonus_points numeric,
  joker_day date
)
language sql
stable
set search_path = app
as $$
  with dp as materialized (
    select d.player_id, d.day, d.exos, d.perfect, d.streak_pos,
           d.points, d.bonus_points, d.jokered
    from app.daily_points d
    where d.league_id = p_league
  ),
  pts as (
    select dp.player_id,
           sum(dp.points) as points,
           sum(dp.bonus_points) as bonus_points,
           count(*) filter (where dp.perfect) as perfect_days,
           sum(dp.exos) as exos_done
    from dp
    where (p_from is null or dp.day >= p_from)
      and (p_until is null or dp.day <= p_until)
    group by dp.player_id
  ),
  last_perfect as (
    select distinct on (dp.player_id) dp.player_id, dp.day, dp.streak_pos
    from dp where dp.perfect
    order by dp.player_id, dp.day desc
  ),
  -- Dernier jour qui tient la chaîne : parfait OU joker.
  last_kept as (
    select distinct on (dp.player_id) dp.player_id, dp.day
    from dp where dp.perfect or dp.jokered
    order by dp.player_id, dp.day desc
  ),
  -- Le joker brûlé, s'il l'est. Jamais borné par p_from/p_until : il vaut pour
  -- toute la ligue, pas pour la fenêtre affichée.
  joker_used as (
    select dp.player_id, min(dp.day) as day
    from dp where dp.jokered
    group by dp.player_id
  )
  select
    p.id as player_id,
    round(coalesce(pts.points, 0), 1) as points,
    rank() over (order by coalesce(pts.points, 0) desc) as rank,
    coalesce(pts.perfect_days, 0) as perfect_days,
    coalesce(pts.exos_done, 0) as exos_done,
    case when lk.day >= (now() at time zone 'Europe/Paris')::date - 1
         then lp.streak_pos else 0 end as current_streak,
    round(coalesce(pts.bonus_points, 0), 1) as bonus_points,
    ju.day as joker_day
  from app.players p
  left join pts on pts.player_id = p.id
  left join last_perfect lp on lp.player_id = p.id
  left join last_kept lk on lk.player_id = p.id
  left join joker_used ju on ju.player_id = p.id
  where p.league_id = p_league
$$;

-- ---------------------------------------------------------------------------
-- app.player_breakdown — le détail ligne à ligne d'un joueur
-- ---------------------------------------------------------------------------
-- Le joueur porte sa ligue : pas de paramètre supplémentaire. Chaque ligne
-- porte ses propres points, comme dans `public` depuis migration34.

create or replace function app.player_breakdown(
  p_player uuid,
  p_from date default null,
  p_until date default null
)
returns table (
  day date,
  kind text,
  label text,
  emoji text,
  points numeric
)
language sql
stable
set search_path = app
as $$
  with d as (
    select dp.*
    from app.daily_points dp
    where dp.player_id = p_player
      and (p_from is null or dp.day >= p_from)
      and (p_until is null or dp.day <= p_until)
  )
  -- La base du jour : exercices cochés + prime du jour parfait, le tout
  -- multiplié par la série.
  select d.day, 'base'::text,
         case when d.perfect then 'Jour parfait' else d.exos || ' exercice' || case when d.exos > 1 then 's' else '' end end,
         case when d.perfect then '✅' else '☑️' end,
         round(d.base_points, 1)
  from d where d.base_points <> 0

  union all
  -- Les bonus déclarés à la main, un par ligne.
  select bc.day, 'bonus'::text, cat.label, cat.emoji, round(bc.points, 1)
  from app.bonus_claims bc
  join app.bonus_catalog cat on cat.key = bc.bonus_key
  where bc.player_id = p_player
    and (p_from is null or bc.day >= p_from)
    and (p_until is null or bc.day <= p_until)

  union all
  -- Le retour. Il se lit sur `points_bruts` : `daily_points` n'expose que le
  -- total des bonus, pas leur ventilation.
  -- (Phase 5 : le détail d'une journée gelée sera recalculé au barème courant
  -- alors que son total est figé. À traiter au moment de la migration.)
  select pb.day, 'execution'::text, cat.label, cat.emoji, round(app.bonus_value('retour'), 1)
  from app.points_bruts pb
  join app.bonus_catalog cat on cat.key = 'retour'
  where pb.player_id = p_player
    and pb.execution_bonus > 0
    and (p_from is null or pb.day >= p_from)
    and (p_until is null or pb.day <= p_until)

  union all
  -- Le jour miroir.
  select jm.mday, 'event'::text, cat.label, cat.emoji, round(app.bonus_value('jour_miroir'), 1)
  from app.jours_miroir jm
  join app.bonus_catalog cat on cat.key = 'jour_miroir'
  where jm.player_id = p_player
    and (p_from is null or jm.mday >= p_from)
    and (p_until is null or jm.mday <= p_until)

  union all
  -- Le duel de la semaine, gagné ou perdu.
  select dr.day, 'execution'::text, cat.label, cat.emoji,
         round(case when dr.winner = p_player then app.bonus_value('duel_hebdo')
                    else - app.bonus_value('duel_hebdo') end, 1)
  from app.duel_results dr
  join app.bonus_catalog cat on cat.key = 'duel_hebdo'
  where dr.winner is not null
    and (dr.winner = p_player or dr.loser = p_player)
    and (p_from is null or dr.day >= p_from)
    and (p_until is null or dr.day <= p_until)
$$;

-- ---------------------------------------------------------------------------
-- app.player_badges — les badges, cadrés par ligue
-- ---------------------------------------------------------------------------
-- Les 8 badges de `public`, à l'identique. Les seuils restent ceux
-- d'aujourd'hui (7 / 14 / 30 / 100) : les rendre proportionnels à la durée de
-- la ligue est la PHASE 2, pas ici.
--
-- Deux changements de fond, et deux seulement :
--   * `finisseur` se déclenche sur `leagues.end_day` au lieu du 2026-08-31 en
--     dur, et la fenêtre des jours écoulés suit la ligue ;
--   * `premier_de_la_classe` (n°1 pendant 7 jours d'affilée) classait les
--     joueurs avec un `rank() over (partition by day order by cum_pts desc)`
--     SANS filtre de groupe. C'est la troisième fuite inter-ligues du moteur,
--     après le jour miroir et la prime hebdo : le n°1 se serait mesuré contre
--     toute la base. Le classement est désormais partitionné par ligue.

create or replace view app.player_badges
with (security_invoker = true) as
with
paris as (select (now() at time zone 'Europe/Paris')::date as today),
pl as (
  select p.id as player_id, p.league_id, l.start_day, l.end_day
  from app.players p join app.leagues l on l.id = p.league_id
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
-- Longueur de chaque série de jours parfaits. Par joueur : pas de fuite ici.
runs as (
  select t.player_id, count(*) as len
  from (
    select e.player_id, e.day,
           e.day - row_number() over (partition by e.player_id order by e.day)::int as island
    from e where e.perfect
  ) t
  group by t.player_id, t.island
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
  select runs.player_id, 'premiere_semaine'::text as badge
  from runs group by runs.player_id having max(runs.len) >= 7
  union all
  select runs.player_id, 'machine'::text
  from runs group by runs.player_id having max(runs.len) >= 14
  union all
  select runs.player_id, 'increvable'::text
  from runs group by runs.player_id having max(runs.len) >= 30
  union all
  -- Sans faute : aucun jour écoulé de SA ligue sans un 3/3.
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
  -- Retour de flamme : deux séries de 5 jours ou plus.
  select runs.player_id, 'retour_de_flamme'::text
  from runs where runs.len >= 5
  group by runs.player_id having count(*) >= 2
  union all
  select top_runs.player_id, 'premier_de_la_classe'::text
  from top_runs group by top_runs.player_id having max(top_runs.len) >= 7
  union all
  -- Le finisseur : 3/3 le dernier jour de SA ligue.
  select e.player_id, 'finisseur'::text
  from e join pl on pl.player_id = e.player_id
  where e.day = pl.end_day and e.perfect
  union all
  select e.player_id, 'centurion'::text
  from e group by e.player_id having sum(e.exos) >= 100
)
select g.player_id, pl.league_id, g.badge
from gagnes g
join pl on pl.player_id = g.player_id;

-- ---------------------------------------------------------------------------
-- app.get_daily_event — le tirage du jour, global
-- ---------------------------------------------------------------------------
-- L'événement reste GLOBAL par jour civil : toutes les ligues actives partagent
-- le tirage. La fenêtre 13/07 → 31/08 en dur est remplacée par « au moins une
-- ligue tourne aujourd'hui » — inutile de tirer quand personne ne joue.

create or replace function app.get_daily_event()
returns text
language plpgsql
set search_path = app
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  existing text;
  r double precision;
  drawn text;
begin
  if not exists (
    select 1 from app.leagues where paris_today between start_day and end_day
  ) then
    return null;
  end if;

  select event_key into existing from app.daily_events where day = paris_today;
  if found then
    return existing;
  end if;

  r := random();
  if extract(isodow from paris_today) = 7 then
    drawn := case
      when r < 0.45 then 'rien'
      when r < 0.70 then 'boss_dimanche'
      when r < 0.76 then 'pompes_double'
      when r < 0.82 then 'abdos_double'
      when r < 0.88 then 'squats_double'
      else 'quitte_ou_double'
    end;
  else
    drawn := case
      when r < 0.52 then 'rien'
      when r < 0.64 then 'pompes_double'
      when r < 0.76 then 'abdos_double'
      when r < 0.88 then 'squats_double'
      else 'quitte_ou_double'
    end;
  end if;

  -- Deux clients qui tirent en même temps : le premier inséré gagne.
  insert into app.daily_events (day, event_key)
  values (paris_today, drawn)
  on conflict (day) do nothing;

  select event_key into existing from app.daily_events where day = paris_today;
  return existing;
end;
$$;

-- ---------------------------------------------------------------------------
-- app.recit_hebdo — le récit du lundi, pour UNE ligue
-- ---------------------------------------------------------------------------
-- Élit l'angle le plus saillant de la semaine close. La sélection est
-- déterministe (pas de random) : deux appels donnent le même récit.

create or replace function app.recit_hebdo(p_league uuid, p_monday date)
returns jsonb
language plpgsql
stable
set search_path = app
as $$
declare
  dimanche date := p_monday + 6;
  nb_joueurs int;
  res jsonb;
  gagnant record;
  serie record;
  parfaits int;
begin
  select count(*) into nb_joueurs from app.players where league_id = p_league;
  if nb_joueurs < 2 then
    return null;
  end if;

  -- Le classement de la semaine, borné à la ligue.
  select l.player_id, pl.name, l.points, l.rank
    into gagnant
  from app.leaderboard(p_league, p_monday, dimanche) l
  join app.players pl on pl.id = l.player_id
  where l.rank = 1 and l.points > 0
  order by pl.created_at
  limit 1;

  if not found then
    return null;
  end if;

  -- Combien de jours parfaits collectifs dans la semaine.
  select count(*) into parfaits
  from (
    select dp.day
    from app.daily_points dp
    where dp.league_id = p_league
      and dp.day between p_monday and dimanche
    group by dp.day
    having count(*) filter (where dp.perfect) = nb_joueurs
  ) t;

  -- La plus longue série en cours dans la ligue.
  select pl.name, max(dp.streak_pos) as serie
    into serie
  from app.daily_points dp
  join app.players pl on pl.id = dp.player_id
  where dp.league_id = p_league and dp.day between p_monday and dimanche
  group by pl.name
  order by serie desc, pl.name
  limit 1;

  res := jsonb_build_object(
    'monday', p_monday,
    'sunday', dimanche,
    'league_id', p_league,
    'winner', jsonb_build_object('player_id', gagnant.player_id, 'name', gagnant.name,
                                 'points', round(gagnant.points, 1)),
    'jours_parfaits_collectifs', parfaits,
    'meilleure_serie', case when serie.name is null then null
                            else jsonb_build_object('name', serie.name, 'longueur', serie.serie) end
  );
  return res;
end;
$$;

grant execute on all functions in schema app to anon, authenticated, service_role;
grant select on all tables in schema app to anon, authenticated, service_role;
