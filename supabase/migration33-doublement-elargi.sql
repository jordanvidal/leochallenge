-- =============================================================
-- Migration 33 — ce que le ×2 du jour couvre, et ce que le détail avoue
-- =============================================================
-- Numérotée 33 : elle recrée daily_points et player_breakdown APRÈS
-- migration29-bareme-s3 (leur dernière définition en prod) et après
-- migration32-recit-hebdo, qui ne touche ni la vue ni la fonction.
-- La dernière définition gagne : celle-ci s'applique en dernier.
--
-- Deux décisions de Jordan, prises le 27/07 :
--
--   1. 🎲 L'exo tiré double TOUT ce qui le travaille, pas seulement son
--      échelle. Le 27/07, jour de « les squats comptent double », les
--      +100 squats déclarés étaient bien payés double, mais les 50
--      squats jump non — deux échelles, deux mondes, alors que le
--      joueur a fait des squats dans les deux cas. Désormais :
--
--        pompes_double → +50 / +100 pompes, 50 dips sur chaise
--        abdos_double  → +100 / +200 abdos, 3 min de gainage
--        squats_double → +100 / +200 squats, 50 / 100 squats jump
--
--      Le rattachement vit dans une colonne du catalogue
--      (bonus_catalog.double_event) et non dans un CASE gravé ici :
--      c'est la seule façon que l'appli et la base disent la même
--      chose. La feuille de déclaration met en avant les puces
--      doublées du jour — elle lit cette colonne, pas une liste
--      recopiée côté client qui se périmerait à la première puce
--      ajoutée.
--
--      RÉTROACTIF SUR LE 27/07, sur décision explicite de Jordan
--      (question posée, réponse « aujourd'hui »). Le doublement des
--      paliers n'existe que depuis ce jour-là : l'élargissement ne
--      peut donc toucher aucun jour de la S1 ou de la S2. Sur le
--      27/07 lui-même il ne fait qu'ajouter des points, à un seul
--      joueur — Jordan, seul déclarant de squats jump ce jour-là. À
--      dire au groupe, sinon la règle passe pour un arrangement.
--
--   2. 🃏 Le joker compte dans la série du DÉTAIL, comme il compte
--      déjà dans le total. player_breakdown rejoue le calcul de son
--      côté depuis la migration 7, et sa CTE de série ignorait le
--      joker : un joueur qui en a brûlé un voyait sa série repartir
--      de 1 dans « d'où viennent mes points », donc un multiplicateur
--      plus faible que celui qui a produit son score. Constaté le
--      27/07 : ligne 🎲 à 5,5 dans le détail pour 6 au classement.
--      La migration 29 avait noté l'écart et laissé la décision à
--      part ; c'est cette décision.
--
--      Ce bloc CHANGE des points déjà affichés — à la hausse, dans
--      l'écran de détail seulement. Le classement, lui, ne bouge pas
--      d'un point : il n'a jamais lu cette fonction.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1. bonus_catalog.double_event : quel tirage double cette puce.
--
--    null = jamais doublée (le cardio hors squats jump, les
--    déplacements, les lignes qui ne sont pas des exercices). La
--    colonne nomme un event_key du catalogue, sans clé étrangère :
--    bonus_catalog se référence elle-même, et une contrainte sur
--    soi rendrait tout réordonnancement de lignes pénible pour
--    zéro garantie utile ici.
-- -------------------------------------------------------------

alter table public.bonus_catalog
  add column if not exists double_event text;

update public.bonus_catalog set double_event = 'pompes_double'
  where key in ('pompes_50', 'pompes_100', 'dips_50');

update public.bonus_catalog set double_event = 'abdos_double'
  where key in ('abdos_100', 'abdos_200', 'gainage_3min');

update public.bonus_catalog set double_event = 'squats_double'
  where key in ('squats_100', 'squats_200', 'squats_jump_50', 'squats_jump_100');

-- -------------------------------------------------------------
-- 2. daily_points et 3. player_breakdown : repris tels quels de la
--    migration 29, avec trois changements et rien d'autre —
--    claims_double remplace les trois CTE par échelle, la jointure
--    de l'événement passe avant elle (elle en dépend), et la série
--    du détail apprend le joker.
-- -------------------------------------------------------------

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
         abs,
         squats,
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
  union
  select player_id, day from joker
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
-- Les puces déclarées du jour rangées par tirage qui les double, à
-- part du reste des bonus : « les squats comptent double » a besoin
-- de leur total à lui. Un CTE au lieu de trois depuis le 27/07 —
-- l'appartenance ne se lit plus sur l'échelle (elle laissait les
-- squats jump dehors) mais sur bonus_catalog.double_event, qui la
-- déclare puce par puce et sert aussi à l'écran de déclaration.
claims_double as (
  select bc.player_id, bc.day, cat.double_event, sum(bc.points) as pts
  from public.bonus_claims bc
  join public.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.double_event is not null
  group by bc.player_id, bc.day, cat.double_event
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
    (fd.player_id is not null) as premier_du_jour,
    case when coalesce(st.streak_pos, 0) >= 7 then 2.0
         when coalesce(st.streak_pos, 0) >= 3 then 1.5
         else 1.0 end as multiplier,
    -- premier du jour : retiré au 27/07 (S3). Une course, mais un réveil
    -- malin le raflait autant qu'un vrai effort. Borné, pas supprimé :
    -- les jours S1/S2 gardent leurs +3.
    (case when s.day < date '2026-07-27' and fd.player_id is not null
          then public.bonus_value('premier_du_jour') else 0 end
     -- dès le 20/07, ne se cumule plus avec « premier du jour » (les
     -- deux valent +3 ; si les valeurs divergent un jour, payer le
     -- plus gros des deux au lieu de supprimer celui-ci)
     -- avant 8h et après 22h : retirés au 27/07 (S3). L'heure de la
     -- séance parle de l'emploi du temps, pas de la performance. Les
     -- jours d'avant gardent leurs points, d'où la borne plutôt que
     -- la suppression de l'arête.
     + case when s.day < date '2026-07-27'
                 and e.done_ts::time < time '08:00'
                 and (s.day < date '2026-07-20' or fd.player_id is null)
            then public.bonus_value('avant_8h') else 0 end
     + case when s.day < date '2026-07-27'
                 and e.done_ts::time >= time '22:00'
            then public.bonus_value('apres_22h') else 0 end
     -- éclair : retiré au 27/07 (S3) — 14 séances sur 16 passaient
     -- sous les 20 min, plus personne n'était départagé.
     + case when s.day < date '2026-07-27'
                 and tw.duration_seconds is not null
                 and tw.duration_seconds < public.bonus_value('cap_seance_20min')
            -- éclair : 5 pts figés pour la S1, valeur catalogue (2) ensuite
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_20min') end) else 0 end
     -- rapide : retirée au 27/07 (S3), même raison que l'éclair — le jeu
     -- optimal était de lancer la séance, ne rien faire dedans, cocher à
     -- la main et finir juste au-dessus du plancher. Bornée, pas supprimée.
     -- (5 pts figés pour la S1, valeur catalogue (2) du 20/07 au 26/07.)
     + case when s.day < date '2026-07-27' and fw.player_id is not null
            then (case when s.day < date '2026-07-20' then 5
                       else public.bonus_value('seance_rapide') end) else 0 end
     + case when cb.player_id is not null
            then public.bonus_value('retour') else 0 end
     -- collectif : retiré au 27/07 (S3) — il se ramollit quand le groupe
     -- se vide (fin août, 2 actifs à 3/3 = +5 chacun presque gratis).
     + case when s.day < date '2026-07-27'
                 and cd.day is not null and coalesce(e.perfect, false)
            then public.bonus_value('jour_parfait_collectif') else 0 end
    ) as execution_bonus,
    -- 🎲 L'exo doublé. Un seul événement est tiré par jour : au plus une
    -- des trois branches est vraie, les regrouper ne change rien au
    -- montant et évite de répéter le facteur de série trois fois.
    ((case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
           then public.bonus_value('pompes_double')
           when ev.event_key = 'abdos_double' and coalesce(e.abs, false)
           then public.bonus_value('abdos_double')
           when ev.event_key = 'squats_double' and coalesce(e.squats, false)
           then public.bonus_value('squats_double')
           else 0 end)
     -- Depuis le 27/07, doubler la coche veut dire la doubler pour de
     -- vrai : à ×2 de série, une coche vaut 2 points, la doubler en
     -- ajoute 2, pas 1. Le forfait de +1 rendait l'événement d'autant
     -- plus faible qu'on était régulier — l'inverse de ce qu'il promet.
     -- Avant le 27/07 le facteur reste 1.0 : les jours S1/S2 gardent
     -- leur +1 au demi-point près.
     * case when s.day < date '2026-07-27' then 1.0
            when coalesce(st.streak_pos, 0) >= 7 then 2.0
            when coalesce(st.streak_pos, 0) >= 3 then 1.5
            else 1.0 end
     -- Depuis le 27/07, l'événement double AUSSI les puces déclarées de
     -- l'exo tiré. claim_bonus les compte déjà une fois : les rajouter
     -- une seconde fois, c'est exactement les doubler. Elles ne suivent
     -- pas la série — une puce est un bonus, et la série ne touche pas
     -- aux bonus, ici pas plus qu'ailleurs. La jointure de dcl porte
     -- déjà le test de l'événement : rien à retester ici.
     + case when s.day < date '2026-07-27' then 0
            else coalesce(dcl.pts, 0) end
     -- happy hour et lève-tôt : retirés au 27/07 (S3), et sortis du
     -- tirage par la même migration. La borne tient même si un
     -- événement était réinséré à la main dans daily_events.
     + case when s.day < date '2026-07-27'
                 and ev.event_key = 'happy_hour'
                 and e.done_ts::time >= time '18:00'
                 and e.done_ts::time < time '20:00'
            then public.bonus_value('happy_hour') else 0 end
     + case when s.day < date '2026-07-27'
                 and ev.event_key = 'leve_tot'
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
  -- L'événement AVANT les puces qu'il double : la jointure suivante le
  -- lit, et une jointure ne voit que ce qui est déjà entré.
  left join public.daily_events ev on ev.day = s.day
  left join claims_double dcl on dcl.player_id = s.player_id
                             and dcl.day = s.day
                             and dcl.double_event = ev.event_key
),
premirror as (
  select
    player_id, day, exos, perfect, streak_pos, jokered, premier_du_jour, multiplier, event_key,
    -- Journée parfaite : +2 jusqu'au 26/07, +4 à partir du 27/07 (S3).
    -- Daté partout où la base est reconstruite, sinon le détail ment.
    (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier as base_pts,
    execution_bonus, event_bonus, claim_bonus,
    case when event_key = 'quitte_ou_double' and perfect
         -- depuis le 20/07 : ne double plus que la base du jour
         then (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier
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
-- 📅 La semaine pleine (S3) : +5 pour qui aligne 7 jours parfaits sur
-- une semaine lundi→dimanche entièrement révolue, posés sur le dimanche.
-- Première semaine payée : 27/07→02/08, sur le 02/08. Modelé sur
-- closed_weeks (même cross-join paris, même borne « semaine close »).
-- Ne dépend que des jours parfaits, pas d'un classement : aucun risque
-- de récursion quand extras_core alimente plus bas week_standing.
full_weeks as (
  select g.monday::date as monday, en.player_id
  from paris,
       generate_series(date '2026-07-27', paris.today, interval '7 days') as g(monday)
  join e en on en.perfect and en.day between g.monday::date and g.monday::date + 6
  where g.monday::date + 7 <= paris.today
  group by g.monday::date, en.player_id
  having count(*) = 7
),
-- Les points « posés » sur un jour sans passer par les entries :
-- le jour miroir (+8 au dernier), les duels (+3 gagnant, −3 perdant,
-- posés sur le dimanche de la semaine jouée) et la semaine pleine. Un
-- match nul (winner null) ne transfère rien.
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
  union all
  select fw.player_id, fw.monday + 6 as day,
         public.bonus_value('semaine_pleine') as pts
  from full_weeks fw
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
  pm.multiplier,
  pm.base_pts + pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + coalesce(x.pts, 0) as points,
  pm.base_pts as base_points,
  pm.execution_bonus + pm.event_bonus + pm.claim_bonus + pm.quitte_bonus
    + coalesce(x.pts, 0) as bonus_points,
  -- jokered puis premier_du_jour EN DERNIER, dans CET ordre : c'est la
  -- signature de sortie de la vue en prod. « create or replace view »
  -- sait ajouter une colonne en fin de liste, jamais en insérer une au
  -- milieu ni en retirer (42P16) — l'ordre des colonnes est gravé.
  pm.jokered,
  pm.premier_du_jour
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
  1.0 as multiplier,
  x.pts as points,
  0 as base_points,
  x.pts as bonus_points,
  false as jokered,
  false as premier_du_jour
from extras_by_day x
where not exists (
  select 1 from premirror pm
  where pm.player_id = x.player_id and pm.day = x.day
);

-- -------------------------------------------------------------
-- 4. player_breakdown : les mêmes bornes, au même endroit.
--
--    La RPC du détail ne lit pas daily_points : elle REJOUE le même
--    calcul de son côté (c'est ainsi depuis la migration 7). Patcher
--    la vue sans elle ferait dire à l'écran « d'où viennent mes
--    points » qu'un joueur a touché un bonus d'horaire le 28/07,
--    pour un total qui ne le contient pas. Les sept changements de la
--    S3 (journée parfaite +4, bornes d'horaire, les trois doublements,
--    la semaine pleine) sont donc recopiés ici à l'identique.
--
--    Repris de la migration 18, vérifié conforme à la fonction en
--    place avant réécriture. La migration 29 avait laissé de côté
--    l'absence du joker dans sa CTE de série, « ça changerait des
--    points déjà affichés, et ça se décide à part » : décidé le
--    27/07, c'est le second bloc de cette migration. Les CTE de
--    série sont désormais celles de la vue, mot pour mot.
-- -------------------------------------------------------------

create or replace function public.player_breakdown(p_player uuid, p_from date default null, p_until date default null)
returns table (category text, item_key text, emoji text, label text, cnt bigint, points numeric)
language sql
stable
set search_path = public
as $$
  with recursive paris as (
    select (now() at time zone 'Europe/Paris')::date as today
  ),
  e as (
    select player_id, day,
           (pushups::int + abs::int + squats::int) as exos,
           (pushups and abs and squats) as perfect,
           pushups,
           abs,
           squats,
           completed_at,
           case when completed_at is not null
                 and (completed_at at time zone 'Europe/Paris')::date = day
                then completed_at at time zone 'Europe/Paris'
           end as done_ts
    from public.entries
  ),
  -- ---- La série et le joker, mot pour mot comme dans daily_points.
  -- Le détail rejoue le calcul du total : s'il ignore le joker, il
  -- fait repartir la série de 1 après le jour sauvé et annonce un
  -- multiplicateur que personne n'a eu. Vu le 27/07 sur la ligne 🎲 :
  -- 5,5 dans le détail, 6 au classement.
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
      and not exists (
        select 1 from e gap
        where gap.player_id = bs.player_id and gap.day = bs.day + 1 and gap.perfect
      )
      and exists (
        select 1 from e back
        where back.player_id = bs.player_id and back.day = bs.day + 2 and back.perfect
      )
    order by bs.player_id, bs.day
  ),
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
  -- Le jour joker est retiré AVANT la numérotation : il tient la
  -- chaîne sans consommer de rang.
  streaks as (
    select player_id, day,
           (row_number() over (partition by player_id, island order by day))::int as streak_pos
    from islands
    where is_perfect
  ),
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
  -- Même rotation du trophée que daily_points (voir le commentaire
  -- là-bas) : les deux doivent raconter la même histoire.
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
  -- Les puces doublées du jour, rangées par tirage : même CTE que
  -- dans la vue, même colonne de catalogue.
  claims_double as (
    select bc.player_id, bc.day, cat.double_event, sum(bc.points) as pts
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    where cat.double_event is not null
    group by bc.player_id, bc.day, cat.double_event
  ),
  claims_day as (
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
      case when coalesce(st.streak_pos, 0) >= 7 then 2.0
           when coalesce(st.streak_pos, 0) >= 3 then 1.5
           else 1.0 end as multiplier,
      -- premier du jour : retiré au 27/07 (S3), borné comme dans daily_points.
      case when s.day < date '2026-07-27' and fd.player_id is not null then bonus_value('premier_du_jour') else 0 end as b_premier_du_jour,
      -- dès le 20/07, ne se cumule plus avec « premier du jour »
      -- avant 8h / après 22h : retirés au 27/07 (S3), bornés ici comme
      -- dans daily_points — le détail doit raconter la même histoire
      -- que le total, sinon l'écran « d'où viennent mes points » ment.
      case when s.day < date '2026-07-27'
                and e.done_ts::time < time '08:00'
                and (s.day < date '2026-07-20' or fd.player_id is null)
           then bonus_value('avant_8h') else 0 end as b_avant_8h,
      case when s.day < date '2026-07-27'
                and e.done_ts::time >= time '22:00'
           then bonus_value('apres_22h') else 0 end as b_apres_22h,
      -- éclair : retiré au 27/07 (S3)
      case when s.day < date '2026-07-27'
                and tw.duration_seconds is not null
                and tw.duration_seconds < bonus_value('cap_seance_20min')
           -- éclair : 5 pts figés pour la S1, valeur catalogue (2) ensuite
           then (case when s.day < date '2026-07-20' then 5
                      else bonus_value('seance_20min') end) else 0 end as b_seance_20min,
      -- rapide : retirée au 27/07 (S3), bornée comme dans daily_points.
      -- (5 pts figés pour la S1, valeur catalogue (2) du 20/07 au 26/07.)
      case when s.day < date '2026-07-27' and fw.player_id is not null
           then (case when s.day < date '2026-07-20' then 5
                      else bonus_value('seance_rapide') end) else 0 end as b_seance_rapide,
      case when cb.player_id is not null then bonus_value('retour') else 0 end as b_retour,
      -- collectif : retiré au 27/07 (S3), bornée comme dans daily_points.
      case when s.day < date '2026-07-27'
                and cd.day is not null and coalesce(e.perfect, false)
           then bonus_value('jour_parfait_collectif') else 0 end as b_collectif,
      -- 🎲 L'exo doublé, borné comme dans daily_points. Depuis le 27/07 la
      -- coche doublée suit la série (à ×2, doubler une coche qui vaut 2
      -- ajoute 2) et l'événement double aussi les puces déclarées de
      -- l'exo — elles au nominal, la série ne touche pas aux bonus. Le
      -- point doublé est porté par la ligne de l'événement (c'est lui qui
      -- le crée) ; claim_bonus garde la valeur nominale.
      -- Trois colonnes séparées ici, contrairement à la vue : le détail
      -- « d'où viennent mes points » nomme l'exo tiré. dcl n'est jointe
      -- qu'au tirage du jour, donc au plus une des trois est servie.
      (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
            then bonus_value('pompes_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
       + case when ev.event_key = 'pompes_double' and s.day >= date '2026-07-27'
              then coalesce(dcl.pts, 0) else 0 end) as b_pompes_double,
      -- Les deux sœurs de la S3, même logique sur l'exo tiré.
      (case when ev.event_key = 'abdos_double' and coalesce(e.abs, false)
            then bonus_value('abdos_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
       + case when ev.event_key = 'abdos_double' and s.day >= date '2026-07-27'
              then coalesce(dcl.pts, 0) else 0 end) as b_abdos_double,
      (case when ev.event_key = 'squats_double' and coalesce(e.squats, false)
            then bonus_value('squats_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
       + case when ev.event_key = 'squats_double' and s.day >= date '2026-07-27'
              then coalesce(dcl.pts, 0) else 0 end) as b_squats_double,
      case when s.day < date '2026-07-27' and ev.event_key = 'happy_hour'
                and e.done_ts::time >= time '18:00'
                and e.done_ts::time < time '20:00'
           then bonus_value('happy_hour') else 0 end as b_happy_hour,
      case when s.day < date '2026-07-27' and ev.event_key = 'leve_tot'
                and e.done_ts::time < time '07:00'
           then bonus_value('leve_tot') else 0 end as b_leve_tot,
      coalesce(c.pts, 0) as claim_bonus,
      ev.event_key
    from spine s
    left join e using (player_id, day)
    left join streaks st using (player_id, day)
    left join comeback cb on cb.player_id = s.player_id and cb.day = s.day
    left join collective_days cd on cd.day = s.day
    left join first_done fd on fd.day = s.day and fd.player_id = s.player_id
    left join timed tw on tw.player_id = s.player_id and tw.day = s.day
    left join fastest_session fw on fw.day = s.day and fw.player_id = s.player_id
    left join claims_day c on c.player_id = s.player_id and c.day = s.day
    -- L'événement avant les puces qu'il double, comme dans la vue.
    left join public.daily_events ev on ev.day = s.day
    left join claims_double dcl on dcl.player_id = s.player_id
                               and dcl.day = s.day
                               and dcl.double_event = ev.event_key
  ),
  premirror as (
    select
      player_id, day, exos, perfect, multiplier, event_key,
      -- Journée parfaite : +2 jusqu'au 26/07, +4 dès le 27/07 (S3).
      (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier as base_pts,
      b_premier_du_jour, b_avant_8h, b_apres_22h, b_seance_20min, b_seance_rapide,
      b_retour, b_collectif, b_pompes_double, b_abdos_double, b_squats_double,
      b_happy_hour, b_leve_tot, claim_bonus,
      case when event_key = 'quitte_ou_double' and perfect
           -- depuis le 20/07 : ne double plus que la base du jour
           then (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier
                + case when day < date '2026-07-20'
                       then b_premier_du_jour + b_avant_8h + b_apres_22h
                            + b_seance_20min + b_seance_rapide + b_retour
                            + b_collectif + b_pompes_double + b_happy_hour
                            + b_leve_tot + claim_bonus
                       else 0 end
           else 0 end as b_quitte_ou_double
    from base
  ),
  pmpts as (
    select player_id, day,
           base_pts + b_premier_du_jour + b_avant_8h + b_apres_22h + b_seance_20min
           + b_seance_rapide + b_retour + b_collectif + b_pompes_double
           + b_abdos_double + b_squats_double + b_happy_hour
           + b_leve_tot + claim_bonus + b_quitte_ou_double as pts
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
  mine as (
    select * from premirror
    where player_id = p_player
      and (p_from is null or day >= p_from)
      and (p_until is null or day <= p_until)
  ),
  mirror_mine as (
    select mw.mday as day, bonus_value('jour_miroir') as v
    from mirror_winner mw
    where mw.player_id = p_player
      and (p_from is null or mw.mday >= p_from)
      and (p_until is null or mw.mday <= p_until)
  ),
  duel_mine as (
    select dr.day,
           case when dr.winner = p_player then bonus_value('duel_hebdo')
                else -bonus_value('duel_hebdo') end as v
    from public.duel_results dr
    where dr.winner is not null
      and p_player in (dr.player_a, dr.player_b)
      and (p_from is null or dr.day >= p_from)
      and (p_until is null or dr.day <= p_until)
  ),
  -- 📅 La semaine pleine (S3), même calcul que dans daily_points :
  -- 7 jours parfaits sur une semaine close (lundi ≥ 27/07), +5 le
  -- dimanche. Comptée dans week_standing plus bas, comme la vue.
  full_weeks as (
    select g.monday::date as monday, en.player_id
    from paris,
         generate_series(date '2026-07-27', paris.today, interval '7 days') as g(monday)
    join e en on en.perfect and en.day between g.monday::date and g.monday::date + 6
    where g.monday::date + 7 <= paris.today
    group by g.monday::date, en.player_id
    having count(*) = 7
  ),
  -- La prime hebdo : même calcul du vainqueur que daily_points
  -- (classement affiché, prime exclue), fenêtré sur le dimanche gagné.
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
      select mw.player_id, mw.mday as day, bonus_value('jour_miroir') as pts
      from mirror_winner mw
      union all
      select dr.winner, dr.day, bonus_value('duel_hebdo')
      from public.duel_results dr where dr.winner is not null
      union all
      select dr.loser, dr.day, -bonus_value('duel_hebdo')
      from public.duel_results dr where dr.winner is not null
      union all
      select fw.player_id, fw.monday + 6 as day, bonus_value('semaine_pleine') as pts
      from full_weeks fw
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
  prime_mine as (
    select ww.monday + 6 as day, bonus_value('prime_hebdo') as v
    from week_winner ww
    where ww.player_id = p_player
      and (p_from is null or ww.monday + 6 >= p_from)
      and (p_until is null or ww.monday + 6 <= p_until)
  ),
  semaine_mine as (
    select fw.monday + 6 as day, bonus_value('semaine_pleine') as v
    from full_weeks fw
    where fw.player_id = p_player
      and (p_from is null or fw.monday + 6 >= p_from)
      and (p_until is null or fw.monday + 6 <= p_until)
  ),
  auto as (
    select 'premier_du_jour'::text as k, b_premier_du_jour as v from mine
    union all select 'avant_8h',         b_avant_8h         from mine
    union all select 'apres_22h',        b_apres_22h        from mine
    union all select 'seance_20min',     b_seance_20min     from mine
    union all select 'seance_rapide',    b_seance_rapide    from mine
    union all select 'retour',           b_retour           from mine
    union all select 'jour_parfait_collectif', b_collectif  from mine
    union all select 'pompes_double',    b_pompes_double    from mine
    union all select 'abdos_double',     b_abdos_double     from mine
    union all select 'squats_double',    b_squats_double    from mine
    union all select 'happy_hour',       b_happy_hour       from mine
    union all select 'leve_tot',         b_leve_tot         from mine
    union all select 'quitte_ou_double', b_quitte_ou_double from mine
    union all select 'jour_miroir',      v                  from mirror_mine
    union all select 'duel_hebdo',       v                  from duel_mine
    union all select 'prime_hebdo',      v                  from prime_mine
    union all select 'semaine_pleine',   v                  from semaine_mine
  ),
  claims as (
    select bc.bonus_key as k, count(*)::bigint as cnt, sum(bc.points) as pts
    from public.bonus_claims bc
    where bc.player_id = p_player
      and (p_from is null or bc.day >= p_from)
      and (p_until is null or bc.day <= p_until)
    group by bc.bonus_key
  ),
  base_rows as (
    select 'base'::text as category, 'exos'::text as item_key,
           '🎯'::text as emoji, 'Exos cochés'::text as label,
           coalesce(sum(exos), 0)::bigint as cnt,
           coalesce(sum(exos), 0)::numeric as points
    from mine
    union all
    select 'base', 'perfect', '✅', 'Journées parfaites',
           count(*) filter (where perfect)::bigint,
           -- +2 jusqu'au 26/07, +4 dès le 27/07 (S3), comme base_pts.
           coalesce(sum(case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end), 0)::numeric
    from mine
    union all
    select 'base', 'streak', '🔥', 'Bonus de série',
           count(*) filter (where multiplier > 1)::bigint,
           -- Le surplus de multiplicateur reconstruit la base : même
           -- montant de journée parfaite daté, sinon détail ≠ total.
           coalesce(sum(
             (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * (multiplier - 1)
           ), 0)::numeric
    from mine
  ),
  bonus_rows as (
    select 'bonus'::text as category, a.k as item_key,
           cat.emoji, cat.label,
           count(*) filter (where a.v <> 0)::bigint as cnt,
           coalesce(sum(a.v), 0)::numeric as points
    from auto a
    join public.bonus_catalog cat on cat.key = a.k
    group by a.k, cat.emoji, cat.label
    union all
    select 'bonus', c.k, cat.emoji, cat.label, c.cnt, c.pts
    from claims c
    join public.bonus_catalog cat on cat.key = c.k
  )
  select category, item_key, emoji, label, cnt, round(points, 1) as points
  from base_rows
  where points <> 0 or cnt <> 0
  union all
  select category, item_key, emoji, label, cnt, round(points, 1) as points
  from bonus_rows
  where points <> 0;
$$;

-- -------------------------------------------------------------
-- 4. Ce qui doit bouger, et rien d'autre.
--
--    Contrôlé le 27/07 à 15h contre la prod, en lecture seule (le
--    corps des deux objets rejoué en requête, la colonne
--    double_event simulée par un CASE sur les clés) :
--
--      · daily_points : UNE seule ligne bouge, Jordan le 27/07,
--        32 → 36 pts. C'est son 50 squats jump, désormais doublé
--        par le tirage du jour. Aucune ligne n'apparaît ni ne
--        disparaît, aucun autre jour ni joueur n'est touché — les
--        autres puces élargies (dips, gainage) n'ont jamais croisé
--        leur tirage depuis le 27/07, seul jour où le doublement
--        des puces existe.
--
--      · player_breakdown : la somme du détail de Jordan passe de
--        357 à 377,5, et rejoint exactement son total de vue
--        (373,5 aujourd'hui, 377,5 après ce fichier). Les 16,5
--        points d'écart étaient le joker manquant dans sa série.
--        Il est le seul joueur à en avoir brûlé un : personne
--        d'autre ne voit son détail changer.
--
--    Le protocole dans l'éditeur SQL, avant de valider :
--
--      begin;
--
--      create temp table avant on commit drop as
--        select player_id, day, points, bonus_points, streak_pos
--        from public.daily_points;
--
--      -- coller ici tout ce fichier, sauf le présent bloc
--
--      select count(*) as jours_qui_bougent
--      from public.daily_points n
--      join avant a using (player_id, day)
--      where n.points        is distinct from a.points
--         or n.bonus_points  is distinct from a.bonus_points
--         or n.streak_pos    is distinct from a.streak_pos;
--      -- attendu : 1 (Jordan, 27/07)
--
--      select count(*) as lignes_apparues_ou_disparues
--      from public.daily_points n
--      full join avant a using (player_id, day)
--      where n.player_id is null or a.player_id is null;
--      -- attendu : 0
--
--      -- le détail dit enfin la même chose que le total
--      select p.name,
--             (select sum(points) from public.player_breakdown(p.id)) as detail,
--             (select sum(points) from public.daily_points d
--               where d.player_id = p.id)                             as total
--      from public.players p order by p.name;
--      -- attendu : detail = total, pour tout le monde
--
--      commit;   -- ou rollback si l'un des trois ne tombe pas juste
-- -------------------------------------------------------------
