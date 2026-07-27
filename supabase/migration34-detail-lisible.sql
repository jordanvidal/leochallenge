-- =============================================================
-- Migration 34 — chaque ligne du détail porte ses propres points
-- =============================================================
-- Ne touche QUE player_breakdown, la fonction du seul écran « d'où
-- viennent mes points ». Aucun point ne change de main : ni la vue
-- daily_points, ni le classement, ni le total d'un joueur ne bougent.
-- C'est une migration d'affichage.
--
-- Le problème, vu sur l'écran de Jordan le 27/07 :
--
--     🎲 Les squats comptent double     10
--     🦵 +100 squats                     4
--     🧗 100 mountain climbers           4
--     🐸 50 squats jump                  4
--
--   Les 10 de la ligne 🎲 empilaient trois choses sans le dire : la
--   coche squats doublée (2), et les points de +100 squats (4) et de
--   50 squats jump (4) versés une seconde fois. Les deux puces
--   concernées s'affichaient quand même en dessous à leur prix
--   nominal. « +100 squats → 4 » alors qu'elle a rapporté 8 : chaque
--   ligne était vraie de son côté, aucune ne disait la vérité entière,
--   et rien ne distinguait la puce doublée du mountain climbers qui,
--   lui, ne l'était pas.
--
-- Après :
--
--     🦵 +100 squats            ×2       8
--     🐸 50 squats jump         ×2       8
--     🧗 100 mountain climbers           4
--     🎲 Coche squats doublée            2
--
--   Les points doublés retournent à la puce qui les a gagnés, et la
--   ligne 🎲 ne garde que ce qu'elle crée elle-même : la coche.
--
-- Deux conséquences techniques :
--
--   · La fonction rend une colonne de plus, `doubled` — la part de la
--     ligne qui vient du doublement. C'est elle qui allume le badge ×2
--     dans l'appli. Un type de retour ne se change pas avec « create or
--     replace » : il faut déposer la fonction d'abord, d'où le drop.
--
--   · Les points doublés RESTENT comptés au niveau du jour, dans une
--     colonne b_claims_double. La fonction ne sert pas qu'à afficher :
--     elle rejoue les totaux quotidiens pour attribuer la prime hebdo
--     et le jour miroir. Déplacer ces points sans les garder là aurait
--     changé un vainqueur de semaine pour une question de mise en page.
-- -------------------------------------------------------------

-- La signature gagne une colonne : « create or replace » ne sait pas
-- changer le type de retour d'une fonction, il faut la déposer d'abord.
drop function if exists public.player_breakdown(uuid, date, date);

