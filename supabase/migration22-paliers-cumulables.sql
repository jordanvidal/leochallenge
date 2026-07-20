-- =============================================================
-- Migration 22 : les paliers d'une même échelle deviennent cumulables.
--
-- Depuis la migration 10, cocher « +50 pompes » fermait « +100
-- pompes » : la crainte était que les 50 premières comptent double.
-- Elle ne tient plus. Les puces sont des déclarations de volume, pas
-- des niveaux exclusifs — cocher les deux, c'est annoncer 150 pompes,
-- et 4+7 = 11 pts les paie une fois chacune. La règle datait des
-- plafonds (3 bonus/jour, 25 pts/7 j), tous deux levés depuis
-- (migrations 16 et 20) ; c'en était le dernier vestige, et il bloquait
-- ceux qui font 150 pompes.
--
-- Le reste du garde ne bouge pas : jour futur, fenêtre 48h, boss du
-- dimanche, bonus inconnu, et les deux plafonds toujours lus au
-- catalogue à chaque insertion. La fonction est recopiée en entier
-- parce que plpgsql ne se patche pas — seul le bloc CAP_PALIER
-- disparaît.
--
-- Aucune donnée touchée : pas d'alter table, pas d'update sur les
-- déclarations. N'affecte que les écritures futures. Réversible en
-- remettant le bloc.
-- =============================================================

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
  if new.day < paris_today - 2 then
    raise exception 'JOUR_VERROUILLE: fenêtre d''édition de 48h dépassée';
  end if;

  new.points := cat.points;
  new.created_at := now();

  if cat.kind = 'exercise' then
    -- (Le bloc CAP_PALIER vivait ici. Voir l'en-tête.)

    -- Garde-fou : N bonus d'exercice max par jour.
    select count(*) into nb
    from public.bonus_claims bc
    join public.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
    where bc.player_id = new.player_id and bc.day = new.day;
    if nb >= cap_day then
      raise exception 'CAP_JOUR: % bonus d''exercice max par jour', cap_day;
    end if;

    -- Plafond glissant sur 7 jours : on teste la pire fenêtre.
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
