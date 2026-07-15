-- =============================================================
-- Détail du classement — RPC player_breakdown.
-- Rejoue la logique de la vue daily_points (migration4b) SANS
-- écraser les bonus en un seul total : on ressort chaque source
-- (base, série, chaque bonus) avec son compte et ses points.
-- Une seule vérité : les montants viennent du catalogue, la
-- logique est la même que celle du classement. La somme des lignes
-- retombe pile sur le `points` de leaderboard().
--
-- Paramètres from/until : mêmes bornes que leaderboard(), pour que
-- l'overlay suive la vue active (Général vs Cette semaine).
-- =============================================================

drop function if exists public.player_breakdown(uuid, date, date);

create function public.player_breakdown(
  p_player uuid,
  p_from date default null,
  p_until date default null
)
returns table (
  category text,   -- 'base' | 'bonus'
  item_key text,   -- 'exos' | 'perfect' | 'streak' | clé catalogue
  emoji text,
  label text,
  cnt bigint,      -- nb de jours (ou nb d'exos pour 'exos')
  points numeric
)
language sql
stable
set search_path = public
as $$
  with paris as (
    select (now() at time zone 'Europe/Paris')::date as today
  ),
  e as (
    select player_id, day,
           (pushups::int + abs::int + squats::int) as exos,
           (pushups and abs and squats) as perfect,
           pushups,
           completed_at,
           case when completed_at is not null
                 and (completed_at at time zone 'Europe/Paris')::date = day
                then completed_at at time zone 'Europe/Paris'
           end as done_ts
    from public.entries
  ),
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
  ),
  spine as (
    select player_id, day from e
    union
    select player_id, day from public.bonus_claims
  ),
  first_done as (
    select distinct on (e.day) e.day, e.player_id
    from e, paris
    where e.done_ts is not null and e.day < paris.today
    order by e.day, e.done_ts
  ),
  solidarity as (
    select day
    from e
    group by day
    having bool_and(perfect)
       and count(*) = (select count(*) from public.players)
  ),
  timed as (
    select ws.player_id, ws.day, ws.duration_seconds, ws.finished_at
    from public.workout_sessions ws
    join e on e.player_id = ws.player_id and e.day = ws.day and e.perfect
    where ws.finished_at is not null
  ),
  fastest_session as (
    select distinct on (t.day) t.day, t.player_id
    from timed t, paris
    where t.day < paris.today
      and (select count(*) from timed t2 where t2.day = t.day) >= 2
    order by t.day, t.duration_seconds asc, t.finished_at asc
  ),
  -- Comme `scored` dans la vue, mais chaque bonus reste une colonne
  -- distincte au lieu d'être sommé.
  scored as (
    select
      s.player_id,
      s.day,
      coalesce(e.exos, 0) as exos,
      coalesce(e.perfect, false) as perfect,
      case when coalesce(st.streak_pos, 0) >= 7 then 2.0
           when coalesce(st.streak_pos, 0) >= 3 then 1.5
           else 1.0 end as multiplier,
      -- ⚡ exécution
      case when fd.player_id is not null then bonus_value('premier_du_jour') else 0 end as b_premier_du_jour,
      case when e.done_ts::time < time '08:00' then bonus_value('avant_8h') else 0 end as b_avant_8h,
      case when e.done_ts::time >= time '22:00' then bonus_value('apres_22h') else 0 end as b_apres_22h,
      case when tw.duration_seconds is not null
                and tw.duration_seconds < bonus_value('cap_seance_20min')
           then bonus_value('seance_20min') else 0 end as b_seance_20min,
      case when fw.player_id is not null then bonus_value('seance_rapide') else 0 end as b_seance_rapide,
      -- 🎲 événements
      case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
           then bonus_value('pompes_double') else 0 end as b_pompes_double,
      case when ev.event_key = 'happy_hour'
                and e.done_ts::time >= time '18:00'
                and e.done_ts::time < time '20:00'
           then bonus_value('happy_hour') else 0 end as b_happy_hour,
      case when ev.event_key = 'solidarite'
                and sol.day is not null
                and coalesce(e.perfect, false)
           then bonus_value('solidarite') else 0 end as b_solidarite
    from spine s
    left join e using (player_id, day)
    left join streaks st using (player_id, day)
    left join first_done fd on fd.day = s.day and fd.player_id = s.player_id
    left join timed tw on tw.player_id = s.player_id and tw.day = s.day
    left join fastest_session fw on fw.day = s.day and fw.player_id = s.player_id
    left join public.daily_events ev on ev.day = s.day
    left join solidarity sol on sol.day = s.day
  ),
  -- Restreint au joueur et à la fenêtre demandée.
  mine as (
    select * from scored
    where player_id = p_player
      and (p_from is null or day >= p_from)
      and (p_until is null or day <= p_until)
  ),
  -- Bonus auto dépliés en (clé, points-du-jour) via valeurs nommées.
  auto as (
    select 'premier_du_jour'::text as k, b_premier_du_jour as v from mine
    union all select 'avant_8h',      b_avant_8h      from mine
    union all select 'apres_22h',     b_apres_22h     from mine
    union all select 'seance_20min',  b_seance_20min  from mine
    union all select 'seance_rapide', b_seance_rapide from mine
    union all select 'pompes_double', b_pompes_double from mine
    union all select 'happy_hour',    b_happy_hour    from mine
    union all select 'solidarite',    b_solidarite    from mine
  ),
  -- 💪 bonus déclarés à la main (inclut le boss du dimanche).
  claims as (
    select bc.bonus_key as k, count(*)::bigint as cnt, sum(bc.points) as pts
    from public.bonus_claims bc
    where bc.player_id = p_player
      and (p_from is null or bc.day >= p_from)
      and (p_until is null or bc.day <= p_until)
    group by bc.bonus_key
  ),
  -- Base décomposée : exos (×1), journées parfaites (+2), série (uplift).
  -- exos + perfect + streak = somme des base_points du classement.
  base_rows as (
    select 'base'::text as category, 'exos'::text as item_key,
           '🎯'::text as emoji, 'Exos cochés'::text as label,
           coalesce(sum(exos), 0)::bigint as cnt,
           coalesce(sum(exos), 0)::numeric as points
    from mine
    union all
    select 'base', 'perfect', '✅', 'Journées parfaites',
           count(*) filter (where perfect)::bigint,
           coalesce(sum(case when perfect then 2 else 0 end), 0)::numeric
    from mine
    union all
    select 'base', 'streak', '🔥', 'Bonus de série',
           count(*) filter (where multiplier > 1)::bigint,
           coalesce(sum(
             (exos + case when perfect then 2 else 0 end) * (multiplier - 1)
           ), 0)::numeric
    from mine
  ),
  bonus_rows as (
    -- auto
    select 'bonus'::text as category, a.k as item_key,
           cat.emoji, cat.label,
           count(*) filter (where a.v > 0)::bigint as cnt,
           coalesce(sum(a.v), 0)::numeric as points
    from auto a
    join public.bonus_catalog cat on cat.key = a.k
    group by a.k, cat.emoji, cat.label
    union all
    -- déclarés
    select 'bonus', c.k, cat.emoji, cat.label, c.cnt, c.pts
    from claims c
    join public.bonus_catalog cat on cat.key = c.k
  )
  select category, item_key, emoji, label, cnt, round(points, 1) as points
  from base_rows
  where points <> 0 or cnt <> 0
  union all
  select category, item_key, emoji, label, cnt, round(points, 1) as points
  from bonus_rows
  where points <> 0;
$$;

grant execute on function public.player_breakdown(uuid, date, date) to anon, authenticated;
