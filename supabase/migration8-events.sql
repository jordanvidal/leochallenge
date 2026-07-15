-- =============================================================
-- Phase événements — migration ADDITIVE au système de bonus.
-- Trois nouveaux événements quotidiens, un retrait, zéro impact
-- rétroactif (la solidarité n'a jamais été tirée en prod).
--
--   ➖ solidarite       : retiré du tirage, du scoring et du catalogue.
--   ➕ leve_tot     🌄  : séance finie avant 7h → +6 (cumulable avant_8h).
--   ➕ quitte_ou_double 🎰 : si 3/3, TOUS les points du jour comptent
--                        double (socle + exécution + événement + déclarés).
--                        Modélisé en bonus additif = le total du jour.
--                        Pas de 3/3 → rien ne double, aucune pénalité.
--   ➕ jour_miroir  🪞  : le DERNIER du classement général (cumul hors
--                        miroir, jours révolus) est reboosté de +8, qu'il
--                        ait joué ce jour-là ou non.
--
-- Rien d'existant ne change de valeur : ces événements ne tombent
-- que sur les jours où le tirage les désigne, à partir de maintenant.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Catalogue : les trois nouvelles lignes, la solidarité retirée.
--    quitte_ou_double a un montant nul : sa valeur est dynamique
--    (le total du jour), l'affichage montre « ×2 », pas « +0 ».
-- -------------------------------------------------------------

insert into public.bonus_catalog (key, kind, emoji, label, points, sort) values
  ('leve_tot',         'event', '🌄', 'Lève-tôt : séance finie avant 7h',            6, 24),
  ('quitte_ou_double', 'event', '🎰', 'Quitte ou double : tous tes points du jour ×2 si 3/3', 0, 25),
  ('jour_miroir',      'event', '🪞', 'Jour miroir : le dernier au classement est reboosté', 8, 26)
on conflict (key) do update
  set kind = excluded.kind, emoji = excluded.emoji,
      label = excluded.label, points = excluded.points, sort = excluded.sort;

-- La solidarité disparaît du catalogue (jamais déclarée, jamais tirée).
delete from public.bonus_catalog where key = 'solidarite';

-- -------------------------------------------------------------
-- 2. Tirage du jour : mêmes règles (paresseux, atomique), nouvelle
--    table des probabilités. Plus de solidarité. Le boss reste
--    l'exclusivité du dimanche.
-- -------------------------------------------------------------

create or replace function public.get_daily_event()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  existing text;
  r double precision;
  drawn text;
begin
  if paris_today < date '2026-07-13' or paris_today > date '2026-08-31' then
    return null;
  end if;

  select event_key into existing from public.daily_events where day = paris_today;
  if found then
    return existing;
  end if;

  -- 40 % des jours : rien. Un événement quotidien n'est plus un événement.
  -- Le boss n'existe que le dimanche.
  r := random();
  if extract(isodow from paris_today) = 7 then
    drawn := case
      when r < 0.40 then 'rien'
      when r < 0.65 then 'boss_dimanche'
      when r < 0.75 then 'pompes_double'
      when r < 0.83 then 'happy_hour'
      when r < 0.90 then 'leve_tot'
      when r < 0.95 then 'quitte_ou_double'
      else 'jour_miroir'
    end;
  else
    drawn := case
      when r < 0.40 then 'rien'
      when r < 0.55 then 'pompes_double'
      when r < 0.70 then 'happy_hour'
      when r < 0.82 then 'leve_tot'
      when r < 0.92 then 'quitte_ou_double'
      else 'jour_miroir'
    end;
  end if;

  -- Deux clients qui tirent en même temps : le premier inséré gagne.
  insert into public.daily_events (day, event_key)
  values (paris_today, drawn)
  on conflict (day) do nothing;

  select event_key into existing from public.daily_events where day = paris_today;
  return existing;
end;
$$;

grant execute on function public.get_daily_event() to anon, authenticated;

-- -------------------------------------------------------------
-- 3. Vue daily_points recréée. Reprend migration4b (chrono) et :
--     · retire la solidarité ;
--     · ajoute leve_tot dans le bonus événementiel ;
--     · ajoute le doublement quitte_ou_double (bonus additif = le
--       total du jour, donc points ×2 quand la journée est parfaite) ;
--     · ajoute le rattrapage jour_miroir au dernier du classement.
--
--   Ordre de calcul important : le « dernier du classement » se
--   mesure sur le cumul HORS miroir (sinon la vue se référencerait
--   elle-même). Le quitte, lui, compte dans ce cumul : ce sont de
--   vrais points.
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
-- Socle + bonus d'exécution + événement additif + déclarés. PAS de
-- doublement quitte ni de miroir ici : ces deux-là s'appliquent ensuite.
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
    -- ⚡ exécution (toujours actifs, montants au catalogue)
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
    -- 🎲 événements additifs (seulement si le tirage les désigne)
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
  left join first_done fd on fd.day = s.day and fd.player_id = s.player_id
  left join timed tw on tw.player_id = s.player_id and tw.day = s.day
  left join fastest_session fw on fw.day = s.day and fw.player_id = s.player_id
  left join claims c on c.player_id = s.player_id and c.day = s.day
  left join public.daily_events ev on ev.day = s.day
),
-- Socle chiffré + doublement quitte (le bonus vaut tout le reste du
-- jour, ce qui fait bien ×2 une fois ajouté).
premirror as (
  select
    player_id, day, exos, perfect, streak_pos, multiplier, event_key,
    (exos + case when perfect then 2 else 0 end) * multiplier as base_pts,
    execution_bonus, event_bonus, claim_bonus,
    case when event_key = 'quitte_ou_double' and perfect
         then (exos + case when perfect then 2 else 0 end) * multiplier
              + execution_bonus + event_bonus + claim_bonus
         else 0 end as quitte_bonus
  from base
),
-- Points du jour hors miroir (doublement quitte inclus).
pmpts as (
  select player_id, day,
         base_pts + execution_bonus + event_bonus + claim_bonus + quitte_bonus as pts
  from premirror
),
-- Jours miroir révolus.
mirror_days as (
  select de.day
  from public.daily_events de, paris
  where de.event_key = 'jour_miroir' and de.day < paris.today
),
-- Classement général (cumul hors miroir) juste AVANT chaque jour miroir,
-- tous les joueurs (0 s'ils n'ont rien marqué). Le plus bas = le dernier.
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
)
-- Lignes réelles : chaque jour joué, plus le miroir si le joueur est
-- le dernier ce jour-là.
select
  pm.player_id,
  pm.day,
  pm.exos,
  pm.perfect,
  pm.streak_pos,
  pm.multiplier,
  pm.base_pts
    + pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + case when mw.player_id is not null then public.bonus_value('jour_miroir') else 0 end
    as points,
  pm.base_pts as base_points,
  pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + case when mw.player_id is not null then public.bonus_value('jour_miroir') else 0 end
    as bonus_points
