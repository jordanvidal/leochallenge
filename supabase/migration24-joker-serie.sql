-- =============================================================
-- Migration 24 — le joker de série
-- =============================================================
-- Un joueur qui casse une série de 12 jours ne perd pas 12 jours :
-- il perd la raison d'ouvrir l'app demain. C'est le moment de
-- décrochage, et sur 50 jours à six il arrive forcément.
--
-- Le joker absorbe UNE journée ratée, une seule fois sur tout le
-- challenge. Règles arrêtées avec Jordan le 20/07 :
--   • un seul joker par joueur, pour les 50 jours ;
--   • il ne se déclenche qu'à partir d'une série de 3 jours (le
--     palier du ×1,5) — en dessous il n'y a rien à sauver et le
--     brûler serait du gâchis ;
--   • il est visible d'avance : une règle qui touche au score et
--     qu'on découvre après coup passe pour de la triche.
--
-- Aucune table, aucun cron, aucune écriture : le joker est DÉRIVÉ
-- de l'historique. Il ne peut donc pas se désynchroniser, se jouer
-- deux fois, ni se perdre — et il ne coûte aucune notification.
--
-- IMPACT RÉTROACTIF AU 20/07 : AUCUN. Le seul trou de série du
-- groupe appartient à Doren (14 et 15 juillet) et fait deux jours ;
-- un joker n'en couvre qu'un. Vérifié en base avant écriture.
-- Appliquer cette migration plus tard ne sera plus neutre.
--
-- Ce fichier remplace la définition de daily_points issue de la
-- migration 18 : seules les CTE de série changent, les ~300 lignes
-- de calcul de points sont reprises à l'identique.
-- =============================================================

