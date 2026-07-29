-- migration42-code-court-search-path.sql — durcissement d'une fonction du socle
--
-- Se joue après migration36. Aucune instruction ne touche `public`.
--
-- `app.code_court()` était la seule des 28 fonctions du schéma `app` à ne pas
-- figer son `search_path`. Le linter Supabase le signale
-- (0011_function_search_path_mutable), à raison : une fonction dont le
-- `search_path` dépend de l'appelant peut voir son corps résolu autrement que
-- prévu si quelqu'un place un schéma piégé devant.
--
-- La portée réelle est étroite — la fonction n'est pas SECURITY DEFINER, elle
-- s'exécute donc avec les droits de l'appelant, et son corps n'appelle que des
-- fonctions de `pg_catalog`. C'est un durcissement, pas un correctif de faille.
-- Mais elle génère les codes d'invitation et de récupération : c'est
-- exactement le genre de fonction qu'on préfère déterministe.
--
-- migration36 n'est pas retouchée : elle est déjà appliquée. Une base rejouée
-- de zéro passe 36 puis 42 et arrive au même état que la prod.

create or replace function app.code_court(n integer default 6)
returns text
language sql
volatile
set search_path = pg_catalog, app
as $$
  select string_agg(
           substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                  1 + floor(random() * 31)::int, 1),
           '')
  from generate_series(1, n)
$$;
