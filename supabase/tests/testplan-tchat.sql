-- =============================================================
-- Plan de test — le tchat (migration41-tchat.sql)
-- =============================================================
-- À passer sur une base où migration41 est DÉJÀ appliquée.
-- Tout tourne dans UNE transaction, puis ROLLBACK : rien ne persiste,
-- ni les joueurs de test ni les messages.
--
--   psql -v ON_ERROR_STOP=1 -d <base> -f supabase/tests/testplan-tchat.sql
--
-- Lis la table finale : les 14 lignes doivent être 'OK'.
--
-- Ce que ce plan vérifie vraiment : les GARDES. La RLS de ce projet
-- est ouverte par design (pas d'auth Supabase, l'identité vit côté
-- client derrière le mot de passe de groupe) — ce sont donc les
-- triggers, et eux seuls, qui tiennent l'intégrité du tchat.
-- =============================================================

begin;

create temp table resultats (ord int, test text, detail text, ok boolean)
  on commit drop;

-- Deux joueurs de test. Le suffixe évite toute collision avec les vrais.
insert into public.players (id, name, color) values
  ('11111111-1111-1111-1111-111111111111', 'TestA', 'oklch(0.74 0.17 150)'),
  ('22222222-2222-2222-2222-222222222222', 'TestB', 'oklch(0.74 0.17 30)');

-- =============================================================
-- T1 — l'horodatage vient du serveur, quoi que dise le client
-- =============================================================
insert into public.chat_messages (id, player_id, body, created_at)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'premier message',
        '2020-01-01T00:00:00Z');

insert into resultats
select 1, 'T1 created_at forcé par le serveur',
       'created_at = ' || created_at::text,
       created_at > now() - interval '1 minute'
from public.chat_messages
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- =============================================================
-- T2 — on ne naît pas supprimé
-- =============================================================
insert into public.chat_messages (id, player_id, body, deleted_at)
values ('aaaaaaaa-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222',
        'je ne suis pas mort-né',
        now());

insert into resultats
select 2, 'T2 deleted_at forcé à null à l''insertion',
       'deleted_at = ' || coalesce(deleted_at::text, 'null'),
       deleted_at is null
from public.chat_messages
where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- =============================================================
-- T3 — 500 caractères max
-- =============================================================
do $$
begin
  insert into public.chat_messages (player_id, body)
  values ('11111111-1111-1111-1111-111111111111', repeat('x', 501));
  insert into resultats values (3, 'T3 corps > 500 refusé', 'accepté !', false);
exception when check_violation then
  insert into resultats values (3, 'T3 corps > 500 refusé', 'check_violation', true);
end $$;

-- 500 pile doit passer : la borne est inclusive.
do $$
begin
  insert into public.chat_messages (player_id, body)
  values ('11111111-1111-1111-1111-111111111111', repeat('x', 500));
  insert into resultats values (4, 'T4 corps = 500 accepté', 'inséré', true);
exception when others then
  insert into resultats values (4, 'T4 corps = 500 accepté', sqlerrm, false);
end $$;

-- =============================================================
-- T5 — corps vide ou blanc refusé
-- =============================================================
do $$
begin
  insert into public.chat_messages (player_id, body)
  values ('11111111-1111-1111-1111-111111111111', '   ');
  insert into resultats values (5, 'T5 corps blanc refusé', 'accepté !', false);
exception when check_violation then
  insert into resultats values (5, 'T5 corps blanc refusé', 'check_violation', true);
end $$;

