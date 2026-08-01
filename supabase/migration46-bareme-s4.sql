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
