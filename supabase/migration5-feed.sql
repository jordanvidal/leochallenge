-- =============================================================
-- Phase feed — migration ADDITIVE. Rien d'existant ne bouge.
--
-- Principe : personne n'écrit de post. Les événements dérivés des
-- écritures (séance terminée, bonus déclaré) sont insérés par
-- TRIGGER — jamais par le client, sinon un cache vidé ferait
-- disparaître l'histoire. Ceux dérivés de calculs (prise de tête,
-- badge, record, milestone) sont insérés par /api/moments.
--
-- Volumétrie : 6 joueurs × 48 jours ≈ 300 séances + ~150 bonus
-- + badges, records, milestones → < 1 000 événements au total.
-- Un ORDER BY created_at DESC LIMIT 50 indexé suffit largement.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Les événements. Insérés UNE seule fois : unicité sur
--    (player_id, kind, dedupe_key) — décocher/recocher ne crée
--    pas de doublon. Le payload fige la phrase à l'insertion.
-- -------------------------------------------------------------

create table public.feed_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  kind text not null check (kind in
    ('seance', 'bonus', 'event', 'lead', 'badge', 'record', 'milestone')),
  dedupe_key text not null check (dedupe_key <> ''),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- dernier push envoyé au propriétaire (throttle : 1 max / 15 min)
  last_notified_at timestamptz,
  unique (player_id, kind, dedupe_key)
);

create index feed_events_created_idx on public.feed_events (created_at desc);

-- L'horodatage vient du serveur, quoi que dise le client
create or replace function public.guard_feed_event_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  new.last_notified_at := null;
  return new;
end;
$$;

create trigger trg_feed_events_insert
  before insert on public.feed_events
  for each row execute function public.guard_feed_event_insert();

-- Un événement du fil ne se réécrit pas, à deux exceptions près :
-- le throttle de notification (last_notified_at seul) et la clôture
-- de séance qui pose une durée manquante (validation des exos et
-- clôture du chrono partent en parallèle, l'ordre n'est pas garanti).
create or replace function public.guard_feed_event_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.player_id = old.player_id
     and new.kind = old.kind
     and new.dedupe_key = old.dedupe_key
     and new.created_at = old.created_at then
    -- cas 1 : seul last_notified_at change (throttle notif)
    if new.payload = old.payload then
      return new;
    end if;
    -- cas 2 : ajout de la durée sur un événement séance qui n'en avait pas
    if new.kind = 'seance'
       and not (old.payload ? 'duration_seconds')
       and new.payload - 'duration_seconds' = old.payload
       and new.last_notified_at is not distinct from old.last_notified_at then
      return new;
    end if;
  end if;
  raise exception 'FEED_FIGE: un événement du fil ne se réécrit pas';
end;
$$;

create trigger trg_feed_events_update
  before update on public.feed_events
  for each row execute function public.guard_feed_event_update();

alter table public.feed_events enable row level security;

-- Pas de policy DELETE : l'histoire ne s'efface pas.
create policy feed_events_select on public.feed_events
  for select to anon, authenticated using (true);
create policy feed_events_insert on public.feed_events
  for insert to anon, authenticated with check (true);
create policy feed_events_update on public.feed_events
  for update to anon, authenticated using (true) with check (true);

-- -------------------------------------------------------------
-- 2. 🔥 Séance terminée : quand une entrée passe à 3/3. La durée
--    est celle de la séance guidée clôturée du jour, si elle existe.
-- -------------------------------------------------------------

create or replace function public.feed_on_entry_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dur int;
begin
  if new.completed_at is not null
     and (tg_op = 'INSERT' or old.completed_at is null) then
    select ws.duration_seconds into dur
    from public.workout_sessions ws
    where ws.player_id = new.player_id
      and ws.day = new.day
      and ws.finished_at is not null;

    insert into public.feed_events (player_id, kind, dedupe_key, payload)
    values (
      new.player_id,
      'seance',
      new.day::text,
      jsonb_strip_nulls(
        jsonb_build_object('day', new.day, 'duration_seconds', dur)
      )
    )
    on conflict (player_id, kind, dedupe_key) do nothing;
  end if;
  return null;
end;
$$;

create trigger trg_entries_feed
  after insert or update on public.entries
  for each row execute function public.feed_on_entry_complete();

