-- -------------------------------------------------------------
-- Migration 6 : plafond de la notif de dépassement.
-- Un joueur ne reçoit plus qu'UNE notif « X t'a doublé » par
-- fenêtre de 4 heures, quel que soit le nombre de dépasseurs.
-- Le verrou vit sur rank_snapshots : une ligne par joueur existe
-- déjà, et /api/moments la lit/écrit à chaque coche.
-- Additive : rien d'autre ne bouge.
-- -------------------------------------------------------------

alter table public.rank_snapshots
  add column if not exists last_overtake_at timestamptz;
