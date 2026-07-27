-- migration36-app-structure.sql — socle multi-ligues, phase 1 (structure)
--
-- Tout se construit dans un schéma NEUF `app`. Aucune instruction de ce fichier
-- ne touche `public` : le challenge d'origine (13/07 → 31/08/2026) continue de
-- tourner sur `public` sans bouger d'un octet, et sera migré en phase 5,
-- après le 31 août.
--
-- Ce fichier ne pose que la structure : schéma, tables, index, RLS.
--   - les gardes et les triggers de dates       → migration37-app-gardes.sql
--   - les vues et fonctions de scoring          → migration38-app-scoring.sql
-- Les trois se jouent dans l'ordre, d'une traite.
--
-- Différences assumées avec `public`, toutes voulues :
--   1. `players` gagne `league_id` et `recovery_code` ;
--   2. l'unicité du prénom et le cap de 12 joueurs deviennent PAR LIGUE ;
--   3. les 4 contraintes CHECK qui codaient en dur la fenêtre 13/07 → 31/08
--      disparaissent : Postgres interdit les sous-requêtes dans un CHECK, donc
--      la fenêtre se vérifie par trigger (migration37) en lisant `leagues`.

create schema if not exists app;

grant usage on schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Repris tel quel de `public`. Sert dans l'index d'unicité des prénoms :
-- « Léo » et « Leo » sont le même joueur. IMMUTABLE, sinon pas d'index possible.
-- L'extension unaccent vit dans `public` côté Supabase, d'où le search_path.
create or replace function app.f_unaccent(txt text)
returns text
language sql
immutable parallel safe strict
set search_path to 'app', 'public', 'extensions'
as $$
  select unaccent(txt)
$$;

-- Codes courts lisibles à l'oral et au clavier : pas de 0/O, pas de 1/I/L.
-- Volontairement court et sans anti-abus — c'est entre potes qui se
-- connaissent, pas un produit ouvert au public (cf. plan multi-ligues).
create or replace function app.code_court(n integer default 6)
returns text
language sql
volatile
as $$
  select string_agg(
           substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                  1 + floor(random() * 31)::int, 1),
           '')
  from generate_series(1, n)
$$;

-- ---------------------------------------------------------------------------
-- Les ligues
-- ---------------------------------------------------------------------------

create table app.leagues (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,          -- dans l'URL : /l/<slug>
  name              text not null,
  invite_code       text not null unique default app.code_court(6),
  start_day         date not null,
  end_day           date not null,
  -- FK posée plus bas : le créateur est un joueur, qui référence lui-même la ligue.
  creator_player_id uuid,
  -- Saison 2 → saison 1. Une saison relancée est une ligue de plus, pas un cas
  -- spécial : même code d'invitation, nouvelles dates, compteurs à zéro.
  parent_league_id  uuid references app.leagues (id),
  created_at        timestamptz not null default now(),
  constraint leagues_name_check check (
    char_length(trim(name)) between 1 and 40
  ),
  -- 1 à 6 semaines. 41 jours d'écart = 42 jours bornes comprises.
  constraint duree_valide check (
    end_day >= start_day and end_day <= start_day + 41
  )
);

-- ---------------------------------------------------------------------------
-- Les joueurs
-- ---------------------------------------------------------------------------

create table app.players (
  id                 uuid primary key default gen_random_uuid(),
  league_id          uuid not null references app.leagues (id) on delete cascade,
  name               text not null,
  color              text not null,
  -- 6 caractères, montrés au joueur à son entrée. Ils ne le ramènent que dans
  -- LA saison où ils ont été créés : chaque saison est une page blanche.
  recovery_code      text not null default app.code_court(6),
  created_at         timestamptz not null default now(),
  backfill_closed_at timestamptz,
  constraint players_name_check check (
    char_length(trim(name)) between 1 and 30
  )
);

alter table app.leagues
  add constraint leagues_creator_fkey
  foreign key (creator_player_id) references app.players (id) on delete set null;

-- Unicité du prénom PAR LIGUE (elle était globale à la base dans `public`).
-- « Léo » peut donc exister dans deux ligues différentes.
create unique index players_name_par_ligue
  on app.players (league_id, lower(app.f_unaccent(trim(name))));

