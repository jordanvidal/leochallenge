-- =============================================================
-- Migration 19 : 500 marches passe de +3 à +5.
--
-- 500 marches, c'est 20 à 25 étages : un effort du même ordre que
-- 10 min de corde à sauter (+5) et nettement au-dessus de 3 min de
-- gainage (+3), avec lequel il était payé pareil. On l'aligne sur
-- la corde.
--
-- Les points sont figés à la déclaration (bonus_claims.points est
-- écrit depuis le catalogue par guard_bonus_claim) : l'historique
-- ne bouge pas, seules les déclarations futures valent 5.
-- =============================================================

update public.bonus_catalog set points = 5 where key = 'marches_500';
