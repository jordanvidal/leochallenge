-- migration37-app-gardes.sql — socle multi-ligues, phase 1 (gardes d'écriture)
--
-- Se joue après migration36-app-structure.sql. Aucune instruction ne touche
-- `public`.
--
-- Les règles vivent en base, pas seulement en React : les devtools ne servent à
-- rien. Ce fichier transpose les 17 gardes de `public` vers `app`, avec trois
-- changements de fond :
--
--   1. Le cap de 12 joueurs et l'unicité du prénom deviennent PAR LIGUE.
--   2. Les 4 contraintes CHECK qui codaient en dur la fenêtre 13/07 → 31/08
--      deviennent des triggers. Postgres interdit les sous-requêtes dans un
--      CHECK : impossible d'y lire `leagues.end_day`. Ces triggers joignent
--      players → leagues et rejettent hors fenêtre avec un message explicite.
--   3. Trois gardes d'étanchéité inter-ligues sont ajoutées (duels, commentaires,
--      réactions) : rien n'empêchait jusqu'ici d'apparier ou de commenter à
--      travers deux ligues, faute de ligues à traverser.

-- ---------------------------------------------------------------------------
-- Lecture du catalogue
-- ---------------------------------------------------------------------------

create or replace function app.bonus_value(p_key text)
returns numeric
language sql
stable
set search_path = app
as $$
  select points from app.bonus_catalog where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- La fenêtre de la ligue — ex-contraintes CHECK
-- ---------------------------------------------------------------------------
-- Générique : s'applique à toute table portant (player_id, day). Le message
-- nomme la ligue et ses bornes — c'est ce garde-fou qui attrapera les
-- incohérences de dates quand plusieurs ligues tourneront côte à côte.

create or replace function app.guard_fenetre_ligue()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  l app.leagues%rowtype;
begin
  select lg.* into l
  from app.players p
  join app.leagues lg on lg.id = p.league_id
  where p.id = new.player_id;

  if not found then
    raise exception 'JOUEUR_SANS_LIGUE: le joueur % n''est rattaché à aucune ligue', new.player_id;
  end if;

  if new.day < l.start_day or new.day > l.end_day then
    raise exception 'HORS_FENETRE: le % est hors de la ligue « % » (% → %)',
      new.day, l.name, l.start_day, l.end_day;
  end if;

  return new;
end;
$$;

-- `daily_events` est global par jour civil : il n'a pas de joueur, donc pas de
-- ligue. On vérifie seulement qu'au moins une ligue couvre ce jour — inutile de
-- tirer un événement du jour quand personne ne joue.
create or replace function app.guard_fenetre_evenement()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if not exists (
    select 1 from app.leagues
    where new.day between start_day and end_day
  ) then
    raise exception 'HORS_FENETRE: aucune ligue ne couvre le %', new.day;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Joueurs
-- ---------------------------------------------------------------------------

create or replace function app.guard_player_insert()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  l app.leagues%rowtype;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
begin
  select * into l from app.leagues where id = new.league_id;
  if not found then
    raise exception 'LIGUE_INCONNUE: aucune ligue %', new.league_id;
  end if;

  -- Arrivée tardive autorisée tant que la ligue tourne, sans rattrapage : les
  -- jours écoulés restent à zéro. Une fois la ligue finie, elle est en lecture
  -- seule — on n'y entre plus.
  if paris_today > l.end_day then
    raise exception 'LIGUE_TERMINEE: la ligue « % » s''est achevée le %', l.name, l.end_day;
  end if;

  -- Le cap était global à la base ; il est désormais compté sur LA ligue.
  if (select count(*) from app.players where league_id = new.league_id) >= 12 then
    raise exception 'CAP_JOUEURS: maximum 12 joueurs par ligue';
  end if;

  new.name := trim(new.name);
  return new;
end;
$$;

create or replace function app.guard_player_update()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'CREATED_AT_FIGE: created_at ne se modifie pas';
  end if;
  -- L'ordre d'arrivée commande la couleur et l'historique du premier du jour :
  -- un joueur ne change pas de ligue en cours de route.
  if new.league_id is distinct from old.league_id then
    raise exception 'LIGUE_FIGEE: un joueur ne change pas de ligue';
  end if;
  if old.backfill_closed_at is not null
     and new.backfill_closed_at is distinct from old.backfill_closed_at then
    raise exception 'RATTRAPAGE_VERROUILLE: le rattrapage est déjà fermé';
  end if;
  return new;
