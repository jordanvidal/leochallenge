-- =============================================================
-- Migration 32 : le récit du lundi.
--
-- Spéc : docs/spec-recit-hebdo.md.
--
-- Une carte de fil par semaine close, écrite à la bascule des semaines
-- (dimanche minuit Paris) par pg_cron. Elle raconte ce que le classement
-- ne montre pas : le sans-faute qui finit quatrième, le bond de trois
-- places, le sprint des deux derniers jours.
--
-- Ce fichier ne rédige AUCUN français. Il calcule les faits, choisit
-- l'angle, et écrit du JSON dans `payload` ; c'est `eventPhrase()` dans
-- lib/feed.ts qui écrit la phrase. Des gabarits français en PL/pgSQL
-- seraient illisibles et intestables.
--
-- DEUX BLOCS, à jouer séparément :
--   BLOC A — la contrainte et la fonction. Sans effet visible : rien ne
--            s'exécute tant qu'on n'appelle pas recit_hebdo().
--   BLOC B — l'armement pg_cron. À jouer APRÈS le rattrapage de la S2,
--            et seulement là.
-- =============================================================


-- =============================================================
-- BLOC A
-- =============================================================

-- 1. Le kind 'recit' -----------------------------------------
-- Seul geste sur le schéma. Contrainte de check uniquement : aucune
-- table, aucune colonne, aucune donnée touchée. La liste reprend
-- exactement celle en prod au 26/07, plus 'recit'.

alter table public.feed_events
  drop constraint if exists feed_events_kind_check;

alter table public.feed_events
  add constraint feed_events_kind_check check (kind = any (array[
    'seance', 'bonus', 'event', 'lead', 'co_lead', 'badge', 'record',
    'milestone', 'collectif', 'duel_start', 'duel_result', 'joker',
    'premier', 'recit'
  ]));


-- 2. La fonction ---------------------------------------------
-- Idempotente et rejouable : deux appels sur la même semaine écrivent
-- une seule carte. La garde porte sur la SEMAINE, pas sur le joueur —
-- la contrainte unique (player_id, kind, dedupe_key) ne suffirait pas,
-- puisqu'un rejeu qui élirait un autre protagoniste passerait à travers.
--
-- Déterministe : le départage descend jusqu'au prénom, donc deux appels
-- élisent le même protagoniste et écrivent le même payload.

