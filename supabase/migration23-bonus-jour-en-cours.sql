-- =============================================================
-- Migration 23 : les bonus s'alignent sur les exos — jour en cours
-- uniquement.
--
-- `migration9-jour-en-cours.sql` a fermé la fenêtre glissante de 48h
-- pour les exos en juillet, mais les deux gardes des bonus l'ont
-- gardée : `paris_today - 2` autorisait encore la déclaration et
-- l'annulation sur trois jours. Personne n'en a jamais profité —
-- `lib/bonus.ts` envoie `parisToday()` à l'insert comme au delete —
-- mais la base laissait passer ce que l'appli n'offre pas, et un
-- appel direct à PostgREST antidatait un bonus sans difficulté.
--
-- On resserre au lieu de supprimer : retirer la condition ouvrirait
-- la déclaration rétroactive, exactement l'inverse du but. La règle
-- devient celle de `guard_entry_write`, au mot près — jour en cours,
-- rien avant, rien après.
--
-- Effet de bord assumé : un tap à cheval sur minuit (le client a
-- calculé hier, la base voit aujourd'hui) est refusé au lieu d'être
-- absorbé. Les exos se comportent déjà comme ça depuis la migration
-- 9 ; laisser les bonus diverger serait pire, un joueur verrait sa
-- coche refusée et son bonus accepté sur la même seconde.
--
-- Aucune donnée touchée : pas d'alter table, pas d'update. Les
-- déclarations passées restent en base et continuent de compter,
-- y compris celles qui n'auraient plus le droit d'être créées.
-- N'affecte que les écritures futures. Réversible en remettant `- 2`.
-- =============================================================

-- 1. Déclaration d'un bonus. Fonction recopiée en entier (plpgsql ne
--    se patche pas) : seule la borne basse change, tout le reste —
--    catalogue, boss du dimanche, plafonds — est identique.
create or replace function public.guard_bonus_claim()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cat public.bonus_catalog%rowtype;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  cap_day numeric := public.bonus_value('cap_claims_jour');
  cap_week numeric := public.bonus_value('cap_points_semaine');
  nb int;
  worst numeric;
begin
  select * into cat from public.bonus_catalog where key = new.bonus_key;
  if not found then
    raise exception 'BONUS_INCONNU: % n''est pas au catalogue', new.bonus_key;
  end if;

  if cat.kind <> 'exercise' then
    if new.bonus_key = 'boss_dimanche' then
      if not exists (
        select 1 from public.daily_events
        where day = new.day and event_key = 'boss_dimanche'
      ) then
        raise exception 'BOSS_INACTIF: pas de boss ce jour-là';
      end if;
    else
      raise exception 'BONUS_NON_DECLARABLE: % est automatique', new.bonus_key;
    end if;
  end if;

  if new.day > paris_today then
    raise exception 'JOUR_FUTUR: on ne déclare pas en avance';
  end if;
  -- Ex-fenêtre de 48h (`paris_today - 2`). Voir l'en-tête.
  if new.day < paris_today then
    raise exception 'JOUR_VERROUILLE: seul le jour en cours est déclarable';
  end if;

  new.points := cat.points;
  new.created_at := now();

  if cat.kind = 'exercise' then
    -- (Le bloc CAP_PALIER vivait ici : migration 22, paliers cumulables.)

    select count(*) into nb
    from public.bonus_claims bc
    join public.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
    where bc.player_id = new.player_id and bc.day = new.day;
    if nb >= cap_day then
      raise exception 'CAP_JOUR: % bonus d''exercice max par jour', cap_day;
    end if;

    select coalesce(max(t.total), 0) into worst
    from (
      select sum(bc.points) as total
      from generate_series(new.day - 6, new.day, interval '1 day') g(w)
      join public.bonus_claims bc
        on bc.player_id = new.player_id
       and bc.day between g.w::date and g.w::date + 6
      join public.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
      group by g.w
    ) t;
    if worst + cat.points > cap_week then
      raise exception 'CAP_SEMAINE: plafond de % pts de bonus sur 7 jours', cap_week;
    end if;
  end if;

  return new;
end;
$$;

-- 2. Annulation d'un bonus (« erreur de pouce »). Même règle : on
--    reprend ce qu'on vient de poser, pas ce qui date d'hier.
create or replace function public.guard_bonus_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
begin
  if old.day < paris_today then
    raise exception 'JOUR_VERROUILLE: seul le jour en cours est déclarable';
  end if;
  return old;
end;
$$;
