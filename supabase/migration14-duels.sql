-- =============================================================
-- Migration 14 : les duels 1v1 hebdomadaires.
--
-- Chaque lundi, les joueurs actifs (une coche sur 7 jours) sont
-- appariés par rangs voisins au général : 1er vs 2e, 3e vs 4e…
-- Le duel se joue sur les jours parfaits de la semaine ; égalité →
-- départage au total d'exos, sinon match nul. Le gagnant PREND
-- 3 pts au perdant (transfert, somme nulle — pas d'inflation).
--
-- La table `duels` ne stocke QUE l'appariement (décidé le lundi par
-- le job, l'activité du moment n'est pas reconstructible après coup).
-- La résolution, elle, est CALCULÉE par la vue duel_results depuis
-- les entries — une seule vérité, comme tout le scoring. Les points
-- sont justes dès lundi 00h même si le job de notification échoue.
-- Le transfert est posé sur le DIMANCHE de la semaine jouée, via le
-- CTE `extras` de daily_points qui généralise le pattern du jour
-- miroir (fold dans la ligne existante + ligne synthétique sinon).
--
-- player_b null = exempt de la semaine (nombre impair, rotation).
-- =============================================================

create table public.duels (
  id uuid primary key default gen_random_uuid(),
  week_monday date not null check (extract(isodow from week_monday) = 1),
  player_a uuid not null references public.players (id) on delete cascade,
  player_b uuid references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (player_b is null or player_a <> player_b),
  unique (week_monday, player_a)
);

-- Un joueur ne peut pas être le player_b de deux duels la même semaine.
create unique index duels_week_player_b_idx
  on public.duels (week_monday, player_b)
  where player_b is not null;

-- RLS : lecture ouverte (la carte duel du client lit la table),
-- insertion ouverte (le job serveur utilise la clé anon, comme tout).
-- Pas d'update ni delete : un appariement ne se réécrit pas.
alter table public.duels enable row level security;
create policy duels_select on public.duels
  for select to anon, authenticated using (true);
create policy duels_insert on public.duels
  for insert to anon, authenticated with check (true);

-- Le montant du transfert vit dans le catalogue : bonus_value('duel_hebdo')
-- est la source unique du « 3 », et le breakdown récupère emoji + label
-- par son join existant. kind 'execution' → invisible dans l'UI de
-- déclaration des bonus (elle ne liste que les 'exercise').
insert into public.bonus_catalog (key, kind, emoji, label, points, sort) values
  ('duel_hebdo', 'execution', '⚔️', 'Duel de la semaine', 3, 17)
on conflict (key) do nothing;

alter table public.feed_events drop constraint if exists feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check
  check (kind in ('seance', 'bonus', 'event', 'lead', 'co_lead',
                  'badge', 'record', 'milestone', 'collectif',
                  'duel_start', 'duel_result'));

-- -------------------------------------------------------------
-- duel_results : la vérité de la résolution. Seulement les semaines
-- révolues (lundi + 7 <= aujourd'hui Paris) — pendant la semaine, le
-- duel n'existe que dans l'UI live du client. winner/loser null =
-- match nul, aucun point ne bouge.
-- -------------------------------------------------------------

create or replace view public.duel_results
with (security_invoker = true) as
with paris as (
  select (now() at time zone 'Europe/Paris')::date as today
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
    count(*) filter (where e.player_id = f.player_a
                       and e.pushups and e.abs and e.squats)::int as perfect_a,
    count(*) filter (where e.player_id = f.player_b
                       and e.pushups and e.abs and e.squats)::int as perfect_b,
    coalesce(sum(e.pushups::int + e.abs::int + e.squats::int)
               filter (where e.player_id = f.player_a), 0)::int as exos_a,
    coalesce(sum(e.pushups::int + e.abs::int + e.squats::int)
               filter (where e.player_id = f.player_b), 0)::int as exos_b
  from finished f
  left join public.entries e
    on e.player_id in (f.player_a, f.player_b)
   and e.day between f.week_monday and f.week_monday + 6
  group by f.id, f.week_monday, f.player_a, f.player_b
)
select
  id, week_monday,
  (week_monday + 6)::date as day, -- le dimanche : jour où le transfert est posé
  player_a, player_b, perfect_a, perfect_b, exos_a, exos_b,
  case when perfect_a > perfect_b then player_a
       when perfect_b > perfect_a then player_b
       when exos_a > exos_b then player_a
       when exos_b > exos_a then player_b end as winner,
  case when perfect_a > perfect_b then player_b
       when perfect_b > perfect_a then player_a
       when exos_a > exos_b then player_b
       when exos_b > exos_a then player_a end as loser,
  (perfect_a = perfect_b) as tiebreak_used
from tally;

-- -------------------------------------------------------------
-- Vue daily_points : identique à la migration 13 jusqu'à
-- mirror_winner, puis la queue généralise le pattern miroir en un
-- CTE `extras` (miroir ∪ duels). Table duels vide ⇒ sortie
-- identique à l'actuelle. Colonnes inchangées → replace.
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
            then public.bonus_value('seance_20min') else 0 end
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
         then (exos + case when perfect then 2 else 0 end) * multiplier
              + execution_bonus + event_bonus + claim_bonus
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
extras as (
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
-- rendrait pas compte du ±3. Identique à la migration 13 plus le
-- CTE duel_mine ; le filtre cnt passe de v > 0 à v <> 0 (le duel
-- est le seul bonus qui peut être négatif).
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
           then bonus_value('seance_20min') else 0 end as b_seance_20min,
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
           then (exos + case when perfect then 2 else 0 end) * multiplier
                + b_premier_du_jour + b_avant_8h + b_apres_22h + b_seance_20min
                + b_seance_rapide + b_retour + b_collectif + b_pompes_double
                + b_happy_hour + b_leve_tot
                + claim_bonus
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
