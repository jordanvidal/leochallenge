-- =============================================================
-- Migration 19 : le départage des duels se joue aux points.
--
-- Constat à la veille du premier tirage : jours parfaits et total
-- d'exos sont tous deux plafonnés (7 et 21 par semaine). Entre deux
-- joueurs assidus — la majorité du groupe — le duel finissait nul
-- mécaniquement : personne ne pouvait faire PLUS que l'autre, il ne
-- restait qu'à attendre la faute. Sur la semaine du 13/07, trois
-- joueurs étaient à 7 parfaits / 21 exos : tous leurs duels auraient
-- été nuls.
--
-- Nouvelle échelle : jours parfaits d'abord (l'assiduité reste le
-- cœur du duel), puis POINTS DE LA SEMAINE en départage, sinon nul.
-- Les points sont déplafonnés (déclarations, quitte ou double,
-- tirages…) : le duel se gagne activement, pas par forfait.
--
-- Le décompte du départage = pmpts + jour miroir, c'est-à-dire
-- exactement le classement hebdo affiché dimanche soir. Le transfert
-- de duel et la prime hebdo en sont exclus : ils dépendent du
-- résultat du duel (daily_points lit duel_results — inclure ces
-- points créerait un cycle de vues), et ils tombent de toute façon
-- après la clôture. La chaîne de calcul est recopiée de la vue
-- daily_points (migration 18) jusqu'à mirror_winner — même précédent
-- de duplication que player_breakdown.
--
-- La table duels est vide à l'application (premier tirage le 20/07) :
-- aucun résultat historique n'est réécrit. Colonnes existantes
-- inchangées, points_a / points_b ajoutées en queue → replace, et
-- daily_points / player_breakdown (qui ne lisent que winner, loser,
-- day) sont intouchées.
-- =============================================================

