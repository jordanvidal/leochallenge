-- =============================================================
-- migration42 — photo de profil optionnelle
-- Une colonne `photo` sur players : data-URI JPEG, redimensionné côté
-- client (~192px, quelques Ko). Pas de bucket Storage — pour six potes,
-- stocker l'image en base directement est plus simple et suffit largement.
-- La contrainte de taille garde-fou : ~150 Ko max, très au-dessus d'un
-- avatar réel, mais empêche un envoi géant de gonfler la table.
-- Nouvelle migration, rien de modifié dans l'existant.
-- =============================================================

alter table public.players
  add column if not exists photo text
    check (photo is null or char_length(photo) <= 200000);

-- Rien d'autre à faire : la policy players_update (anon) autorise déjà
-- l'écriture, et le trigger guard_player_update ne garde que created_at
-- et backfill_closed_at — mettre à jour `photo` passe sans toucher aux
-- règles du jeu.
