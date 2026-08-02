-- =============================================================
-- Migration 46 — le barème S4 (03/08) : deux événements, un jour off
-- =============================================================
-- Numérotée 46 : elle recrée daily_points APRÈS migration33 (sa
-- dernière définition en prod). La dernière définition gagne.
--
-- Modelée sur migration29-bareme-s3 : un seul fichier pour une seule
-- bascule de barème, chaque règle datée au 03/08 quand elle en a
-- besoin. AUCUN EFFET RÉTROACTIF.
--
-- Deux décisions de Jordan pour la S4 :
--
--   1. 🔁 Bonus doublés et 🎁 Jour de fête entrent dans la roue. Elle
--      tournait à vide 52 % du temps et n'offrait plus que deux
--      mécaniques (doubler un exo, quitte ou double). Ces deux-là
--      élargissent le registre sans payer une HEURE de la journée —
--      l'erreur des bonus d'horloge, retirés le 27/07.
--
--   2. 😴 Un jour off par semaine, LE MÊME POUR TOUT LE MONDE, tiré
--      au hasard parmi lundi→vendredi, découvert le matin même. Il
--      préserve la série et rien d'autre : zéro point, pas un jour
--      parfait, pas un jour de duel. Une seule exception, la semaine
--      pleine — sinon ce bonus punirait le repos.
--
--      Le contrat est quotidien depuis le 13/07 et le seul filet est
--      le joker : un pour tout le challenge. Sur les quatre dernières
--      semaines, une soupape hebdomadaire attaque ce que la migration
--      24 décrivait déjà : « il ne perd pas 12 jours, il perd la
--      raison d'ouvrir l'app demain ».
--
-- POURQUOI CE FICHIER NE DATE PAS LE JOUR OFF.
-- La table jours_off est VIDE avant le 03/08 et sa contrainte CHECK
-- interdit d'y écrire un jour antérieur. Toutes les injections plus
-- bas (série, spine, semaine pleine, joker, retour) se réduisent donc
-- mot pour mot au comportement actuel sur tout jour passé. La
-- non-régression est STRUCTURELLE, pas datée — c'est ce qui évite les
-- 34 bornes de date qu'avait coûtées la migration 29. Les deux
-- événements, eux, sont bornés : ils touchent le calcul des points.
-- -------------------------------------------------------------

-- -------------------------------------------------------------
-- 1. Les deux nouveaux événements au catalogue.
--
--    bonus_doubles porte 0 point : son montant n'est pas un forfait,
--    c'est la somme des puces du jour. jour_de_fete porte ses 5, lus
--    par bonus_value comme boss_dimanche lit ses 10.
--
--    Pas de double_event sur ces lignes : cette colonne dit « quel
--    tirage double CETTE puce », et un événement ne se double pas
--    lui-même.
-- -------------------------------------------------------------

insert into public.bonus_catalog (key, kind, emoji, label, points, sort) values
  ('bonus_doubles', 'event', '🔁',
   'Bonus doublés : tes puces déclarées comptent double', 0, 27),
  ('jour_de_fete',  'event', '🎁',
   'Jour de fête : +5 si tu fais 3/3', 5, 28)
on conflict (key) do nothing;

-- -------------------------------------------------------------
-- 2. Le jour off : la table.
--
--    Une ligne par jour off, pas une par joueur : le jour off est un
--    fait de CALENDRIER, le même pour tout le monde. C'est ce qui
--    rend cette migration tenable — aucune écriture joueur, donc pas
--    de RLS en écriture, pas de trigger de fenêtre, et surtout pas de
--    deuxième porte avant « Lancer ma séance » (PRODUCT.md).
--
--    Le CHECK est le garde-fou de non-régression : il rend
--    littéralement impossible d'écrire un jour off avant le 03/08,
--    donc de toucher à l'historique. Il s'arrête au 28/08, dernier
--    vendredi : la dernière semaine du challenge n'est qu'un lundi
--    (31/08), jour du badge 🏁 le finisseur — on ne met pas le point
--    final en repos.
-- -------------------------------------------------------------

create table if not exists public.jours_off (
  day         date primary key
              check (day between date '2026-08-03' and date '2026-08-28'),
  -- Le lundi de la semaine du jour off. Redondant avec `day`, et c'est
  -- exprès : il porte la contrainte d'unicité ci-dessous. Un jour off
  -- par semaine devient alors une garantie de la BASE, et plus
  -- seulement une propriété de l'échelle de tirage.
  week_monday date not null,
  tire_le     timestamptz not null default now(),
  constraint jour_off_ouvre check (extract(isodow from day) between 1 and 5),
  constraint jour_off_lundi
    check (week_monday = day - (extract(isodow from day)::int - 1)),
  constraint jour_off_un_par_semaine unique (week_monday)
);

alter table public.jours_off enable row level security;

drop policy if exists "jours_off lecture publique" on public.jours_off;
create policy "jours_off lecture publique"
  on public.jours_off for select using (true);

-- Aucune policy d'écriture : seule get_jour_off() (security definer)
-- insère. Le client ne décide jamais de son repos.

-- ⚠️ LA LIGNE LA PLUS RISQUÉE DU FICHIER, et elle ne parle pas du jour
-- off. daily_points est `with (security_invoker = true)` : elle lit
-- jours_off avec les droits de l'appelant. Sans ce SELECT pour anon, ce
-- n'est pas le repos qui casse, c'est LA VUE ENTIÈRE — donc le
-- classement, donc l'app. Supabase pose ce grant par défaut sur public ;
-- on ne parie pas l'application sur un défaut de plateforme.
grant select on public.jours_off to anon, authenticated, service_role;

