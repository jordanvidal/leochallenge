-- migration9-jour-en-cours.sql
-- On restreint la déclaration des exos au SEUL jour en cours (heure de Paris).
-- Fini le rattrapage à l'inscription et la fenêtre glissante de 48h : on ne
-- coche que le jour même, ni le passé ni le futur.
--
-- Ne touche à aucun score existant : les entrées déjà saisies (rattrapages
-- compris) restent en base et continuent de compter. Seules les écritures
-- FUTURES sur un autre jour qu'aujourd'hui sont désormais refusées.
--
-- Colonne players.backfill_closed_at et son trigger de verrou : laissés en
-- place (dormants), rien à migrer.

create or replace function public.guard_entry_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
begin
  -- (player_id, day) reste immuable : on ne déplace pas une entrée.
  if tg_op = 'UPDATE' and (
    new.day is distinct from old.day
    or new.player_id is distinct from old.player_id
  ) then
    raise exception 'ENTREE_IMMUTABLE: (player_id, day) ne se modifie pas';
  end if;

  if new.day > paris_today then
    raise exception 'JOUR_FUTUR: on ne coche pas en avance';
  end if;

  -- Seul le jour en cours est déclarable. Tout jour écoulé est verrouillé.
  if new.day < paris_today then
    raise exception 'JOUR_VERROUILLE: seul le jour en cours est déclarable';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