create or replace function public.player_breakdown(p_player uuid, p_from date default null, p_until date default null)
returns table (category text, item_key text, emoji text, label text, cnt bigint, points numeric, doubled numeric)
language sql
stable
set search_path = public
as $$
  with recursive paris as (
    select (now() at time zone 'Europe/Paris')::date as today
  ),
  e as (
    select player_id, day,
           (pushups::int + abs::int + squats::int) as exos,
           (pushups and abs and squats) as perfect,
           pushups,
           abs,
           squats,
           completed_at,
           case when completed_at is not null
                 and (completed_at at time zone 'Europe/Paris')::date = day
                then completed_at at time zone 'Europe/Paris'
           end as done_ts
    from public.entries
  ),
  -- ---- La série et le joker, mot pour mot comme dans daily_points.
  -- Le détail rejoue le calcul du total : s'il ignore le joker, il
  -- fait repartir la série de 1 après le jour sauvé et annonce un
  -- multiplicateur que personne n'a eu. Vu le 27/07 sur la ligne 🎲 :
  -- 5,5 dans le détail, 6 au classement.
  base_islands as (
    select player_id, day,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from e
    where perfect
  ),
  base_streaks as (
    select player_id, day,
           (row_number() over (partition by player_id, island order by day))::int as pos
    from base_islands
  ),
  joker as (
    select distinct on (bs.player_id)
           bs.player_id, (bs.day + 1) as day
    from base_streaks bs
    where bs.pos >= 3
      and not exists (
        select 1 from e gap
        where gap.player_id = bs.player_id and gap.day = bs.day + 1 and gap.perfect
      )
      and exists (
        select 1 from e back
        where back.player_id = bs.player_id and back.day = bs.day + 2 and back.perfect
      )
    order by bs.player_id, bs.day
  ),
  kept as (
    select player_id, day, true as is_perfect from e where perfect
    union all
    select player_id, day, false as is_perfect from joker
  ),
  islands as (
    select player_id, day, is_perfect,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from kept
  ),
  -- Le jour joker est retiré AVANT la numérotation : il tient la
  -- chaîne sans consommer de rang.
  streaks as (
    select player_id, day,
           (row_number() over (partition by player_id, island order by day))::int as streak_pos
    from islands
    where is_perfect
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
  -- Les puces doublées du jour, rangées par tirage : même CTE que
  -- dans la vue, même colonne de catalogue.
  claims_double as (
    select bc.player_id, bc.day, cat.double_event, sum(bc.points) as pts
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    where cat.double_event is not null
    group by bc.player_id, bc.day, cat.double_event
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
      -- premier du jour : retiré au 27/07 (S3), borné comme dans daily_points.
      case when s.day < date '2026-07-27' and fd.player_id is not null then bonus_value('premier_du_jour') else 0 end as b_premier_du_jour,
      -- dès le 20/07, ne se cumule plus avec « premier du jour »
      -- avant 8h / après 22h : retirés au 27/07 (S3), bornés ici comme
      -- dans daily_points — le détail doit raconter la même histoire
      -- que le total, sinon l'écran « d'où viennent mes points » ment.
      case when s.day < date '2026-07-27'
                and e.done_ts::time < time '08:00'
                and (s.day < date '2026-07-20' or fd.player_id is null)
           then bonus_value('avant_8h') else 0 end as b_avant_8h,
      case when s.day < date '2026-07-27'
                and e.done_ts::time >= time '22:00'
           then bonus_value('apres_22h') else 0 end as b_apres_22h,
      -- éclair : retiré au 27/07 (S3)
      case when s.day < date '2026-07-27'
                and tw.duration_seconds is not null
                and tw.duration_seconds < bonus_value('cap_seance_20min')
           -- éclair : 5 pts figés pour la S1, valeur catalogue (2) ensuite
           then (case when s.day < date '2026-07-20' then 5
                      else bonus_value('seance_20min') end) else 0 end as b_seance_20min,
      -- rapide : retirée au 27/07 (S3), bornée comme dans daily_points.
      -- (5 pts figés pour la S1, valeur catalogue (2) du 20/07 au 26/07.)
      case when s.day < date '2026-07-27' and fw.player_id is not null
           then (case when s.day < date '2026-07-20' then 5
                      else bonus_value('seance_rapide') end) else 0 end as b_seance_rapide,
      case when cb.player_id is not null then bonus_value('retour') else 0 end as b_retour,
      -- collectif : retiré au 27/07 (S3), bornée comme dans daily_points.
      case when s.day < date '2026-07-27'
                and cd.day is not null and coalesce(e.perfect, false)
           then bonus_value('jour_parfait_collectif') else 0 end as b_collectif,
      -- 🎲 L'exo doublé : ici, la COCHE doublée et rien d'autre. Elle
      -- suit la série (à ×2, doubler une coche qui vaut 2 ajoute 2).
      -- Ce que l'événement double par ailleurs — les puces déclarées de
      -- l'exo — descend sur les puces elles-mêmes, plus bas : c'est la
      -- puce qu'on a cochée, c'est elle qui doit afficher ce qu'elle a
      -- rapporté. Trois colonnes séparées ici, contrairement à la vue :
      -- le détail « d'où viennent mes points » nomme l'exo tiré.
      (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
            then bonus_value('pompes_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
      ) as b_pompes_double,
      -- Les deux sœurs de la S3, même logique sur l'exo tiré.
      (case when ev.event_key = 'abdos_double' and coalesce(e.abs, false)
            then bonus_value('abdos_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
      ) as b_abdos_double,
      (case when ev.event_key = 'squats_double' and coalesce(e.squats, false)
            then bonus_value('squats_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
      ) as b_squats_double,
      -- Les puces doublées du jour. Elles restent comptées ici pour que
      -- le total du jour ne bouge pas d'un pouce (la prime hebdo et le
      -- jour miroir se calculent dessus), mais elles ne sortent plus en
      -- ligne d'événement : chaque puce porte ses propres points, plus
      -- bas. Une ligne « +100 squats » qui affiche 4 quand elle en a
      -- rapporté 8 est une ligne qui ment poliment.
      case when s.day >= date '2026-07-27'
           then coalesce(dcl.pts, 0) else 0 end as b_claims_double,
      case when s.day < date '2026-07-27' and ev.event_key = 'happy_hour'
                and e.done_ts::time >= time '18:00'
                and e.done_ts::time < time '20:00'
           then bonus_value('happy_hour') else 0 end as b_happy_hour,
      case when s.day < date '2026-07-27' and ev.event_key = 'leve_tot'
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
    -- L'événement avant les puces qu'il double, comme dans la vue.
    left join public.daily_events ev on ev.day = s.day
    left join claims_double dcl on dcl.player_id = s.player_id
                               and dcl.day = s.day
                               and dcl.double_event = ev.event_key
  ),
  premirror as (
    select
      player_id, day, exos, perfect, multiplier, event_key,
      -- Journée parfaite : +2 jusqu'au 26/07, +4 dès le 27/07 (S3).
      (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier as base_pts,
      b_premier_du_jour, b_avant_8h, b_apres_22h, b_seance_20min, b_seance_rapide,
      b_retour, b_collectif, b_pompes_double, b_abdos_double, b_squats_double,
      b_claims_double, b_happy_hour, b_leve_tot, claim_bonus,
      case when event_key = 'quitte_ou_double' and perfect
           -- depuis le 20/07 : ne double plus que la base du jour
           then (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier
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
           + b_seance_rapide + b_retour + b_collectif + b_pompes_double
           + b_abdos_double + b_squats_double + b_claims_double + b_happy_hour
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
  -- 📅 La semaine pleine (S3), même calcul que dans daily_points :
  -- 7 jours parfaits sur une semaine close (lundi ≥ 27/07), +5 le
  -- dimanche. Comptée dans week_standing plus bas, comme la vue.
  full_weeks as (
    select g.monday::date as monday, en.player_id
    from paris,
         generate_series(date '2026-07-27', paris.today, interval '7 days') as g(monday)
    join e en on en.perfect and en.day between g.monday::date and g.monday::date + 6
    where g.monday::date + 7 <= paris.today
    group by g.monday::date, en.player_id
    having count(*) = 7
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
      union all
      select fw.player_id, fw.monday + 6 as day, bonus_value('semaine_pleine') as pts
      from full_weeks fw
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
  semaine_mine as (
    select fw.monday + 6 as day, bonus_value('semaine_pleine') as v
    from full_weeks fw
    where fw.player_id = p_player
      and (p_from is null or fw.monday + 6 >= p_from)
      and (p_until is null or fw.monday + 6 <= p_until)
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
    union all select 'abdos_double',     b_abdos_double     from mine
    union all select 'squats_double',    b_squats_double    from mine
    union all select 'happy_hour',       b_happy_hour       from mine
    union all select 'leve_tot',         b_leve_tot         from mine
    union all select 'quitte_ou_double', b_quitte_ou_double from mine
    union all select 'jour_miroir',      v                  from mirror_mine
    union all select 'duel_hebdo',       v                  from duel_mine
    union all select 'prime_hebdo',      v                  from prime_mine
    union all select 'semaine_pleine',   v                  from semaine_mine
  ),
  claims as (
    select bc.bonus_key as k, count(*)::bigint as cnt, sum(bc.points) as pts,
           -- Les fois où le tirage du jour doublait cette puce : ses points
           -- sont versés une seconde fois, et ils lui appartiennent — c'est
           -- elle qu'on a cochée. Même somme que b_claims_double vu du jour,
           -- rangée par puce au lieu d'être rangée par date.
           sum(case when bc.day >= date '2026-07-27'
                         and ev.event_key = cat.double_event
                    then bc.points else 0 end) as pts_double
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    left join public.daily_events ev on ev.day = bc.day
    where bc.player_id = p_player
      and (p_from is null or bc.day >= p_from)
      and (p_until is null or bc.day <= p_until)
    group by bc.bonus_key
  ),
  base_rows as (
    select 'base'::text as category, 'exos'::text as item_key,
           '🎯'::text as emoji, 'Exos cochés'::text as label,
           coalesce(sum(exos), 0)::bigint as cnt,
           coalesce(sum(exos), 0)::numeric as points,
           0::numeric as doubled
    from mine
    union all
    select 'base', 'perfect', '✅', 'Journées parfaites',
           count(*) filter (where perfect)::bigint,
           -- +2 jusqu'au 26/07, +4 dès le 27/07 (S3), comme base_pts.
           coalesce(sum(case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end), 0)::numeric,
           0::numeric
    from mine
    union all
    select 'base', 'streak', '🔥', 'Bonus de série',
           count(*) filter (where multiplier > 1)::bigint,
           -- Le surplus de multiplicateur reconstruit la base : même
           -- montant de journée parfaite daté, sinon détail ≠ total.
           coalesce(sum(
             (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * (multiplier - 1)
           ), 0)::numeric,
           0::numeric
    from mine
  ),
  bonus_rows as (
    select 'bonus'::text as category, a.k as item_key,
           cat.emoji, cat.label,
           count(*) filter (where a.v <> 0)::bigint as cnt,
           coalesce(sum(a.v), 0)::numeric as points,
           0::numeric as doubled
    from auto a
    join public.bonus_catalog cat on cat.key = a.k
    group by a.k, cat.emoji, cat.label
    union all
    select 'bonus', c.k, cat.emoji, cat.label, c.cnt,
           c.pts + c.pts_double, c.pts_double
    from claims c
    join public.bonus_catalog cat on cat.key = c.k
  )
  select category, item_key, emoji, label, cnt, round(points, 1) as points,
         round(doubled, 1) as doubled
  from base_rows
  where points <> 0 or cnt <> 0
  union all
  select category, item_key, emoji, label, cnt, round(points, 1) as points,
         round(doubled, 1) as doubled
  from bonus_rows
  where points <> 0;
$$;