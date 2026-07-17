-- =============================================================
-- Migration 12 — les coches en temps réel.
-- La ligne « les potes aujourd'hui » vit en direct : quand un pote
-- coche, sa pastille pulse chez les autres sans re-fetch. Côté base,
-- il suffit d'exposer entries dans la publication supabase_realtime —
-- la RLS (lecture ouverte par design) fait le reste.
-- Idempotent : ne casse pas si la table y est déjà.
-- =============================================================

do $$
begin
  alter publication supabase_realtime add table public.entries;
exception
  when duplicate_object then null;
end $$;