from premirror pm
left join mirror_winner mw on mw.mday = pm.day and mw.player_id = pm.player_id
union all
-- Le dernier n'a rien joué le jour miroir : il touche quand même son
-- rattrapage, sur une ligne synthétique (socle nul, juste le bonus).
select
  mw.player_id,
  mw.mday as day,
  0 as exos,
  false as perfect,
  0 as streak_pos,
  1.0 as multiplier,
  public.bonus_value('jour_miroir') as points,
  0 as base_points,
  public.bonus_value('jour_miroir') as bonus_points
from mirror_winner mw
where not exists (
  select 1 from premirror pm
  where pm.player_id = mw.player_id and pm.day = mw.mday
);

-- -------------------------------------------------------------
-- 4. player_breakdown recréé : même logique que la vue, chaque bonus
--    reste une ligne. Rejoue standings/mirror pour attribuer le miroir
--    au joueur demandé, y compris les jours où il n'a rien joué.
-- -------------------------------------------------------------

drop function if exists public.player_breakdown(uuid, date, date);

create function public.player_breakdown(
  p_player uuid,
  p_from date default null,
  p_until date default null
)
returns table (
  category text,
  item_key text,
  emoji text,
  label text,
  cnt bigint,
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
           then bonus_value('seance_20min') else 0 end as b_seance_20min,
      case when fw.player_id is not null then bonus_value('seance_rapide') else 0 end as b_seance_rapide,
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
      b_pompes_double, b_happy_hour, b_leve_tot, claim_bonus,
      case when event_key = 'quitte_ou_double' and perfect
           then (exos + case when perfect then 2 else 0 end) * multiplier
                + b_premier_du_jour + b_avant_8h + b_apres_22h + b_seance_20min
                + b_seance_rapide + b_pompes_double + b_happy_hour + b_leve_tot
                + claim_bonus
           else 0 end as b_quitte_ou_double
    from base
  ),
  pmpts as (
    select player_id, day,
           base_pts + b_premier_du_jour + b_avant_8h + b_apres_22h + b_seance_20min
           + b_seance_rapide + b_pompes_double + b_happy_hour + b_leve_tot
           + claim_bonus + b_quitte_ou_double as pts
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
  -- Lignes du joueur demandé, dans la fenêtre.
  mine as (
    select * from premirror
    where player_id = p_player
      and (p_from is null or day >= p_from)
      and (p_until is null or day <= p_until)
  ),
  -- Jours miroir gagnés par le joueur (participé ou non), dans la fenêtre.
  mirror_mine as (
    select mw.mday as day, bonus_value('jour_miroir') as v
    from mirror_winner mw
    where mw.player_id = p_player
      and (p_from is null or mw.mday >= p_from)
      and (p_until is null or mw.mday <= p_until)
  ),
  -- Bonus auto dépliés en (clé, points-du-jour).
  auto as (
    select 'premier_du_jour'::text as k, b_premier_du_jour as v from mine
    union all select 'avant_8h',         b_avant_8h         from mine
    union all select 'apres_22h',        b_apres_22h        from mine
    union all select 'seance_20min',     b_seance_20min     from mine
    union all select 'seance_rapide',    b_seance_rapide    from mine
    union all select 'pompes_double',    b_pompes_double    from mine
    union all select 'happy_hour',       b_happy_hour       from mine
    union all select 'leve_tot',         b_leve_tot         from mine
    union all select 'quitte_ou_double', b_quitte_ou_double from mine
    union all select 'jour_miroir',      v                  from mirror_mine
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
           count(*) filter (where a.v > 0)::bigint as cnt,
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

grant execute on function public.player_breakdown(uuid, date, date) to anon, authenticated;
