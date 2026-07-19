-- =============================================================
-- Migration 20 : levée du plafond de 25 pts de bonus / 7 jours.
--
-- Dernier garde-fou quantitatif après la levée du cap journalier
-- (migration 16). À partir de la S2, les gros volumes déclarés
-- comptent plein pot : le plafond bridait les semaines ambitieuses
-- alors que le catalogue borne déjà chaque déclaration (un palier
-- par échelle et par jour).
--
-- 999 = « illimité », même convention que le 99 du cap journalier :
-- le trigger de garde lit la valeur au catalogue à chaque insertion,
-- aucune réécriture de fonction. N'affecte que les écritures futures
-- — l'historique ne bouge pas. L'UI masque le « /25 » dès que la
-- valeur passe à 999 (BonusSection).
-- =============================================================

update public.bonus_catalog set points = 999 where key = 'cap_points_semaine';
