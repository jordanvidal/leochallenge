-- =============================================================
-- Migration 29 — le barème de la S3 (lundi 27 juillet)
-- =============================================================
-- Numérotée 29 : elle recrée daily_points / player_breakdown /
-- get_daily_event APRÈS migration27-joker-visible et
-- migration28-premier-du-jour-feed (déjà en prod), dont elle reprend
-- les apports — la branche joker dans `spine` et la colonne
-- premier_du_jour de la vue. La dernière définition gagne : cette
-- migration doit s'appliquer en dernier.
--
-- Six semaines de jeu ont montré où le barème paie autre chose que
-- l'effort. Arbitrages pris avec Jordan les 22 et 24/07, applicables
-- au 27/07 :
--
--   1. 🏃 10 km de course ajouté, en deuxième palier de l'échelle
--      course : 5 km = 8 pts, +5 km = 12 pts, donc 10 km = 20 pts.
--      Les paliers se cumulent depuis la migration 22, la grammaire
--      est celle des pompes (« +100 pompes (200 au total) »).
--   2. ⚡ Séance éclair (< 20 min) retirée. 14 séances chronométrées
--      sur 16 depuis le 20/07 passaient sous la barre, chez les six
--      joueurs : ce n'était plus un bonus, c'était un salaire.
--   3. 🕘 Les quatre bonus d'horloge retirés — avant 8h, après 22h,
--      happy hour, lève-tôt. L'heure à laquelle on s'entraîne dit
--      quelque chose de l'emploi du temps, rien de la performance.
--   4. ✅ Journée parfaite : le bonus de base passe de +2 à +4. Le
--      contrat rempli (3/3) doit peser plus lourd que l'assaisonnement.
--   5. 📅 « La semaine pleine » : +5 automatiques pour 7 jours parfaits
--      sur une semaine lundi→dimanche, posés sur le dimanche. Comptée
--      dans le classement hebdo (donc prime et duels), sans récursion.
--   6. 🎲 Le doublement se généralise aux trois exos : « pompes / abdos
--      / squats comptent double », un seul tiré par jour. Chacun double
--      la coche ET les paliers déclarés de son échelle. « Pompes double »
--      garde sa clé et son historique. Et la coche double POUR DE VRAI :
--      jusqu'au 26/07 l'événement versait +1 forfaitaire, donc à ×2 de
--      série une coche qui valait 2 n'en rapportait que 3 — l'événement
--      payait d'autant moins qu'on était régulier. Dès le 27/07 la coche
--      doublée suit le multiplicateur (+1, +1,5 ou +2). Les paliers, eux,
--      restent au nominal : un palier est un bonus, et la série n'a
--      jamais touché aux bonus.
--   7. 🎰🪞 La roue rééquilibrée : le jour miroir sort du tirage (il
--      versait +8 à un compte inactif qui le raflait à vie ; son scoring
--      reste, les jours S1/S2 gardent leurs points), et quitte ou double
--      redescend de 0.20 à 0.12 (première source de points du jeu).
--   8. 🥇 Séance la plus rapide retirée (bornée au 27/07). Même salaire
--      déguisé que l'éclair : lancer, ne rien faire, cocher à la main.
--   9. 🤝 Jour parfait collectif retiré (borné au 27/07). Il se ramollit
--      quand le groupe se vide — plus facile à mesure qu'on décroche.
--  10. 🥇 Premier du jour retiré (borné au 27/07). Pensé comme une
--      course, mais un réveil malin le raflait autant qu'un vrai effort ;
--      comme les bonus d'horloge, il parlait plus de l'agenda que de la
--      perf. Borné, pas supprimé : les jours S1/S2 gardent leurs +3, et
--      la colonne premier_du_jour de la vue reste (signature figée).
--
-- AUCUN EFFET RÉTROACTIF. Chaque changement est daté au 27/07 dans la
-- vue (< 27/07 pour un retrait, >= 27/07 pour un ajout), comme les
-- arbitrages du 20/07 l'ont été. Les points de la S1 et de la S2 ne
-- bougent pas d'un demi-point, le classement général non plus.
-- Vérifiable : la vue ne change de valeur pour aucun jour antérieur au
-- 27/07 (protocole en fin de fichier, attendu : 0).
--
-- RÈGLE D'OR : daily_points (la vue) et player_breakdown (la RPC qui
-- REJOUE le calcul pour l'écran « d'où viennent mes points ») changent
-- ensemble, au caractère près. Toute arête ajoutée ici l'est là.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Le catalogue : arrivée du 10 km.
-- -------------------------------------------------------------

