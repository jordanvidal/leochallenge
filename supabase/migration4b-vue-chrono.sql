-- =============================================================
-- Phase séance guidée — 2/2 : la vue daily_points recréée.
-- À appliquer APRÈS migration4-seance.sql (dépend des tables
-- workout_sessions et des lignes catalogue seance_*).
-- Mêmes colonnes qu'avant : leaderboard() et player_badges
-- continuent de marcher sans changement.
-- =============================================================

-- -------------------------------------------------------------
-- 4. Vue daily_points recréée : mêmes colonnes, les deux bonus
--    chrono rejoignent le bonus d'exécution. Conditions :
--      · seance_20min : séance clôturée + journée parfaite + durée
--        sous le seuil. La journée parfaite est exigée pour qu'une
--        mini-config (4 × 10) ne rapporte pas un bonus chrono.
--      · seance_rapide : la plus rapide parmi les séances clôturées
--        des journées parfaites, jours révolus uniquement, et
--        seulement s'il y en a eu AU MOINS DEUX ce jour-là (être
--        seul ne fait pas de toi le plus rapide).
-- -------------------------------------------------------------

create or replace view public.daily_points
with (security_invoker = true) as
with paris as (
  select (now() at time zone 'Europe/Paris')::date as today
),
e as (
  select player_id, day,
         (pushups::int + abs::int + squats::int) as exos,
         (pushups and abs and squats) as perfect,
         pushups,
         completed_at,
         -- heure locale Paris de complétion, seulement si même jour civil
         case when completed_at is not null
               and (completed_at at time zone 'Europe/Paris')::date = day
              then completed_at at time zone 'Europe/Paris'
         end as done_ts
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
),
-- épine dorsale : un jour existe s'il a une entrée OU un bonus déclaré
spine as (
  select player_id, day from e
  union
  select player_id, day from public.bonus_claims
),
-- premier à terminer : uniquement les jours révolus
first_done as (
  select distinct on (e.day) e.day, e.player_id
  from e, paris
  where e.done_ts is not null and e.day < paris.today
  order by e.day, e.done_ts
),
-- jour de solidarité : TOUT le monde à 3/3
solidarity as (
  select day
  from e
  group by day
  having bool_and(perfect)
     and count(*) = (select count(*) from public.players)
),
claims as (
  select player_id, day, sum(points) as pts
  from public.bonus_claims
  group by player_id, day
),
-- ⏱️ séances éligibles au chrono : clôturées ET journée parfaite
timed as (
  select ws.player_id, ws.day, ws.duration_seconds, ws.finished_at
  from public.workout_sessions ws
  join e on e.player_id = ws.player_id and e.day = ws.day and e.perfect
  where ws.finished_at is not null
),
-- 🥇 la plus rapide du jour : jours révolus, minimum 2 séances
fastest_session as (
  select distinct on (t.day) t.day, t.player_id
  from timed t, paris
  where t.day < paris.today
    and (select count(*) from timed t2 where t2.day = t.day) >= 2
  order by t.day, t.duration_seconds asc, t.finished_at asc
),
scored as (
  select
    s.player_id,
    s.day,
    coalesce(e.exos, 0) as exos,
    coalesce(e.perfect, false) as perfect,
    coalesce(st.streak_pos, 0) as streak_pos,
    case when coalesce(st.streak_pos, 0) >= 7 then 2.0
         when coalesce(st.streak_pos, 0) >= 3 then 1.5
         else 1.0 end as multiplier,
    -- ⚡ bonus d'exécution, montants lus au catalogue
    (case when fd.player_id is not null
          then public.bonus_value('premier_du_jour') else 0 end
     + case when e.done_ts::time < time '08:00'
            then public.bonus_value('avant_8h') else 0 end
     + case when e.done_ts::time >= time '22:00'
            then public.bonus_value('apres_22h') else 0 end
     + case when tw.duration_seconds is not null
                 and tw.duration_seconds < public.bonus_value('cap_seance_20min')
            then public.bonus_value('seance_20min') else 0 end
     + case when fw.player_id is not null
            then public.bonus_value('seance_rapide') else 0 end
    ) as execution_bonus,
    -- 🎲 bonus événementiels automatiques
    (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
          then public.bonus_value('pompes_double') else 0 end
     + case when ev.event_key = 'happy_hour'
                 and e.done_ts::time >= time '18:00'
                 and e.done_ts::time < time '20:00'
            then public.bonus_value('happy_hour') else 0 end
     + case when ev.event_key = 'solidarite'
                 and sol.day is not null
                 and coalesce(e.perfect, false)
            then public.bonus_value('solidarite') else 0 end
    ) as event_bonus,
    -- 💪 bonus déclarés (montants figés à la déclaration)
    coalesce(c.pts, 0) as claim_bonus
  from spine s
  left join e using (player_id, day)
  left join streaks st using (player_id, day)
  left join first_done fd on fd.day = s.day and fd.player_id = s.player_id
  left join timed tw on tw.player_id = s.player_id and tw.day = s.day
  left join fastest_session fw on fw.day = s.day and fw.player_id = s.player_id
  left join claims c on c.player_id = s.player_id and c.day = s.day
  left join public.daily_events ev on ev.day = s.day
  left join solidarity sol on sol.day = s.day
)
select
  player_id,
  day,
  exos,
  perfect,
  streak_pos,
  multiplier,
  (exos + case when perfect then 2 else 0 end) * multiplier
    + execution_bonus + event_bonus + claim_bonus as points,
  (exos + case when perfect then 2 else 0 end) * multiplier as base_points,
  execution_bonus + event_bonus + claim_bonus as bonus_points
from scored;
