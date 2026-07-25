-- =============================================================
-- Migration 30 — retirer une carte de record de volume
-- =============================================================
-- La carte « nouveau record de volume » doit disparaître si le joueur
-- retire la déclaration qui l'a fait tomber : c'est une affirmation sur
-- son histoire, pas sur son geste du soir. S'il repasse sous son record,
-- la carte ment — et un fil qui garde une affirmation devenue fausse
-- contredit le principe « dire la vérité » de PRODUCT.md. Même famille
-- que la séance décochée (migration 26), à l'opposé du bonus annulé qui
-- garde sa carte (migration 5).
--
-- Pourquoi une politique et pas un trigger : la règle du record vit en
-- TypeScript (lib/records.ts), testée hors base. La réécrire en PL/pgSQL
-- ferait deux sources de vérité pour un même calcul, qui divergeraient au
-- premier palier ajouté au catalogue. C'est la route /api/moments qui
-- décide, il lui faut juste le droit de supprimer.
--
-- Pourquoi ça manquait : jusqu'ici aucune carte n'avait besoin d'être
-- effacée depuis l'appli. La séance décochée l'est par un trigger
-- `security definer` (migration 26), qui contourne RLS — la route, elle,
-- tourne avec la clé anon et n'a aucun privilège de suppression.
--
-- Portée : volontairement la plus étroite possible. Seules les cartes de
-- record de VOLUME deviennent supprimables — le record de série se dédup
-- sur une date nue (`2026-07-20`), jamais sur `vol:`, il reste donc hors
-- d'atteinte, comme toutes les autres cartes du fil.
--
-- Note de sécurité : la clé anon est publique (embarquée dans le bundle
-- de la PWA), mais elle autorise déjà l'INSERT et l'UPDATE sur
-- feed_events. Le droit de supprimer les seules cartes `vol:` n'élargit
-- donc pas la surface de façon significative.
--
-- Réversible : `drop policy feed_events_delete_volume on
-- public.feed_events;` remet l'état d'avant. Aucune donnée n'est touchée.
-- =============================================================

drop policy if exists feed_events_delete_volume on public.feed_events;

create policy feed_events_delete_volume
  on public.feed_events
  for delete
  to anon, authenticated
  using (kind = 'record' and dedupe_key like 'vol:%');