-- Le 5 km rejoint une échelle : deux paliers cumulables qui font 20.
update public.bonus_catalog set ladder = 'course' where key = 'course_5km';

-- Place au palier haut juste après le 5 km (sort = 8) : on décale les
-- exercices suivants d'un cran. Les kinds ne partagent pas d'ordre,
-- seul le tri des puces déclarables se lit ici.
--
-- Le garde `not exists` rend le décalage rejouable : c'est la seule
-- instruction non idempotente du fichier, et une migration qu'on
-- applique à 00h01 doit pouvoir être relancée sans décaler l'ordre
-- une deuxième fois.
update public.bonus_catalog
   set sort = sort + 1
 where kind = 'exercise' and sort >= 8
   and not exists (
     select 1 from public.bonus_catalog where key = 'course_10km'
   );

insert into public.bonus_catalog (key, kind, emoji, label, points, sort, ladder) values
  ('course_10km', 'exercise', '🏃', '+5 km (10 au total)', 12, 8, 'course')
on conflict (key) do nothing;

-- Deux nouveaux bonus automatiques / événements de la S3 :
--   · semaine_pleine : +5 posés sur le dimanche d'une semaine 7/7. Auto,
--     ni déclaré ni tiré — même kind que prime_hebdo, jamais une puce.
--   · abdos_double / squats_double : l'événement de doublement se tire
--     désormais sur l'un des trois exos. Même valeur que pompes_double
--     (la coche doublée = +1), lue au catalogue.
insert into public.bonus_catalog (key, kind, emoji, label, points, sort, ladder) values
  ('semaine_pleine', 'execution', '📅', 'La semaine pleine : 7 jours parfaits', 5, 19, null),
  ('abdos_double',   'event',     '🎲', 'Les abdos comptent double aujourd''hui', 1, 20, null),
  ('squats_double',  'event',     '🎲', 'Les squats comptent double aujourd''hui', 1, 20, null)
on conflict (key) do nothing;

-- -------------------------------------------------------------
-- 2. Le tirage : la roue de la S3.
--
--    Trois mouvements, tous à partir du 27/07 :
--      · happy hour et lève-tôt avaient déjà quitté la roue ;
--      · le jour miroir la quitte à son tour — il versait +8 au
--        dernier du classement, or le dernier est un compte inactif
--        (0 coche) qui le raflait à vie : le tirage ne récompensait
--        plus personne d'utile. On arrête de le TIRER ; son scoring
--        reste en place plus bas, les jours S1/S2 gardent leurs +8 ;
--      · le doublement se répartit sur les trois exos (pompes / abdos
--        / squats), à part égale, et quitte ou double redescend de
--        0.20 à 0.12 — il était devenu la première source de points.
--
--    Rien à dater ici : la fonction ne tire que pour aujourd'hui et
--    relit les jours déjà tirés dans daily_events. Les tirages passés
--    (miroir compris) sont figés dans la table, jamais rejoués.
-- -------------------------------------------------------------

create or replace function public.get_daily_event()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  existing text;
  r double precision;
  drawn text;
