-- =============================================================
-- Phase bonus — migration ADDITIVE. Rien d'existant ne bouge :
-- les points déjà acquis sont identiques (base × multiplicateur),
-- les bonus s'ajoutent dans une colonne séparée.
--
-- Règle d'or : la régularité reste le moteur, les bonus sont
-- l'assaisonnement. Trois garde-fous, tous côté base :
--   1. aucun multiplicateur de série sur les bonus ;
--   2. 2 bonus d'exercice max par jour ;
--   3. 20 pts de bonus d'exercice max par fenêtre de 7 jours.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Catalogue : LA source unique des valeurs de points.
--    SQL (triggers, vue) et affichage React lisent cette table.
--    Modifier un montant = UPDATE d'une ligne, rien d'autre.
--    Écriture uniquement via l'éditeur SQL (aucune policy INSERT).
-- -------------------------------------------------------------

create table public.bonus_catalog (
  key text primary key,
  kind text not null check (kind in ('exercise', 'execution', 'event', 'cap')),
  emoji text not null default '',
  label text not null default '',
  points numeric not null check (points >= 0),
  sort int not null default 0
);

insert into public.bonus_catalog (key, kind, emoji, label, points, sort) values
  -- 💪 bonus d'exercices (déclaratifs, sur l'honneur)
  ('pompes_50',    'exercise', '💪', '+50 pompes',               4, 1),
  ('abdos_100',    'exercise', '🫁', '+100 abdos',               4, 2),
  ('squats_100',   'exercise', '🦵', '+100 squats',              4, 3),
  ('course_5km',   'exercise', '🏃', '5 km de course',           8, 4),
  ('gainage_3min', 'exercise', '🧱', '3 min de gainage',         3, 5),
  ('corde_10min',  'exercise', '🪢', '10 min de corde à sauter', 5, 6),
  ('marches_500',  'exercise', '🪜', '500 marches',              3, 7),
  -- ⚡ bonus d'exécution (automatiques, calculés par la vue)
  ('premier_du_jour', 'execution', '🌅', 'Premier à terminer',   3, 10),
  ('avant_8h',        'execution', '🔥', 'Fini avant 8h',        3, 11),
  ('apres_22h',       'execution', '🌙', 'Fini après 22h',       2, 12),
  -- 🎲 bonus événementiels (tirage serveur, un par jour max)
  ('pompes_double', 'event', '🎲', 'Les pompes comptent double aujourd''hui',  1, 20),
  ('happy_hour',    'event', '🍻', 'Happy hour : séance finie entre 18h et 20h', 5, 21),
  ('solidarite',    'event', '🤝', 'Jour de solidarité : tout le monde à 3/3', 10, 22),
  ('boss_dimanche', 'event', '👊', 'Boss du dimanche : 200 pompes au total', 10, 23),
  -- 🔒 garde-fous (points = la valeur du plafond)
  ('cap_claims_jour',    'cap', '', 'Bonus d''exercice max par jour',            2, 30),
  ('cap_points_semaine', 'cap', '', 'Plafond pts bonus exercice / 7 jours',     20, 31);

alter table public.bonus_catalog enable row level security;

create policy catalog_select on public.bonus_catalog
  for select to anon, authenticated using (true);

-- Lecture d'un montant du catalogue, pour les triggers.
create or replace function public.bonus_value(p_key text)
returns numeric
language sql
stable
set search_path = public
as $$
  select points from public.bonus_catalog where key = p_key
$$;

-- -------------------------------------------------------------
-- 2. Heure de complétion : la seule donnée temps fiable avant la
--    séance guidée. Posée par trigger quand l'entrée passe à 3/3,
--    remise à null si elle redescend. Le client ne la fixe jamais.
-- -------------------------------------------------------------

alter table public.entries add column completed_at timestamptz;

create or replace function public.set_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pushups and new.abs and new.squats then
    if tg_op = 'INSERT' or old.completed_at is null then
      new.completed_at := now();
    else
      -- déjà complète : l'heure d'origine est figée, valeur client ignorée
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_entries_completed_at
  before insert or update on public.entries
  for each row execute function public.set_completed_at();

