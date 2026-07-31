-- =============================================================
-- Migration 45 — les notes vocales du tchat.
--
-- Même décision qu'en migration44, et pour les mêmes raisons : un
-- vocal est un MESSAGE. On y répond, on y réagit, on le supprime
-- comme une phrase. Aucune table nouvelle, aucun deuxième
-- vocabulaire de conversation à apprendre.
--
-- ADDITIVE des deux côtés. Le tchat vit dans DEUX schémas :
-- `public` (migration41) et `app` (migration43, les ligues). Les
-- deux reçoivent exactement le même traitement, dans cet ordre.
-- Une seule moitié jouée, et les vocaux marchent pour un groupe et
-- pas pour l'autre — sans erreur visible, ce qui est pire.
--
-- Les octets ne sont PAS en base, comme les photos : le chemin dans
-- un bucket, et rien d'autre.
--
-- `audio_ms` n'est pas un ornement, et c'est même plus vrai ici que
-- pour les dimensions d'une photo. Un fichier WebM produit par
-- MediaRecorder n'a PAS de durée dans son entête : le lecteur du
-- navigateur rend `Infinity` tant qu'il n'a pas tout téléchargé.
-- Sans cette colonne, une bulle vocale afficherait « ∞ » jusqu'à ce
-- qu'on la lise, et la barre de progression n'aurait aucune échelle.
-- La durée est donc mesurée à l'enregistrement, côté client, et
-- écrite ici une fois pour toutes.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Le bucket.
--
-- Mêmes règles que `tchat-photos` (migration44 §1) : public en
-- lecture, protégé par l'uuid dans le chemin, pas d'URL signée qui
-- casserait le cache.
--
-- Deux garde-fous côté serveur :
--  · file_size_limit — 2 Mo. Une minute encodée à 32 kbps pèse
--    ~240 Ko ; la borne est dix fois au-dessus, contre l'accident
--    (un navigateur qui ignore `audioBitsPerSecond` et enregistre à
--    128 kbps), pas contre l'abus.
--  · allowed_mime_types — les deux seuls formats que MediaRecorder
--    produit sur nos cibles : `audio/mp4` (AAC, ce que rend iOS et
--    ce que le client demande en priorité, parce qu'il se lit
--    PARTOUT) et `audio/webm` (Opus, la solution de repli des
--    navigateurs qui ne savent pas encoder de mp4). Refuser le
--    reste ferme la porte à tout ce qui n'est pas un vocal.
-- -------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tchat-vocaux', 'tchat-vocaux', true, 2097152, array['audio/mp4', 'audio/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cadrées au seul bucket `tchat-vocaux` : les autres buckets ne
-- doivent rien hériter d'ici.
--
-- Pas de politique UPDATE : un vocal ne se réenregistre pas, comme
-- un message ne se réécrit pas. On le supprime et on en poste un autre.
drop policy if exists tchat_vocaux_select on storage.objects;
drop policy if exists tchat_vocaux_insert on storage.objects;
drop policy if exists tchat_vocaux_delete on storage.objects;

create policy tchat_vocaux_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'tchat-vocaux');
create policy tchat_vocaux_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'tchat-vocaux');
create policy tchat_vocaux_delete on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'tchat-vocaux');

-- -------------------------------------------------------------
-- 2. Les colonnes, schéma `public`.
--
-- Deux colonnes qui vont ensemble : un chemin sans durée ferait une
-- bulle sans échelle, une durée sans chemin ne veut rien dire.
--
-- Le chemin est borné à 200 caractères, comme `photo_path` : il est
-- fabriqué par le client (`<player_id>/<uuid>.m4a`), et une colonne
-- texte sans borne est une invitation.
--
-- La durée est bornée à 65 s pour une limite produit de 60 s.
-- L'écart est délibéré : le client coupe l'enregistrement au
-- chronomètre, et MediaRecorder rend la main quelques dizaines de
-- millisecondes plus tard. Une borne à exactement 60 000 refuserait
-- en base un vocal que l'app vient d'enregistrer et de téléverser —
-- l'erreur la plus vexante qui soit, puisque les octets sont déjà
-- payés. La borne est là contre un client qui mentirait franchement,
-- pas contre l'arrondi.
-- -------------------------------------------------------------

alter table public.chat_messages
  add column if not exists audio_path text,
  add column if not exists audio_ms integer;

alter table public.chat_messages
  drop constraint if exists chat_audio_complete;
alter table public.chat_messages
  add constraint chat_audio_complete check (
    (audio_path is null and audio_ms is null)
    or (
      audio_path is not null
      and char_length(audio_path) <= 200
      and audio_ms > 0
      and audio_ms <= 65000
    )
  );

-- Une pièce jointe à la fois. Un message qui porterait une photo ET
-- un vocal n'a pas de rendu : la bulle devrait choisir lequel des
-- deux gestes le tap déclenche (ouvrir la photo, ou lancer la
-- lecture), et il n'y a pas de bonne réponse. L'app n'en fabrique
-- jamais ; la base refuse d'en garder un, ce qui est la seule
-- version de cette règle qui survivra au prochain composeur.
alter table public.chat_messages
  drop constraint if exists chat_piece_unique;