end;
$$;

create or replace function app.guard_player_delete()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if exists (select 1 from app.entries where player_id = old.id) then
    raise exception 'JOUEUR_INDESTRUCTIBLE: ce joueur a des entrées';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entrées du jour
-- ---------------------------------------------------------------------------

create or replace function app.set_completed_at()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if new.pushups and new.abs and new.squats then
    if tg_op = 'INSERT' or old.completed_at is null then
      new.completed_at := now();
    else
      -- déjà complète : l'heure d'origine est figée, valeur client ignorée
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create or replace function app.guard_entry_write()
returns trigger
language plpgsql
set search_path = app
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

-- ---------------------------------------------------------------------------
-- Séances chrono
-- ---------------------------------------------------------------------------

create or replace function app.guard_session_insert()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  -- Une séance se lance en direct : le jour et l'heure de départ
  -- sont ceux du serveur, quoi que dise le client.
  new.day := (now() at time zone 'Europe/Paris')::date;
  new.started_at := now();
  new.finished_at := null;
  new.duration_seconds := null;
  return new;
end;
$$;

create or replace function app.guard_session_update()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  min_duration int := coalesce(app.bonus_value('cap_seance_min'), 300)::int;
begin
  if old.finished_at is not null then
    raise exception 'SEANCE_FIGEE: la première séance clôturée du jour fait foi';
  end if;

  -- Le jour et le départ ne se réécrivent jamais depuis le client.
  new.day := old.day;
  new.player_id := old.player_id;

  if new.finished_at is not null then
    -- Clôture : le serveur fixe l'heure de fin et la durée.
    new.started_at := old.started_at;
    new.finished_at := now();
    new.duration_seconds := extract(epoch from now() - old.started_at)::int;
    -- Personne ne fait 300 répétitions en moins de 5 minutes.
    if new.duration_seconds < min_duration then
      raise exception 'SEANCE_TROP_COURTE: durée invraisemblable (% s)', new.duration_seconds;
    end if;
  else
    -- Relance d'une séance abandonnée : le chrono repart de zéro.
    new.started_at := now();
    new.duration_seconds := null;
  end if;
  return new;
end;
$$;

create or replace function app.guard_preset()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  -- L'horodatage vient du serveur, jamais du client. clock_timestamp()
  -- plutôt que now() : deux upserts dans la même transaction restent
  -- ordonnés, la liste MRU ne départage jamais au hasard.
  new.last_used_at := clock_timestamp();
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    -- Un upsert d'un format existant passe aussi par BEFORE INSERT :
    -- dans ce cas rien n'est créé (le conflit fera le touch), on
    -- n'élague donc pas.
    if exists (
      select 1 from app.workout_presets
      where player_id = new.player_id
        and rounds = new.rounds
        and pushups_reps = new.pushups_reps
        and abs_reps = new.abs_reps
        and squats_reps = new.squats_reps
        and rest_seconds = new.rest_seconds
    ) then
      return new;
    end if;
    -- MRU : on garde les 7 plus récents + celui qui arrive = 8 max.
    delete from app.workout_presets wp
    where wp.player_id = new.player_id
      and wp.id in (
        select id from app.workout_presets
        where player_id = new.player_id
        order by last_used_at desc
        offset 7
      );
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bonus déclarés
-- ---------------------------------------------------------------------------

create or replace function app.guard_bonus_claim()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  cat app.bonus_catalog%rowtype;
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  cap_day numeric := app.bonus_value('cap_claims_jour');
  cap_week numeric := app.bonus_value('cap_points_semaine');
  nb int;
  worst numeric;
