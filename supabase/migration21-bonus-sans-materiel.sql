-- =============================================================
-- Migration 21 : cinq bonus déclarables sans matériel.
--
-- Le catalogue manquait d'options les jours sans accès à rien :
-- burpees et fentes (intensité pure au poids du corps), chaise
-- murale (le jumeau statique du gainage), dips sur chaise (les
-- triceps, angle mort du challenge), 10 000 pas (le seul bonus
-- « actif toute la journée », pensé pour les vacances d'août).
--
-- Barème calé sur l'existant : palier bas +4 / palier haut +7
-- comme les échelles pompes/abdos/squats (rendement dégressif),
-- statique 3 min +3 comme le gainage. Les échelles burpees et
-- fentes passent par le même garde-fou qu'ailleurs : un seul
-- palier par échelle et par jour (guard_bonus_claim, générique).
--
-- Additive pure : des lignes de catalogue, rien d'autre. L'UI et
-- les triggers lisent la table.
-- =============================================================

insert into public.bonus_catalog (key, kind, emoji, label, points, sort, ladder) values
  ('burpees_30',  'exercise', '💥', '30 burpees',             4, 11, 'burpees'),
  ('burpees_60',  'exercise', '💥', '60 burpees',             7, 12, 'burpees'),
  ('fentes_100',  'exercise', '🧎', '100 fentes',             4, 13, 'fentes'),
  ('fentes_200',  'exercise', '🧎', '200 fentes',             7, 14, 'fentes'),
  ('dips_50',     'exercise', '💺', '50 dips sur chaise',     4, 15, null),
  ('chaise_3min', 'exercise', '🪑', '3 min de chaise murale', 3, 16, null),
  ('pas_10000',   'exercise', '🚶', '10 000 pas',             4, 17, null)
on conflict (key) do nothing;
