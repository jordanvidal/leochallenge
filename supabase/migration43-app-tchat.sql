-- =============================================================
-- Migration 43 — le tchat, dans le schéma `app`.
--
-- Transposition de `migration41-tchat.sql`, qui n'existe que dans
-- `public`. Le tchat a été livré en prod le 28/07, après l'écriture
-- des migrations 36 à 38 : le schéma `app` ne l'a jamais eu. Sur une
-- ligue, l'onglet Tchat s'ouvrait donc sur quatre tables absentes.
--
-- ADDITIVE et confinée à `app` : aucune instruction ne touche
-- `public`, où le groupe d'origine continue de discuter.
--
-- Un écart avec migration41, et un seul : le cadrage par ligue.
-- migration41 annonçait « une colonne league_id + un backfill ». Ce
-- n'est pas ce que fait `app` : le cadrage passe par jointure sur
-- `players.league_id`, comme pour `entries`, `feed_events` et tout
-- le reste (voir migration36). Pas de `league_id` dupliqué, donc
-- rien à maintenir en cohérence — c'est `lib/chat.ts` qui joint.
--
-- Le reste est identique au mot près : mêmes bornes, mêmes gardes,
-- mêmes politiques RLS, même durcissement des fonctions.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Les messages.
--
-- 500 caractères, pas les 140 de feed_comments : ces 140-là
-- cadrent une pique sous un moment. Un salon qui vise WhatsApp a
-- besoin de la place d'un paragraphe. 500 reste une borne — au
-- delà, c'est un mail.
--
-- Deux références facultatives, et elles ne servent pas à la même
-- chose :
--  · reply_to      — la réponse citée, un message vers un message ;
--  · feed_event_id — le rebond « En parler » depuis le fil, qui
--                    attache la conversation au fait qui l'a
--                    déclenchée. C'est le mécanisme d'amorçage de
--                    la spec (§9) : personne n'a jamais à décider
--                    d'ouvrir une conversation.
--
-- Les deux sont en `on delete set null` et jamais en cascade :
-- effacer ce qui a provoqué une réponse ne doit pas emporter la
-- réponse, elle porte la moitié de la conversation.
-- -------------------------------------------------------------

