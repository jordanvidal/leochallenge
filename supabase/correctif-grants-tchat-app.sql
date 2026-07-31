-- =============================================================
-- Correctif — les tables du tchat de `app` sont inaccessibles.
--
-- SANS RAPPORT AVEC LES PHOTOS. Bug préexistant, découvert en
-- vérifiant migration44 le 31/07.
--
-- Ce qui s'est passé : migration36 (l. 370) a donné les droits avec
-- `on all tables in schema app`, ce qui ne vaut QUE pour les tables
-- existant à cet instant. migration43 a créé les quatre tables du
-- tchat après coup, sans refaire de grant, et aucun
-- `alter default privileges` n'a jamais été posé sur ce schéma.
--
-- Conséquence en production depuis le 29/07 : sur une ligue, les
-- quatre tables du tchat répondent « permission denied » à la clé
-- anonyme. La RLS était pourtant bien en place — mais une policy
-- n'accorde rien, elle filtre ce qui a déjà été accordé.
--
-- Le challenge d'origine (`public`) n'est pas touché.
--
-- Vérifié avant écriture : app.players et app.entries répondent
-- normalement, app.chat_messages / chat_reactions / chat_reads /
-- chat_prefs répondent 42501.
-- =============================================================

grant select, insert, update, delete
  on app.chat_messages, app.chat_reactions, app.chat_reads, app.chat_prefs
  to anon, authenticated, service_role;

-- Et la cause racine, pour que la prochaine table créée dans `app`
-- n'ait pas à attendre un correctif : les droits par défaut. Sans
-- ça, le piège se retend au prochain `create table`.
alter default privileges in schema app
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;

-- =============================================================
-- Vérification :
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'app'
--      and table_name like 'chat_%'
--      and grantee = 'anon'
--    order by table_name, privilege_type;
--   -- attendu : 16 lignes (4 tables x 4 droits)
-- =============================================================
