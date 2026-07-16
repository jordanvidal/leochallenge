-- =============================================================
-- Migration 10 : paliers de volume.
--
-- Le constat : les bonus de volume n'avaient qu'une marche
-- (+50 pompes = 4 pts). Le mec qui en fait 200 touchait la même
-- chose que celui qui en fait 150. Rien à gagner au-delà.
--
-- On ne touche PAS au plancher : les 100 du challenge restent le
-- contrat de base. On ajoute une deuxième marche au-dessus, et on
-- desserre les plafonds qui rendaient la première inatteignable
-- en fin de semaine.
--
-- Additive : aucun point déjà acquis ne bouge.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Échelles de volume.
--    Deux bonus de la même échelle = le même exercice à deux
--    hauteurs. On n'en déclare qu'un par jour, sinon les 50
--    premières pompes seraient payées deux fois.
--    ladder null = bonus hors échelle (course, gainage, corde…),
--    aucune exclusion.
-- -------------------------------------------------------------

alter table public.bonus_catalog add column if not exists ladder text;

update public.bonus_catalog set ladder = 'pompes' where key = 'pompes_50';
update public.bonus_catalog set ladder = 'abdos'  where key = 'abdos_100';
update public.bonus_catalog set ladder = 'squats' where key = 'squats_100';

-- -------------------------------------------------------------
-- 2. La deuxième marche. Rendement volontairement dégressif :
--    2× le volume pour 1,75× les points. Le volume ne doit pas
--    rattraper la régularité, il l'assaisonne.
-- -------------------------------------------------------------

insert into public.bonus_catalog (key, kind, emoji, label, points, sort, ladder) values
  ('pompes_100', 'exercise', '💪', '+100 pompes', 7, 2, 'pompes'),
  ('abdos_200',  'exercise', '🫁', '+200 abdos',  7, 4, 'abdos'),
  ('squats_200', 'exercise', '🦵', '+200 squats', 7, 6, 'squats')
on conflict (key) do nothing;

-- Les marches d'une même échelle doivent se suivre dans la rangée
-- de puces : 50 puis 100, 100 puis 200.
update public.bonus_catalog set sort = 1  where key = 'pompes_50';
update public.bonus_catalog set sort = 3  where key = 'abdos_100';
update public.bonus_catalog set sort = 5  where key = 'squats_100';
update public.bonus_catalog set sort = 7  where key = 'course_5km';
update public.bonus_catalog set sort = 8  where key = 'gainage_3min';
update public.bonus_catalog set sort = 9  where key = 'corde_10min';
update public.bonus_catalog set sort = 10 where key = 'marches_500';

-- -------------------------------------------------------------
-- 3. Plafonds desserrés.
--    Une marche à 7 pts consomme 35 % de l'ancien plafond hebdo :
--    la nouvelle marche serait inatteignable dès le mercredi.
--    2 → 3 claims/jour, 20 → 25 pts / 7 jours.
--
--    25 pts, c'est ~26 % du total d'une semaine parfaite (70 pts
--    de base à ×2 + bonus). La régularité reste le moteur.
--    Ces deux valeurs sont des lignes de catalogue : si c'est trop
--    serré ou trop lâche, c'est un UPDATE, pas une migration.
-- -------------------------------------------------------------

update public.bonus_catalog set points = 3  where key = 'cap_claims_jour';
update public.bonus_catalog set points = 25 where key = 'cap_points_semaine';

-- -------------------------------------------------------------
-- 4. Le garde : ajout de la règle d'échelle.
--    Le reste de la fonction est identique à la migration 3 —
--    recréée en entier parce que plpgsql ne se patche pas.
-- -------------------------------------------------------------

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
    -- Une seule marche par échelle et par jour : +50 pompes OU
    -- +100 pompes, jamais les deux (les 50 premières compteraient double).
    if cat.ladder is not null then
      if exists (
        select 1
        from public.bonus_claims bc
        join public.bonus_catalog c on c.key = bc.bonus_key
        where bc.player_id = new.player_id
          and bc.day = new.day
          and c.ladder = cat.ladder
      ) then
        raise exception 'CAP_PALIER: un seul palier de % par jour', cat.ladder;
      end if;
    end if;

    -- Garde-fou : N bonus d'exercice max par jour.
    select count(*) into nb
    from public.bonus_claims bc
    join public.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
    where bc.player_id = new.player_id and bc.day = new.day;
    if nb >= cap_day then
      raise exception 'CAP_JOUR: % bonus d''exercice max par jour', cap_day;
    end if;

    -- Garde-fou : aucune fenêtre de 7 jours contenant ce jour ne doit
    -- dépasser le plafond.
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

revoke execute on function public.guard_bonus_claim() from public, anon, authenticated;