create or replace view public.duel_results
with (security_invoker = true) as
with recursive paris as (
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
comeback as (
  select cur.player_id, cur.day
  from e cur
  where cur.perfect
    and not exists (
      select 1 from e prev
      where prev.player_id = cur.player_id
        and prev.day = cur.day - 1
        and prev.exos > 0
    )
    and exists (
      select 1 from e hist
      where hist.player_id = cur.player_id
        and hist.day < cur.day - 1
    )
),
active as (
  select distinct d.day, a.player_id
  from (select distinct day from e) d
  join e a on a.exos > 0 and a.day between d.day - 6 and d.day
),
collective_days as (
  select act.day
  from active act
  left join e cur on cur.player_id = act.player_id and cur.day = act.day
  group by act.day
  having count(*) >= 2
     and bool_and(coalesce(cur.perfect, false))
),
spine as (
  select player_id, day from e
  union
  select player_id, day from public.bonus_claims
),
-- Même rotation du trophée que daily_points (voir le commentaire
-- là-bas) : les deux doivent raconter la même histoire.
first_done_old as (
  select distinct on (e.day) e.day, e.player_id
  from e, paris
  where e.done_ts is not null and e.day < paris.today
    and e.day < date '2026-07-20'
  order by e.day, e.done_ts
),
finishers as (
  select e.day, e.player_id, e.done_ts
  from e, paris
  where e.done_ts is not null and e.day < paris.today
    and e.day >= date '2026-07-20'
),
first_rot as (
  select date '2026-07-20' as day,
         (select f.player_id from finishers f
          where f.day = date '2026-07-20'
          order by f.done_ts limit 1) as winner
  from paris
  where date '2026-07-20' < paris.today
  union all
  select r.day + 1,
         (select f.player_id from finishers f
          where f.day = r.day + 1
            and (r.winner is null or f.player_id <> r.winner)
          order by f.done_ts limit 1)
  from first_rot r
  where r.day + 1 < (select today from paris)
),
first_done as (
  select day, player_id from first_done_old
  union all
  select day, winner as player_id from first_rot where winner is not null
),
claims as (
  select player_id, day, sum(points) as pts
  from public.bonus_claims
  group by player_id, day
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
base as (
  select
    s.player_id,
    s.day,
    coalesce(e.exos, 0) as exos,
    coalesce(e.perfect, false) as perfect,
    coalesce(st.streak_pos, 0) as streak_pos,
    case when coalesce(st.streak_pos, 0) >= 7 then 2.0
         when coalesce(st.streak_pos, 0) >= 3 then 1.5
         else 1.0 end as multiplier,
    (case when fd.player_id is not null
          then public.bonus_value('premier_du_jour') else 0 end
     + case when e.done_ts::time < time '08:00'
                 and (s.day < date '2026-07-20' or fd.player_id is null)
            then public.bonus_value('avant_8h') else 0 end
     + case when e.done_ts::time >= time '22:00'
            then public.bonus_value('apres_22h') else 0 end
     + case when tw.duration_seconds is not null
                 and tw.duration_seconds < public.bonus_value('cap_seance_20min')
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_20min') end) else 0 end
     + case when fw.player_id is not null
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_rapide') end) else 0 end
     + case when cb.player_id is not null
            then public.bonus_value('retour') else 0 end
     + case when cd.day is not null and coalesce(e.perfect, false)
            then public.bonus_value('jour_parfait_collectif') else 0 end
    ) as execution_bonus,
    (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
          then public.bonus_value('pompes_double') else 0 end
     + case when ev.event_key = 'happy_hour'
                 and e.done_ts::time >= time '18:00'
                 and e.done_ts::time < time '20:00'
            then public.bonus_value('happy_hour') else 0 end
     + case when ev.event_key = 'leve_tot'
                 and e.done_ts::time < time '07:00'
            then public.bonus_value('leve_tot') else 0 end
    ) as event_bonus,
    coalesce(c.pts, 0) as claim_bonus,
    ev.event_key
  from spine s
  left join e using (player_id, day)
  left join streaks st using (player_id, day)
  left join comeback cb on cb.player_id = s.player_id and cb.day = s.day
  left join collective_days cd on cd.day = s.day
  left join first_done fd on fd.day = s.day and fd.player_id = s.player_id
  left join timed tw on tw.player_id = s.player_id and tw.day = s.day
  left join fastest_session fw on fw.day = s.day and fw.player_id = s.player_id
  left join claims c on c.player_id = s.player_id and c.day = s.day
  left join public.daily_events ev on ev.day = s.day
),
premirror as (
  select
    player_id, day, exos, perfect, streak_pos, multiplier, event_key,
    (exos + case when perfect then 2 else 0 end) * multiplier as base_pts,
    execution_bonus, event_bonus, claim_bonus,
    case when event_key = 'quitte_ou_double' and perfect
         then (exos + case when perfect then 2 else 0 end) * multiplier
              + case when day < date '2026-07-20'
                     then execution_bonus + event_bonus + claim_bonus
                     else 0 end
         else 0 end as quitte_bonus
  from base
),
pmpts as (
  select player_id, day,
         base_pts + execution_bonus + event_bonus + claim_bonus + quitte_bonus as pts
  from premirror
),
mirror_days as (
  select de.day
  from public.daily_events de, paris
  where de.event_key = 'jour_miroir' and de.day < paris.today
),
standings as (
  select md.day as mday, p.id as player_id,
         coalesce(sum(pm.pts), 0) as cum
  from mirror_days md
  cross join public.players p
  left join pmpts pm on pm.player_id = p.id and pm.day < md.day
  group by md.day, p.id
),
mirror_winner as (
  select distinct on (mday) mday, player_id
  from standings
  order by mday, cum asc, player_id
),
-- Les points « affichés » d'un jour, hors duel et prime hebdo : ce que
-- le classement de la semaine montre dimanche soir, avant transferts.
weekpts as (
  select player_id, day, pts from pmpts
  union all
  select mw.player_id, mw.mday as day, public.bonus_value('jour_miroir') as pts
  from mirror_winner mw
),
finished as (
  select d.id, d.week_monday, d.player_a, d.player_b
  from public.duels d, paris
  where d.player_b is not null
    and d.week_monday + 7 <= paris.today
),
tally as (
  select
    f.id, f.week_monday, f.player_a, f.player_b,
    count(*) filter (where en.player_id = f.player_a
                       and en.pushups and en.abs and en.squats)::int as perfect_a,
    count(*) filter (where en.player_id = f.player_b
                       and en.pushups and en.abs and en.squats)::int as perfect_b,
    coalesce(sum(en.pushups::int + en.abs::int + en.squats::int)
               filter (where en.player_id = f.player_a), 0)::int as exos_a,
    coalesce(sum(en.pushups::int + en.abs::int + en.squats::int)
               filter (where en.player_id = f.player_b), 0)::int as exos_b
  from finished f
  left join public.entries en
    on en.player_id in (f.player_a, f.player_b)
   and en.day between f.week_monday and f.week_monday + 6
  group by f.id, f.week_monday, f.player_a, f.player_b
),
duel_points as (
  select
    f.id,
    coalesce(sum(w.pts) filter (where w.player_id = f.player_a), 0) as points_a,
    coalesce(sum(w.pts) filter (where w.player_id = f.player_b), 0) as points_b
  from finished f
  left join weekpts w
    on w.player_id in (f.player_a, f.player_b)
   and w.day between f.week_monday and f.week_monday + 6
  group by f.id
)
select
  t.id, t.week_monday,
  (t.week_monday + 6)::date as day, -- le dimanche : jour où le transfert est posé
  t.player_a, t.player_b, t.perfect_a, t.perfect_b, t.exos_a, t.exos_b,
  case when t.perfect_a > t.perfect_b then t.player_a
       when t.perfect_b > t.perfect_a then t.player_b
       when p.points_a > p.points_b then t.player_a
       when p.points_b > p.points_a then t.player_b end as winner,
  case when t.perfect_a > t.perfect_b then t.player_b
       when t.perfect_b > t.perfect_a then t.player_a
       when p.points_a > p.points_b then t.player_b
       when p.points_b > p.points_a then t.player_a end as loser,
  (t.perfect_a = t.perfect_b) as tiebreak_used,
  round(p.points_a, 1) as points_a,
  round(p.points_b, 1) as points_b
from tally t
join duel_points p using (id);