create or replace view public.daily_points
with (security_invoker = true) as
with recursive paris as (
  select (now() at time zone 'Europe/Paris')::date as today
),
e as (
  select player_id, day,
         (pushups::int + abs::int + squats::int) as exos,
         (pushups and abs and squats) as perfect,
         pushups,
         completed_at,
         case when completed_at is not null
               and (completed_at at time zone 'Europe/Paris')::date = day
              then completed_at at time zone 'Europe/Paris'
         end as done_ts
  from public.entries
),
-- ---- La serie et le joker ---------------------------------------
-- Un joker par joueur pour tout le challenge, DERIVE : pas de table,
-- pas de cron, pas d'ecriture. Il se consomme tout seul sur le PREMIER
-- jour rate qui interrompt une serie d'au moins 3 jours parfaits, et
-- seulement si le joueur est revenu le lendemain : un joker ne sauve
-- pas quelqu'un qui a arrete, il recolle deux morceaux.
--
-- Le jour joker entre dans l'ile (la serie survit) mais ne compte PAS
-- dans streak_pos : il preserve, il ne recompense pas. Serie de 5,
-- joker, puis 3/3 => 6, pas 7. Restant non-perfect avec un streak_pos
-- nul, il ne rapporte ni multiplicateur ni points.
base_islands as (
  select player_id, day,
         (day - (row_number() over (partition by player_id order by day))::int) as island
  from e
  where perfect
),
base_streaks as (
  select player_id, day,
         (row_number() over (partition by player_id, island order by day))::int as pos
  from base_islands
),
joker as (
  select distinct on (bs.player_id)
         bs.player_id, (bs.day + 1) as day
  from base_streaks bs
  where bs.pos >= 3
    -- le lendemain n'est pas parfait : c'est la cassure
    and not exists (
      select 1 from e gap
      where gap.player_id = bs.player_id and gap.day = bs.day + 1 and gap.perfect
    )
    -- mais le surlendemain l'est : il y a bien deux morceaux a recoller
    and exists (
      select 1 from e back
      where back.player_id = bs.player_id and back.day = bs.day + 2 and back.perfect
    )
  order by bs.player_id, bs.day
),
-- Les jours qui tiennent la chaine : les parfaits, plus le jour joker.
kept as (
  select player_id, day, true as is_perfect from e where perfect
  union all
  select player_id, day, false as is_perfect from joker
),
islands as (
  select player_id, day, is_perfect,
         (day - (row_number() over (partition by player_id order by day))::int) as island
  from kept
),
-- WHERE s'applique avant la fonction de fenetre : le jour joker est
-- retire AVANT la numerotation, donc il ne consomme pas de rang.
streaks as (
  select player_id, day,
         (row_number() over (partition by player_id, island order by day))::int as streak_pos
  from islands
  where is_perfect
),
-- 🔙 le retour : 3/3 aujourd'hui, zéro hier, et déjà présent avant hier.
comeback as (
  select cur.player_id, cur.day
  from e cur
  where cur.perfect
    and not exists (
      select 1 from e prev
      where prev.player_id = cur.player_id
        and prev.day = cur.day - 1
        and prev.exos > 0
    )
    and exists (
      select 1 from e hist
      where hist.player_id = cur.player_id
        and hist.day < cur.day - 1
    )
),
-- 🤝 jour parfait collectif : la « bande du jour » = les joueurs actifs
-- sur 7 jours glissants (au moins une coche). Tous à 3/3 ce jour-là, et
-- au moins deux. Perfect ⇒ actif, donc le bonus va exactement aux 3/3.
active as (
  select distinct d.day, a.player_id
  from (select distinct day from e) d
  join e a on a.exos > 0 and a.day between d.day - 6 and d.day
),
collective_days as (
  select act.day
  from active act
  left join e cur on cur.player_id = act.player_id and cur.day = act.day
  group by act.day
  having count(*) >= 2
     and bool_and(coalesce(cur.perfect, false))
),
spine as (
  select player_id, day from e
  union
  select player_id, day from public.bonus_claims
),
-- Premier du jour. Jusqu'au 19/07 : le premier point, point. Depuis
-- le 20/07 le trophée TOURNE : si tu as été premier à finir hier,
-- le +3 du jour va au premier des autres. Exclusion d'un seul jour ;
-- tenant seul à finir = trophée non attribué ce jour-là.
first_done_old as (
  select distinct on (e.day) e.day, e.player_id
  from e, paris
  where e.done_ts is not null and e.day < paris.today
    and e.day < date '2026-07-20'
  order by e.day, e.done_ts
),
finishers as (
  select e.day, e.player_id, e.done_ts
  from e, paris
  where e.done_ts is not null and e.day < paris.today
    and e.day >= date '2026-07-20'
),
-- La chaîne jour par jour : le gagnant de la veille voyage dans la
-- récursion. Jour sans gagnant → null transmis → pas d'exclusion le
-- lendemain.
first_rot as (
  select date '2026-07-20' as day,
         (select f.player_id from finishers f
          where f.day = date '2026-07-20'
          order by f.done_ts limit 1) as winner
  from paris
  where date '2026-07-20' < paris.today
  union all
  select r.day + 1,
         (select f.player_id from finishers f
          where f.day = r.day + 1
            and (r.winner is null or f.player_id <> r.winner)
          order by f.done_ts limit 1)
  from first_rot r
  where r.day + 1 < (select today from paris)
),
first_done as (
  select day, player_id from first_done_old
  union all
  select day, winner as player_id from first_rot where winner is not null
),
claims as (
  select player_id, day, sum(points) as pts
  from public.bonus_claims
  group by player_id, day
),
timed as (
  select ws.player_id, ws.day, ws.duration_seconds, ws.finished_at
  from public.workout_sessions ws
  join e on e.player_id = ws.player_id and e.day = ws.day and e.perfect
  where ws.finished_at is not null
),
fastest_session as (
  select distinct on (t.day) t.day, t.player_id
  from timed t, paris
  where t.day < paris.today
    and (select count(*) from timed t2 where t2.day = t.day) >= 2
  order by t.day, t.duration_seconds asc, t.finished_at asc
),
base as (
  select
    s.player_id,
    s.day,
    coalesce(e.exos, 0) as exos,
    coalesce(e.perfect, false) as perfect,
    coalesce(st.streak_pos, 0) as streak_pos,
    (jk.day is not null) as jokered,
    case when coalesce(st.streak_pos, 0) >= 7 then 2.0
         when coalesce(st.streak_pos, 0) >= 3 then 1.5
         else 1.0 end as multiplier,
    (case when fd.player_id is not null
          then public.bonus_value('premier_du_jour') else 0 end
     -- dès le 20/07, ne se cumule plus avec « premier du jour » (les
     -- deux valent +3 ; si les valeurs divergent un jour, payer le
     -- plus gros des deux au lieu de supprimer celui-ci)
     + case when e.done_ts::time < time '08:00'
                 and (s.day < date '2026-07-20' or fd.player_id is null)
            then public.bonus_value('avant_8h') else 0 end
     + case when e.done_ts::time >= time '22:00'
            then public.bonus_value('apres_22h') else 0 end
     + case when tw.duration_seconds is not null
                 and tw.duration_seconds < public.bonus_value('cap_seance_20min')
            -- éclair : 5 pts figés pour la S1, valeur catalogue (2) ensuite
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_20min') end) else 0 end
     -- rapide : 5 pts figés pour la S1, valeur catalogue (2) ensuite
     + case when fw.player_id is not null
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_rapide') end) else 0 end
     + case when cb.player_id is not null
            then public.bonus_value('retour') else 0 end
     + case when cd.day is not null and coalesce(e.perfect, false)
            then public.bonus_value('jour_parfait_collectif') else 0 end
    ) as execution_bonus,
    (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
          then public.bonus_value('pompes_double') else 0 end
     + case when ev.event_key = 'happy_hour'
                 and e.done_ts::time >= time '18:00'
                 and e.done_ts::time < time '20:00'
            then public.bonus_value('happy_hour') else 0 end
     + case when ev.event_key = 'leve_tot'
                 and e.done_ts::time < time '07:00'
            then public.bonus_value('leve_tot') else 0 end
    ) as event_bonus,
    coalesce(c.pts, 0) as claim_bonus,
    ev.event_key
  from spine s
  left join e using (player_id, day)
  left join streaks st using (player_id, day)
  left join joker jk on jk.player_id = s.player_id and jk.day = s.day
  left join comeback cb on cb.player_id = s.player_id and cb.day = s.day
  left join collective_days cd on cd.day = s.day
  left join first_done fd on fd.day = s.day and fd.player_id = s.player_id
  left join timed tw on tw.player_id = s.player_id and tw.day = s.day
  left join fastest_session fw on fw.day = s.day and fw.player_id = s.player_id
  left join claims c on c.player_id = s.player_id and c.day = s.day
  left join public.daily_events ev on ev.day = s.day
),
premirror as (
  select
    player_id, day, exos, perfect, streak_pos, jokered, multiplier, event_key,
    (exos + case when perfect then 2 else 0 end) * multiplier as base_pts,
    execution_bonus, event_bonus, claim_bonus,
    case when event_key = 'quitte_ou_double' and perfect
         -- depuis le 20/07 : ne double plus que la base du jour
         then (exos + case when perfect then 2 else 0 end) * multiplier
              + case when day < date '2026-07-20'
                     then execution_bonus + event_bonus + claim_bonus
                     else 0 end
         else 0 end as quitte_bonus
  from base
),
pmpts as (
  select player_id, day,
         base_pts + execution_bonus + event_bonus + claim_bonus + quitte_bonus as pts
  from premirror
),
mirror_days as (
  select de.day
  from public.daily_events de, paris
  where de.event_key = 'jour_miroir' and de.day < paris.today
),
standings as (
  select md.day as mday, p.id as player_id,
         coalesce(sum(pm.pts), 0) as cum
  from mirror_days md
  cross join public.players p
  left join pmpts pm on pm.player_id = p.id and pm.day < md.day
  group by md.day, p.id
),
mirror_winner as (
  select distinct on (mday) mday, player_id
  from standings
  order by mday, cum asc, player_id
),
-- Les points « posés » sur un jour sans passer par les entries :
-- le jour miroir (+8 au dernier) et les duels (+3 gagnant, −3 perdant,
-- posés sur le dimanche de la semaine jouée). Un match nul (winner
-- null) ne transfère rien.
extras_core as (
  select mw.player_id, mw.mday as day,
         public.bonus_value('jour_miroir') as pts
  from mirror_winner mw
  union all
  select dr.winner, dr.day, public.bonus_value('duel_hebdo')
  from public.duel_results dr
  where dr.winner is not null
  union all
  select dr.loser, dr.day, -public.bonus_value('duel_hebdo')
  from public.duel_results dr
  where dr.winner is not null
),
-- La prime hebdo : vainqueur du classement AFFICHÉ de chaque semaine
-- close depuis le 20/07 (points + miroir + duels, la prime elle-même
-- exclue — pas de récursion, le +3 ne peut pas changer qui gagne),
-- +3 posés sur le dimanche gagné. Égalité au sommet = tous primés.
closed_weeks as (
  select g.monday::date as monday
  from paris,
       generate_series(date '2026-07-20', paris.today, interval '7 days') as g(monday)
  where g.monday::date + 7 <= paris.today
),
week_standing as (
  select cw.monday, s.player_id, sum(s.pts) as pts
  from closed_weeks cw
  join (
    select player_id, day, pts from pmpts
    union all
    select player_id, day, pts from extras_core
  ) s on s.day between cw.monday and cw.monday + 6
  group by cw.monday, s.player_id
),
week_winner as (
  select monday, player_id
  from (
    select monday, player_id, pts,
           rank() over (partition by monday order by pts desc) as rk
    from week_standing
  ) r
  where rk = 1 and pts > 0
),
extras as (
  select player_id, day, pts from extras_core
  union all
  select ww.player_id, ww.monday + 6 as day,
         public.bonus_value('prime_hebdo') as pts
  from week_winner ww
),
extras_by_day as (
  select player_id, day, sum(pts) as pts
  from extras
  group by player_id, day
)
select
  pm.player_id,
  pm.day,
  pm.exos,
  pm.perfect,
  pm.streak_pos,
  pm.jokered,
  pm.multiplier,
  pm.base_pts + pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + coalesce(x.pts, 0) as points,
  pm.base_pts as base_points,
  pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + coalesce(x.pts, 0) as bonus_points
