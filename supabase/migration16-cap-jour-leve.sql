-- =============================================================
-- Migration 16 : levée de la limite de déclarations par jour.
--
-- La limite de 3 bonus déclarés/jour frustrait les grosses séances
-- légitimes (+100 pompes + gainage + corde + marches = 4 déclas, la
-- 4e refusée) alors que le plafond de 25 pts/7 jours glissants
-- contient déjà l'inflation. On lève le comptage, on garde les points.
--
-- 99 = « illimité » : le trigger de garde lit cette valeur au
-- catalogue à chaque insertion, aucune réécriture de code. N'affecte
-- que les écritures futures — l'historique ne bouge pas. L'UI masque
-- le compteur du jour dès que la valeur passe à 99 (BonusSection).
--
-- Prochaine étape (spec validée, à venir) : déclarations au-delà du
-- plafond hebdo acceptées à 0 point et versées dans une course au
-- volume hebdomadaire — la reconnaissance sans l'inflation.
-- =============================================================

update public.bonus_catalog set points = 99 where key = 'cap_claims_jour';