begin
  if paris_today < date '2026-07-13' or paris_today > date '2026-08-31' then
    return null;
  end if;

  select event_key into existing from public.daily_events where day = paris_today;
  if found then
    return existing;
  end if;

  r := random();
  if extract(isodow from paris_today) = 7 then
    drawn := case
      when r < 0.45 then 'rien'
      when r < 0.70 then 'boss_dimanche'
      when r < 0.76 then 'pompes_double'
      when r < 0.82 then 'abdos_double'
      when r < 0.88 then 'squats_double'
      else 'quitte_ou_double'
    end;
  else
    drawn := case
      when r < 0.52 then 'rien'
      when r < 0.64 then 'pompes_double'
      when r < 0.76 then 'abdos_double'
      when r < 0.88 then 'squats_double'
      else 'quitte_ou_double'
    end;
  end if;

  -- Deux clients qui tirent en même temps : le premier inséré gagne.
  insert into public.daily_events (day, event_key)
  values (paris_today, drawn)
  on conflict (day) do nothing;

  select event_key into existing from public.daily_events where day = paris_today;
  return existing;
end;
$$;

grant execute on function public.get_daily_event() to anon, authenticated;

-- -------------------------------------------------------------
-- 3. La vue daily_points, reprise de la migration 24 (joker).
--
--    Le squelette (série, joker, duels, miroir, prime hebdo) est
--    recopié au caractère près. Ce qui change pour la S3 :
--
--      · base_pts : journée parfaite +2 → +4, datée au 27/07 ;
--      · avant_8h, apres_22h, seance_20min, seance_rapide,
--        jour_parfait_collectif : bornés à < 27/07 ;
--      · happy_hour, leve_tot : bornés à < 27/07 (ceinture et
--        bretelles — ils ne sont plus tirés, mais un tirage forcé à
--        la main ne doit pas ressusciter le barème) ;
--      · pompes_double : dès le 27/07, double aussi les paliers pompes,
--        et deux sœurs (abdos_double, squats_double) font de même sur
--        leur échelle — un CTE claims_* par exercice ;
--      · full_weeks / semaine_pleine : +5 pour une semaine 7/7, injectés
--        dans extras_core (donc comptés dans le classement hebdo).
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
-- Les paliers pompes déclarés du jour, isolés du reste des bonus :
-- « les pompes comptent double » a besoin de leur total à part, et
-- l'échelle du catalogue est la seule définition de « c'est des
-- pompes » qui ne se périme pas quand un palier s'ajoute.
claims_pompes as (
  select bc.player_id, bc.day, sum(bc.points) as pts
  from public.bonus_claims bc
  join public.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.ladder = 'pompes'
  group by bc.player_id, bc.day
),
-- Les deux sœurs, pour « les abdos / les squats comptent double ».
claims_abdos as (
  select bc.player_id, bc.day, sum(bc.points) as pts
  from public.bonus_claims bc
  join public.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.ladder = 'abdos'
  group by bc.player_id, bc.day
),
claims_squats as (
  select bc.player_id, bc.day, sum(bc.points) as pts
  from public.bonus_claims bc
  join public.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.ladder = 'squats'
  group by bc.player_id, bc.day
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
     -- Depuis le 27/07, l'événement double AUSSI les paliers déclarés de
     -- l'exo tiré. claim_bonus les compte déjà une fois : les rajouter
     -- une seconde fois, c'est exactement les doubler. Eux ne suivent pas
     -- la série — un palier est un bonus, et la série ne touche pas aux
     -- bonus, ici pas plus qu'ailleurs.
     + case when s.day < date '2026-07-27' then 0
            when ev.event_key = 'pompes_double' then coalesce(cp.pts, 0)
            when ev.event_key = 'abdos_double'  then coalesce(ca.pts, 0)
            when ev.event_key = 'squats_double' then coalesce(cq.pts, 0)
            else 0 end
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
  left join claims_pompes cp on cp.player_id = s.player_id and cp.day = s.day
  left join claims_abdos ca on ca.player_id = s.player_id and ca.day = s.day
  left join claims_squats cq on cq.player_id = s.player_id and cq.day = s.day
  left join public.daily_events ev on ev.day = s.day
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
--    place avant réécriture. Le reste ne bouge pas — y compris
--    l'absence du joker dans sa CTE de série, écart antérieur à
--    cette migration qu'on ne corrige pas ici (ça changerait des
--    points déjà affichés, et ça se décide à part).
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
  islands as (
    select player_id, day,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from e
    where perfect
  ),
  streaks as (
    select player_id, day,
           (row_number() over (partition by player_id, island order by day))::int as streak_pos
    from islands
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
  claims_pompes as (
    select bc.player_id, bc.day, sum(bc.points) as pts
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    where cat.ladder = 'pompes'
    group by bc.player_id, bc.day
  ),
  claims_abdos as (
    select bc.player_id, bc.day, sum(bc.points) as pts
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    where cat.ladder = 'abdos'
    group by bc.player_id, bc.day
  ),
  claims_squats as (
    select bc.player_id, bc.day, sum(bc.points) as pts
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    where cat.ladder = 'squats'
    group by bc.player_id, bc.day
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
      -- ajoute 2) et l'événement double aussi les paliers déclarés de
      -- l'exo — eux au nominal, la série ne touche pas aux bonus. Le
      -- point doublé est porté par la ligne de l'événement (c'est lui qui
      -- le crée) ; claim_bonus garde la valeur nominale.
      -- Trois colonnes séparées ici, contrairement à la vue : le détail
      -- « d'où viennent mes points » nomme l'exo tiré.
      (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
            then bonus_value('pompes_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
       + case when ev.event_key = 'pompes_double' and s.day >= date '2026-07-27'
              then coalesce(cp.pts, 0) else 0 end) as b_pompes_double,
      -- Les deux sœurs de la S3, même logique sur l'exo tiré.
      (case when ev.event_key = 'abdos_double' and coalesce(e.abs, false)
            then bonus_value('abdos_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
       + case when ev.event_key = 'abdos_double' and s.day >= date '2026-07-27'
              then coalesce(ca.pts, 0) else 0 end) as b_abdos_double,
      (case when ev.event_key = 'squats_double' and coalesce(e.squats, false)
            then bonus_value('squats_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
       + case when ev.event_key = 'squats_double' and s.day >= date '2026-07-27'
              then coalesce(cq.pts, 0) else 0 end) as b_squats_double,
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
    left join claims_pompes cp on cp.player_id = s.player_id and cp.day = s.day
    left join claims_abdos ca on ca.player_id = s.player_id and ca.day = s.day
    left join claims_squats cq on cq.player_id = s.player_id and cq.day = s.day
    left join public.daily_events ev on ev.day = s.day
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
-- 5. Vérifier la non-régression AVANT de valider.
--
--    Cette migration ne doit rien changer aux jours déjà joués. Le
--    protocole, dans l'éditeur SQL — photographier la vue actuelle,
--    remplacer, comparer, et ne valider que si le compte est nul :
--
--      begin;
--
--      create temp table avant on commit drop as
--        select player_id, day, points, bonus_points, streak_pos
--        from public.daily_points;
--
--      -- coller ici tout ce fichier, sauf le présent bloc
--
--      select count(*) as points_qui_bougent
--      from public.daily_points n
--      join avant a using (player_id, day)
--      where n.points        is distinct from a.points
--         or n.bonus_points  is distinct from a.bonus_points
--         or n.streak_pos    is distinct from a.streak_pos;
--      -- attendu : 0
--
--      select count(*) as lignes_apparues_ou_disparues
--      from public.daily_points n
--      full join avant a using (player_id, day)
--      where n.player_id is null or a.player_id is null;
--      -- attendu : 0
--
--      commit;   -- ou rollback si l'un des deux comptes n'est pas nul
--
--    Contrôlé le 22/07 avant écriture : aucune entry, aucun claim et
--    aucun événement n'existe au 27/07 ou après. Toutes les arêtes
--    modifiées sont bornées par `s.day < date '2026-07-27'` (le
--    conjoint ajouté vaut TRUE sur tout jour antérieur, l'expression
--    est donc inchangée) ou par `s.day >= date '2026-07-27'` (sans
--    aucune ligne à ce jour). La migration est un no-op sur
--    l'existant, par construction et par les données.
-- -------------------------------------------------------------
