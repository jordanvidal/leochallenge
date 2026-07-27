-- =============================================================
-- migration35 — le classement arrête de tout recalculer 4 fois
-- =============================================================
--
-- Symptôme : « Calcul en cours… » qui traîne à l'ouverture du
-- Classement, parfois plus d'une seconde sur téléphone.
--
-- Cause : `leaderboard()` lisait `public.daily_points` dans quatre
-- CTE distinctes (pts, last_perfect, last_kept, joker_used). Chacune
-- n'étant référencée qu'une fois, Postgres les inline — et réévalue
-- donc la vue entière quatre fois par appel. Or `daily_points`, ce
-- sont ~32 CTE empilées (séries, jokers, doublements, primes hebdo,
-- miroirs…) : son coût est du CPU de plan, quasi indépendant du
-- volume. Mesuré en prod sur 78 entries / 9 joueurs :
--
--     daily_points seule ............  73 ms
--     leaderboard() .................  259 ms   (≈ 4 × 73)
--
-- Et le client en tire trois en parallèle à chaque ouverture (total,
-- semaine, semaine dernière) : douze recalculs complets de la vue
-- pour afficher neuf lignes.
--
-- Correctif : une seule lecture de `daily_points`, forcée avec
-- `as materialized`, dont les quatre agrégats dérivent. Même sortie,
-- au bit près — seul le plan change.
--
--     leaderboard() ................. 77 ms   (×3,4)
--
-- Ce que la migration ne change PAS, volontairement :
--   * la signature de la fonction (mêmes colonnes, même ordre) ;
--   * le fait que `pts` soit borné par p_from/p_until alors que
--     last_perfect / last_kept / joker_used ne le sont jamais. La
--     série et le joker valent pour tout le challenge, pas pour la
--     fenêtre affichée — c'est la règle posée en migration24, elle
--     est reconduite telle quelle ;
--   * la vue `daily_points` elle-même, pas touchée d'une ligne.
--
-- `create or replace` : pas de drop, donc les droits en place
-- survivent et aucune vue dépendante n'est cassée.
-- =============================================================

create or replace function public.leaderboard(p_from date default null, p_until date default null)
returns table (
  player_id uuid,
  points numeric,
  rank bigint,
  perfect_days bigint,
  exos_done bigint,
  current_streak int,
  bonus_points numeric,
  joker_day date
)
language sql
stable
set search_path = public
as $$
  -- LA lecture de la vue. `as materialized` n'est pas cosmétique :
  -- sans elle, Postgres inline la CTE dans chacune des quatre
  -- références ci-dessous et on retombe sur le bug d'origine.
  with dp as materialized (
    select d.player_id, d.day, d.exos, d.perfect, d.streak_pos,
           d.points, d.bonus_points, d.jokered
    from public.daily_points d
  ),
  pts as (
    select dp.player_id,
           sum(dp.points) as points,
           sum(dp.bonus_points) as bonus_points,
           count(*) filter (where dp.perfect) as perfect_days,
           sum(dp.exos) as exos_done
    from dp
    where (p_from is null or dp.day >= p_from)
      and (p_until is null or dp.day <= p_until)
    group by dp.player_id
  ),
  last_perfect as (
    select distinct on (dp.player_id) dp.player_id, dp.day, dp.streak_pos
    from dp
    where dp.perfect
    order by dp.player_id, dp.day desc
  ),
  -- Dernier jour qui tient la chaîne : parfait OU joker.
  last_kept as (
    select distinct on (dp.player_id) dp.player_id, dp.day
    from dp
    where dp.perfect or dp.jokered
    order by dp.player_id, dp.day desc
  ),
  -- Le joker brûlé, s'il l'est. Jamais borné par p_from/p_until :
  -- il vaut pour tout le challenge, pas pour la fenêtre affichée.
  joker_used as (
    select dp.player_id, min(dp.day) as day
    from dp
    where dp.jokered
    group by dp.player_id
  )
  select
    p.id as player_id,
    round(coalesce(pts.points, 0), 1) as points,
    rank() over (order by coalesce(pts.points, 0) desc) as rank,
    coalesce(pts.perfect_days, 0) as perfect_days,
    coalesce(pts.exos_done, 0) as exos_done,
    case when lk.day >= (now() at time zone 'Europe/Paris')::date - 1
         then lp.streak_pos else 0 end as current_streak,
    round(coalesce(pts.bonus_points, 0), 1) as bonus_points,
    ju.day as joker_day
  from public.players p
  left join pts on pts.player_id = p.id
  left join last_perfect lp on lp.player_id = p.id
  left join last_kept lk on lk.player_id = p.id
  left join joker_used ju on ju.player_id = p.id
$$;

grant execute on function public.leaderboard(date, date)
  to anon, authenticated, service_role;