create table app.chat_messages (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references app.players (id) on delete cascade,
  body text not null,
  reply_to uuid references app.chat_messages (id) on delete set null,
  feed_event_id uuid references app.feed_events (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chat_body_500 check (char_length(body) <= 500),
  -- Un message supprimé a le corps vide : la contrainte de non-vacuité
  -- ne vaut donc que tant qu'il est vivant.
  constraint chat_body_non_vide
    check (deleted_at is not null or char_length(trim(body)) >= 1)
);

create index chat_messages_created_idx on app.chat_messages (created_at desc);
-- Sert le `set null` quand un joueur est supprimé (cascade sur ses
-- messages, puis remise à null des réponses qui les citaient).
create index chat_messages_reply_idx on app.chat_messages (reply_to)
  where reply_to is not null;

-- L'horodatage vient du serveur, quoi que dise le client. Même garde
-- que guard_feed_event_insert() (migration 5 l. 37).
create or replace function app.guard_chat_message_insert()
returns trigger
language plpgsql
security definer
set search_path = app
as $$
begin
  new.created_at := now();
  -- On ne naît pas supprimé.
  new.deleted_at := null;
  return new;
end;
$$;

create trigger trg_chat_messages_insert
  before insert on app.chat_messages
  for each row execute function app.guard_chat_message_insert();

-- Un message ne se réécrit pas. DEUX transitions seulement passent.
--
-- Cas 1, la suppression douce : deleted_at va de null à maintenant, et
-- le corps est vidé dans le même mouvement. C'est le trigger qui le
-- vide, pas le client — on ne lui fait pas confiance pour effacer.
--
-- Cas 2, une référence citée qui disparaît. Ce n'est PAS un cas
-- théorique et il a coûté un échec de test : `on delete set null`
-- s'exécute comme un UPDATE sur cette table, donc il passe par ce
-- trigger. Sans cette branche, supprimer un joueur (data.deletePlayer)
-- casse en entier dès que quelqu'un a répondu à l'un de ses messages.
-- La branche est étroite : le corps, l'auteur, la date et l'état de
-- suppression doivent être identiques, et une seule des deux
-- références bascule, vers null et jamais l'inverse.
--
-- Un client mal intentionné pourrait emprunter le cas 2 pour détacher
-- une citation. C'est assumé : l'effet est cosmétique, la RLS de ce
-- projet est ouverte par design, et fermer ce chemin fermerait aussi
-- celui de la clé étrangère.
--
-- Tout le reste lève. Pas d'édition : un message édité dans un groupe
-- de six, c'est une dispute sur ce qui a été dit. Supprimer et
-- réécrire suffit, et c'est honnête.
create or replace function app.guard_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = app
as $$
begin
  -- Cas 1 : la suppression douce.
  if old.deleted_at is null
     and new.deleted_at is not null
     and new.player_id = old.player_id
     and new.created_at = old.created_at
     and new.reply_to is not distinct from old.reply_to
     and new.feed_event_id is not distinct from old.feed_event_id then
    new.deleted_at := now();
    new.body := '';
    return new;
  end if;

  -- Cas 2 : une référence citée tombe à null (clé étrangère).
  if new.player_id = old.player_id
     and new.created_at = old.created_at
     and new.body = old.body
     and new.deleted_at is not distinct from old.deleted_at
     and (
       (new.reply_to is null and old.reply_to is not null
        and new.feed_event_id is not distinct from old.feed_event_id)
       or
       (new.feed_event_id is null and old.feed_event_id is not null
        and new.reply_to is not distinct from old.reply_to)
     ) then
    return new;
  end if;

  raise exception 'CHAT_FIGE: un message ne se réécrit pas, il se supprime';
end;
$$;

create trigger trg_chat_messages_update
  before update on app.chat_messages
  for each row execute function app.guard_chat_message_update();

alter table app.chat_messages enable row level security;

-- Pas de policy DELETE : la suppression est douce (update ci-dessus).
-- Une vraie ligne effacée laisserait les réponses qui la citaient
-- incompréhensibles.
create policy chat_messages_select on app.chat_messages
  for select to anon, authenticated using (true);
create policy chat_messages_insert on app.chat_messages
  for insert to anon, authenticated with check (true);
create policy chat_messages_update on app.chat_messages
  for update to anon, authenticated using (true) with check (true);

-- -------------------------------------------------------------
-- 2. Les réactions.
--
-- La MÊME liste de cinq emojis que le fil (REACTION_EMOJIS dans
-- lib/feed.ts l. 13, contrainte feed_reactions.emoji migration 5
-- l. 214). Deux vocabulaires d'emojis dans la même app seraient une
-- incohérence gratuite, et un sélecteur complet serait un menu de
-- plus dans un geste qui doit coûter un tap.
-- -------------------------------------------------------------

create table app.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references app.chat_messages (id) on delete cascade,
  player_id uuid not null references app.players (id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '🔥', '💪', '😂', '💀')),
  created_at timestamptz not null default now(),
  unique (message_id, player_id, emoji)
);

create index chat_reactions_message_idx on app.chat_reactions (message_id);

create or replace function app.guard_chat_reaction_insert()
returns trigger
language plpgsql
security definer
set search_path = app
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger trg_chat_reactions_insert
  before insert on app.chat_reactions
  for each row execute function app.guard_chat_reaction_insert();

alter table app.chat_reactions enable row level security;

-- Pas de policy UPDATE : un retap enlève, exactement comme
-- feed_reactions (migration 5 l. 239).
create policy chat_reactions_select on app.chat_reactions
  for select to anon, authenticated using (true);
create policy chat_reactions_insert on app.chat_reactions
  for insert to anon, authenticated with check (true);
