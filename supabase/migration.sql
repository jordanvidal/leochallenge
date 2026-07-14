-- =============================================================
-- Challenge 100-100-100 — migration Supabase complète
-- À coller telle quelle dans l'éditeur SQL de Supabase. Aucun seed.
-- =============================================================

-- Extension unaccent (peu importe le schéma où Supabase l'installe,
-- la fonction wrapper ci-dessous la retrouve via son search_path).
create extension if not exists unaccent;

-- unaccent() est STABLE, donc inutilisable telle quelle dans un index.
-- Wrapper IMMUTABLE : sans danger ici, le dictionnaire ne change jamais.
create or replace function public.f_unaccent(txt text)
returns text
language sql
immutable
strict
parallel safe
set search_path = public, extensions
as $$
  select unaccent(txt)
$$;

-- -------------------------------------------------------------
-- Tables
-- -------------------------------------------------------------

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 30),
  color text not null,               -- accent auto-assigné, palette de 8
  created_at timestamptz not null default now(),
  backfill_closed_at timestamptz     -- null = rattrapage initial encore ouvert
);

-- Unicité insensible à la casse et aux accents : "Léo" == "leo" == "LEO"
create unique index players_name_unique
  on public.players (lower(public.f_unaccent(trim(name))));

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  day date not null,
  pushups boolean not null default false,
  abs boolean not null default false,
  squats boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (player_id, day),
  -- Aucune entrée hors de la fenêtre du challenge. En dur, pas de jour fantôme.
  constraint entries_day_in_challenge
    check (day between date '2026-07-13' and date '2026-08-31')
);

-- -------------------------------------------------------------
-- Triggers : les règles vivent en base, pas seulement dans React
-- -------------------------------------------------------------

-- 1. Cap à 12 joueurs. On est un groupe de potes, pas une plateforme.
create or replace function public.guard_player_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.players) >= 12 then
    raise exception 'CAP_JOUEURS: maximum 12 joueurs';
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;

create trigger trg_players_insert
  before insert on public.players
  for each row execute function public.guard_player_insert();

-- 2. Un joueur qui a coché un seul exo devient indestructible.
--    (le BEFORE DELETE se déclenche avant le cascade de la FK)
create or replace function public.guard_player_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.entries where player_id = old.id) then
    raise exception 'JOUEUR_INDESTRUCTIBLE: ce joueur a des entrées';
  end if;
  return old;
end;
$$;

create trigger trg_players_delete
  before delete on public.players
  for each row execute function public.guard_player_delete();

-- 3. Pas de triche sur le joueur lui-même : created_at est figé et
--    le rattrapage ne se rouvre jamais une fois fermé.
create or replace function public.guard_player_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'CREATED_AT_FIGE: created_at ne se modifie pas';
  end if;
  if old.backfill_closed_at is not null
     and new.backfill_closed_at is distinct from old.backfill_closed_at then
    raise exception 'RATTRAPAGE_VERROUILLE: le rattrapage est déjà fermé';
  end if;
  return new;
end;
$$;

create trigger trg_players_update
  before update on public.players
  for each row execute function public.guard_player_update();

-- 4. Fenêtre d'édition des entrées, calculée en heure de Paris.
--    Rattrapage ouvert  = backfill_closed_at null ET création < 48h
--                       → tout jour écoulé du challenge est éditable.
--    Rattrapage fermé   → uniquement aujourd'hui, hier, avant-hier (48h).
--    Jamais de jour futur, jamais de changement de (player_id, day).
create or replace function public.guard_entry_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.players%rowtype;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  is_backfill_open boolean;
begin
  if tg_op = 'UPDATE' and (
    new.day is distinct from old.day
    or new.player_id is distinct from old.player_id
  ) then
    raise exception 'ENTREE_IMMUTABLE: (player_id, day) ne se modifie pas';
  end if;

  select * into p from public.players where id = new.player_id;
  if not found then
    raise exception 'JOUEUR_INCONNU';
  end if;

  is_backfill_open := p.backfill_closed_at is null
    and now() < p.created_at + interval '48 hours';

  if new.day > paris_today then
    raise exception 'JOUR_FUTUR: on ne coche pas en avance';
  end if;

  if not is_backfill_open and new.day < paris_today - 2 then
    raise exception 'JOUR_VERROUILLE: fenêtre d''édition de 48h dépassée';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_entries_write
  before insert or update on public.entries
  for each row execute function public.guard_entry_write();

-- -------------------------------------------------------------
-- RLS : ouvert pour la clé anonyme, sauf ce que les triggers gardent.
-- Pas de policy DELETE sur entries : une coche ne se supprime pas,
-- elle se décoche (update à false).
-- -------------------------------------------------------------

alter table public.players enable row level security;
alter table public.entries enable row level security;

create policy players_select on public.players
  for select to anon, authenticated using (true);
create policy players_insert on public.players
  for insert to anon, authenticated with check (true);
create policy players_update on public.players
  for update to anon, authenticated using (true) with check (true);
create policy players_delete on public.players
  for delete to anon, authenticated using (true);

create policy entries_select on public.entries
  for select to anon, authenticated using (true);
create policy entries_insert on public.entries
  for insert to anon, authenticated with check (true);
create policy entries_update on public.entries
  for update to anon, authenticated using (true) with check (true);

-- -------------------------------------------------------------
-- Durcissement : les fonctions de garde ne sont pas appelables
-- via l'API RPC. Les triggers, eux, continuent de fonctionner.
-- -------------------------------------------------------------

revoke execute on function public.guard_player_insert() from public, anon, authenticated;
revoke execute on function public.guard_player_delete() from public, anon, authenticated;
revoke execute on function public.guard_player_update() from public, anon, authenticated;
revoke execute on function public.guard_entry_write() from public, anon, authenticated;
