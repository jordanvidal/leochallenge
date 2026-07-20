-- =============================================================
-- Migration 25 — le joker s'annonce dans le fil
-- =============================================================
-- La migration 24 a posé le joker en base. Il y était invisible :
-- on ne pouvait le lire qu'au Classement, sur un bouclier estompé.
-- Or le moment où quelqu'un se fait sauver est exactement ce qui
-- mérite d'être vu par le groupe — c'est la pression sociale qui
-- fait tenir le truc (principe 4 de PRODUCT.md).
--
-- feed_events.kind est fermé par un CHECK. On l'élargit d'une
-- valeur, rien d'autre. Aucune ligne existante ne peut devenir
-- invalide en élargissant une contrainte : la migration est sûre
-- et se rejoue sans effet.
-- =============================================================

alter table public.feed_events
  drop constraint if exists feed_events_kind_check;

alter table public.feed_events
  add constraint feed_events_kind_check check (kind = any (array[
    'seance'::text,
    'bonus'::text,
    'event'::text,
    'lead'::text,
    'co_lead'::text,
    'badge'::text,
    'record'::text,
    'milestone'::text,
    'collectif'::text,
    'duel_start'::text,
    'duel_result'::text,
    'joker'::text
  ]));