create or replace function public.recit_hebdo(p_monday date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sunday      date := p_monday + 6;
  v_veille      date := p_monday - 1;
  v_prev_ok     boolean;   -- le classement de la veille a-t-il un sens ?
  v_last_angle  text;
  v_last_player uuid;
  v_actifs      int;
  v_c           record;    -- le candidat élu
  v_payload     jsonb;
begin
  -- Déjà écrite : on ne réveille rien.
  if exists (select 1 from feed_events
              where kind = 'recit' and dedupe_key = p_monday::text) then
    return jsonb_build_object('statut', 'deja_ecrit', 'semaine', p_monday);
  end if;

  -- Une semaine à un joueur n'a pas d'histoire.
  select count(distinct player_id) into v_actifs
    from daily_points
   where day between p_monday and v_sunday and exos > 0;
  if coalesce(v_actifs, 0) < 2 then
    return jsonb_build_object('statut', 'pas_assez_de_monde',
                              'semaine', p_monday, 'actifs', v_actifs);
  end if;

  -- Le classement de la veille ne veut rien dire si personne n'avait de
  -- points (première semaine du challenge). Même convention que
  -- lastWeekRanks côté client et que rankLine() dans lib/server/recap.ts.
  select exists (select 1 from leaderboard(null, v_veille) where points > 0)
    into v_prev_ok;

  -- L'angle de la semaine d'avant : on ne raconte pas deux fois de suite
  -- la même histoire sur le même joueur. Sans ça, deux sans-fautes
  -- consécutifs donnent deux cartes jumelles et le rendez-vous meurt.
  select payload->>'angle', player_id into v_last_angle, v_last_player
    from feed_events
   where kind = 'recit' and dedupe_key = (p_monday - 7)::text;

  with sem as (
    select dp.player_id,
           count(*) filter (where dp.perfect)  as parfaits,
           count(*) filter (where dp.exos > 0) as jours_actifs,
           count(*) filter (where dp.exos = 0) as jours_vides,
           sum(dp.points)                      as pts,
           coalesce(sum(dp.points) filter (where dp.day >= p_monday + 5), 0) as finish,
           max(dp.streak_pos)                  as serie,
           bool_or(dp.jokered)                 as joker
      from daily_points dp
     where dp.day between p_monday and v_sunday
     group by dp.player_id
  ),
  record_avant as (
    select player_id, max(streak_pos) as serie
      from daily_points where day < p_monday group by player_id
  ),
  base as (
    select s.player_id, pl.name,
           s.parfaits, s.jours_vides, s.pts, s.finish, s.serie, s.joker,
           ap.rank as rang_apres, av.rank as rang_avant,
           h.rank  as rang_hebdo,
           ap.points as pts_general, -- au général, pour l'écart au 2e
           h.points  as pts_hebdo,   -- sur la seule semaine
           coalesce(ra.serie, 0) as serie_avant
      from sem s
      join players pl on pl.id = s.player_id
      join leaderboard(null, v_sunday)      ap on ap.player_id = s.player_id
      join leaderboard(p_monday, v_sunday)  h  on h.player_id  = s.player_id
      left join leaderboard(null, v_veille) av on av.player_id = s.player_id
      left join record_avant ra on ra.player_id = s.player_id
     where s.jours_actifs > 0
  ),
  cand as (
    -- L'ordre de cette liste EST la spéc : c'est lui qui décide si la
    -- carte est intéressante ou générique (§6).
    select 1 as n, 'sans_faute_sans_recompense' as angle, b.*, 0::numeric as ampl
      from base b where b.parfaits = 7 and b.rang_apres > 1
    union all
    select 2, 'sans_faute', b.*, 0::numeric
      from base b where b.parfaits = 7 and b.rang_apres = 1
    union all
    select 3, 'bond', b.*, (b.rang_avant - b.rang_apres)::numeric
      from base b where v_prev_ok and b.rang_avant - b.rang_apres >= 2
    union all
    select 4, 'chute', b.*, (b.rang_apres - b.rang_avant)::numeric
      from base b where v_prev_ok and b.rang_apres - b.rang_avant >= 2
    union all
    -- nullif : le WHERE protège déjà de la division par zéro, mais rien
    -- ne garantit qu'il soit évalué avant la projection.
    select 5, 'finish', b.*, (b.finish / nullif(b.pts, 0))::numeric
      from base b where b.pts > 0 and b.finish >= 0.4 * b.pts
    union all
    select 6, 'serie_record', b.*, b.serie::numeric
      from base b where b.serie >= 3 and b.serie > b.serie_avant
    union all
    select 7, 'duel_departage', b.*, 1::numeric
      from base b
      join duel_results d on d.week_monday = p_monday
                         and d.winner = b.player_id and d.tiebreak_used
    union all
    select 8, 'defaut', b.*, 0::numeric
      from base b where b.rang_hebdo = 1
  )
  select * into v_c
    from cand c
   where v_last_angle is null
      or c.angle is distinct from v_last_angle
      or c.player_id is distinct from v_last_player
   order by c.n,                 -- l'angle le plus haut qui trouve preneur
            -- puis un visage neuf. Ce cran passe AVANT l'amplitude, et
            -- c'est voulu : à angle égal, que le fil change de tête vaut
            -- mieux que trois places de mieux. Sur les vraies données du
            -- 26/07, sans lui, Léo portait les deux cartes de la S2.
            (c.player_id is not distinct from v_last_player),
            c.ampl desc,         -- puis la plus grande amplitude
            c.rang_apres desc,   -- puis le plus loin de la 1re place
            c.name               -- puis l'alphabet : sans ce cran, deux
   limit 1;                      -- exécutions peuvent diverger

  if not found then
    return jsonb_build_object('statut', 'aucun_angle', 'semaine', p_monday);
  end if;

  -- Le payload : des FAITS, pas des phrases. Chaque angle emporte ce
  -- dont eventPhrase() a besoin, et rien d'autre.
  v_payload := jsonb_build_object(
    'angle',       v_c.angle,
    'week_monday', p_monday,
    'rank',        v_c.rang_apres,
    'parfaits',    v_c.parfaits,
    'points',      round(v_c.pts_hebdo, 1)
  );

  if v_c.angle = 'sans_faute_sans_recompense' then
    v_payload := v_payload || jsonb_build_object(
      -- les autres sans-fautes : la carte ne s'attribue pas un mérite
      -- collectif, elle dit qui d'autre y était
      'peers', coalesce((
        select jsonb_agg(x.name order by x.name) from (
          select pl.name
            from daily_points dp join players pl on pl.id = dp.player_id
           where dp.day between p_monday and v_sunday
             and dp.player_id <> v_c.player_id
           group by dp.player_id, pl.name
          having count(*) filter (where dp.perfect) = 7
        ) x
      ), '[]'::jsonb))
      || coalesce((
        select jsonb_build_object(
                 'leader', pl.name,
                 'leader_parfaits', (
                   select count(*) filter (where dp.perfect) from daily_points dp
                    where dp.day between p_monday and v_sunday
                      and dp.player_id = l.player_id))
          from leaderboard(null, v_sunday) l
          join players pl on pl.id = l.player_id
         where l.rank = 1 limit 1), '{}'::jsonb);

  elsif v_c.angle = 'sans_faute' then
    -- L'écart au 2e. Un seul aller-retour : le foil et son écart doivent
    -- désigner le même joueur, deux sous-requêtes pourraient diverger.
    v_payload := v_payload || coalesce((
      select jsonb_build_object('foil', pl.name,
               'gap', round(v_c.pts_general - l.points, 1))
        from leaderboard(null, v_sunday) l
        join players pl on pl.id = l.player_id
       where l.rank = 2 limit 1), '{}'::jsonb);

  elsif v_c.angle in ('bond', 'chute') then
    v_payload := v_payload || jsonb_build_object(
      'rank_before', v_c.rang_avant,
      'finish',      round(v_c.finish, 1),
      'joker',       v_c.joker,
      'jours_vides', v_c.jours_vides)
      -- le meilleur finish d'en face, pour comparer plutôt que qualifier
      || coalesce(( select jsonb_build_object(
                      'foil', pl.name, 'foil_finish', round(sum(dp.points), 1))
                      from daily_points dp join players pl on pl.id = dp.player_id
                     where dp.day between p_monday + 5 and v_sunday
                       and dp.player_id <> v_c.player_id
                     group by pl.name
                     order by sum(dp.points) desc, pl.name
                     limit 1), '{}'::jsonb);

  elsif v_c.angle = 'finish' then
    v_payload := v_payload || jsonb_build_object('finish', round(v_c.finish, 1))
      || coalesce(( select jsonb_build_object(
                      'foil', pl.name, 'foil_finish', round(sum(dp.points), 1))
                      from daily_points dp join players pl on pl.id = dp.player_id
                     where dp.day between p_monday + 5 and v_sunday
                       and dp.player_id <> v_c.player_id
                     group by pl.name
                     order by sum(dp.points) desc, pl.name
                     limit 1), '{}'::jsonb);

  elsif v_c.angle = 'serie_record' then
    v_payload := v_payload || jsonb_build_object(
      'streak', v_c.serie, 'streak_before', v_c.serie_avant
    );

  elsif v_c.angle = 'duel_departage' then
    -- Le score se lit toujours vainqueur d'abord, jamais player_a d'abord.
    v_payload := v_payload || coalesce((
      select jsonb_build_object(
        'foil',  pl.name,
        'score', case when d.winner = d.player_a
                      then d.perfect_a || '–' || d.perfect_b
                      else d.perfect_b || '–' || d.perfect_a end,
        'pointsScore', case when d.winner = d.player_a
                      then round(d.points_a, 1) || '–' || round(d.points_b, 1)
                      else round(d.points_b, 1) || '–' || round(d.points_a, 1) end)
        from duel_results d
        join players pl on pl.id = d.loser
       where d.week_monday = p_monday and d.winner = v_c.player_id
       limit 1), '{}'::jsonb);

  elsif v_c.angle = 'defaut' then
    v_payload := v_payload || coalesce((
      select jsonb_build_object('foil', pl.name,
               'gap', round(v_c.pts_hebdo - l.points, 1))
        from leaderboard(p_monday, v_sunday) l
        join players pl on pl.id = l.player_id
       where l.rank = 2 limit 1), '{}'::jsonb);
  end if;


  -- La garde atomique : sur la semaine, pas sur le joueur.
  insert into feed_events (player_id, kind, dedupe_key, payload)
  select v_c.player_id, 'recit', p_monday::text, v_payload
   where not exists (select 1 from feed_events
                      where kind = 'recit' and dedupe_key = p_monday::text);

  return jsonb_build_object(
    'statut', 'ecrit', 'semaine', p_monday,
    'angle', v_c.angle, 'joueur', v_c.name, 'payload', v_payload);
end;
$$;

comment on function public.recit_hebdo(date) is
  'Le récit du lundi : une carte de fil par semaine close. Voir docs/spec-recit-hebdo.md.';

grant execute on function public.recit_hebdo(date) to anon, authenticated;


-- =============================================================
-- BLOC B — l'armement pg_cron. À NE JOUER QU'APRÈS le rattrapage.
--
-- Dimanche 22h05 UTC = lundi 00h05 Paris en été. En hiver (après le
-- 25/10) il faut passer à 23h05 UTC, sinon la carte tombe une heure
-- trop tôt — le dimanche à 23h05, avant la bascule. À ne pas oublier.
--
-- À 00h05 Paris un lundi, la date Paris EST ce lundi : la semaine qui
-- vient de fermer est donc ce lundi moins 7. Ne pas lire l'heure UTC ici,
-- elle est encore au dimanche.
-- =============================================================
--
-- select cron.schedule(
--   'recit-hebdo',
--   '5 22 * * 0',
--   $cron$ select public.recit_hebdo(((now() at time zone 'Europe/Paris')::date) - 7) $cron$
-- );