-- -------------------------------------------------------------
-- 3. Bonus déclarés. Mêmes règles d'écriture que les entrées :
--    fenêtre 48h heure de Paris, pas de jour futur, bornes du
--    challenge. Plus les deux plafonds. Tout par trigger.
-- -------------------------------------------------------------

create table public.bonus_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  day date not null,
  bonus_key text not null references public.bonus_catalog (key),
  points numeric not null,
  created_at timestamptz not null default now(),
  unique (player_id, day, bonus_key),
  constraint bonus_day_in_challenge
    check (day between date '2026-07-13' and date '2026-08-31')
);

create or replace function public.guard_bonus_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat public.bonus_catalog%rowtype;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  cap_day numeric := public.bonus_value('cap_claims_jour');
  cap_week numeric := public.bonus_value('cap_points_semaine');
  nb int;
  worst numeric;
begin
  select * into cat from public.bonus_catalog where key = new.bonus_key;
  if not found then
    raise exception 'BONUS_INCONNU: % n''est pas au catalogue', new.bonus_key;
  end if;

  -- Seuls les bonus déclaratifs se déclarent : les exercices, plus le
  -- boss du dimanche quand c'est l'événement tiré ce jour-là.
  if cat.kind <> 'exercise' then
    if new.bonus_key = 'boss_dimanche' then
      if not exists (
        select 1 from public.daily_events
        where day = new.day and event_key = 'boss_dimanche'
      ) then
        raise exception 'BOSS_INACTIF: pas de boss ce jour-là';
      end if;
    else
      raise exception 'BONUS_NON_DECLARABLE: % est automatique', new.bonus_key;
    end if;
  end if;

  -- Fenêtre d'écriture identique aux entrées (régime normal).
  if new.day > paris_today then
    raise exception 'JOUR_FUTUR: on ne déclare pas en avance';
  end if;
  if new.day < paris_today - 2 then
    raise exception 'JOUR_VERROUILLE: fenêtre d''édition de 48h dépassée';
  end if;

  -- Les points viennent du catalogue, jamais du client.
  new.points := cat.points;
  new.created_at := now();

  if cat.kind = 'exercise' then
    -- Garde-fou : 2 bonus d'exercice max par jour.
    select count(*) into nb
    from public.bonus_claims bc
    join public.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
    where bc.player_id = new.player_id and bc.day = new.day;
    if nb >= cap_day then
      raise exception 'CAP_JOUR: % bonus d''exercice max par jour', cap_day;
    end if;

    -- Garde-fou : aucune fenêtre de 7 jours contenant ce jour ne doit
    -- dépasser le plafond (les déclarations rétroactives sont possibles,
    -- on vérifie donc toutes les fenêtres, pas seulement celle qui finit
    -- aujourd'hui).
    select coalesce(max(t.total), 0) into worst
    from (
      select sum(bc.points) as total
      from generate_series(new.day - 6, new.day, interval '1 day') g(w)
      join public.bonus_claims bc
        on bc.player_id = new.player_id
       and bc.day between g.w::date and g.w::date + 6
      join public.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
      group by g.w
    ) t;
    if worst + cat.points > cap_week then
      raise exception 'CAP_SEMAINE: plafond de % pts de bonus sur 7 jours', cap_week;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_bonus_claims_insert
  before insert on public.bonus_claims
  for each row execute function public.guard_bonus_claim();

-- Un retap annule la déclaration (erreur de pouce), mais uniquement
-- dans la même fenêtre de 48h. Ensuite, c'est gravé.
create or replace function public.guard_bonus_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
begin
  if old.day < paris_today - 2 then
    raise exception 'JOUR_VERROUILLE: fenêtre d''édition de 48h dépassée';
  end if;
  return old;
end;
$$;

create trigger trg_bonus_claims_delete
  before delete on public.bonus_claims
  for each row execute function public.guard_bonus_delete();

alter table public.bonus_claims enable row level security;

-- Pas de policy UPDATE : une déclaration ne se modifie pas,
-- elle s'annule (delete) puis se refait.
create policy claims_select on public.bonus_claims
  for select to anon, authenticated using (true);
create policy claims_insert on public.bonus_claims
  for insert to anon, authenticated with check (true);
create policy claims_delete on public.bonus_claims
  for delete to anon, authenticated using (true);

-- -------------------------------------------------------------
-- 4. Événement du jour : tirage PARESSEUX côté serveur (pas de
--    cron dispo sur Vercel Hobby). Le premier appel du jour tire
--    et insère, les suivants relisent. Atomique via on conflict.
--    'rien' est stocké aussi : le tirage n'a lieu qu'une fois.
-- -------------------------------------------------------------

create table public.daily_events (
  day date primary key,
  event_key text not null,
  created_at timestamptz not null default now(),
  constraint event_day_in_challenge
    check (day between date '2026-07-13' and date '2026-08-31')
);

alter table public.daily_events enable row level security;

-- Lecture seule pour tous ; l'insertion passe par le RPC (definer).
create policy events_select on public.daily_events
  for select to anon, authenticated using (true);

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
  -- Le boss n'existe que le dimanche, la solidarité reste rare.
  r := random();
  if extract(isodow from paris_today) = 7 then
    drawn := case
      when r < 0.40 then 'rien'
      when r < 0.70 then 'boss_dimanche'
      when r < 0.85 then 'pompes_double'
      when r < 0.95 then 'happy_hour'
      else 'solidarite'
    end;
  else
    drawn := case
      when r < 0.40 then 'rien'
      when r < 0.65 then 'pompes_double'
      when r < 0.90 then 'happy_hour'
      else 'solidarite'
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
-- 5. Vue daily_points recréée (colonnes existantes inchangées,
--    colonnes bonus AJOUTÉES à la fin : create or replace suffit
--    et player_badges, qui dépend de la vue, continue de marcher).
--
--    points = base_points + bonus_points, où :
--      base_points  = (exos + 2 si parfait) × multiplicateur de série
--      bonus_points = exécution + événement + déclarations
--    Le multiplicateur ne touche JAMAIS les bonus.
--
--    Les bonus d'exécution et happy hour n'existent que si la séance
--    a été complétée LE JOUR MÊME (un rattrapage d'hier coché à 10h
--    ne gagne pas "fini avant 8h").
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
-- (courir 5 km sans avoir coché un seul exo reste un jour à points)
spine as (
  select player_id, day from e
  union
  select player_id, day from public.bonus_claims
),
-- premier à terminer : uniquement les jours révolus, sinon le gagnant
-- changerait à chaque décoche/recoche en cours de journée
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

-- -------------------------------------------------------------
-- 6. Classement : même logique, plus le détail "dont X pts bonus".
--    Le type de retour change → drop puis create (l'app appelle
--    toujours rpc('leaderboard'), rien à changer côté client).
-- -------------------------------------------------------------

drop function public.leaderboard(date, date);

create function public.leaderboard(p_from date default null, p_until date default null)
returns table (
  player_id uuid,
  points numeric,
  rank bigint,
  perfect_days bigint,
  exos_done bigint,
  current_streak int,
  bonus_points numeric
)
language sql
stable
set search_path = public
as $$
  with pts as (
    select dp.player_id,
           sum(dp.points) as points,
           sum(dp.bonus_points) as bonus_points,
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
         then lp.streak_pos else 0 end as current_streak,
    round(coalesce(pts.bonus_points, 0), 1) as bonus_points
  from public.players p
  left join pts on pts.player_id = p.id
  left join last_perfect lp on lp.player_id = p.id
$$;

-- -------------------------------------------------------------
-- 7. Durcissement : les fonctions de garde ne sont pas appelables
--    via l'API RPC (même politique que les migrations 1 et 2).
-- -------------------------------------------------------------

revoke execute on function public.set_completed_at() from public, anon, authenticated;
revoke execute on function public.guard_bonus_claim() from public, anon, authenticated;
revoke execute on function public.guard_bonus_delete() from public, anon, authenticated;
