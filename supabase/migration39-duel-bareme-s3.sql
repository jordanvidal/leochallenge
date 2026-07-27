-- migration39-duel-bareme-s3.sql — le duel départage au bon barème
--
-- ⚠️ Cette migration touche `public`, le challenge en cours. Elle est écrite
-- pour ne RIEN changer aux semaines déjà closes. Voir le test
-- `supabase/tests/duel-bareme-s3.sql`, qui le vérifie avant/après.
--
-- LE PROBLÈME
--
-- `duel_results` embarque sa PROPRE copie du moteur de points. Elle sert au
-- départage : quand deux joueurs finissent la semaine avec le même nombre de
-- jours parfaits, c'est le total de points qui tranche. Cette copie n'a pas
-- suivi deux migrations :
--
--   * migration29 (barème S3, en vigueur le 27/07) — le jour parfait vaut 4
--     points et non 2, et la pile de bonus d'exécution s'éteint ;
--   * migration33 (doublement élargi) — sa copie ne connaît que `pompes_double`.
--     Ni `abdos_double`, ni `squats_double`, ni les bonus d'exercice rattachés
--     à l'événement du jour, qui doivent doubler eux aussi.
--
-- Tant que les semaines closes étaient antérieures au 27/07, la copie tombait
-- juste : elle appliquait l'ancien barème à des journées jouées sous l'ancien
-- barème. La semaine du 27/07 est la première sous S3. Elle se clôture début
-- août — c'est à partir de là que le départage se ferait au mauvais barème.
--
-- Ce n'est pas cosmétique : sur les 3 duels résolus à ce jour, 1 s'est joué au
-- départage aux points (7 jours parfaits de chaque côté, 231,5 contre 241,0).
-- Une marge de 9,5 points suffit à faire basculer un duel.
--
-- LA CORRECTION
--
-- Le corps de calcul est remplacé par celui de `daily_points`, repris VERBATIM
-- (sortie de `pg_get_viewdef`) plutôt que retranscrit à la main : c'est la
-- seule façon de garantir qu'aucune expression ne diverge d'un caractère. Les
-- gardes de date viennent avec — pour toute journée antérieure au 27/07, les
-- expressions sont mot pour mot celles d'avant, donc les semaines closes ne
-- bougent pas d'un point.
--
-- `create or replace`, surtout pas `drop ... cascade` : `daily_points` dépend
-- de cette vue, et `player_badges` dépend de `daily_points`. Un drop en cascade
-- emporterait les deux.
--
-- Ce que cette migration NE fait PAS : elle ne touche ni `daily_points`, ni
-- `player_badges`, ni aucune table. Une seule vue est remplacée.
--
-- LIMITE ASSUMÉE
--
-- La duplication du moteur reste : `duel_results` porte toujours sa copie, et
-- rien n'empêche mécaniquement une nouvelle dérive à la prochaine migration de
-- barème. Le correctif propre — extraire un `points_bruts` dont les deux vues
-- dérivent — réécrirait `daily_points` au milieu du challenge, ce qui n'est pas
-- un risque à prendre maintenant. C'est cette structure-là qui a été retenue
-- pour le schéma `app` du multi-ligues (migration38), où elle ne risque rien.

