-- =============================================================
-- Phase 2 — gamification. Migration ADDITIVE : rien d'existant
-- n'est modifié, aucune donnée perdue.
-- Points calculés côté serveur : une seule vérité, pas six.
-- =============================================================

-- -------------------------------------------------------------
-- Points quotidiens.
-- 1 pt / exo, +2 si jour parfait (3/3), multiplicateur de série :
-- ×1,5 à partir du 3e jour parfait consécutif, ×2 à partir du 7e.
-- La série casse dès qu'un jour n'est pas à 3/3.
-- -------------------------------------------------------------

create or replace view public.daily_points
with (security_invoker = true) as
with e as (
  select player_id, day,
         (pushups::int + abs::int + squats::int) as exos,
         (pushups and abs and squats) as perfect
  from public.entries
),
-- gaps-and-islands : les jours parfaits consécutifs partagent un îlot
islands as (
  select player_id, day,
         (day - (row_number() over (partition by player_id order by day))::int) as island
  from e
  where perfect
),
streaks as (
  select player_id, day,
         (row_number() over (partition by player_id, island order by day))::int as streak_pos
  from islands
)
select
  e.player_id,
  e.day,
  e.exos,
  e.perfect,
  coalesce(s.streak_pos, 0) as streak_pos,
  case when coalesce(s.streak_pos, 0) >= 7 then 2.0
       when coalesce(s.streak_pos, 0) >= 3 then 1.5
       else 1.0 end as multiplier,
  (e.exos + case when e.perfect then 2 else 0 end)
    * case when coalesce(s.streak_pos, 0) >= 7 then 2.0
           when coalesce(s.streak_pos, 0) >= 3 then 1.5
           else 1.0 end as points
from e
left join streaks s using (player_id, day);

-- -------------------------------------------------------------
-- Classement, bornes optionnelles (général, semaine, "à date").
-- Inclut tous les joueurs, même à 0 point. La série en cours est
-- toujours globale : aujourd'hui incomplet ne la casse pas encore.
-- -------------------------------------------------------------

create or replace function public.leaderboard(p_from date default null, p_until date default null)
returns table (
  player_id uuid,
  points numeric,
  rank bigint,
  perfect_days bigint,
  exos_done bigint,
  current_streak int
)
language sql
stable
set search_path = public
as $$
  with pts as (
    select dp.player_id,
           sum(dp.points) as points,
           count(*) filter (where dp.perfect) as perfect_days,
           sum(dp.exos) as exos_done
    from public.daily_points dp
    where (p_from is null or dp.day >= p_from)
      and (p_until is null or dp.day <= p_until)
    group by dp.player_id
  ),
  last_perfect as (
    select distinct on (dp.player_id) dp.player_id, dp.day, dp.streak_pos
    from public.daily_points dp
    where dp.perfect
    order by dp.player_id, dp.day desc
  )
  select
    p.id as player_id,
    round(coalesce(pts.points, 0), 1) as points,
    rank() over (order by coalesce(pts.points, 0) desc) as rank,
    coalesce(pts.perfect_days, 0) as perfect_days,
    coalesce(pts.exos_done, 0) as exos_done,
    case when lp.day >= (now() at time zone 'Europe/Paris')::date - 1
         then lp.streak_pos else 0 end as current_streak
  from public.players p
  left join pts on pts.player_id = p.id
  left join last_perfect lp on lp.player_id = p.id
$$;

-- -------------------------------------------------------------
-- Badges. Tous dérivés des entrées, rien à stocker : pas de
-- désynchronisation possible. 8 badges, pas 40.
-- -------------------------------------------------------------

create or replace view public.player_badges
with (security_invoker = true) as
with e as (
  select player_id, day,
         (pushups::int + abs::int + squats::int) as exos,
         (pushups and abs and squats) as perfect
  from public.entries
),
paris as (
  select (now() at time zone 'Europe/Paris')::date as today
),
elapsed as (
  select d::date as day
  from generate_series(
    date '2026-07-13',
    least((select today from paris), date '2026-08-31'),
    interval '1 day'
  ) d
),
islands as (
  select player_id, count(*) as len
  from (
    select player_id, day,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from e where perfect
  ) t
  group by player_id, island
),
-- classement cumulé jour par jour, pour "Premier de la classe"
grid as (
  select pl.id as player_id, d.day, coalesce(dp.points, 0) as pts
  from public.players pl
  cross join elapsed d
  left join public.daily_points dp on dp.player_id = pl.id and dp.day = d.day
),
dayrank as (
  select player_id, day,
         rank() over (partition by day order by cum_pts desc) as r
  from (
    select player_id, day,
           sum(pts) over (partition by player_id order by day) as cum_pts
    from grid
  ) c
),
top_runs as (
  select player_id, count(*) as len
  from (
    select player_id, day,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from dayrank where r = 1
  ) t
  group by player_id, island
)
select player_id, 'premiere_semaine' as badge
  from islands group by player_id having max(len) >= 7
union all
select player_id, 'machine'
  from islands group by player_id having max(len) >= 14
union all
select player_id, 'increvable'
  from islands group by player_id having max(len) >= 30
union all
select p.id, 'sans_faute'
  from public.players p
  where exists (select 1 from e where e.player_id = p.id and e.perfect)
    and not exists (
      select 1 from elapsed d
      where d.day < (select today from paris)
        and not exists (
          select 1 from e
          where e.player_id = p.id and e.day = d.day and e.perfect
        )
    )
union all
select player_id, 'retour_de_flamme'
  from islands where len >= 5
  group by player_id having count(*) >= 2
union all
select player_id, 'premier_de_la_classe'
  from top_runs group by player_id having max(len) >= 7
union all
select player_id, 'finisseur'
  from e where day = date '2026-08-31' and perfect
union all
select player_id, 'centurion'
  from e group by player_id having sum(exos) >= 100;

-- -------------------------------------------------------------
-- Notifications push : une subscription par joueur/appareil.
-- Les endpoints seuls ne permettent pas d'envoyer (clé VAPID
-- privée requise, côté serveur uniquement).
-- -------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy push_select on public.push_subscriptions
  for select to anon, authenticated using (true);
create policy push_insert on public.push_subscriptions
  for insert to anon, authenticated with check (true);
create policy push_update on public.push_subscriptions
  for update to anon, authenticated using (true) with check (true);
create policy push_delete on public.push_subscriptions
  for delete to anon, authenticated using (true);

-- -------------------------------------------------------------
-- Dernier rang connu de chaque joueur, pour détecter les
-- dépassements ("Sam vient de te passer").
-- -------------------------------------------------------------

create table public.rank_snapshots (
  player_id uuid primary key references public.players (id) on delete cascade,
  rank bigint not null,
  points numeric not null,
  updated_at timestamptz not null default now()
);

alter table public.rank_snapshots enable row level security;

create policy snap_select on public.rank_snapshots
  for select to anon, authenticated using (true);
create policy snap_insert on public.rank_snapshots
  for insert to anon, authenticated with check (true);
create policy snap_update on public.rank_snapshots
  for update to anon, authenticated using (true) with check (true);