begin
  select * into cat from app.bonus_catalog where key = new.bonus_key;
  if not found then
    raise exception 'BONUS_INCONNU: % n''est pas au catalogue', new.bonus_key;
  end if;

  if cat.kind <> 'exercise' then
    if new.bonus_key = 'boss_dimanche' then
      if not exists (
        select 1 from app.daily_events
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
  if new.day < paris_today then
    raise exception 'JOUR_VERROUILLE: seul le jour en cours est déclarable';
  end if;

  new.points := cat.points;
  new.created_at := now();

  if cat.kind = 'exercise' then
    select count(*) into nb
    from app.bonus_claims bc
    join app.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
    where bc.player_id = new.player_id and bc.day = new.day;
    if nb >= cap_day then
      raise exception 'CAP_JOUR: % bonus d''exercice max par jour', cap_day;
    end if;

    select coalesce(max(t.total), 0) into worst
    from (
      select sum(bc.points) as total
      from generate_series(new.day - 6, new.day, interval '1 day') g(w)
      join app.bonus_claims bc
        on bc.player_id = new.player_id
       and bc.day between g.w::date and g.w::date + 6
      join app.bonus_catalog c on c.key = bc.bonus_key and c.kind = 'exercise'
      group by g.w
    ) t;
    if worst + cat.points > cap_week then
      raise exception 'CAP_SEMAINE: plafond de % pts de bonus sur 7 jours', cap_week;
    end if;
  end if;

  return new;
end;
$$;

create or replace function app.guard_bonus_delete()
returns trigger
language plpgsql
set search_path = app
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

-- ---------------------------------------------------------------------------
-- Duels — étanchéité inter-ligues (nouveau)
-- ---------------------------------------------------------------------------
-- Rien n'appariait deux joueurs de ligues différentes jusqu'ici, faute de
-- deuxième ligue. Maintenant que c'est possible, on le refuse : un duel qui
-- traverse deux ligues fausserait les deux classements d'un coup.

create or replace function app.guard_duel_insert()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  ligue_a uuid;
  ligue_b uuid;
begin
  select league_id into ligue_a from app.players where id = new.player_a;
  if new.player_b is not null then
    select league_id into ligue_b from app.players where id = new.player_b;
    if ligue_a is distinct from ligue_b then
      raise exception 'DUEL_INTER_LIGUES: on n''apparie pas deux joueurs de ligues différentes';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fil d'actualité
-- ---------------------------------------------------------------------------

create or replace function app.guard_feed_event_insert()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  new.created_at := now();
  new.last_notified_at := null;
  return new;
end;
$$;

create or replace function app.guard_feed_event_update()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if new.player_id = old.player_id
     and new.kind = old.kind
     and new.dedupe_key = old.dedupe_key
     and new.created_at = old.created_at then
    -- cas 1 : seul last_notified_at change (throttle notif)
    if new.payload = old.payload then
      return new;
    end if;
    -- cas 2 : ajout de la durée sur un événement séance qui n'en avait pas
    if new.kind = 'seance'
       and not (old.payload ? 'duration_seconds')
       and new.payload - 'duration_seconds' = old.payload
       and new.last_notified_at is not distinct from old.last_notified_at then
      return new;
    end if;
  end if;
  raise exception 'FEED_FIGE: un événement du fil ne se réécrit pas';
end;
$$;

-- On ne commente et on ne réagit que dans sa propre ligue (nouveau) : le fil
-- d'une bande ne s'ouvre pas aux inconnus d'une autre.
create or replace function app.guard_feed_comment_insert()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if (select p.league_id from app.players p where p.id = new.player_id)
     is distinct from
     (select a.league_id
        from app.feed_events fe
        join app.players a on a.id = fe.player_id
       where fe.id = new.event_id)
  then
    raise exception 'FIL_HORS_LIGUE: on ne commente que dans sa ligue';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create or replace function app.guard_feed_reaction_insert()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if (select p.league_id from app.players p where p.id = new.player_id)
     is distinct from
     (select a.league_id
        from app.feed_events fe
        join app.players a on a.id = fe.player_id
       where fe.id = new.event_id)
  then
    raise exception 'FIL_HORS_LIGUE: on ne réagit que dans sa ligue';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create or replace function app.feed_on_entry_complete()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  dur int;
begin
  -- L'aller : la journée devient complète, on annonce.
  if new.completed_at is not null
     and (tg_op = 'INSERT' or old.completed_at is null) then
    select ws.duration_seconds into dur
    from app.workout_sessions ws
    where ws.player_id = new.player_id
      and ws.day = new.day
      and ws.finished_at is not null;

    insert into app.feed_events (player_id, kind, dedupe_key, payload)
    values (
      new.player_id,
      'seance',
      new.day::text,
      jsonb_strip_nulls(
        jsonb_build_object('day', new.day, 'duration_seconds', dur)
      )
    )
    on conflict (player_id, kind, dedupe_key) do nothing;
  end if;

  -- Le retour : la journée cesse d'être complète, on retire l'annonce.
  -- Les réactions et commentaires partent avec (FK en ON DELETE CASCADE).
  -- C'est le coût assumé : si quelqu'un décoche après avoir été félicité, les
  -- félicitations disparaissent. La fenêtre est courte — le trigger tire à
  -- l'instant du décochage, pas trois jours plus tard.
  if tg_op = 'UPDATE'
     and old.completed_at is not null
     and new.completed_at is null then
    delete from app.feed_events
    where player_id = new.player_id
      and kind = 'seance'
      and dedupe_key = new.day::text;
  end if;

  return null;
end;
$$;

create or replace function app.feed_on_bonus_claim()
returns trigger
language plpgsql
set search_path = app
as $$
declare
  cat app.bonus_catalog%rowtype;
begin
  select * into cat from app.bonus_catalog where key = new.bonus_key;

  insert into app.feed_events (player_id, kind, dedupe_key, payload)
  values (
    new.player_id,
    case when cat.kind = 'event' then 'event' else 'bonus' end,
    new.day::text || ':' || new.bonus_key,
    jsonb_build_object(
      'day', new.day,
      'bonus_key', new.bonus_key,
      'label', cat.label,
      'emoji', cat.emoji,
      'points', new.points
    )
  )
  on conflict (player_id, kind, dedupe_key) do nothing;
  return null;
end;
$$;

create or replace function app.feed_on_session_close()
returns trigger
language plpgsql
set search_path = app
as $$
begin
  if new.finished_at is not null and old.finished_at is null then
    update app.feed_events
    set payload = payload
      || jsonb_build_object('duration_seconds', new.duration_seconds)
    where player_id = new.player_id
      and kind = 'seance'
      and dedupe_key = new.day::text
      and not (payload ? 'duration_seconds');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Les triggers
-- ---------------------------------------------------------------------------

create trigger trg_players_insert before insert on app.players
  for each row execute function app.guard_player_insert();
create trigger trg_players_update before update on app.players
  for each row execute function app.guard_player_update();
create trigger trg_players_delete before delete on app.players
  for each row execute function app.guard_player_delete();

-- Ordre alphabétique = ordre de déclenchement dans Postgres. `trg_entries_a_*`
-- pour que la fenêtre de ligue soit vérifiée en premier : le message le plus
-- parlant gagne.
create trigger trg_entries_a_fenetre before insert or update on app.entries
  for each row execute function app.guard_fenetre_ligue();
create trigger trg_entries_completed_at before insert or update on app.entries
  for each row execute function app.set_completed_at();
create trigger trg_entries_write before insert or update on app.entries
  for each row execute function app.guard_entry_write();
create trigger trg_entries_feed after insert or update on app.entries
  for each row execute function app.feed_on_entry_complete();

create trigger trg_sessions_a_fenetre before insert or update on app.workout_sessions
  for each row execute function app.guard_fenetre_ligue();
create trigger trg_workout_sessions_insert before insert on app.workout_sessions
  for each row execute function app.guard_session_insert();
create trigger trg_workout_sessions_update before update on app.workout_sessions
  for each row execute function app.guard_session_update();
create trigger trg_workout_sessions_feed after update on app.workout_sessions
  for each row execute function app.feed_on_session_close();

create trigger trg_workout_presets_guard before insert or update on app.workout_presets
  for each row execute function app.guard_preset();

create trigger trg_claims_a_fenetre before insert or update on app.bonus_claims
  for each row execute function app.guard_fenetre_ligue();
create trigger trg_bonus_claims_insert before insert on app.bonus_claims
  for each row execute function app.guard_bonus_claim();
create trigger trg_bonus_claims_delete before delete on app.bonus_claims
  for each row execute function app.guard_bonus_delete();
create trigger trg_bonus_claims_feed after insert on app.bonus_claims
  for each row execute function app.feed_on_bonus_claim();

create trigger trg_daily_events_fenetre before insert or update on app.daily_events
  for each row execute function app.guard_fenetre_evenement();

create trigger trg_duels_insert before insert on app.duels
  for each row execute function app.guard_duel_insert();

create trigger trg_feed_events_insert before insert on app.feed_events
  for each row execute function app.guard_feed_event_insert();
create trigger trg_feed_events_update before update on app.feed_events
  for each row execute function app.guard_feed_event_update();
create trigger trg_feed_comments_insert before insert on app.feed_comments
  for each row execute function app.guard_feed_comment_insert();
create trigger trg_feed_reactions_insert before insert on app.feed_reactions
  for each row execute function app.guard_feed_reaction_insert();