-- Clôture du chrono arrivée APRÈS le 3/3 : on complète l'événement.
create or replace function public.feed_on_session_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.finished_at is not null and old.finished_at is null then
    update public.feed_events
    set payload = payload
      || jsonb_build_object('duration_seconds', new.duration_seconds)
    where player_id = new.player_id
      and kind = 'seance'
      and dedupe_key = new.day::text
      and not (payload ? 'duration_seconds');
  end if;
  return null;
end;
$$;

create trigger trg_workout_sessions_feed
  after update on public.workout_sessions
  for each row execute function public.feed_on_session_close();

-- -------------------------------------------------------------
-- 3. 💪 Bonus déclaré (et 🎲 boss du dimanche, qui passe aussi par
--    bonus_claims). Le label et l'emoji du catalogue sont figés
--    dans le payload. Une annulation (delete du claim) ne retire
--    pas l'événement : le feed raconte, il ne comptabilise pas.
-- -------------------------------------------------------------

create or replace function public.feed_on_bonus_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat public.bonus_catalog%rowtype;
begin
  select * into cat from public.bonus_catalog where key = new.bonus_key;

  insert into public.feed_events (player_id, kind, dedupe_key, payload)
  values (
    new.player_id,
    case when cat.kind = 'event' then 'event' else 'bonus' end,
    new.day::text || ':' || new.bonus_key,
    jsonb_build_object(
      'day', new.day,
      'bonus_key', new.bonus_key,
      'label', cat.label,
      'emoji', cat.emoji,
      'points', new.points
    )
  )
  on conflict (player_id, kind, dedupe_key) do nothing;
  return null;
end;
$$;

create trigger trg_bonus_claims_feed
  after insert on public.bonus_claims
  for each row execute function public.feed_on_bonus_claim();

-- -------------------------------------------------------------
-- 4. Les réactions : liste fixe de 5 emojis, un tap ajoute, un
--    retap enlève (delete). Unicité sur le triplet.
-- -------------------------------------------------------------

create table public.feed_reactions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.feed_events (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '🔥', '💪', '😂', '💀')),
  created_at timestamptz not null default now(),
  unique (event_id, player_id, emoji)
);

create index feed_reactions_event_idx on public.feed_reactions (event_id);

create or replace function public.guard_feed_reaction_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger trg_feed_reactions_insert
  before insert on public.feed_reactions
  for each row execute function public.guard_feed_reaction_insert();

alter table public.feed_reactions enable row level security;

-- Pas de policy UPDATE : une réaction s'enlève (retap), point.
create policy feed_reactions_select on public.feed_reactions
  for select to anon, authenticated using (true);
create policy feed_reactions_insert on public.feed_reactions
  for insert to anon, authenticated with check (true);
create policy feed_reactions_delete on public.feed_reactions
  for delete to anon, authenticated using (true);

-- -------------------------------------------------------------
-- 5. Les commentaires : 140 caractères max EN BASE, pas de fil,
--    pas d'édition, pas de suppression (aucune policy UPDATE ni
--    DELETE). Une pique ou un bravo, pas une conversation.
-- -------------------------------------------------------------

create table public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.feed_events (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint comment_140 check (char_length(body) <= 140),
  constraint comment_non_vide check (char_length(trim(body)) >= 1)
);

create index feed_comments_event_idx on public.feed_comments (event_id);

create or replace function public.guard_feed_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger trg_feed_comments_insert
  before insert on public.feed_comments
  for each row execute function public.guard_feed_comment_insert();

alter table public.feed_comments enable row level security;

create policy feed_comments_select on public.feed_comments
  for select to anon, authenticated using (true);
create policy feed_comments_insert on public.feed_comments
  for insert to anon, authenticated with check (true);

-- -------------------------------------------------------------
-- 6. Durcissement : fonctions de garde et de feed non appelables
--    via l'API RPC (même politique que les migrations 1 à 4).
-- -------------------------------------------------------------

revoke execute on function public.guard_feed_event_insert() from public, anon, authenticated;
revoke execute on function public.guard_feed_event_update() from public, anon, authenticated;
revoke execute on function public.feed_on_entry_complete() from public, anon, authenticated;
revoke execute on function public.feed_on_session_close() from public, anon, authenticated;
revoke execute on function public.feed_on_bonus_claim() from public, anon, authenticated;
revoke execute on function public.guard_feed_reaction_insert() from public, anon, authenticated;
revoke execute on function public.guard_feed_comment_insert() from public, anon, authenticated;