-- -------------------------------------------------------------
-- 3. Le jour off : le tirage.
--
--    Échelle de probabilité CROISSANTE sur les jours ouvrés de la
--    semaine en cours, tant que rien n'est tombé : lundi 1/5, mardi
--    1/4, mercredi 1/3, jeudi 1/2, vendredi 1/1.
--
--    Marginale exacte de 1/5 par jour (lundi 1/5 ; mardi 4/5 × 1/4 =
--    1/5 ; mercredi 3/4 × 1/3 = 1/5 ; etc.) et EXACTEMENT un jour off
--    par semaine, garanti par construction.
--
--    Pourquoi pas un tirage du lundi pour toute la semaine : la ligne
--    existerait en base dès le lundi, et la RLS de lecture est
--    publique. N'importe qui ouvrant l'onglet réseau connaîtrait son
--    repos trois jours à l'avance. Ici la ligne du jour off n'existe
--    pas avant son matin — il n'y a rien à lire.
--
--    Défaut assumé : arrivé au vendredi matin sans jour off, il est
--    certain. C'est du suspense, pas une fuite.
-- -------------------------------------------------------------

create or replace function public.get_jour_off()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_today date := (now() at time zone 'Europe/Paris')::date;
  dow      int;
  lundi    date;
  deja     date;
  restants int;
begin
  if paris_today < date '2026-08-03' or paris_today > date '2026-08-28' then
    return false;
  end if;

  dow := extract(isodow from paris_today)::int;   -- 1 = lundi … 7 = dimanche
  if dow > 5 then
    return false;                                 -- jamais le week-end
  end if;

  lundi := paris_today - (dow - 1);

  -- Déjà tiré cette semaine ? Alors la réponse est figée, quelle que
  -- soit l'heure et le nombre d'appels.
  select day into deja
  from public.jours_off
  where day between lundi and lundi + 6;
  if found then
    return deja = paris_today;
  end if;

  restants := 6 - dow;             -- lundi → 5, mardi → 4 … vendredi → 1
  if random() >= 1.0 / restants then
    return false;
  end if;

  -- Deux clients qui tirent en même temps : le premier inséré gagne.
  -- `on conflict do nothing` SANS cible, pour couvrir la clé primaire ET
  -- l'unicité de week_monday — le cron de 6h et un lève-tôt qui ouvre
  -- l'app ne doivent jamais se lever d'exception à la figure.
  insert into public.jours_off (day, week_monday) values (paris_today, lundi)
  on conflict do nothing;

  return exists (select 1 from public.jours_off where day = paris_today);
end;
$$;

grant execute on function public.get_jour_off() to anon, authenticated;