from premirror pm
left join extras_by_day x on x.player_id = pm.player_id and x.day = pm.day
union all
-- Ligne synthétique : le joueur n'a ni entrée ni claim ce jour-là mais
-- des points l'attendent (miroir, ou perdant de duel sans coche le dimanche).
select
  x.player_id,
  x.day,
  0 as exos,
  false as perfect,
  0 as streak_pos,
  false as jokered,
  1.0 as multiplier,
  x.pts as points,
  0 as base_points,
  x.pts as bonus_points
from extras_by_day x
where not exists (
  select 1 from premirror pm
  where pm.player_id = x.player_id and pm.day = x.day
);

-- -------------------------------------------------------------
-- leaderboard : deux ajustements.
--
-- 1) current_streak lisait « dernier jour parfait >= hier ». Un
--    joueur sauvé par son joker hier a son dernier jour parfait
--    avant-hier : sans ce correctif, sa série afficherait 0 alors
--    qu'elle est vivante. On regarde donc le dernier jour qui TIENT
--    la chaîne (parfait ou joker), tout en lisant le compteur sur
--    le dernier jour parfait — le joker préserve, il n'incrémente pas.
--
-- 2) joker_day sort au client : null = joker encore disponible.
--    C'est ce que l'app affiche à côté de la série.
-- -------------------------------------------------------------

drop function if exists public.leaderboard(date, date);

create function public.leaderboard(p_from date default null, p_until date default null)
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
  with pts as (
    select dp.player_id,
           sum(dp.points) as points,
           sum(dp.bonus_points) as bonus_points,
           count(*) filter (where dp.perfect) as perfect_days,
           sum(dp.exos) as exos_done
    from public.daily_points dp
    where (p_from is null or dp.day >= p_from)
      and (p_until is null or dp.day <= p_until)
    group by dp.player_id
  ),
  last_perfect as (
    select distinct on (dp.player_id) dp.player_id, dp.day, dp.streak_pos
    from public.daily_points dp
    where dp.perfect
    order by dp.player_id, dp.day desc
  ),
  -- Dernier jour qui tient la chaîne : parfait OU joker.
  last_kept as (
    select distinct on (dp.player_id) dp.player_id, dp.day
    from public.daily_points dp
    where dp.perfect or dp.jokered
    order by dp.player_id, dp.day desc
  ),
  -- Le joker brûlé, s'il l'est. Jamais borné par p_from/p_until :
  -- il vaut pour tout le challenge, pas pour la fenêtre affichée.
  joker_used as (
    select dp.player_id, min(dp.day) as day
    from public.daily_points dp
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