-- =============================================================
-- T6 — la suppression douce vide le corps, et c'est le trigger qui
--      le vide (le client n'envoie que deleted_at)
-- =============================================================
update public.chat_messages
set deleted_at = now()
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into resultats
select 6, 'T6 suppression douce : corps vidé par le trigger',
       'body=' || quote_literal(body) || ' deleted_at=' ||
         coalesce(deleted_at::text, 'null'),
       body = '' and deleted_at is not null
from public.chat_messages
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- =============================================================
-- T7 — éditer un message lève CHAT_FIGE
-- =============================================================
do $$
begin
  update public.chat_messages
  set body = 'je réécris l''histoire'
  where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  insert into resultats values (7, 'T7 édition refusée', 'acceptée !', false);
exception when others then
  insert into resultats values (7, 'T7 édition refusée', sqlerrm,
    sqlerrm like 'CHAT_FIGE%');
end $$;

-- =============================================================
-- T8 — changer d'auteur lève CHAT_FIGE
-- =============================================================
do $$
begin
  update public.chat_messages
  set player_id = '11111111-1111-1111-1111-111111111111',
      deleted_at = now()
  where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  insert into resultats values (8, 'T8 changement d''auteur refusé', 'accepté !', false);
exception when others then
  insert into resultats values (8, 'T8 changement d''auteur refusé', sqlerrm,
    sqlerrm like 'CHAT_FIGE%');
end $$;

-- =============================================================
-- T9 — un message supprimé ne se dé-supprime pas
-- =============================================================
do $$
begin
  update public.chat_messages
  set deleted_at = null
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  insert into resultats values (9, 'T9 dé-suppression refusée', 'acceptée !', false);
exception when others then
  insert into resultats values (9, 'T9 dé-suppression refusée', sqlerrm,
    sqlerrm like 'CHAT_FIGE%');
end $$;

-- =============================================================
-- T10 — une réponse survit à la suppression DURE de son parent.
--       C'est le `on delete set null` : la réponse porte la moitié
--       de la conversation, elle ne part pas avec ce qu'elle citait.
--       Chemin réel : suppression d'un joueur (data.deletePlayer),
--       qui cascade sur ses messages.
-- =============================================================
insert into public.chat_messages (id, player_id, body)
values ('aaaaaaaa-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'le parent');
insert into public.chat_messages (id, player_id, body, reply_to)
values ('aaaaaaaa-0000-0000-0000-000000000004',
        '22222222-2222-2222-2222-222222222222', 'la réponse',
        'aaaaaaaa-0000-0000-0000-000000000003');

delete from public.players
where id = '11111111-1111-1111-1111-111111111111';

insert into resultats
select 10, 'T10 la réponse survit à son parent',
       'reply_to = ' || coalesce(reply_to::text, 'null'),
       reply_to is null
from public.chat_messages
where id = 'aaaaaaaa-0000-0000-0000-000000000004';

-- =============================================================
-- T11 — même emoji deux fois par la même personne : refusé
-- =============================================================
insert into public.chat_reactions (message_id, player_id, emoji)
values ('aaaaaaaa-0000-0000-0000-000000000004',
        '22222222-2222-2222-2222-222222222222', '🔥');
do $$
begin
  insert into public.chat_reactions (message_id, player_id, emoji)
  values ('aaaaaaaa-0000-0000-0000-000000000004',
          '22222222-2222-2222-2222-222222222222', '🔥');
  insert into resultats values (11, 'T11 réaction en double refusée', 'acceptée !', false);
exception when unique_violation then
  insert into resultats values (11, 'T11 réaction en double refusée', 'unique_violation', true);
end $$;

-- =============================================================
-- T12 — emoji hors de la liste des cinq : refusé
-- =============================================================
do $$
begin
  insert into public.chat_reactions (message_id, player_id, emoji)
  values ('aaaaaaaa-0000-0000-0000-000000000004',
          '22222222-2222-2222-2222-222222222222', '🍕');
  insert into resultats values (12, 'T12 emoji hors liste refusé', 'accepté !', false);
exception when check_violation then
  insert into resultats values (12, 'T12 emoji hors liste refusé', 'check_violation', true);
end $$;

-- =============================================================
-- T13 — préférence de notification hors des trois valeurs : refusée
-- =============================================================
do $$
begin
  insert into public.chat_prefs (player_id, notify)
  values ('22222222-2222-2222-2222-222222222222', 'parfois');
  insert into resultats values (13, 'T13 préférence inconnue refusée', 'acceptée !', false);
exception when check_violation then
  insert into resultats values (13, 'T13 préférence inconnue refusée', 'check_violation', true);
end $$;

-- =============================================================
-- T14 — les gardes ne sont pas appelables par anon/authenticated.
--       C'est le vrai durcissement d'un schéma à RLS ouverte.
-- =============================================================
insert into resultats
select 14, 'T14 gardes non appelables via RPC',
       string_agg(p.proname || '=' ||
         coalesce(has_function_privilege('anon', p.oid, 'execute')::text, '?'), ' '),
       bool_and(not has_function_privilege('anon', p.oid, 'execute'))
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('guard_chat_message_insert',
                    'guard_chat_message_update',
                    'guard_chat_reaction_insert');

-- =============================================================
-- Verdict
-- =============================================================
select ord, test, detail, case when ok then 'OK' else '❌ ÉCHEC' end as verdict
from resultats order by ord;

select count(*) filter (where not ok) as echecs,
       count(*) as total,
       case when count(*) filter (where not ok) = 0
            then '✅ TOUT PASSE' else '❌ AU MOINS UN ÉCHEC' end as verdict_global
from resultats;

rollback;
