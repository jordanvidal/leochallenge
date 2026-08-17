-- migration 48 — un seul tirage de jour off par jour.
--
-- LE BUG, tel qu'il s'est vu le 17/08.
--
--   00h52  un joueur ouvre l'app. get_daily_event() appelle get_jour_off(),
--          qui tire NON (lundi, 1/5). Rien n'est écrit. L'événement du jour
--          est tiré dans la foulée : pompes_double.
--   06h00  le cron jour-off appelle get_jour_off(). Elle RE-TIRE. Cette
--          fois OUI. Ligne dans jours_off, push « 😴 Jour off ».
--   07h00  le cron daily-event trouve pompes_double et envoie son teaser.
--
--   Résultat : deux notifications qui se contredisent, et des pompes
--   doublées un jour où personne n'est censé cocher.
--
-- LA CAUSE. get_jour_off() n'était idempotente que quand elle répondait
-- OUI : le OUI laisse une ligne dans jours_off, et le garde-fou « déjà
-- tiré cette semaine ? » relit cette ligne. Le NON, lui, ne laissait
-- aucune trace — donc rien à relire, donc un nouveau tirage à chaque
-- appel. La fonction avait une mémoire, mais seulement de ses victoires.
--
-- CE N'EST PAS UN CAS LIMITE : deux appels par jour sont la norme. Le cron
-- de 6h en fait un, et le premier get_daily_event() de la journée en fait
-- un second (le cron de 7h, ou n'importe quel joueur qui ouvre l'app avant
-- lui). Les trois jours off du challenge ont tous été tirés de travers :
--
--   03/08  tiré à 00h00 par un client — à 6h le cron a vu que c'était fait
--          et s'est tu. Jour off jamais annoncé.
--   12/08  le cron de 6h a tiré NON, le cron de 7h a re-tiré et touché.
--          Jour off créé à 07h41, jamais annoncé non plus.
--   17/08  l'ordre inverse, celui décrit plus haut.
--
-- Et la promesse de la migration 46 — « marginale exacte de 1/5 par jour,
-- exactement un jour off par semaine » — ne tenait que sur un appel par
-- jour. À deux appels, chaque jour ouvré voit sa chance passer de 1/5 à
-- ~1-(1-1/r)², et le repos se tasse en début de semaine.
--
-- LE CORRECTIF. Une table qui note QUE le tirage a eu lieu, sans dire son
-- résultat : `jour_off_tirages`. Une ligne y entre au premier appel du
-- jour, gagnant ou perdant. Les appels suivants la trouvent et rendent la
-- réponse déjà décidée au lieu d'en fabriquer une nouvelle.
--
-- Pourquoi une table à part plutôt qu'une colonne `off boolean` sur
-- jours_off : une quarantaine de jointures du barème lisent jours_off
-- comme « la liste des jours de repos ». Y écrire des lignes qui n'en sont
-- pas casserait la série, le joker, la semaine pleine et les badges d'un
-- coup. jours_off garde exactement le sens qu'elle a toujours eu.
--
-- Ce que la migration NE corrige PAS, et qu'il faudra décider à part : un
-- jour off tiré par un client entre minuit et 6h reste sans annonce, parce
-- que notifyJourOff() se tait quand le tirage est déjà fait (lib/server/
-- jour-off.ts). C'est le trou du 03/08. Il demande un verrou d'annonce sur
-- jours_off — donc une colonne de plus sur une table de prod.

-- -------------------------------------------------------------
-- 1. La mémoire du tirage.
--
--    Une ligne = « le jour off du jour a été tiré ». Elle ne dit pas le
--    résultat : jours_off le dit déjà quand il est positif, et l'absence
--    des deux lignes veut dire « pas encore tiré ». Deux tables, trois
--    états, aucune redondance à tenir synchronisée.
--
--    Pas de RLS ouverte, pas de grant : personne ne lit cette table en
--    dehors de get_jour_off(), qui est security definer et passe donc
--    outre. Contrairement à jours_off, aucune vue du barème ne la
--    joint — il n'y a rien ici à laisser lire au client.
-- -------------------------------------------------------------

create table if not exists public.jour_off_tirages (
  day     date primary key,
  tire_at timestamptz not null default now()
);

alter table public.jour_off_tirages enable row level security;

-- Rattrapage des jours déjà joués : sans ces lignes, un appel tardif à
-- get_jour_off() sur un jour passé re-tirerait. La fenêtre du 03/08 au
-- 28/08 borne le tout, et les jours déjà off sont dans jours_off.
insert into public.jour_off_tirages (day)
select d::date
from generate_series(date '2026-08-03',
                     least((now() at time zone 'Europe/Paris')::date,
                           date '2026-08-28'),
                     interval '1 day') d
where extract(isodow from d::date) between 1 and 5
on conflict (day) do nothing;

-- -------------------------------------------------------------
-- 2. Le tirage, avec sa mémoire.
--
--    Reprise mot pour mot de la migration 46 — même fenêtre, même
--    échelle croissante (lundi 1/5 … vendredi 1/1), même garantie d'un
--    jour off par semaine. Un seul ajout : la réservation du tirage,
--    juste avant de lancer le dé.
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
  reserve  date;
begin
  if paris_today < date '2026-08-03' or paris_today > date '2026-08-28' then
    return false;
  end if;

  dow := extract(isodow from paris_today)::int;   -- 1 = lundi … 7 = dimanche
  if dow > 5 then
    return false;                                 -- jamais le week-end
  end if;

  lundi := paris_today - (dow - 1);

  -- Déjà tiré cette semaine, et gagnant ? Alors la réponse est figée,
  -- quelle que soit l'heure et le nombre d'appels.
  select day into deja
  from public.jours_off
  where day between lundi and lundi + 6;
  if found then
    return deja = paris_today;
  end if;

  -- Déjà tiré aujourd'hui, et perdant ? Même chose — c'est la moitié de
  -- la mémoire qui manquait. La réservation vaut prise de jeton : le
  -- premier appel de la journée insère et gagne le droit de tirer, les
  -- suivants repartent avec la réponse déjà décidée.
  insert into public.jour_off_tirages (day) values (paris_today)
  on conflict (day) do nothing
  returning day into reserve;
  if not found then
    -- Quelqu'un a tiré avant nous. Le SELECT sur jours_off plus haut
    -- peut dater d'avant SON insertion (deux clients à la même seconde,
    -- le 6h et un lève-tôt) : on relit plutôt que de supposer un NON.
    return exists (select 1 from public.jours_off where day = paris_today);
  end if;

  restants := 6 - dow;             -- lundi → 5, mardi → 4 … vendredi → 1
  if random() >= 1.0 / restants then
    return false;
  end if;

  -- Deux clients qui tirent en même temps : le premier inséré gagne.
  -- `on conflict do nothing` SANS cible, pour couvrir la clé primaire ET
  -- l'unicité de week_monday.
  insert into public.jours_off (day, week_monday) values (paris_today, lundi)
  on conflict do nothing;

  return exists (select 1 from public.jours_off where day = paris_today);
end;
$$;

grant execute on function public.get_jour_off() to anon, authenticated;