-- -------------------------------------------------------------
-- 4. Le tirage du jour : la roue de la S4.
--
--    Reprise mot pour mot de la migration 29, avec deux changements :
--
--    a) Le jour off est résolu AVANT l'événement. Sans cet ordre, un
--       client qui ouvre l'app à 5h ferait tirer un « charge sur les
--       bonus » que le tirage de 6h contredirait. Un jour off ne
--       porte pas d'événement : le repos EST la nouvelle du jour, et
--       deux annonces opposées le même matin ne s'expliquent pas.
--
--    b) Les probabilités du 03/08. « rien » reste autour de la moitié
--       (un événement quotidien n'est plus un événement) et quitte ou
--       double ne remonte pas — il était redevenu la première source
--       de points du jeu. Les deux nouveaux se financent sur « rien »
--       et sur les doublements d'exo, qui passent de 12 à 9 %.
--
--       lun–sam : rien 47, pompes/abdos/squats 9 chacun,
--                 quitte ou double 10, bonus doublés 8, fête 8.
--       dimanche : rien 41, boss 25, les trois doubles 4 chacun,
--                 quitte ou double 10, bonus doublés 7, fête 5.
--
--       Pourquoi 8 % et pas 5. Il ne reste que 29 jours, dont quatre
--       seront des jours off — donc sans tirage. À 5 %, il y avait une
--       chance sur trois qu'un des deux nouveaux ne sorte JAMAIS d'ici
--       le 31/08 : une règle annoncée au groupe et jamais vue. À 8 %,
--       chacun a ~86 % de chances de tomber au moins une fois.
--       C'est le calendrier qui décide ici, pas l'équilibrage : sur un
--       challenge de 50 jours, 5 % aurait été le bon chiffre.
--
--    Avant le 03/08 l'ancien tirage s'applique mot pour mot. La
--    fonction ne tire de toute façon que pour aujourd'hui : les jours
--    passés sont figés dans daily_events, jamais rejoués.
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

  -- Le repos passe avant la roue.
  if public.get_jour_off() then
    insert into public.daily_events (day, event_key)
    values (paris_today, 'rien')
    on conflict (day) do nothing;
    select event_key into existing from public.daily_events where day = paris_today;
    return existing;
  end if;

  r := random();
  if paris_today >= date '2026-08-03' then
    if extract(isodow from paris_today) = 7 then
      drawn := case
        when r < 0.41 then 'rien'
        when r < 0.66 then 'boss_dimanche'
        when r < 0.70 then 'pompes_double'
        when r < 0.74 then 'abdos_double'
        when r < 0.78 then 'squats_double'
        when r < 0.88 then 'quitte_ou_double'
        when r < 0.95 then 'bonus_doubles'
        else 'jour_de_fete'
      end;
    else
      drawn := case
        when r < 0.47 then 'rien'
        when r < 0.56 then 'pompes_double'
        when r < 0.65 then 'abdos_double'
        when r < 0.74 then 'squats_double'
        when r < 0.84 then 'quitte_ou_double'
        when r < 0.92 then 'bonus_doubles'
        else 'jour_de_fete'
      end;
    end if;
  elsif extract(isodow from paris_today) = 7 then
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
-- 5. daily_points : reprise TELLE QUELLE de la migration 33, avec
--    les seuls changements de la S4. Ils sont marqués « S4 » un par
--    un ci-dessous, il n'y en a pas d'autres.
--
--      · offs         — nouvelle CTE : qui se repose, quel jour
--      · kept0        — la chaîne de base enjambe le jour off
--      · joker        — il ne brûle JAMAIS sur un jour off
--      · comeback     — 🔙 le retour ne paie pas le lendemain d'un off
--      · spine        — le jour off existe même sans coche
--      · claims_exo   — le total des puces, pour 🔁 bonus doublés
--      · event_bonus  — 🔁 bonus doublés et 🎁 jour de fête
--      · full_weeks   — le jour off compte comme rempli
--      · jour_off     — nouvelle colonne, EN DERNIER
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
-- ---- S4 : le jour off ------------------------------------------
-- Le jour off appartient au calendrier, pas au joueur : jours_off ×
-- players. On EXCLUT ceux qui étaient parfaits ce jour-là — s'ils ont
-- coché, leur jour compte comme un vrai 3/3, et une seconde ligne
-- dans kept décalerait le row_number(), donc toute leur série.
--
-- Table vide avant le 03/08 (CHECK) : sur tout jour passé, cette CTE
-- est vide et tout ce qui suit se réduit au calcul d'avant.
offs as (
  select p.id as player_id, jo.day
  from public.jours_off jo
  cross join public.players p
  where not exists (
    select 1 from e
    where e.player_id = p.id and e.day = jo.day and e.perfect
  )
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
--
-- S4 : la chaîne de base part désormais des jours parfaits ET des
-- jours off. Sans ça, base_streaks casserait à chaque repos et le
-- joker se déclencherait sur un jour où il n'y a rien à sauver.
kept0 as (
  select player_id, day, true as is_perfect from e where perfect
  union all
  select player_id, day, false as is_perfect from offs
),
base_islands as (
  select player_id, day, is_perfect,
         (day - (row_number() over (partition by player_id order by day))::int) as island
  from kept0
),
base_streaks as (
  select player_id, day,
         (row_number() over (partition by player_id, island order by day))::int as pos
  from base_islands
  where is_perfect
),
-- S4 : « le lendemain » saute un éventuel jour off. Il ne peut jamais
-- y en avoir deux d'affilée (un seul par semaine, jamais le week-end),
-- donc sauter d'un jour suffit toujours.
--
-- Sans ça, deux régressions : le joker brûlerait sur le premier jour
-- off venu — les trois conditions (série ≥ 3, trou, retour) y sont
-- toutes satisfaites — et sa collision avec offs dans kept ferait
-- compter deux fois le même jour.
--
-- jours_off étant vide avant le 03/08, les deux « case when exists »
-- rendent day + 1 sur tout jour passé : c'est le calcul de la
-- migration 33, mot pour mot.
joker as (
  select distinct on (bs.player_id)
         bs.player_id, g.trou as day
  from base_streaks bs
  cross join lateral (
    select case when exists (select 1 from public.jours_off jo where jo.day = bs.day + 1)
                then bs.day + 2 else bs.day + 1 end as trou
  ) g
  where bs.pos >= 3
    -- un jour off n'est pas une cassure : il n'y a rien à racheter
    and not exists (select 1 from public.jours_off jo where jo.day = g.trou)
    -- le lendemain n'est pas parfait : c'est la cassure
    and not exists (
      select 1 from e gap
      where gap.player_id = bs.player_id and gap.day = g.trou and gap.perfect
    )
    -- mais le surlendemain l'est : il y a bien deux morceaux a recoller
    and exists (
      select 1 from e back
      where back.player_id = bs.player_id and back.perfect
        and back.day = case when exists (select 1 from public.jours_off jo
                                          where jo.day = g.trou + 1)
                            then g.trou + 2 else g.trou + 1 end
    )
  order by bs.player_id, bs.day
),
-- Les jours qui tiennent la chaine : les parfaits, le jour off, plus
-- le jour joker.
kept as (
  select player_id, day, is_perfect from kept0
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
--
-- S4 : pas au lendemain d'un jour off. Un jour off EST un hier à zéro
-- pour presque tout le monde — sans cette garde, le groupe entier
-- encaisse +3 gratuits chaque semaine, et « la main tendue à celui
-- qui revient » devient un salaire.
comeback as (
  select cur.player_id, cur.day
  from e cur
  where cur.perfect
    and not exists (
      select 1 from public.jours_off jo where jo.day = cur.day - 1
    )
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
-- S4 : le jour off entre dans spine. Sans lui, un joueur qui se repose
-- n'a ni entrée ni claim ce jour-là, donc AUCUNE ligne daily_points —
-- et le drapeau jour_off n'existerait pour personne. C'est exactement
-- le défaut que la migration 27 a corrigé pour le joker.
spine as (
  select player_id, day from e
  union
  select player_id, day from public.bonus_claims
  union
  select player_id, day from joker
  union
  select player_id, day from offs
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
-- S4 : le total des puces d'EXERCICE du jour, pour 🔁 bonus doublés.
-- Ce tirage-là ne vise aucun exo : il double la feuille entière. Il ne
-- passe donc pas par double_event, qui dit « quel exo double cette
-- puce ». Restreint à kind = 'exercise' : boss_dimanche est un
-- événement déclaré, pas une puce, et ne se double pas.
claims_exo as (
  select bc.player_id, bc.day, sum(bc.points) as pts
  from public.bonus_claims bc
  join public.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.kind = 'exercise'
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
    (jo.day is not null) as jour_off,
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
     -- S4 : 🔁 bonus doublés. Même mécanique que ci-dessus, mais sur la
     -- feuille entière au lieu d'un seul exo. claim_bonus les compte
     -- déjà une fois ; les rajouter une seconde fois les double. Hors
     -- série, comme tout bonus.
     + case when s.day >= date '2026-08-03' and ev.event_key = 'bonus_doubles'
            then coalesce(cex.pts, 0) else 0 end
     -- S4 : 🎁 jour de fête. Un forfait pour le contrat rempli, rien
     -- d'autre à faire. Hors série : c'est un bonus d'événement, pas de
     -- la base — le multiplicateur ne le touche pas.
     + case when s.day >= date '2026-08-03' and ev.event_key = 'jour_de_fete'
                 and coalesce(e.perfect, false)
            then public.bonus_value('jour_de_fete') else 0 end
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
  left join public.jours_off jo on jo.day = s.day
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
  left join claims_exo cex on cex.player_id = s.player_id and cex.day = s.day
),
premirror as (
  select
    player_id, day, exos, perfect, streak_pos, jokered, premier_du_jour,
    jour_off, multiplier, event_key,
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
--
-- S4 : le jour off compte comme rempli. C'est la SEULE exception à
-- « le jour off ne vaut rien » — sans elle, la semaine pleine
-- deviendrait inatteignable dès qu'on se repose, et un bonus qui
-- punit le repos annule le repos. Le compte reste à 7 : six jours
-- parfaits plus le jour off. jours_off étant vide avant le 03/08, les
-- semaines déjà payées ne bougent pas d'un point.
full_weeks as (
  select g.monday::date as monday, k.player_id
  from paris,
       generate_series(date '2026-07-27', paris.today, interval '7 days') as g(monday)
  join (
    select player_id, day from e where perfect
    union
    select player_id, day from offs
  ) k on k.day between g.monday::date and g.monday::date + 6
  where g.monday::date + 7 <= paris.today
  group by g.monday::date, k.player_id
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
  -- jokered, premier_du_jour puis jour_off EN DERNIER, dans CET ordre :
  -- c'est la signature de sortie de la vue en prod. « create or replace
  -- view » sait ajouter une colonne en fin de liste, jamais en insérer
  -- une au milieu ni en retirer (42P16) — l'ordre des colonnes est gravé.
  pm.jokered,
  pm.premier_du_jour,
  pm.jour_off
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
  false as premier_du_jour,
  false as jour_off
from extras_by_day x
where not exists (
  select 1 from premirror pm
  where pm.player_id = x.player_id and pm.day = x.day
);

-- -------------------------------------------------------------
-- 6. player_badges : les badges de série enjambent le jour off.
--
--    Reprise telle quelle de la migration 2, avec deux changements.
--
--    Cette vue porte SA PROPRE notion de série (la CTE `islands`), qui
--    ne connaît ni le joker ni rien d'autre : elle compte les runs de
--    jours parfaits, point. Sans correctif, un joueur qui prend son
--    jour off voit sa course aux badges repartir de zéro chaque
--    semaine — 🌱 la première semaine (7 d'affilée) devient hors
--    d'atteinte, et 🛡️ increvable (30) aussi.
--
--    Ce n'est pas « impossible pour tout le monde » : qui s'entraîne le
--    jour off garde sa course entière. Mais faire des badges la
--    récompense de celui qui ne se repose jamais, c'est reprendre d'une
--    main ce que le jour off donne de l'autre. Décision de Jordan : le
--    jour off enjambe aussi les badges.
--
--    Le jour off PRÉSERVE sans ALLONGER, comme partout ailleurs :
--    `count(*) filter (where is_perfect)` ne compte que les vrais
--    jours parfaits. Six jours parfaits autour d'un jour off font une
--    île de 6, pas de 7.
--
--    jours_off étant vide avant le 03/08, les badges déjà décrochés
--    ne bougent pas.
-- -------------------------------------------------------------

create or replace view public.player_badges
with (security_invoker = true) as
with e as (
  select player_id, day,
         (pushups::int + abs::int + squats::int) as exos,
         (pushups and abs and squats) as perfect
  from public.entries
),
paris as (
  select (now() at time zone 'Europe/Paris')::date as today
),
elapsed as (
  select d::date as day
  from generate_series(
    date '2026-07-13',
    least((select today from paris), date '2026-08-31'),
    interval '1 day'
  ) d
),
-- 😴 Le jour off, joueur par joueur — sauf pour qui s'est entraîné
-- quand même : celui-là a déjà sa ligne parfaite, et un doublon
-- décalerait la numérotation des îles.
repos as (
  select p.id as player_id, jo.day
  from public.jours_off jo
  cross join public.players p
  where not exists (
    select 1 from e
    where e.player_id = p.id and e.day = jo.day and e.perfect
  )
),
islands as (
  select player_id, count(*) filter (where is_perfect) as len
  from (
    select player_id, day, is_perfect,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from (
      select player_id, day, true as is_perfect from e where perfect
      union all
      select player_id, day, false as is_perfect from repos
    ) k
  ) t
  group by player_id, island
),
-- classement cumulé jour par jour, pour "Premier de la classe"
grid as (
  select pl.id as player_id, d.day, coalesce(dp.points, 0) as pts
  from public.players pl
  cross join elapsed d
  left join public.daily_points dp on dp.player_id = pl.id and dp.day = d.day
),
dayrank as (
  select player_id, day,
         rank() over (partition by day order by cum_pts desc) as r
  from (
    select player_id, day,
           sum(pts) over (partition by player_id order by day) as cum_pts
    from grid
  ) c
),
top_runs as (
  select player_id, count(*) as len
  from (
    select player_id, day,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from dayrank where r = 1
  ) t
  group by player_id, island
)
select player_id, 'premiere_semaine' as badge
  from islands group by player_id having max(len) >= 7
union all
select player_id, 'machine'
  from islands group by player_id having max(len) >= 14
union all
select player_id, 'increvable'
  from islands group by player_id having max(len) >= 30
union all
select p.id, 'sans_faute'
  from public.players p
  where exists (select 1 from e where e.player_id = p.id and e.perfect)
    and not exists (
      select 1 from elapsed d
      where d.day < (select today from paris)
        -- 😴 Un jour off n'est pas une faute. Sans cette ligne, 💎 sans
        -- faute tombe pour tout le groupe le premier mercredi venu.
        and not exists (select 1 from public.jours_off jo where jo.day = d.day)
        and not exists (
          select 1 from e
          where e.player_id = p.id and e.day = d.day and e.perfect
        )
    )
union all
select player_id, 'retour_de_flamme'
  from islands where len >= 5
  group by player_id having count(*) >= 2
union all
select player_id, 'premier_de_la_classe'
  from top_runs group by player_id having max(len) >= 7
union all
select player_id, 'finisseur'
  from e where day = date '2026-08-31' and perfect
union all
select player_id, 'centurion'
  from e group by player_id having sum(exos) >= 100;

-- -------------------------------------------------------------
-- 7. leaderboard() : la série survit au jour off.
--
--    Reprise telle quelle de la migration 35, avec trois changements.
--
--    C'est le raté le plus visible s'il est oublié : `current_streak`
--    ne tient que si le DERNIER jour qui a tenu la chaîne date d'hier
--    ou d'aujourd'hui. Sans le jour off dans `last_kept`, la série de
--    tout le monde tombe à zéro le lendemain matin de chaque repos —
--    alors même que daily_points, lui, l'a correctement préservée. Le
--    classement dirait 0, la vue dirait 23.
--
--    Le coalesce sur streak_pos est un no-op aujourd'hui et
--    indispensable demain : jusqu'ici `lk` impliquait `lp` (un joker
--    suppose trois jours parfaits derrière lui). Le jour off, lui, est
--    distribué à TOUT LE MONDE — y compris à un inscrit qui n'a jamais
--    fait un seul 3/3. `lk` existe alors sans `lp`, et current_streak
--    remontait null au lieu de 0.
--
--    Signature inchangée ⇒ create or replace, les droits survivent.
-- -------------------------------------------------------------

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
           d.points, d.bonus_points, d.jokered, d.jour_off
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
  -- Dernier jour qui tient la chaîne : parfait, joker, ou jour off
  -- QUI PROLONGE VRAIMENT quelque chose.
  --
  -- Le test de cette condition n'est pas décoratif. Un jour joker est
  -- toujours collé à la série qu'il sauve, donc « dernier jour joker »
  -- suffisait. Le jour off, lui, est distribué à TOUT LE MONDE — y
  -- compris à quelqu'un qui n'a plus rien coché depuis trois semaines.
  -- Sans la condition d'adjacence, son jour off devient un « dernier
  -- jour qui tient la chaîne » tout frais, et le classement ressuscite
  -- une série morte : mesuré, un joueur arrêté depuis 3 jours
  -- réaffichait 21 jours de série le lendemain du repos.
  --
  -- Il ne peut jamais y avoir deux jours off consécutifs (un par
  -- semaine, jamais le week-end), donc regarder la veille suffit.
  last_kept as (
    select distinct on (dp.player_id) dp.player_id, dp.day
    from dp
    where dp.perfect
       or dp.jokered
       or (dp.jour_off and exists (
             select 1 from dp v
             where v.player_id = dp.player_id
               and v.day = dp.day - 1
               and (v.perfect or v.jokered)))
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
         then coalesce(lp.streak_pos, 0) else 0 end as current_streak,
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


-- -------------------------------------------------------------
-- 8. duel_results : le duel se joue sur les jours parfaits, mais il
--    se DÉPARTAGE aux points de la semaine.
--
--    Le critère principal ne bouge pas d'une ligne : `tally` compte les
--    jours parfaits directement sur entries, le jour off n'en est pas
--    un, et il est le même pour les deux adversaires. Équitable par
--    construction — c'est tout l'intérêt d'un jour off collectif.
--
--    Mais `duel_points` somme `weekpts`, qui descend de `pmpts`, donc
--    du moteur. Trois changements S4 déplacent ces points : la série
--    préservée par le jour off change le multiplicateur de TOUS les
--    jours suivants (3,5 pts par jour entre ×1 et ×1,5), le 🔙 retour
--    ne paie plus le lendemain d'un repos, et les deux nouveaux
--    événements sont des points secs.
--
--    Laisser cette vue sur le moteur S3, ce serait reproduire à un mois
--    près le bug que la migration 39 a été écrite pour corriger. Son
--    en-tête donne l'ordre de grandeur : sur les 3 duels résolus, 1
--    s'est joué au départage, 231,5 contre 241,0. Une marge de 9,5
--    points suffit à faire basculer un duel — un multiplicateur
--    préservé sur trois jours pèse plus que ça.
--
--    MÉTHODE, la même qu'en migration 39. La tête (de `paris` à
--    `mirror_winner`) est la chaîne de CTE de daily_points ci-dessus,
--    au caractère près — c'est la seule façon que les deux ne dérivent
--    pas. La queue (`weekpts` → le select final) est recollée VERBATIM
--    depuis pg_get_viewdef, d'où son style machine : on ne retape pas à
--    la main ce qui décide qui gagne un duel.
--
--    Les colonnes jokered / premier_du_jour / jour_off traversent
--    `base` et `premirror` sans jamais être lues par la queue. C'est
--    déjà le cas aujourd'hui, et c'est le prix du verbatim.
--
--    `create or replace` avec la même liste de sortie, JAMAIS de drop :
--    daily_points dépend de duel_results, et player_badges de
--    daily_points.
-- -------------------------------------------------------------

create or replace view public.duel_results
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
-- ---- S4 : le jour off ------------------------------------------
-- Le jour off appartient au calendrier, pas au joueur : jours_off ×
-- players. On EXCLUT ceux qui étaient parfaits ce jour-là — s'ils ont
-- coché, leur jour compte comme un vrai 3/3, et une seconde ligne
-- dans kept décalerait le row_number(), donc toute leur série.
--
-- Table vide avant le 03/08 (CHECK) : sur tout jour passé, cette CTE
-- est vide et tout ce qui suit se réduit au calcul d'avant.
offs as (
  select p.id as player_id, jo.day
  from public.jours_off jo
  cross join public.players p
  where not exists (
    select 1 from e
    where e.player_id = p.id and e.day = jo.day and e.perfect
  )
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
--
-- S4 : la chaîne de base part désormais des jours parfaits ET des
-- jours off. Sans ça, base_streaks casserait à chaque repos et le
-- joker se déclencherait sur un jour où il n'y a rien à sauver.
kept0 as (
  select player_id, day, true as is_perfect from e where perfect
  union all
  select player_id, day, false as is_perfect from offs
),
base_islands as (
  select player_id, day, is_perfect,
         (day - (row_number() over (partition by player_id order by day))::int) as island
  from kept0
),
base_streaks as (
  select player_id, day,
         (row_number() over (partition by player_id, island order by day))::int as pos
  from base_islands
  where is_perfect
),
-- S4 : « le lendemain » saute un éventuel jour off. Il ne peut jamais
-- y en avoir deux d'affilée (un seul par semaine, jamais le week-end),
-- donc sauter d'un jour suffit toujours.
--
-- Sans ça, deux régressions : le joker brûlerait sur le premier jour
-- off venu — les trois conditions (série ≥ 3, trou, retour) y sont
-- toutes satisfaites — et sa collision avec offs dans kept ferait
-- compter deux fois le même jour.
--
-- jours_off étant vide avant le 03/08, les deux « case when exists »
-- rendent day + 1 sur tout jour passé : c'est le calcul de la
-- migration 33, mot pour mot.
joker as (
  select distinct on (bs.player_id)
         bs.player_id, g.trou as day
  from base_streaks bs
  cross join lateral (
    select case when exists (select 1 from public.jours_off jo where jo.day = bs.day + 1)
                then bs.day + 2 else bs.day + 1 end as trou
  ) g
  where bs.pos >= 3
    -- un jour off n'est pas une cassure : il n'y a rien à racheter
    and not exists (select 1 from public.jours_off jo where jo.day = g.trou)
    -- le lendemain n'est pas parfait : c'est la cassure
    and not exists (
      select 1 from e gap
      where gap.player_id = bs.player_id and gap.day = g.trou and gap.perfect
    )
    -- mais le surlendemain l'est : il y a bien deux morceaux a recoller
    and exists (
      select 1 from e back
      where back.player_id = bs.player_id and back.perfect
        and back.day = case when exists (select 1 from public.jours_off jo
                                          where jo.day = g.trou + 1)
                            then g.trou + 2 else g.trou + 1 end
    )
  order by bs.player_id, bs.day
),
-- Les jours qui tiennent la chaine : les parfaits, le jour off, plus
-- le jour joker.
kept as (
  select player_id, day, is_perfect from kept0
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
--
-- S4 : pas au lendemain d'un jour off. Un jour off EST un hier à zéro
-- pour presque tout le monde — sans cette garde, le groupe entier
-- encaisse +3 gratuits chaque semaine, et « la main tendue à celui
-- qui revient » devient un salaire.
comeback as (
  select cur.player_id, cur.day
  from e cur
  where cur.perfect
    and not exists (
      select 1 from public.jours_off jo where jo.day = cur.day - 1
    )
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
-- S4 : le jour off entre dans spine. Sans lui, un joueur qui se repose
-- n'a ni entrée ni claim ce jour-là, donc AUCUNE ligne daily_points —
-- et le drapeau jour_off n'existerait pour personne. C'est exactement
-- le défaut que la migration 27 a corrigé pour le joker.
spine as (
  select player_id, day from e
  union
  select player_id, day from public.bonus_claims
  union
  select player_id, day from joker
  union
  select player_id, day from offs
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
-- S4 : le total des puces d'EXERCICE du jour, pour 🔁 bonus doublés.
-- Ce tirage-là ne vise aucun exo : il double la feuille entière. Il ne
-- passe donc pas par double_event, qui dit « quel exo double cette
-- puce ». Restreint à kind = 'exercise' : boss_dimanche est un
-- événement déclaré, pas une puce, et ne se double pas.
claims_exo as (
  select bc.player_id, bc.day, sum(bc.points) as pts
  from public.bonus_claims bc
  join public.bonus_catalog cat on cat.key = bc.bonus_key
  where cat.kind = 'exercise'
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
    (jo.day is not null) as jour_off,
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
     -- S4 : 🔁 bonus doublés. Même mécanique que ci-dessus, mais sur la
     -- feuille entière au lieu d'un seul exo. claim_bonus les compte
     -- déjà une fois ; les rajouter une seconde fois les double. Hors
     -- série, comme tout bonus.
     + case when s.day >= date '2026-08-03' and ev.event_key = 'bonus_doubles'
            then coalesce(cex.pts, 0) else 0 end
     -- S4 : 🎁 jour de fête. Un forfait pour le contrat rempli, rien
     -- d'autre à faire. Hors série : c'est un bonus d'événement, pas de
     -- la base — le multiplicateur ne le touche pas.
     + case when s.day >= date '2026-08-03' and ev.event_key = 'jour_de_fete'
                 and coalesce(e.perfect, false)
            then public.bonus_value('jour_de_fete') else 0 end
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
  left join public.jours_off jo on jo.day = s.day
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
  left join claims_exo cex on cex.player_id = s.player_id and cex.day = s.day
),
premirror as (
  select
    player_id, day, exos, perfect, streak_pos, jokered, premier_du_jour,
    jour_off, multiplier, event_key,
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


-- -------------------------------------------------------------
-- 9. player_breakdown : le détail rejoue le moteur, il doit le
--    rejouer JUSTE.
--
--    Reprise telle quelle de la migration 34, avec les mêmes
--    changements que la vue. Ce n'est pas de l'affichage : la fonction
--    recalcule les totaux quotidiens pour désigner le vainqueur de la
--    semaine (week_standing → week_winner → prime_mine). Un moteur qui
--    diverge ici, c'est une prime hebdo versée à quelqu'un d'autre que
--    le premier du classement.
--
--    Ses CTE de série (base_islands, base_streaks, joker, kept,
--    comeback, full_weeks) sont celles de la vue mot pour mot depuis la
--    migration 33 — vérifié caractère par caractère avant de patcher.
--    Les mêmes correctifs s'y appliquent donc à l'identique.
--
--    UNE exception assumée : `spine` ne reçoit PAS les jours off. Il
--    ignore déjà le joker depuis toujours, et l'ajout serait un no-op
--    arithmétique — un jour off non travaillé n'apporte ni exo, ni jour
--    parfait, ni multiplicateur. On garde le diff minimal.
--
--    Signature à 7 colonnes inchangée ⇒ create or replace, pas de drop.
-- -------------------------------------------------------------

create or replace function public.player_breakdown(p_player uuid, p_from date default null, p_until date default null)
returns table (category text, item_key text, emoji text, label text, cnt bigint, points numeric, doubled numeric)
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
  -- 😴 S4 : le jour off, joueur par joueur — sauf pour qui s'est
  -- entraîné quand même, qui a déjà sa ligne parfaite.
  repos as (
    select p.id as player_id, jo.day
    from public.jours_off jo
    cross join public.players p
    where not exists (
      select 1 from e
      where e.player_id = p.id and e.day = jo.day and e.perfect
    )
  ),
  kept0 as (
    select player_id, day, true as is_perfect from e where perfect
    union all
    select player_id, day, false as is_perfect from repos
  ),
  base_islands as (
    select player_id, day, is_perfect,
           (day - (row_number() over (partition by player_id order by day))::int) as island
    from kept0
  ),
  base_streaks as (
    select player_id, day,
           (row_number() over (partition by player_id, island order by day))::int as pos
    from base_islands
    where is_perfect
  ),
  joker as (
    select distinct on (bs.player_id)
           bs.player_id, g.trou as day
    from base_streaks bs
    cross join lateral (
      select case when exists (select 1 from public.jours_off jo where jo.day = bs.day + 1)
                  then bs.day + 2 else bs.day + 1 end as trou
    ) g
    where bs.pos >= 3
      and not exists (select 1 from public.jours_off jo where jo.day = g.trou)
      and not exists (
        select 1 from e gap
        where gap.player_id = bs.player_id and gap.day = g.trou and gap.perfect
      )
      and exists (
        select 1 from e back
        where back.player_id = bs.player_id and back.perfect
        and back.day = case when exists (select 1 from public.jours_off jo
                                          where jo.day = g.trou + 1)
                            then g.trou + 2 else g.trou + 1 end
      )
    order by bs.player_id, bs.day
  ),
  kept as (
    select player_id, day, is_perfect from kept0
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
        select 1 from public.jours_off jo where jo.day = cur.day - 1
      )
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
  -- 🔁 S4 : le total des puces d'EXERCICE du jour. À part de
  -- claims_double, qui range par exo ; celui-ci ignore l'exo et exclut
  -- le boss du dimanche (kind='event'), qui ne se double pas.
  claims_exercise as (
    select bc.player_id, bc.day, sum(bc.points) as pts
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    where cat.kind = 'exercise'
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
      -- 🎲 L'exo doublé : ici, la COCHE doublée et rien d'autre. Elle
      -- suit la série (à ×2, doubler une coche qui vaut 2 ajoute 2).
      -- Ce que l'événement double par ailleurs — les puces déclarées de
      -- l'exo — descend sur les puces elles-mêmes, plus bas : c'est la
      -- puce qu'on a cochée, c'est elle qui doit afficher ce qu'elle a
      -- rapporté. Trois colonnes séparées ici, contrairement à la vue :
      -- le détail « d'où viennent mes points » nomme l'exo tiré.
      (case when ev.event_key = 'pompes_double' and coalesce(e.pushups, false)
            then bonus_value('pompes_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
      ) as b_pompes_double,
      -- Les deux sœurs de la S3, même logique sur l'exo tiré.
      (case when ev.event_key = 'abdos_double' and coalesce(e.abs, false)
            then bonus_value('abdos_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
      ) as b_abdos_double,
      (case when ev.event_key = 'squats_double' and coalesce(e.squats, false)
            then bonus_value('squats_double')
                 * case when s.day < date '2026-07-27' then 1.0
                        when coalesce(st.streak_pos, 0) >= 7 then 2.0
                        when coalesce(st.streak_pos, 0) >= 3 then 1.5
                        else 1.0 end
            else 0 end
      ) as b_squats_double,
      -- Les puces doublées du jour. Elles restent comptées ici pour que
      -- le total du jour ne bouge pas d'un pouce (la prime hebdo et le
      -- jour miroir se calculent dessus), mais elles ne sortent plus en
      -- ligne d'événement : chaque puce porte ses propres points, plus
      -- bas. Une ligne « +100 squats » qui affiche 4 quand elle en a
      -- rapporté 8 est une ligne qui ment poliment.
      -- 🔁 S4 : bonus doublés verse une seconde fois TOUTES les puces
      -- d'exercice du jour. Elles restent rangées avec les points
      -- doublés — c'est la puce qu'on a cochée qui les a gagnés.
      (case when s.day >= date '2026-07-27'
            then coalesce(dcl.pts, 0) else 0 end
       + case when s.day >= date '2026-08-03' and ev.event_key = 'bonus_doubles'
              then coalesce(cxc.pts, 0) else 0 end) as b_claims_double,
      -- 🎁 S4 : jour de fête, +5 pour un 3/3. Hors multiplicateur.
      case when s.day >= date '2026-08-03' and ev.event_key = 'jour_de_fete'
                and coalesce(e.perfect, false)
           then bonus_value('jour_de_fete') else 0 end as b_jour_de_fete,
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
    left join claims_exercise cxc on cxc.player_id = s.player_id and cxc.day = s.day
  ),
  premirror as (
    select
      player_id, day, exos, perfect, multiplier, event_key,
      -- Journée parfaite : +2 jusqu'au 26/07, +4 dès le 27/07 (S3).
      (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * multiplier as base_pts,
      b_premier_du_jour, b_avant_8h, b_apres_22h, b_seance_20min, b_seance_rapide,
      b_retour, b_collectif, b_pompes_double, b_abdos_double, b_squats_double,
      b_claims_double, b_happy_hour, b_leve_tot, b_jour_de_fete, claim_bonus,
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
           + b_abdos_double + b_squats_double + b_claims_double + b_happy_hour
           + b_leve_tot + b_jour_de_fete + claim_bonus + b_quitte_ou_double as pts
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
    select g.monday::date as monday, jp.player_id
    from paris,
         generate_series(date '2026-07-27', paris.today, interval '7 days') as g(monday)
    join (
      select player_id, day from e where perfect
      union
      select player_id, day from repos
    ) jp on jp.day between g.monday::date and g.monday::date + 6
    where g.monday::date + 7 <= paris.today
    group by g.monday::date, jp.player_id
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
    union all select 'jour_de_fete',     b_jour_de_fete     from mine
    union all select 'quitte_ou_double', b_quitte_ou_double from mine
    union all select 'jour_miroir',      v                  from mirror_mine
    union all select 'duel_hebdo',       v                  from duel_mine
    union all select 'prime_hebdo',      v                  from prime_mine
    union all select 'semaine_pleine',   v                  from semaine_mine
  ),
  claims as (
    select bc.bonus_key as k, count(*)::bigint as cnt, sum(bc.points) as pts,
           -- Les fois où le tirage du jour doublait cette puce : ses points
           -- sont versés une seconde fois, et ils lui appartiennent — c'est
           -- elle qu'on a cochée. Même somme que b_claims_double vu du jour,
           -- rangée par puce au lieu d'être rangée par date.
           sum(case when bc.day >= date '2026-07-27'
                         and ev.event_key = cat.double_event
                    then bc.points
                    -- 🔁 S4 : un jour « bonus doublés », c'est TOUTE la
                    -- feuille d'exercice qui est payée deux fois.
                    when bc.day >= date '2026-08-03'
                         and ev.event_key = 'bonus_doubles'
                         and cat.kind = 'exercise'
                    then bc.points
                    else 0 end) as pts_double
    from public.bonus_claims bc
    join public.bonus_catalog cat on cat.key = bc.bonus_key
    left join public.daily_events ev on ev.day = bc.day
    where bc.player_id = p_player
      and (p_from is null or bc.day >= p_from)
      and (p_until is null or bc.day <= p_until)
    group by bc.bonus_key
  ),
  base_rows as (
    select 'base'::text as category, 'exos'::text as item_key,
           '🎯'::text as emoji, 'Exos cochés'::text as label,
           coalesce(sum(exos), 0)::bigint as cnt,
           coalesce(sum(exos), 0)::numeric as points,
           0::numeric as doubled
    from mine
    union all
    select 'base', 'perfect', '✅', 'Journées parfaites',
           count(*) filter (where perfect)::bigint,
           -- +2 jusqu'au 26/07, +4 dès le 27/07 (S3), comme base_pts.
           coalesce(sum(case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end), 0)::numeric,
           0::numeric
    from mine
    union all
    select 'base', 'streak', '🔥', 'Bonus de série',
           count(*) filter (where multiplier > 1)::bigint,
           -- Le surplus de multiplicateur reconstruit la base : même
           -- montant de journée parfaite daté, sinon détail ≠ total.
           coalesce(sum(
             (exos + case when perfect then (case when day >= date '2026-07-27' then 4 else 2 end) else 0 end) * (multiplier - 1)
           ), 0)::numeric,
           0::numeric
    from mine
  ),
  bonus_rows as (
    select 'bonus'::text as category, a.k as item_key,
           cat.emoji, cat.label,
           count(*) filter (where a.v <> 0)::bigint as cnt,
           coalesce(sum(a.v), 0)::numeric as points,
           0::numeric as doubled
    from auto a
    join public.bonus_catalog cat on cat.key = a.k
    group by a.k, cat.emoji, cat.label
    union all
    select 'bonus', c.k, cat.emoji, cat.label, c.cnt,
           c.pts + c.pts_double, c.pts_double
    from claims c
    join public.bonus_catalog cat on cat.key = c.k
  )
  select category, item_key, emoji, label, cnt, round(points, 1) as points,
         round(doubled, 1) as doubled
  from base_rows
  where points <> 0 or cnt <> 0
  union all
  select category, item_key, emoji, label, cnt, round(points, 1) as points,
         round(doubled, 1) as doubled
  from bonus_rows
  where points <> 0;
$$;
