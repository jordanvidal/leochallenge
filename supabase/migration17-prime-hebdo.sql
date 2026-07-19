-- =============================================================
-- Migration 17 : la prime du vainqueur hebdo (+3 au général).
--
-- La semaine est devenue LA compétition (reset chaque lundi), mais
-- la gagner ne rapportait que du statut. Désormais le vainqueur de
-- la semaine prend +3 au général — gagner sa semaine fait avancer
-- la grande course, comme un duel gagné.
--
-- Mécanique, même pattern que le transfert de duel :
--   - la prime est POSÉE sur le dimanche de la semaine gagnée, via
--     le CTE extras de daily_points (fold ou ligne synthétique) ;
--   - le vainqueur = rang 1 du classement hebdo AFFICHÉ (points du
--     jeu + miroir + duels), la prime elle-même exclue du calcul —
--     pas de récursion, et le +3 ne peut pas changer qui gagne ;
--   - égalité au sommet = tous primés ;
--   - seulement les semaines CLOSES (lundi + 7 <= aujourd'hui) et
--     à partir de la S2 (lundi 20/07) : la S1 s'est jouée sous les
--     anciennes règles, on ne prime pas rétroactivement. Première
--     prime possible : dimanche 26/07, visible le lundi 27 au matin.
--
-- Le montant vit au catalogue ('prime_hebdo'), comme le duel.
-- daily_points et player_breakdown sont recopiés de la migration 15,
-- seuls les CTE de la prime s'ajoutent.
-- =============================================================

insert into public.bonus_catalog (key, kind, emoji, label, points, sort) values
  ('prime_hebdo', 'execution', '🏆', 'Semaine gagnée', 3, 18)
on conflict (key) do nothing;

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
-- 🔙 le retour : 3/3 aujourd'hui, zéro hier, et déjà présent avant hier.
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
-- 🤝 jour parfait collectif : la « bande du jour » = les joueurs actifs
-- sur 7 jours glissants (au moins une coche). Tous à 3/3 ce jour-là, et
-- au moins deux. Perfect ⇒ actif, donc le bonus va exactement aux 3/3.
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
first_done as (
  select distinct on (e.day) e.day, e.player_id
  from e, paris
  where e.done_ts is not null and e.day < paris.today
  order by e.day, e.done_ts
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
            then public.bonus_value('avant_8h') else 0 end
     + case when e.done_ts::time >= time '22:00'
            then public.bonus_value('apres_22h') else 0 end
     + case when tw.duration_seconds is not null
                 and tw.duration_seconds < public.bonus_value('cap_seance_20min')
            -- éclair : 5 pts figés pour la S1, valeur catalogue (2) ensuite
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_20min') end) else 0 end
     + case when fw.player_id is not null
            then public.bonus_value('seance_rapide') else 0 end
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
         -- depuis le 20/07 : ne double plus que la base du jour
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
-- Les points « posés » sur un jour sans passer par les entries :
-- le jour miroir (+8 au dernier) et les duels (+3 gagnant, −3 perdant,
-- posés sur le dimanche de la semaine jouée). Un match nul (winner
-- null) ne transfère rien.
extras_core as (
  select mw.player_id, mw.mday as day,
         public.bonus_value('jour_miroir') as pts
  from mirror_winner mw
  union all
  select dr.winner, dr.day, public.bonus_value('duel_hebdo')
  from public.duel_results dr
  where dr.winner is not null
  union all
  select dr.loser, dr.day, -public.bonus_value('duel_hebdo')
  from public.duel_results dr
  where dr.winner is not null
),
-- La prime hebdo : vainqueur du classement AFFICHÉ de chaque semaine
-- close depuis le 20/07 (points + miroir + duels, la prime elle-même
-- exclue — pas de récursion, le +3 ne peut pas changer qui gagne),
-- +3 posés sur le dimanche gagné. Égalité au sommet = tous primés.
closed_weeks as (
  select g.monday::date as monday
  from paris,
       generate_series(date '2026-07-20', paris.today, interval '7 days') as g(monday)
  where g.monday::date + 7 <= paris.today
),
week_standing as (
  select cw.monday, s.player_id, sum(s.pts) as pts
  from closed_weeks cw
  join (
    select player_id, day, pts from pmpts
    union all
    select player_id, day, pts from extras_core
  ) s on s.day between cw.monday and cw.monday + 6
  group by cw.monday, s.player_id
),
week_winner as (
  select monday, player_id
  from (
    select monday, player_id, pts,
           rank() over (partition by monday order by pts desc) as rk
    from week_standing
  ) r
  where rk = 1 and pts > 0
),
extras as (
  select player_id, day, pts from extras_core
  union all
  select ww.player_id, ww.monday + 6 as day,
         public.bonus_value('prime_hebdo') as pts
  from week_winner ww
),
extras_by_day as (
  select player_id, day, sum(pts) as pts
  from extras
  group by player_id, day
)
select
  pm.player_id,
  pm.day,
  pm.exos,
  pm.perfect,
  pm.streak_pos,
  pm.multiplier,
  pm.base_pts + pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + coalesce(x.pts, 0) as points,
  pm.base_pts as base_points,
  pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + coalesce(x.pts, 0) as bonus_points
from premirror pm
left join extras_by_day x on x.player_id = pm.player_id and x.day = pm.day
union all
-- Ligne synthétique : le joueur n'a ni entrée ni claim ce jour-là mais
-- des points l'attendent (miroir, ou perdant de duel sans coche le dimanche).
select
  x.player_id,
  x.day,
  0 as exos,
  false as perfect,
  0 as streak_pos,
  1.0 as multiplier,
  x.pts as points,
  0 as base_points,
  x.pts as bonus_points
from extras_by_day x
where not exists (
  select 1 from premirror pm
  where pm.player_id = x.player_id and pm.day = x.day
);

-- -------------------------------------------------------------
-- player_breakdown : même ajout, sinon le détail au classement ne
-- rendrait pas compte du +3 (CTE prime_mine, calqué sur duel_mine).
-- -------------------------------------------------------------

create or replace function public.player_breakdown(p_player uuid, p_from date default null, p_until date default null)
returns table (category text, item_key text, emoji text, label text, cnt bigint, points numeric)
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
  first_done as (
    select distinct on (e.day) e.day, e.player_id
    from e, paris
    where e.done_ts is not null and e.day < paris.today
    order by e.day, e.done_ts
  ),
  claims_day as (
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
      case when coalesce(st.streak_pos, 0) >= 7 then 2.0
           when coalesce(st.streak_pos, 0) >= 3 then 1.5
           else 1.0 end as multiplier,
      case when fd.player_id is not null then bonus_value('premier_du_jour') else 0 end as b_premier_du_jour,
      case when e.done_ts::time < time '08:00' then bonus_value('avant_8h') else 0 end as b_avant_8h,
      case when e.done_ts::time >= time '22:00' then bonus_value('apres_22h') else 0 end as b_apres_22h,
      case when tw.duration_seconds is not null
                and tw.duration_seconds < bonus_value('cap_seance_20min')
           -- éclair : 5 pts figés pour la S1, valeur catalogue (2) ensuite
           then (case when s.day < date '2026-07-20' then 5
                      else bonus_value('seance_20min') end) else 0 end as b_seance_20min,
      case when fw.player_id is not null then bonus_value('seance_rapide') else 0 end as b_seance_rapide,
      case when cb.player_id is not null then bonus_value('retour') else 0 end as b_retour,
      case when cd.day is not null and coalesce(e.perfect, false)
           then bonus_value('jour_parfait_collectif') else 0 end as b_collectif,
      case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
           then bonus_value('pompes_double') else 0 end as b_pompes_double,
      case when ev.event_key = 'happy_hour'
                and e.done_ts::time >= time '18:00'
                and e.done_ts::time < time '20:00'
           then bonus_value('happy_hour') else 0 end as b_happy_hour,
      case when ev.event_key = 'leve_tot'
                and e.done_ts::time < time '07:00'
           then bonus_value('leve_tot') else 0 end as b_leve_tot,
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
    left join claims_day c on c.player_id = s.player_id and c.day = s.day
    left join public.daily_events ev on ev.day = s.day
  ),
  premirror as (
    select
      player_id, day, exos, perfect, multiplier, event_key,
      (exos + case when perfect then 2 else 0 end) * multiplier as base_pts,
      b_premier_du_jour, b_avant_8h, b_apres_22h, b_seance_20min, b_seance_rapide,
      b_retour, b_collectif, b_pompes_double, b_happy_hour, b_leve_tot, claim_bonus,
      case when event_key = 'quitte_ou_double' and perfect
           -- depuis le 20/07 : ne double plus que la base du jour
           then (exos + case when perfect then 2 else 0 end) * multiplier
                + case when day < date '2026-07-20'
                       then b_premier_du_jour + b_avant_8h + b_apres_22h
                            + b_seance_20min + b_seance_rapide + b_retour
                            + b_collectif + b_pompes_double + b_happy_hour
                            + b_leve_tot + claim_bonus
                       else 0 end
           else 0 end as b_quitte_ou_double
    from base
  ),
  pmpts as (
    select player_id, day,
           base_pts + b_premier_du_jour + b_avant_8h + b_apres_22h + b_seance_20min
           + b_seance_rapide + b_retour + b_collectif + b_pompes_double + b_happy_hour
           + b_leve_tot + claim_bonus + b_quitte_ou_double as pts
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
  mine as (
    select * from premirror
    where player_id = p_player
      and (p_from is null or day >= p_from)
      and (p_until is null or day <= p_until)
  ),
  mirror_mine as (
    select mw.mday as day, bonus_value('jour_miroir') as v
    from mirror_winner mw
    where mw.player_id = p_player
      and (p_from is null or mw.mday >= p_from)
      and (p_until is null or mw.mday <= p_until)
  ),
  duel_mine as (
    select dr.day,
           case when dr.winner = p_player then bonus_value('duel_hebdo')
                else -bonus_value('duel_hebdo') end as v
    from public.duel_results dr
    where dr.winner is not null
      and p_player in (dr.player_a, dr.player_b)
      and (p_from is null or dr.day >= p_from)
      and (p_until is null or dr.day <= p_until)
  ),
  -- La prime hebdo : même calcul du vainqueur que daily_points
  -- (classement affiché, prime exclue), fenêtré sur le dimanche gagné.
  closed_weeks as (
    select g.monday::date as monday
    from paris,
         generate_series(date '2026-07-20', paris.today, interval '7 days') as g(monday)
    where g.monday::date + 7 <= paris.today
  ),
  week_standing as (
    select cw.monday, s.player_id, sum(s.pts) as pts
    from closed_weeks cw
    join (
      select player_id, day, pts from pmpts
      union all
      select mw.player_id, mw.mday as day, bonus_value('jour_miroir') as pts
      from mirror_winner mw
      union all
      select dr.winner, dr.day, bonus_value('duel_hebdo')
      from public.duel_results dr where dr.winner is not null
      union all
      select dr.loser, dr.day, -bonus_value('duel_hebdo')
      from public.duel_results dr where dr.winner is not null
    ) s on s.day between cw.monday and cw.monday + 6
    group by cw.monday, s.player_id
  ),
  week_winner as (
    select monday, player_id
    from (
      select monday, player_id, pts,
             rank() over (partition by monday order by pts desc) as rk
      from week_standing
    ) r
    where rk = 1 and pts > 0
  ),
  prime_mine as (
    select ww.monday + 6 as day, bonus_value('prime_hebdo') as v
    from week_winner ww
    where ww.player_id = p_player
      and (p_from is null or ww.monday + 6 >= p_from)
      and (p_until is null or ww.monday + 6 <= p_until)
  ),
  auto as (
    select 'premier_du_jour'::text as k, b_premier_du_jour as v from mine
    union all select 'avant_8h',         b_avant_8h         from mine
    union all select 'apres_22h',        b_apres_22h        from mine
    union all select 'seance_20min',     b_seance_20min     from mine
    union all select 'seance_rapide',    b_seance_rapide    from mine
    union all select 'retour',           b_retour           from mine
    union all select 'jour_parfait_collectif', b_collectif  from mine
    union all select 'pompes_double',    b_pompes_double    from mine
    union all select 'happy_hour',       b_happy_hour       from mine
    union all select 'leve_tot',         b_leve_tot         from mine
    union all select 'quitte_ou_double', b_quitte_ou_double from mine
    union all select 'jour_miroir',      v                  from mirror_mine
    union all select 'duel_hebdo',       v                  from duel_mine
    union all select 'prime_hebdo',      v                  from prime_mine
  ),
  claims as (
    select bc.bonus_key as k, count(*)::bigint as cnt, sum(bc.points) as pts
    from public.bonus_claims bc
    where bc.player_id = p_player
      and (p_from is null or bc.day >= p_from)
      and (p_until is null or bc.day <= p_until)
    group by bc.bonus_key
  ),
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
    select 'bonus'::text as category, a.k as item_key,
           cat.emoji, cat.label,
           count(*) filter (where a.v <> 0)::bigint as cnt,
           coalesce(sum(a.v), 0)::numeric as points
    from auto a
    join public.bonus_catalog cat on cat.key = a.k
    group by a.k, cat.emoji, cat.label
    union all
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
