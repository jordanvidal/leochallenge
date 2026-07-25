-- =============================================================
-- Migration 31 : six bonus de cardio, et une colonne pour ranger
-- la feuille de déclaration.
--
-- Remontée du groupe : le catalogue est du renfo. Sur dix-sept
-- bonus d'exercice, quatre relèvent du cardio (course, corde,
-- marches, 10 000 pas) et trois d'entre eux sont morts — 2 à 8
-- déclarations, un ou deux joueurs. Ceux qui veulent souffler
-- plutôt que pousser n'ont rien à cocher.
--
-- Trois exercices, deux paliers chacun. Barème calé sur
-- l'existant (migration 21) : palier bas +4, palier haut +7 pour
-- les échelles, et les jumping jacks descendent d'un cran parce
-- qu'ils sont plus légers que 30 burpees. Repères :
--   100 mountain climbers ≈ 100 fentes (+4)
--   50 squats jump        ≈ 30 burpees (+4)
--   200 jumping jacks     ≈ 10 min de corde (+5)
--
-- Chaque exercice a SON échelle. `squats_jump` n'est surtout pas
-- l'échelle `squats` : le record de volume (lib/records.ts) ne
-- compte que les trois exos du contrat, reconnus par `ladder`, et
-- un palier de squats sans équivalent en répétitions suspendrait
-- le calcul pour tout le monde. Les paliers se cumulent depuis la
-- migration 22 : cocher les deux jumping jacks = 300 déclarés.
--
-- La colonne `family` sert l'affichage, rien d'autre : vingt-trois
-- pastilles en vrac ne se lisent plus, la feuille les range en
-- trois paquets. Nullable, donc les lignes execution/event/cap ne
-- bougent pas, et une ligne sans famille reste affichable.
--
-- Additive : une colonne, six lignes, des `sort` renumérotés
-- (affichage seul, aucun point ne bouge). Aucune déclaration
-- existante n'est touchée.
-- =============================================================

-- -------------------------------------------------------------
-- 1. La famille d'un bonus. Sert de titre de paquet dans la
--    feuille ; l'ordre des paquets est décidé côté React, pas ici.
-- -------------------------------------------------------------

alter table public.bonus_catalog
  add column if not exists family text
  check (family is null or family in ('contrat', 'cardio', 'renfo'));

-- -------------------------------------------------------------
-- 2. Les six nouveaux. `on conflict do nothing` : rejouable.
-- -------------------------------------------------------------

insert into public.bonus_catalog (key, kind, emoji, label, points, sort, ladder, family) values
  ('jumping_jacks_100', 'exercise', '🤸', '100 jumping jacks',     3, 10, 'jumping_jacks', 'cardio'),
  ('jumping_jacks_200', 'exercise', '🤸', '200 jumping jacks',     5, 11, 'jumping_jacks', 'cardio'),
  ('climbers_100',      'exercise', '🧗', '100 mountain climbers', 4, 12, 'climbers',      'cardio'),
  ('climbers_200',      'exercise', '🧗', '200 mountain climbers', 7, 13, 'climbers',      'cardio'),
  ('squats_jump_50',    'exercise', '🐸', '50 squats jump',        4, 14, 'squats_jump',   'cardio'),
  ('squats_jump_100',   'exercise', '🐸', '100 squats jump',       7, 15, 'squats_jump',   'cardio')
on conflict (key) do nothing;

-- -------------------------------------------------------------
-- 3. Familles et ordre des dix-sept anciens.
--
--    Le contrat d'abord (c'est le challenge, en plus), le cardio
--    ensuite avec les nouveaux en tête — les vieux du cardio sont
--    ceux que personne ne coche —, le renfo en dernier.
--
--    Les burpees partent au cardio : full-body, mais c'est le
--    souffle qui lâche en premier.
-- -------------------------------------------------------------

update public.bonus_catalog set family = 'contrat', sort = v.sort
from (values
  ('pompes_50', 1), ('pompes_100', 2),
  ('abdos_100', 3), ('abdos_200', 4),
  ('squats_100', 5), ('squats_200', 6)
) as v(key, sort)
where bonus_catalog.key = v.key;

update public.bonus_catalog set family = 'cardio', sort = v.sort
from (values
  ('burpees_30', 16), ('burpees_60', 17),
  ('corde_10min', 18), ('course_5km', 19),
  ('marches_500', 20), ('pas_10000', 21)
) as v(key, sort)
where bonus_catalog.key = v.key;

update public.bonus_catalog set family = 'renfo', sort = v.sort
from (values
  ('gainage_3min', 30), ('chaise_3min', 31), ('dips_50', 32),
  ('fentes_100', 33), ('fentes_200', 34)
) as v(key, sort)
where bonus_catalog.key = v.key;