-- Le code de récupération n'a besoin d'être unique que dans sa ligue.
create unique index players_recovery_par_ligue
  on app.players (league_id, recovery_code);

-- L'ordre d'arrivée commande la couleur et l'historique du premier du jour.
create index players_league_created_idx
  on app.players (league_id, created_at);

-- ---------------------------------------------------------------------------
-- Données de référence — globales, pas de league_id
-- ---------------------------------------------------------------------------

create table app.bonus_catalog (
  key          text primary key,
  kind         text not null check (kind in ('exercise', 'execution', 'event', 'cap')),
  emoji        text not null default '',
  label        text not null default '',
  points       numeric not null check (points >= 0),
  sort         integer not null default 0,
  ladder       text,
  family       text check (family is null or family in ('cardio', 'haut', 'abdos', 'jambes')),
  double_event text
);

-- L'événement du jour reste GLOBAL par jour civil : toutes les ligues actives
-- partagent le tirage. Plus simple, et sans conséquence sur l'équité puisque
-- chaque ligue est classée séparément. Son CHECK de fenêtre a sauté (trigger).
create table app.daily_events (
  day        date primary key,
  event_key  text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Les tables rattachées à un joueur
-- ---------------------------------------------------------------------------
-- Elles ne portent PAS de league_id : elles se cadrent par jointure sur
-- players.league_id. Au volume visé (une poignée de ligues × ~12 joueurs) la
-- jointure est gratuite, et une colonne dupliquée est une désynchronisation qui
-- attend son heure.

create table app.entries (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references app.players (id) on delete cascade,
  day          date not null,
  pushups      boolean not null default false,
  abs          boolean not null default false,
  squats       boolean not null default false,
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (player_id, day)
);

create table app.workout_sessions (
  player_id        uuid not null references app.players (id) on delete cascade,
  day              date not null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  duration_seconds integer,
  config           jsonb not null default '{}'::jsonb,
  primary key (player_id, day)
);

create table app.workout_presets (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references app.players (id) on delete cascade,
  rounds       integer not null check (rounds between 1 and 10),
  pushups_reps integer not null check (pushups_reps between 0 and 200),
  abs_reps     integer not null check (abs_reps between 0 and 200),
  squats_reps  integer not null check (squats_reps between 0 and 200),
  rest_seconds integer not null check (rest_seconds between 0 and 600),
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (player_id, rounds, pushups_reps, abs_reps, squats_reps, rest_seconds)
);

create table app.bonus_claims (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references app.players (id) on delete cascade,
  day        date not null,
  bonus_key  text not null references app.bonus_catalog (key),
  points     numeric not null,
  created_at timestamptz not null default now(),
  unique (player_id, day, bonus_key)
);

create table app.duels (
  id          uuid primary key default gen_random_uuid(),
  week_monday date not null,
  player_a    uuid not null references app.players (id) on delete cascade,
  player_b    uuid references app.players (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (player_b is null or player_a <> player_b),
  check (extract(isodow from week_monday) = 1),
  unique (week_monday, player_a)
);

create unique index duels_week_player_b_idx
  on app.duels (week_monday, player_b) where player_b is not null;

create table app.feed_events (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references app.players (id) on delete cascade,
  kind             text not null check (kind in (
                     'seance', 'bonus', 'event', 'lead', 'co_lead', 'badge',
                     'record', 'milestone', 'collectif', 'duel_start',
                     'duel_result', 'joker', 'premier', 'recit')),
  dedupe_key       text not null check (dedupe_key <> ''),
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  last_notified_at timestamptz,
  unique (player_id, kind, dedupe_key)
);

create index feed_events_created_idx on app.feed_events (created_at desc);

create table app.feed_comments (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references app.feed_events (id) on delete cascade,
  player_id  uuid not null references app.players (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint comment_non_vide check (char_length(trim(body)) >= 1),
  constraint comment_140 check (char_length(body) <= 140)
);

create index feed_comments_event_idx on app.feed_comments (event_id);

create table app.feed_reactions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references app.feed_events (id) on delete cascade,
  player_id  uuid not null references app.players (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️', '🔥', '💪', '😂', '💀')),
  created_at timestamptz not null default now(),
  unique (event_id, player_id, emoji)
);

create index feed_reactions_event_idx on app.feed_reactions (event_id);

create table app.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references app.players (id) on delete cascade,
  -- Unique globalement : un endpoint, c'est un appareil, pas une ligue.
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table app.rank_snapshots (
  player_id        uuid primary key references app.players (id) on delete cascade,
  rank             bigint not null,
  points           numeric not null,
  updated_at       timestamptz not null default now(),
  last_overtake_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Le gel de l'historique (phase 5)
-- ---------------------------------------------------------------------------
-- `app.daily_points` n'implémente que le barème courant (S3). Les journées du
-- groupe d'origine antérieures au 27/07/2026 ont été jouées sous un barème
-- différent : les recalculer réécrirait leur classement. Elles seront donc
-- recopiées telles quelles ici en phase 5, et `app.daily_points` les reprend
-- sans jamais les recalculer.
--
-- Vide en phase 1. Tant qu'elle l'est, elle ne change rien au scoring.
create table app.legacy_daily_points (
  player_id       uuid not null references app.players (id) on delete cascade,
  day             date not null,
  exos            integer not null default 0,
  perfect         boolean not null default false,
  streak_pos      integer not null default 0,
  multiplier      numeric not null default 1.0,
  points          numeric not null default 0,
  base_points     numeric not null default 0,
  bonus_points    numeric not null default 0,
  jokered         boolean not null default false,
  premier_du_jour boolean not null default false,
  primary key (player_id, day)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Transposition à l'identique de `public` : ouverte à `anon`. C'est un choix
-- conscient à cette échelle (des bandes de gens qui se connaissent), pas un
-- oubli — il redevient un sujet le jour où l'app s'ouvre à des inconnus.

alter table app.leagues             enable row level security;
alter table app.players             enable row level security;
alter table app.entries             enable row level security;
alter table app.workout_sessions    enable row level security;
alter table app.workout_presets     enable row level security;
alter table app.bonus_catalog       enable row level security;
alter table app.bonus_claims        enable row level security;
alter table app.daily_events        enable row level security;
alter table app.duels               enable row level security;
alter table app.feed_events         enable row level security;
alter table app.feed_comments       enable row level security;
alter table app.feed_reactions      enable row level security;
alter table app.push_subscriptions  enable row level security;
alter table app.rank_snapshots      enable row level security;
alter table app.legacy_daily_points enable row level security;

create policy leagues_select on app.leagues for select to anon, authenticated using (true);
create policy leagues_insert on app.leagues for insert to anon, authenticated with check (true);
create policy leagues_update on app.leagues for update to anon, authenticated using (true) with check (true);

create policy players_select on app.players for select to anon, authenticated using (true);
create policy players_insert on app.players for insert to anon, authenticated with check (true);
create policy players_update on app.players for update to anon, authenticated using (true) with check (true);
create policy players_delete on app.players for delete to anon, authenticated using (true);

create policy entries_select on app.entries for select to anon, authenticated using (true);
create policy entries_insert on app.entries for insert to anon, authenticated with check (true);
create policy entries_update on app.entries for update to anon, authenticated using (true) with check (true);

create policy sessions_select on app.workout_sessions for select to anon, authenticated using (true);
create policy sessions_insert on app.workout_sessions for insert to anon, authenticated with check (true);
create policy sessions_update on app.workout_sessions for update to anon, authenticated using (true) with check (true);

create policy presets_select on app.workout_presets for select to anon, authenticated using (true);
create policy presets_insert on app.workout_presets for insert to anon, authenticated with check (true);
create policy presets_update on app.workout_presets for update to anon, authenticated using (true) with check (true);

create policy catalog_select on app.bonus_catalog for select to anon, authenticated using (true);

create policy claims_select on app.bonus_claims for select to anon, authenticated using (true);
create policy claims_insert on app.bonus_claims for insert to anon, authenticated with check (true);
create policy claims_delete on app.bonus_claims for delete to anon, authenticated using (true);

create policy events_select on app.daily_events for select to anon, authenticated using (true);

create policy duels_select on app.duels for select to anon, authenticated using (true);
create policy duels_insert on app.duels for insert to anon, authenticated with check (true);

create policy feed_events_select on app.feed_events for select to anon, authenticated using (true);
create policy feed_events_insert on app.feed_events for insert to anon, authenticated with check (true);
create policy feed_events_update on app.feed_events for update to anon, authenticated using (true) with check (true);
create policy feed_events_delete_volume on app.feed_events for delete to anon, authenticated
  using (kind = 'record' and dedupe_key like 'vol:%');

create policy feed_comments_select on app.feed_comments for select to anon, authenticated using (true);
create policy feed_comments_insert on app.feed_comments for insert to anon, authenticated with check (true);

create policy feed_reactions_select on app.feed_reactions for select to anon, authenticated using (true);
create policy feed_reactions_insert on app.feed_reactions for insert to anon, authenticated with check (true);
create policy feed_reactions_delete on app.feed_reactions for delete to anon, authenticated using (true);

create policy push_select on app.push_subscriptions for select to anon, authenticated using (true);
create policy push_insert on app.push_subscriptions for insert to anon, authenticated with check (true);
create policy push_update on app.push_subscriptions for update to anon, authenticated using (true) with check (true);
create policy push_delete on app.push_subscriptions for delete to anon, authenticated using (true);

create policy snap_select on app.rank_snapshots for select to anon, authenticated using (true);
create policy snap_insert on app.rank_snapshots for insert to anon, authenticated with check (true);
create policy snap_update on app.rank_snapshots for update to anon, authenticated using (true) with check (true);

-- L'historique gelé se lit, ne s'écrit pas depuis le client.
create policy legacy_select on app.legacy_daily_points for select to anon, authenticated using (true);

grant select, insert, update, delete on all tables in schema app to anon, authenticated;
grant select, insert, update, delete on all tables in schema app to service_role;
grant execute on all functions in schema app to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalogue des bonus — mêmes valeurs que `public`
-- ---------------------------------------------------------------------------
-- Les règles sont identiques pour toutes les ligues (décision produit figée).
-- Les entrées d'exécution devenues muettes sous le barème S3
-- (premier_du_jour, avant_8h, apres_22h, seance_20min, seance_rapide,
-- jour_parfait_collectif) sont conservées : le fil et l'UI les affichent encore.

insert into app.bonus_catalog (key, kind, emoji, label, points, sort, ladder, family, double_event) values
  ('jumping_jacks_100', 'exercise', '🤸', '100 jumping jacks', 3, 10, 'jumping_jacks', 'cardio', null),
  ('premier_du_jour', 'execution', '🌅', 'Premier à terminer', 3, 10, null, null, null),
  ('avant_8h', 'execution', '🔥', 'Fini avant 8h', 3, 11, null, null, null),
  ('jumping_jacks_200', 'exercise', '🤸', '200 jumping jacks', 5, 11, 'jumping_jacks', 'cardio', null),
  ('apres_22h', 'execution', '🌙', 'Fini après 22h', 2, 12, null, null, null),
  ('climbers_100', 'exercise', '🧗', '100 mountain climbers', 4, 12, 'climbers', 'cardio', null),
  ('climbers_200', 'exercise', '🧗', '200 mountain climbers', 7, 13, 'climbers', 'cardio', null),
  ('seance_20min', 'execution', '⚡', 'Séance complète en moins de 20 min', 2, 13, null, null, null),
  ('seance_rapide', 'execution', '🥇', 'Séance la plus rapide de la journée', 2, 14, null, null, null),
  ('squats_jump_50', 'exercise', '🐸', '50 squats jump', 4, 14, 'squats_jump', 'cardio', 'squats_double'),
  ('retour', 'execution', '🔙', 'Le retour : 3/3 après un jour à zéro', 3, 15, null, null, null),
  ('squats_jump_100', 'exercise', '🐸', '100 squats jump', 7, 15, 'squats_jump', 'cardio', 'squats_double'),
  ('burpees_30', 'exercise', '💥', '30 burpees', 4, 16, 'burpees', 'cardio', null),
  ('jour_parfait_collectif', 'execution', '🤝', 'Jour parfait collectif : toute la bande à 3/3', 5, 16, null, null, null),
  ('burpees_60', 'exercise', '💥', '60 burpees', 7, 17, 'burpees', 'cardio', null),
  ('duel_hebdo', 'execution', '⚔️', 'Duel de la semaine', 3, 17, null, null, null),
  ('corde_10min', 'exercise', '🪢', '10 min de corde à sauter', 5, 18, null, 'cardio', null),
  ('prime_hebdo', 'execution', '🏆', 'Semaine gagnée', 3, 18, null, null, null),
  ('course_5km', 'exercise', '🏃', '5 km de course', 8, 19, null, 'cardio', null),
  ('semaine_pleine', 'execution', '📅', 'La semaine pleine : 7 jours parfaits', 5, 19, null, null, null),
  ('abdos_double', 'event', '🎲', 'Les abdos comptent double aujourd''hui', 1, 20, null, null, null),
  ('course_10km', 'exercise', '🏃', '10 km de course', 20, 20, null, 'cardio', null),
  ('pompes_double', 'event', '🎲', 'Les pompes comptent double aujourd''hui', 1, 20, null, null, null),
  ('squats_double', 'event', '🎲', 'Les squats comptent double aujourd''hui', 1, 20, null, null, null),
  ('happy_hour', 'event', '🍻', 'Happy hour : séance finie entre 18h et 20h', 5, 21, null, null, null),
  ('marches_500', 'exercise', '🪜', '500 marches', 5, 21, null, 'cardio', null),
  ('pas_10000', 'exercise', '🚶', '10 000 pas', 4, 22, null, 'cardio', null),
  ('boss_dimanche', 'event', '👊', 'Boss du dimanche : 200 pompes au total', 10, 23, null, null, null),
  ('leve_tot', 'event', '🌄', 'Lève-tôt : séance finie avant 7h', 6, 24, null, null, null),
  ('quitte_ou_double', 'event', '🎰', 'Quitte ou double : ta base du jour ×2 si 3/3', 0, 25, null, null, null),
  ('jour_miroir', 'event', '🪞', 'Jour miroir : le dernier au classement est reboosté', 8, 26, null, null, null),
  ('cap_claims_jour', 'cap', '', 'Bonus d''exercice max par jour', 99, 30, null, null, null),
  ('pompes_50', 'exercise', '💪', '+50 pompes', 4, 30, 'pompes', 'haut', 'pompes_double'),
  ('cap_points_semaine', 'cap', '', 'Plafond pts bonus exercice / 7 jours', 999, 31, null, null, null),
  ('pompes_100', 'exercise', '💪', '+100 pompes', 7, 31, 'pompes', 'haut', 'pompes_double'),
  ('cap_seance_20min', 'cap', '', 'Seuil séance rapide (secondes)', 1200, 32, null, null, null),
  ('dips_50', 'exercise', '💺', '50 dips sur chaise', 4, 32, null, 'haut', 'pompes_double'),
  ('cap_seance_min', 'cap', '', 'Durée minimale plausible (secondes)', 300, 33, null, null, null),
  ('abdos_100', 'exercise', '🫁', '+100 abdos', 4, 40, 'abdos', 'abdos', 'abdos_double'),
  ('abdos_200', 'exercise', '🫁', '+200 abdos', 7, 41, 'abdos', 'abdos', 'abdos_double'),
  ('gainage_3min', 'exercise', '🧱', '3 min de gainage', 3, 42, null, 'abdos', 'abdos_double'),
  ('squats_100', 'exercise', '🦵', '+100 squats', 4, 50, 'squats', 'jambes', 'squats_double'),
  ('squats_200', 'exercise', '🦵', '+200 squats', 7, 51, 'squats', 'jambes', 'squats_double'),
  ('fentes_100', 'exercise', '🧎', '100 fentes', 4, 52, 'fentes', 'jambes', null),
  ('fentes_200', 'exercise', '🧎', '200 fentes', 7, 53, 'fentes', 'jambes', null),
  ('chaise_3min', 'exercise', '🪑', '3 min de chaise murale', 3, 54, null, 'jambes', null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Temps réel
-- ---------------------------------------------------------------------------
-- Le filtre par ligue se fait CÔTÉ CLIENT : le hook ignore un événement dont le
-- player_id n'est pas dans sa ligue. Au volume visé c'est suffisant, et ça évite
-- un canal Supabase par ligue.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table app.entries;
  end if;
end $$;