create or replace view public.duel_results with (security_invoker = true) as
 WITH RECURSIVE paris AS (
         SELECT (now() AT TIME ZONE 'Europe/Paris'::text)::date AS today
        ), e AS (
         SELECT entries.player_id,
            entries.day,
            entries.pushups::integer + entries.abs::integer + entries.squats::integer AS exos,
            entries.pushups AND entries.abs AND entries.squats AS perfect,
            entries.pushups,
            entries.abs,
            entries.squats,
            entries.completed_at,
                CASE
                    WHEN entries.completed_at IS NOT NULL AND (entries.completed_at AT TIME ZONE 'Europe/Paris'::text)::date = entries.day THEN (entries.completed_at AT TIME ZONE 'Europe/Paris'::text)
                    ELSE NULL::timestamp without time zone
                END AS done_ts
           FROM entries
        ), base_islands AS (
         SELECT e.player_id,
            e.day,
            e.day - row_number() OVER (PARTITION BY e.player_id ORDER BY e.day)::integer AS island
           FROM e
          WHERE e.perfect
        ), base_streaks AS (
         SELECT base_islands.player_id,
            base_islands.day,
            row_number() OVER (PARTITION BY base_islands.player_id, base_islands.island ORDER BY base_islands.day)::integer AS pos
           FROM base_islands
        ), joker AS (
         SELECT DISTINCT ON (bs.player_id) bs.player_id,
            bs.day + 1 AS day
           FROM base_streaks bs
          WHERE bs.pos >= 3 AND NOT (EXISTS ( SELECT 1
                   FROM e gap
                  WHERE gap.player_id = bs.player_id AND gap.day = (bs.day + 1) AND gap.perfect)) AND (EXISTS ( SELECT 1
                   FROM e back
                  WHERE back.player_id = bs.player_id AND back.day = (bs.day + 2) AND back.perfect))
          ORDER BY bs.player_id, bs.day
        ), kept AS (
         SELECT e.player_id,
            e.day,
            true AS is_perfect
           FROM e
          WHERE e.perfect
        UNION ALL
         SELECT joker.player_id,
            joker.day,
            false AS is_perfect
           FROM joker
        ), islands AS (
         SELECT kept.player_id,
            kept.day,
            kept.is_perfect,
            kept.day - row_number() OVER (PARTITION BY kept.player_id ORDER BY kept.day)::integer AS island
           FROM kept
        ), streaks AS (
         SELECT islands.player_id,
            islands.day,
            row_number() OVER (PARTITION BY islands.player_id, islands.island ORDER BY islands.day)::integer AS streak_pos
           FROM islands
          WHERE islands.is_perfect
        ), comeback AS (
         SELECT cur.player_id,
            cur.day
           FROM e cur
          WHERE cur.perfect AND NOT (EXISTS ( SELECT 1
                   FROM e prev
                  WHERE prev.player_id = cur.player_id AND prev.day = (cur.day - 1) AND prev.exos > 0)) AND (EXISTS ( SELECT 1
                   FROM e hist
                  WHERE hist.player_id = cur.player_id AND hist.day < (cur.day - 1)))
        ), active AS (
         SELECT DISTINCT d.day,
            a.player_id
           FROM ( SELECT DISTINCT e.day
                   FROM e) d
             JOIN e a ON a.exos > 0 AND a.day >= (d.day - 6) AND a.day <= d.day
        ), collective_days AS (
         SELECT act.day
           FROM active act
             LEFT JOIN e cur ON cur.player_id = act.player_id AND cur.day = act.day
          GROUP BY act.day
         HAVING count(*) >= 2 AND bool_and(COALESCE(cur.perfect, false))
        ), spine AS (
         SELECT e.player_id,
            e.day
           FROM e
        UNION
         SELECT bonus_claims.player_id,
            bonus_claims.day
           FROM bonus_claims
        UNION
         SELECT joker.player_id,
            joker.day
           FROM joker
        ), first_done_old AS (
         SELECT DISTINCT ON (e.day) e.day,
            e.player_id
           FROM e,
            paris
          WHERE e.done_ts IS NOT NULL AND e.day < paris.today AND e.day < '2026-07-20'::date
          ORDER BY e.day, e.done_ts
        ), finishers AS (
         SELECT e.day,
            e.player_id,
            e.done_ts
           FROM e,
            paris
          WHERE e.done_ts IS NOT NULL AND e.day < paris.today AND e.day >= '2026-07-20'::date
        ), first_rot AS (
         SELECT '2026-07-20'::date AS day,
            ( SELECT f.player_id
                   FROM finishers f
                  WHERE f.day = '2026-07-20'::date
                  ORDER BY f.done_ts
                 LIMIT 1) AS winner
           FROM paris
          WHERE '2026-07-20'::date < paris.today
        UNION ALL
         SELECT r.day + 1,
            ( SELECT f.player_id
                   FROM finishers f
                  WHERE f.day = (r.day + 1) AND (r.winner IS NULL OR f.player_id <> r.winner)
                  ORDER BY f.done_ts
                 LIMIT 1) AS player_id
           FROM first_rot r
          WHERE (r.day + 1) < (( SELECT paris.today
                   FROM paris))
        ), first_done AS (
         SELECT first_done_old.day,
            first_done_old.player_id
           FROM first_done_old
        UNION ALL
         SELECT first_rot.day,
            first_rot.winner AS player_id
           FROM first_rot
          WHERE first_rot.winner IS NOT NULL
        ), claims AS (
         SELECT bonus_claims.player_id,
            bonus_claims.day,
            sum(bonus_claims.points) AS pts
           FROM bonus_claims
          GROUP BY bonus_claims.player_id, bonus_claims.day
        ), claims_double AS (
         SELECT bc.player_id,
            bc.day,
            cat.double_event,
            sum(bc.points) AS pts
           FROM bonus_claims bc
             JOIN bonus_catalog cat ON cat.key = bc.bonus_key
          WHERE cat.double_event IS NOT NULL
          GROUP BY bc.player_id, bc.day, cat.double_event
        ), timed AS (
         SELECT ws.player_id,
            ws.day,
            ws.duration_seconds,
            ws.finished_at
           FROM workout_sessions ws
             JOIN e ON e.player_id = ws.player_id AND e.day = ws.day AND e.perfect
          WHERE ws.finished_at IS NOT NULL
        ), fastest_session AS (
         SELECT DISTINCT ON (t.day) t.day,
            t.player_id
           FROM timed t,
            paris
          WHERE t.day < paris.today AND (( SELECT count(*) AS count
                   FROM timed t2
                  WHERE t2.day = t.day)) >= 2
          ORDER BY t.day, t.duration_seconds, t.finished_at
        ), base AS (
         SELECT s.player_id,
            s.day,
            COALESCE(e.exos, 0) AS exos,
            COALESCE(e.perfect, false) AS perfect,
            COALESCE(st.streak_pos, 0) AS streak_pos,
            jk.day IS NOT NULL AS jokered,
            fd.player_id IS NOT NULL AS premier_du_jour,
                CASE
                    WHEN COALESCE(st.streak_pos, 0) >= 7 THEN 2.0
                    WHEN COALESCE(st.streak_pos, 0) >= 3 THEN 1.5
                    ELSE 1.0
                END AS multiplier,
                CASE
                    WHEN s.day < '2026-07-27'::date AND fd.player_id IS NOT NULL THEN bonus_value('premier_du_jour'::text)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND e.done_ts::time without time zone < '08:00:00'::time without time zone AND (s.day < '2026-07-20'::date OR fd.player_id IS NULL) THEN bonus_value('avant_8h'::text)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND e.done_ts::time without time zone >= '22:00:00'::time without time zone THEN bonus_value('apres_22h'::text)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND tw.duration_seconds IS NOT NULL AND tw.duration_seconds::numeric < bonus_value('cap_seance_20min'::text) THEN
                    CASE
                        WHEN s.day < '2026-07-20'::date THEN 5::numeric
                        ELSE bonus_value('seance_20min'::text)
                    END
                    ELSE 0::numeric
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND fw.player_id IS NOT NULL THEN
                    CASE
                        WHEN s.day < '2026-07-20'::date THEN 5::numeric
                        ELSE bonus_value('seance_rapide'::text)
                    END
                    ELSE 0::numeric
                END +
                CASE
                    WHEN cb.player_id IS NOT NULL THEN bonus_value('retour'::text)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND cd.day IS NOT NULL AND COALESCE(e.perfect, false) THEN bonus_value('jour_parfait_collectif'::text)
                    ELSE 0::numeric
                END AS execution_bonus,
                CASE
                    WHEN ev.event_key = 'pompes_double'::text AND COALESCE(e.pushups, false) THEN bonus_value('pompes_double'::text)
                    WHEN ev.event_key = 'abdos_double'::text AND COALESCE(e.abs, false) THEN bonus_value('abdos_double'::text)
                    WHEN ev.event_key = 'squats_double'::text AND COALESCE(e.squats, false) THEN bonus_value('squats_double'::text)
                    ELSE 0::numeric
                END *
                CASE
                    WHEN s.day < '2026-07-27'::date THEN 1.0
                    WHEN COALESCE(st.streak_pos, 0) >= 7 THEN 2.0
                    WHEN COALESCE(st.streak_pos, 0) >= 3 THEN 1.5
                    ELSE 1.0
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date THEN 0::numeric
                    ELSE COALESCE(dcl.pts, 0::numeric)
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND ev.event_key = 'happy_hour'::text AND e.done_ts::time without time zone >= '18:00:00'::time without time zone AND e.done_ts::time without time zone < '20:00:00'::time without time zone THEN bonus_value('happy_hour'::text)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN s.day < '2026-07-27'::date AND ev.event_key = 'leve_tot'::text AND e.done_ts::time without time zone < '07:00:00'::time without time zone THEN bonus_value('leve_tot'::text)
                    ELSE 0::numeric
                END AS event_bonus,
            COALESCE(c.pts, 0::numeric) AS claim_bonus,
            ev.event_key
           FROM spine s
             LEFT JOIN e USING (player_id, day)
             LEFT JOIN streaks st USING (player_id, day)
             LEFT JOIN joker jk ON jk.player_id = s.player_id AND jk.day = s.day
             LEFT JOIN comeback cb ON cb.player_id = s.player_id AND cb.day = s.day
             LEFT JOIN collective_days cd ON cd.day = s.day
             LEFT JOIN first_done fd ON fd.day = s.day AND fd.player_id = s.player_id
             LEFT JOIN timed tw ON tw.player_id = s.player_id AND tw.day = s.day
             LEFT JOIN fastest_session fw ON fw.day = s.day AND fw.player_id = s.player_id
             LEFT JOIN claims c ON c.player_id = s.player_id AND c.day = s.day
             LEFT JOIN daily_events ev ON ev.day = s.day
             LEFT JOIN claims_double dcl ON dcl.player_id = s.player_id AND dcl.day = s.day AND dcl.double_event = ev.event_key
        ), premirror AS (
         SELECT base.player_id,
            base.day,
            base.exos,
            base.perfect,
            base.streak_pos,
            base.jokered,
            base.premier_du_jour,
            base.multiplier,
            base.event_key,
            (base.exos +
                CASE
                    WHEN base.perfect THEN
                    CASE
                        WHEN base.day >= '2026-07-27'::date THEN 4
                        ELSE 2
                    END
                    ELSE 0
                END)::numeric * base.multiplier AS base_pts,
            base.execution_bonus,
            base.event_bonus,
            base.claim_bonus,
                CASE
                    WHEN base.event_key = 'quitte_ou_double'::text AND base.perfect THEN (base.exos +
                    CASE
                        WHEN base.perfect THEN
                        CASE
                            WHEN base.day >= '2026-07-27'::date THEN 4
                            ELSE 2
                        END
                        ELSE 0
                    END)::numeric * base.multiplier +
                    CASE
                        WHEN base.day < '2026-07-20'::date THEN base.execution_bonus + base.event_bonus + base.claim_bonus
                        ELSE 0::numeric
                    END
                    ELSE 0::numeric
                END AS quitte_bonus
           FROM base
        ), pmpts AS (
         SELECT premirror.player_id,
            premirror.day,
            premirror.base_pts + premirror.execution_bonus + premirror.event_bonus + premirror.claim_bonus + premirror.quitte_bonus AS pts
           FROM premirror
        ), mirror_days AS (
         SELECT de.day
           FROM daily_events de,
            paris
          WHERE de.event_key = 'jour_miroir'::text AND de.day < paris.today
        ), standings AS (
         SELECT md.day AS mday,
            p.id AS player_id,
            COALESCE(sum(pm.pts), 0::numeric) AS cum
           FROM mirror_days md
             CROSS JOIN players p
             LEFT JOIN pmpts pm ON pm.player_id = p.id AND pm.day < md.day
          GROUP BY md.day, p.id
        ), mirror_winner AS (
         SELECT DISTINCT ON (standings.mday) standings.mday,
            standings.player_id
           FROM standings
          ORDER BY standings.mday, standings.cum, standings.player_id
        ), weekpts AS (
         SELECT pmpts.player_id,
            pmpts.day,
            pmpts.pts
           FROM pmpts
        UNION ALL
         SELECT mw.player_id,
            mw.mday AS day,
            bonus_value('jour_miroir'::text) AS pts
           FROM mirror_winner mw
        ), finished AS (
         SELECT d.id,
            d.week_monday,
            d.player_a,
            d.player_b
           FROM duels d,
            paris
          WHERE d.player_b IS NOT NULL AND (d.week_monday + 7) <= paris.today
        ), tally AS (
         SELECT f.id,
            f.week_monday,
            f.player_a,
            f.player_b,
            count(*) FILTER (WHERE en.player_id = f.player_a AND en.pushups AND en.abs AND en.squats)::integer AS perfect_a,
            count(*) FILTER (WHERE en.player_id = f.player_b AND en.pushups AND en.abs AND en.squats)::integer AS perfect_b,
            COALESCE(sum(en.pushups::integer + en.abs::integer + en.squats::integer) FILTER (WHERE en.player_id = f.player_a), 0::bigint)::integer AS exos_a,
            COALESCE(sum(en.pushups::integer + en.abs::integer + en.squats::integer) FILTER (WHERE en.player_id = f.player_b), 0::bigint)::integer AS exos_b
           FROM finished f
             LEFT JOIN entries en ON (en.player_id = f.player_a OR en.player_id = f.player_b) AND en.day >= f.week_monday AND en.day <= (f.week_monday + 6)
          GROUP BY f.id, f.week_monday, f.player_a, f.player_b
        ), duel_points AS (
         SELECT f.id,
            COALESCE(sum(w.pts) FILTER (WHERE w.player_id = f.player_a), 0::numeric) AS points_a,
            COALESCE(sum(w.pts) FILTER (WHERE w.player_id = f.player_b), 0::numeric) AS points_b
           FROM finished f
             LEFT JOIN weekpts w ON (w.player_id = f.player_a OR w.player_id = f.player_b) AND w.day >= f.week_monday AND w.day <= (f.week_monday + 6)
          GROUP BY f.id
        )
 SELECT t.id,
    t.week_monday,
    t.week_monday + 6 AS day,
    t.player_a,
    t.player_b,
    t.perfect_a,
    t.perfect_b,
    t.exos_a,
    t.exos_b,
        CASE
            WHEN t.perfect_a > t.perfect_b THEN t.player_a
            WHEN t.perfect_b > t.perfect_a THEN t.player_b
            WHEN p.points_a > p.points_b THEN t.player_a
            WHEN p.points_b > p.points_a THEN t.player_b
            ELSE NULL::uuid
        END AS winner,
        CASE
            WHEN t.perfect_a > t.perfect_b THEN t.player_b
            WHEN t.perfect_b > t.perfect_a THEN t.player_a
            WHEN p.points_a > p.points_b THEN t.player_b
            WHEN p.points_b > p.points_a THEN t.player_a
            ELSE NULL::uuid
        END AS loser,
    t.perfect_a = t.perfect_b AS tiebreak_used,
    round(p.points_a, 1) AS points_a,
    round(p.points_b, 1) AS points_b
   FROM tally t
     JOIN duel_points p USING (id);
