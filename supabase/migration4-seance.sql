-- =============================================================
-- Phase séance guidée — 1/2 : tables, triggers, catalogue.
-- Migration ADDITIVE : entrées, bonus et points acquis intacts.
-- La suite (vue daily_points) est dans migration4b-vue-chrono.sql.
--
-- Principe du chrono : les DEUX timestamps sont posés par le
-- serveur (now() à l'insert, now() à la clôture). Le client ne
-- transmet jamais une durée, il la lit. C'est la seule façon de
-- protéger les bonus chrono sans surveiller personne.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Formats favoris : une liste MRU auto-gérée. Chaque lancement
--    upserte le format utilisé ; au-delà de 8, le moins récemment
--    utilisé saute. Zéro gestion manuelle côté joueur.
-- -------------------------------------------------------------

create table public.workout_presets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  rounds int not null check (rounds between 1 and 10),
  pushups_reps int not null check (pushups_reps between 0 and 200),
  abs_reps int not null check (abs_reps between 0 and 200),
  squats_reps int not null check (squats_reps between 0 and 200),
  rest_seconds int not null check (rest_seconds between 0 and 600),
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (player_id, rounds, pushups_reps, abs_reps, squats_reps, rest_seconds)
);

create or replace function public.guard_preset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- L'horodatage vient du serveur, jamais du client. clock_timestamp()
  -- plutôt que now() : deux upserts dans la même transaction restent
  -- ordonnés, la liste MRU ne départage jamais au hasard.
  new.last_used_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    -- Un upsert d'un format existant passe aussi par BEFORE INSERT :
    -- dans ce cas rien n'est créé (le conflit fera le touch), on
    -- n'élague donc pas.
    if exists (
      select 1 from public.workout_presets
      where player_id = new.player_id
        and rounds = new.rounds
        and pushups_reps = new.pushups_reps
        and abs_reps = new.abs_reps
        and squats_reps = new.squats_reps
        and rest_seconds = new.rest_seconds
    ) then
      return new;
    end if;
    -- MRU : on garde les 7 plus récents + celui qui arrive = 8 max.
    delete from public.workout_presets wp
    where wp.player_id = new.player_id
      and wp.id in (
        select id from public.workout_presets
        where player_id = new.player_id
        order by last_used_at desc
        offset 7
      );
  end if;
  return new;
end;
$$;

create trigger trg_workout_presets_guard
  before insert or update on public.workout_presets
  for each row execute function public.guard_preset();

alter table public.workout_presets enable row level security;

create policy presets_select on public.workout_presets
  for select to anon, authenticated using (true);
create policy presets_insert on public.workout_presets
  for insert to anon, authenticated with check (true);
-- L'update ne sert qu'au "touch" du upsert (last_used_at rafraîchi).
create policy presets_update on public.workout_presets
  for update to anon, authenticated using (true) with check (true);
-- Pas de policy DELETE : seul le trigger (definer) élague la liste.

-- -------------------------------------------------------------
-- 2. Séances : une par joueur et par jour, la première clôturée
--    fait foi. started_at/finished_at = now() serveur, durée
--    dérivée. Une séance jamais clôturée peut être relancée
--    (le départ repart de zéro), une séance clôturée est figée.
-- -------------------------------------------------------------

create table public.workout_sessions (
  player_id uuid not null references public.players (id) on delete cascade,
  day date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_seconds int,
  config jsonb not null default '{}'::jsonb,
  primary key (player_id, day),
  constraint session_day_in_challenge
    check (day between date '2026-07-13' and date '2026-08-31')
);

create or replace function public.guard_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Une séance se lance en direct : le jour et l'heure de départ
  -- sont ceux du serveur, quoi que dise le client.
  new.day := (now() at time zone 'Europe/Paris')::date;
  new.started_at := now();
  new.finished_at := null;
  new.duration_seconds := null;
  return new;
end;
$$;

create or replace function public.guard_session_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  min_duration int := coalesce(public.bonus_value('cap_seance_min'), 300)::int;
begin
  if old.finished_at is not null then
    raise exception 'SEANCE_FIGEE: la première séance clôturée du jour fait foi';
  end if;

  -- Le jour et le départ ne se réécrivent jamais depuis le client.
  new.day := old.day;
  new.player_id := old.player_id;

  if new.finished_at is not null then
    -- Clôture : le serveur fixe l'heure de fin et la durée.
    new.started_at := old.started_at;
    new.finished_at := now();
    new.duration_seconds := extract(epoch from now() - old.started_at)::int;
    -- Personne ne fait 300 répétitions en moins de 5 minutes.
    if new.duration_seconds < min_duration then
      raise exception 'SEANCE_TROP_COURTE: durée invraisemblable (% s)', new.duration_seconds;
    end if;
  else
    -- Relance d'une séance abandonnée : le chrono repart de zéro.
    new.started_at := now();
    new.duration_seconds := null;
  end if;
  return new;
end;
$$;

create trigger trg_workout_sessions_insert
  before insert on public.workout_sessions
  for each row execute function public.guard_session_insert();

create trigger trg_workout_sessions_update
  before update on public.workout_sessions
  for each row execute function public.guard_session_update();

alter table public.workout_sessions enable row level security;

create policy sessions_select on public.workout_sessions
  for select to anon, authenticated using (true);
create policy sessions_insert on public.workout_sessions
  for insert to anon, authenticated with check (true);
create policy sessions_update on public.workout_sessions
  for update to anon, authenticated using (true) with check (true);
-- Pas de policy DELETE : une séance ne s'efface pas.

-- -------------------------------------------------------------
-- 3. Bonus chrono au catalogue. Mêmes règles que le reste :
--    montants centralisés ici, jamais de multiplicateur dessus.
--    Les seuils (20 min, durée minimale) sont des lignes 'cap'.
-- -------------------------------------------------------------

insert into public.bonus_catalog (key, kind, emoji, label, points, sort) values
  ('seance_20min',  'execution', '⚡', 'Séance complète en moins de 20 min',   5, 13),
  ('seance_rapide', 'execution', '🥇', 'Séance la plus rapide de la journée',  5, 14),
  ('cap_seance_20min', 'cap', '', 'Seuil séance rapide (secondes)',         1200, 32),
  ('cap_seance_min',   'cap', '', 'Durée minimale plausible (secondes)',     300, 33);

-- -------------------------------------------------------------
-- 4. Durcissement : les fonctions de garde ne sont pas appelables
--    via l'API RPC (même politique que les migrations 1 à 3).
-- -------------------------------------------------------------

revoke execute on function public.guard_preset() from public, anon, authenticated;
revoke execute on function public.guard_session_insert() from public, anon, authenticated;
revoke execute on function public.guard_session_update() from public, anon, authenticated;
