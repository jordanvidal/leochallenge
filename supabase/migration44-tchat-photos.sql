-- =============================================================
-- Migration 44 — les photos du tchat.
--
-- Une photo est un MESSAGE, pas un objet à part. C'est toute la
-- décision de cette migration, et tout le reste en découle : on
-- répond à une photo comme à une phrase (reply_to), on y réagit
-- comme à une phrase (chat_reactions), on la supprime comme une
-- phrase (suppression douce). Aucune table nouvelle, aucun
-- deuxième vocabulaire de conversation à apprendre.
--
-- ADDITIVE des deux côtés. Le tchat vit dans DEUX schémas :
-- `public` (migration41, le challenge d'origine) et `app`
-- (migration43, les ligues). Les deux reçoivent exactement le même
-- traitement, dans cet ordre. Une seule moitié jouée, et les photos
-- marchent pour un groupe et pas pour l'autre — sans erreur visible,
-- ce qui est pire.
--
-- Les octets, eux, ne sont PAS en base. La photo de profil
-- (migration42) tient en colonne parce qu'elle pèse ~10 Ko ; une
-- photo de tchat en pèse 200 à 400. Cinquante messages par page,
-- et ouvrir l'onglet tirerait plusieurs mégaoctets — exactement ce
-- que la règle des 10 secondes interdit. La base ne garde donc que
-- le chemin dans un bucket Storage, plus les dimensions.
--
-- Les dimensions ne sont pas un ornement : sans elles, la bulle
-- naît plate et grandit quand l'image arrive, ce qui décale la
-- conversation sous le pouce de quelqu'un qui lit. Avec elles, la
-- place est réservée d'avance et rien ne saute.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Le bucket.
--
-- Public en lecture, comme le reste de ce projet est ouvert : la
-- RLS y est permissive par design (« pas de comptes », README), et
-- des URL signées qui expirent casseraient le cache du navigateur
-- sur des images qu'on rouvre tous les jours. Ce qui protège une
-- photo ici, c'est que son chemin contient un uuid : elle n'est
-- pas devinable, et le chemin ne circule que dans la base.
--
-- Deux garde-fous côté serveur, parce qu'un client peut mentir :
--  · file_size_limit  — 3 Mo, soit dix fois ce qu'un JPEG 1600px
--    réduit côté téléphone devrait peser. C'est une borne contre
--    l'accident (un envoi non redimensionné), pas contre l'abus.
--  · allowed_mime_types — JPEG seul. C'est ce que le client
--    produit après passage par canvas, et refuser le reste ferme
--    la porte au SVG, qui est du script déguisé en image.
-- -------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tchat-photos', 'tchat-photos', true, 3145728, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Les politiques d'accès aux objets. Cadrées au seul bucket
-- `tchat-photos` : les autres buckets, s'il en naît un jour, ne
-- doivent rien hériter d'ici.
--
-- Pas de politique UPDATE : une photo ne se réécrit pas, comme un
-- message ne se réécrit pas. On la supprime et on en poste une autre.
drop policy if exists tchat_photos_select on storage.objects;
drop policy if exists tchat_photos_insert on storage.objects;
drop policy if exists tchat_photos_delete on storage.objects;

create policy tchat_photos_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'tchat-photos');
create policy tchat_photos_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'tchat-photos');
create policy tchat_photos_delete on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'tchat-photos');

-- -------------------------------------------------------------
-- 2. Les colonnes, schéma `public`.
--
-- Trois colonnes et une contrainte qui les tient ensemble : une
-- photo sans ses dimensions ferait sauter la mise en page, des
-- dimensions sans photo ne veulent rien dire. C'est tout ou rien.
--
-- Le chemin est borné à 200 caractères : il est fabriqué par le
-- client (`<player_id>/<uuid>.jpg`, une centaine de caractères), et
-- une colonne texte sans borne est une invitation.
-- -------------------------------------------------------------

alter table public.chat_messages
  add column if not exists photo_path text,
  add column if not exists photo_w integer,
  add column if not exists photo_h integer;

alter table public.chat_messages
  drop constraint if exists chat_photo_complete;
alter table public.chat_messages
  add constraint chat_photo_complete check (
    (photo_path is null and photo_w is null and photo_h is null)
    or (
      photo_path is not null
      and char_length(photo_path) <= 200
      and photo_w > 0
      and photo_h > 0
    )
  );

-- Un message peut désormais n'avoir que sa photo. La légende est
-- facultative — obliger à écrire « voilà » sous chaque photo serait
-- un mot de plus à taper pour rien.
--
-- Le reste de la règle ne bouge pas : un message vivant sans corps
-- ET sans photo n'existe pas, et un message supprimé n'a plus rien.
alter table public.chat_messages
  drop constraint if exists chat_body_non_vide;
alter table public.chat_messages
  add constraint chat_body_non_vide check (
    deleted_at is not null
    or char_length(trim(body)) >= 1
    or photo_path is not null
  );

-- Le gardien de l'écriture, mis à jour pour les photos. Sa forme et
-- ses deux cas sont ceux de migration41 l. 117 — seules les
-- nouvelles colonnes s'y ajoutent.
--
-- Cas 1, la suppression douce : la photo part avec le corps. Ce
-- n'est pas cosmétique. Tant que le chemin reste en base, l'objet
-- reste servi par le bucket, et « supprimer » n'aurait supprimé
-- que l'affichage. Le client efface l'objet dans la foulée ; ici on
-- coupe au moins le lien, quoi qu'il arrive au client ensuite.
--
-- Cas 2, la référence citée qui tombe à null : la photo fait
-- maintenant partie de ce qui doit rester IDENTIQUE. Sans ces trois
-- égalités, ce cas devenait le chemin par lequel on remplace la
-- photo d'un message déjà posté.
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
-- Les deux schémas sont deux mondes séparés (migration43 l. 9) :
-- ce qui est vrai dans l'un ne l'est jamais par héritage dans
-- l'autre, il faut l'écrire deux fois.
-- -------------------------------------------------------------

alter table app.chat_messages
  add column if not exists photo_path text,
  add column if not exists photo_w integer,
  add column if not exists photo_h integer;

alter table app.chat_messages
  drop constraint if exists chat_photo_complete;
alter table app.chat_messages
  add constraint chat_photo_complete check (
    (photo_path is null and photo_w is null and photo_h is null)
    or (
      photo_path is not null
      and char_length(photo_path) <= 200
      and photo_w > 0
      and photo_h > 0
    )
  );

alter table app.chat_messages
  drop constraint if exists chat_body_non_vide;
alter table app.chat_messages
  add constraint chat_body_non_vide check (
    deleted_at is not null
    or char_length(trim(body)) >= 1
    or photo_path is not null
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
--   select count(*) from storage.buckets where id = 'tchat-photos';
--   -- attendu : 1
--
--   select table_schema, column_name
--     from information_schema.columns
--    where table_name = 'chat_messages'
--      and column_name like 'photo%'
--    order by table_schema, column_name;
--   -- attendu : 6 lignes (3 dans app, 3 dans public)
--
-- Et le refus qui compte, dans les deux schémas — un message sans
-- rien dedans doit toujours être impossible :
--
--   insert into public.chat_messages (player_id, body)
--   values ((select id from public.players limit 1), '   ');
--   -- attendu : violation de chat_body_non_vide
-- =============================================================