alter table public.chat_messages
  add constraint chat_piece_unique check (
    photo_path is null or audio_path is null
  );

-- Un message peut désormais n'avoir que son vocal. La légende reste
-- facultative, comme sous une photo.
--
-- Le reste de la règle ne bouge pas : un message vivant sans corps,
-- sans photo ET sans vocal n'existe pas, et un message supprimé n'a
-- plus rien.
alter table public.chat_messages
  drop constraint if exists chat_body_non_vide;
alter table public.chat_messages
  add constraint chat_body_non_vide check (
    deleted_at is not null
    or char_length(trim(body)) >= 1
    or photo_path is not null
    or audio_path is not null
  );

-- Le gardien de l'écriture, mis à jour pour les vocaux. Sa forme et
-- ses deux cas sont ceux de migration44 — seules les nouvelles
-- colonnes s'y ajoutent.
--
-- Cas 1, la suppression douce : le vocal part avec le corps. Tant
-- que le chemin reste en base, l'objet reste servi par le bucket, et
-- « supprimer » n'aurait supprimé que l'affichage.
--
-- Cas 2, la référence citée qui tombe à null : le vocal fait partie
-- de ce qui doit rester IDENTIQUE. Sans ces deux égalités, ce cas
-- devenait le chemin par lequel on remplace le vocal d'un message
-- déjà posté.
create or replace function public.guard_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = public
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
    new.photo_path := null;
    new.photo_w := null;
    new.photo_h := null;
    new.audio_path := null;
    new.audio_ms := null;
    return new;
  end if;

  -- Cas 2 : une référence citée tombe à null (clé étrangère).
  if new.player_id = old.player_id
     and new.created_at = old.created_at
     and new.body = old.body
     and new.deleted_at is not distinct from old.deleted_at
     and new.photo_path is not distinct from old.photo_path
     and new.photo_w is not distinct from old.photo_w
     and new.photo_h is not distinct from old.photo_h
     and new.audio_path is not distinct from old.audio_path
     and new.audio_ms is not distinct from old.audio_ms
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

-- -------------------------------------------------------------
-- 3. Les mêmes colonnes, schéma `app`.
--
-- Copie au mot près de la section 2, `public` remplacé par `app`.
-- Les deux schémas sont deux mondes séparés (migration43 l. 9) : ce
-- qui est vrai dans l'un ne l'est jamais par héritage dans l'autre,
-- il faut l'écrire deux fois.
-- -------------------------------------------------------------

alter table app.chat_messages
  add column if not exists audio_path text,
  add column if not exists audio_ms integer;

alter table app.chat_messages
  drop constraint if exists chat_audio_complete;
alter table app.chat_messages
  add constraint chat_audio_complete check (
    (audio_path is null and audio_ms is null)
    or (
      audio_path is not null
      and char_length(audio_path) <= 200
      and audio_ms > 0
      and audio_ms <= 65000
    )
  );

alter table app.chat_messages
  drop constraint if exists chat_piece_unique;
alter table app.chat_messages
  add constraint chat_piece_unique check (
    photo_path is null or audio_path is null
  );

alter table app.chat_messages
  drop constraint if exists chat_body_non_vide;
alter table app.chat_messages
  add constraint chat_body_non_vide check (
    deleted_at is not null
    or char_length(trim(body)) >= 1
    or photo_path is not null
    or audio_path is not null
  );

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
    new.photo_path := null;
    new.photo_w := null;
    new.photo_h := null;
    new.audio_path := null;
    new.audio_ms := null;
    return new;
  end if;

  -- Cas 2 : une référence citée tombe à null (clé étrangère).
  if new.player_id = old.player_id
     and new.created_at = old.created_at
     and new.body = old.body
     and new.deleted_at is not distinct from old.deleted_at
     and new.photo_path is not distinct from old.photo_path
     and new.photo_w is not distinct from old.photo_w
     and new.photo_h is not distinct from old.photo_h
     and new.audio_path is not distinct from old.audio_path
     and new.audio_ms is not distinct from old.audio_ms
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

-- =============================================================
-- Vérification, à jouer juste après.
--
--   select count(*) from storage.buckets where id = 'tchat-vocaux';
--   -- attendu : 1
--
--   select table_schema, column_name
--     from information_schema.columns
--    where table_name = 'chat_messages'
--      and column_name like 'audio%'
--    order by table_schema, column_name;
--   -- attendu : 4 lignes (2 dans app, 2 dans public)
--
-- Et les deux refus qui comptent, dans les deux schémas :
--
--   insert into public.chat_messages (player_id, body)
--   values ((select id from public.players limit 1), '   ');
--   -- attendu : violation de chat_body_non_vide
--
--   insert into public.chat_messages (player_id, body, audio_path, audio_ms)
--   values ((select id from public.players limit 1), '', 'x/y.m4a', 90000);
--   -- attendu : violation de chat_audio_complete (durée hors borne)
-- =============================================================