create policy chat_reactions_delete on app.chat_reactions
  for delete to anon, authenticated using (true);

-- -------------------------------------------------------------
-- 3. Lecture et présence. Deux colonnes, deux usages distincts, et
--    c'est la table la plus importante de la migration.
--
--  · last_read_at porte la pastille de non-lus. En base et pas en
--    localStorage, pour la raison donnée en tête de fichier.
--
--  · last_seen_at est un battement de présence, envoyé toutes les
--    30 s tant que l'écran du tchat est monté ET visible. Il sert
--    à UNE chose : ne pas notifier quelqu'un qui a la conversation
--    sous les yeux. Sans lui, six personnes qui discutent en direct
--    reçoivent une notification par message qu'elles voient déjà.
--    Le serveur exclut qui a moins de 90 s (trois battements, donc
--    une marge d'un battement perdu).
--
-- Cette table n'est PAS publiée en realtime : six battements par
-- minute diffusés à tout le monde, c'est du bruit pur pour un
-- affichage qu'on n'a même pas décidé de faire.
-- -------------------------------------------------------------

create table app.chat_reads (
  player_id uuid primary key references app.players (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table app.chat_reads enable row level security;

create policy chat_reads_select on app.chat_reads
  for select to anon, authenticated using (true);
create policy chat_reads_insert on app.chat_reads
  for insert to anon, authenticated with check (true);
create policy chat_reads_update on app.chat_reads
  for update to anon, authenticated using (true) with check (true);

-- -------------------------------------------------------------
-- 4. Les préférences de notification.
--
-- Le tchat notifie CHAQUE message (docs/spec-tchat.md §7) : c'est
-- la seule façon qu'un salon se découvre, et c'est aussi la
-- meilleure façon de faire désinstaller l'app. Ce réglage est donc
-- une condition de la décision, pas une option — et il est
-- accessible depuis le tchat lui-même, pas enterré ailleurs : un
-- mute qu'on ne trouve pas ne sert à rien, et celui qui veut couper
-- le bruit le veut à l'instant où le bruit le dérange.
--
-- Ligne absente = 'tous'. On ne pré-remplit pas la table.
-- -------------------------------------------------------------

create table app.chat_prefs (
  player_id uuid primary key references app.players (id) on delete cascade,
  notify text not null default 'tous'
    check (notify in ('tous', 'mentions', 'aucune')),
  updated_at timestamptz not null default now()
);

alter table app.chat_prefs enable row level security;

create policy chat_prefs_select on app.chat_prefs
  for select to anon, authenticated using (true);
create policy chat_prefs_insert on app.chat_prefs
  for insert to anon, authenticated with check (true);
create policy chat_prefs_update on app.chat_prefs
  for update to anon, authenticated using (true) with check (true);

-- -------------------------------------------------------------
-- 5. Le temps réel. Même motif idempotent que migration12-realtime.
--    chat_reads en est volontairement absente (voir §3).
--
--    `replica identity full` sur chat_reactions : sans elle, la
--    charge d'un DELETE ne porte que la clé primaire, et le client
--    ne saurait pas QUEL emoji vient de disparaître ni sur quel
--    message — donc il ne pourrait pas retirer la bonne pastille.
-- -------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table app.chat_messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table app.chat_reactions;
exception
  when duplicate_object then null;
end $$;

alter table app.chat_reactions replica identity full;

-- -------------------------------------------------------------
-- 6. Durcissement : les fonctions de garde ne sont pas appelables
--    via l'API RPC. Même politique que les migrations 1 à 5
--    (migration 5 l. 293-299) — c'est le durcissement qui compte
--    vraiment dans un schéma dont la RLS est ouverte par design.
-- -------------------------------------------------------------

revoke execute on function app.guard_chat_message_insert() from public, anon, authenticated;
revoke execute on function app.guard_chat_message_update() from public, anon, authenticated;
revoke execute on function app.guard_chat_reaction_insert() from public, anon, authenticated;
