-- =============================================================
-- Plan de test — barème S3 (à passer AVANT merge)
-- =============================================================
-- Éditeur SQL Supabase (rôle postgres), projet fnvayegsjhlesczpfshx.
-- Tout tourne dans UNE transaction, puis ROLLBACK : rien ne persiste.
--
--   1. Colle ce bloc jusqu'au marqueur ⬇️.
--   2. Au marqueur, colle TOUT migration29-bareme-s3.sql.
--   3. Colle la partie TESTS.
--   4. Exécute. Lis la table finale : tout doit être 'OK'.
--
-- NOTE T2 : l'écart joker de Jordan (~5 pts) est PRÉEXISTANT (la RPC
-- ignore le joker) — le test vérifie donc que rien ne BOUGE vs la
-- ligne de base, pas un écart nul. Set de divergence attendu inchangé.
-- =============================================================
begin;
create temp table avant on commit drop as
  select player_id, day, points, base_points, bonus_points, streak_pos
  from public.daily_points;
-- Ligne de base T2 : total vue ET total détail par joueur, AVANT migration.
-- (capture l'écart joker préexistant de Jordan pour qu'il ne fausse pas le test)
create temp table t2base on commit drop as
  select p.id,
         (select round(sum(points),1) from public.daily_points where player_id=p.id) as vue,
         (select round(sum(points),1) from public.player_breakdown(p.id,null,null)) as detail
  from public.players p;
create temp table resultats (ord int, test text, detail text, ok boolean);

-- ============================================================
-- COLLE ICI TOUT LE FICHIER migration29-bareme-s3.sql
-- ============================================================


-- ============================================================
-- PARTIE TESTS
-- ============================================================

-- ===================== TESTS =====================
-- T1 — non-régression (avant migration vs après), données réelles
insert into resultats
select 1, 'T1-points-bougent', 'n='||c, c=0 from (
  select count(*) c from public.daily_points n join avant a using (player_id,day)
   where n.points is distinct from a.points or n.base_points is distinct from a.base_points
      or n.bonus_points is distinct from a.bonus_points or n.streak_pos is distinct from a.streak_pos) x;
insert into resultats
select 2, 'T1-lignes-apparues-disparues', 'n='||c, c=0 from (
  select count(*) c from public.daily_points n full join avant a using (player_id,day)
   where n.player_id is null or a.player_id is null) x;

-- T2 — vue ET détail inchangés vs la ligne de base (par joueur réel).
-- On ne teste PAS "écart 0" (l'écart joker de Jordan est préexistant),
-- mais que la migration ne fait bouger NI la vue NI le détail de personne.
insert into resultats
select 3, 'T2-vue-et-detail-inchanges',
       coalesce('a bougé: '||string_agg(name,', '),'aucun joueur ne bouge'),
       count(*)=0
from (
  select p.name
  from public.players p
  join t2base b on b.id = p.id
  where b.vue   is distinct from (select round(sum(points),1) from public.daily_points where player_id=p.id)
     or b.detail is distinct from (select round(sum(points),1) from public.player_breakdown(p.id,null,null))
) d;

-- T7 — catalogue : nouvelles clés + kinds
insert into resultats
select 4, 'T7-catalogue', string_agg(key||'/'||kind||'/'||points,'; ' order by key),
       bool_and( (key='abdos_double' and kind='event' and points=1)
              or (key='squats_double' and kind='event' and points=1)
              or (key='semaine_pleine' and kind='execution' and points=5) )
from public.bonus_catalog where key in ('abdos_double','squats_double','semaine_pleine');

-- T7 — un bonus auto n'est PAS déclarable (trigger actif)
do $$
begin
  begin
    insert into public.bonus_claims(player_id, day, bonus_key, points)
    values ('2aa4c403-7df2-448c-9d9f-8f4116b5cae5', (now() at time zone 'Europe/Paris')::date, 'semaine_pleine', 5);
    insert into resultats values (5,'T7-non-declarable','insert ACCEPTÉ (faux)', false);
  exception when others then
    insert into resultats values (5,'T7-non-declarable','rejeté: '||sqlerrm, position('BONUS_NON_DECLARABLE' in sqlerrm) > 0);
  end;
end $$;

-- cobayes
insert into public.players (id,name,color) values
 ('00000000-0000-0000-0000-0000000000a1','TEST1','#888'),
 ('00000000-0000-0000-0000-0000000000a2','TEST2','#999'),
 ('00000000-0000-0000-0000-0000000000a3','TEST3','#777'),
 ('00000000-0000-0000-0000-0000000000a4','TEST4','#666'),
 ('00000000-0000-0000-0000-0000000000a5','TEST5','#555'),
 ('00000000-0000-0000-0000-0000000000a6','TEST6','#444'),
 ('00000000-0000-0000-0000-0000000000a7','TEST7','#333'),
 ('00000000-0000-0000-0000-0000000000a8','TEST8','#222');

set session_replication_role = 'replica';

-- T3 — journée parfaite +2 (20/07) vs +4 (27/07), jours isolés (mult 1)
insert into public.entries (player_id,day,pushups,abs,squats,completed_at) values
 ('00000000-0000-0000-0000-0000000000a1',date '2026-07-20',true,true,true,timestamptz '2026-07-20 21:00+00'),
 ('00000000-0000-0000-0000-0000000000a1',date '2026-07-27',true,true,true,timestamptz '2026-07-27 21:00+00');
insert into resultats
select 6,'T3-parfaite-20/07=5','base='||base_points, base_points=5
from public.daily_points where player_id='00000000-0000-0000-0000-0000000000a1' and day=date '2026-07-20';
insert into resultats
select 7,'T3-parfaite-27/07=7','base='||base_points, base_points=7
from public.daily_points where player_id='00000000-0000-0000-0000-0000000000a1' and day=date '2026-07-27';

-- T3b — le +4 traverse le multiplicateur (série 27/07->02/08)
insert into public.entries (player_id,day,pushups,abs,squats,completed_at)
select '00000000-0000-0000-0000-0000000000a2', d, true,true,true, d + time '21:00'
from generate_series(date '2026-07-27',date '2026-08-02',interval '1 day') g(d);
insert into resultats
select 8,'T3b-serie-base_points',
       string_agg(base_points::text,',' order by day),
       string_agg(base_points::text,',' order by day) = '7.0,7.0,10.5,10.5,10.5,10.5,14.0'
from public.daily_points
where player_id='00000000-0000-0000-0000-0000000000a2' and day between date '2026-07-27' and date '2026-08-02';

-- T4 — pompes_double (réf) : base7 bonus23 total30, et détail==vue
insert into public.entries (player_id,day,pushups,abs,squats,completed_at) values
 ('00000000-0000-0000-0000-0000000000a3',date '2026-07-28',true,true,true,timestamptz '2026-07-28 21:00+00');
insert into public.daily_events (day,event_key) values (date '2026-07-28','pompes_double');
insert into public.bonus_claims (player_id,day,bonus_key,points) values
 ('00000000-0000-0000-0000-0000000000a3',date '2026-07-28','pompes_50',4),
 ('00000000-0000-0000-0000-0000000000a3',date '2026-07-28','pompes_100',7);
insert into resultats
select 9,'T4-pompes_double','base='||base_points||' bonus='||bonus_points||' total='||points,
       base_points=7 and bonus_points=23 and points=30
from public.daily_points where player_id='00000000-0000-0000-0000-0000000000a3' and day=date '2026-07-28';
insert into resultats
select 10,'T4-pompes-detail=vue','detail='||d, d=30 from (
  select round(sum(points),1) d from public.player_breakdown('00000000-0000-0000-0000-0000000000a3',date '2026-07-28',date '2026-07-28')) x;

-- T4b — abdos_double (nouveau) : base7 bonus9 total16
insert into public.entries (player_id,day,pushups,abs,squats,completed_at) values
 ('00000000-0000-0000-0000-0000000000a4',date '2026-07-28',true,true,true,timestamptz '2026-07-28 21:00+00');
insert into public.daily_events (day,event_key) values (date '2026-07-28','abdos_double');
insert into public.bonus_claims (player_id,day,bonus_key,points) values
 ('00000000-0000-0000-0000-0000000000a4',date '2026-07-28','abdos_100',4);
insert into resultats
select 11,'T4b-abdos_double','base='||base_points||' bonus='||bonus_points||' total='||points,
       base_points=7 and bonus_points=9 and points=16
from public.daily_points where player_id='00000000-0000-0000-0000-0000000000a4' and day=date '2026-07-28';
insert into resultats
select 12,'T4b-abdos-detail=vue','detail='||d, d=16 from (
  select round(sum(points),1) d from public.player_breakdown('00000000-0000-0000-0000-0000000000a4',date '2026-07-28',date '2026-07-28')) x;

-- T4c — squats_double : total16
insert into public.entries (player_id,day,pushups,abs,squats,completed_at) values
 ('00000000-0000-0000-0000-0000000000a5',date '2026-07-28',true,true,true,timestamptz '2026-07-28 21:00+00');
insert into public.daily_events (day,event_key) values (date '2026-07-28','squats_double');
insert into public.bonus_claims (player_id,day,bonus_key,points) values
 ('00000000-0000-0000-0000-0000000000a5',date '2026-07-28','squats_100',4);
insert into resultats
select 13,'T4c-squats_double','total='||points, base_points=7 and bonus_points=9 and points=16
from public.daily_points where player_id='00000000-0000-0000-0000-0000000000a5' and day=date '2026-07-28';

-- T5 — collectif retiré au 27/07 : 2 joueurs 3/3 le 25/08 -> bonus 0 chacun
insert into public.entries (player_id,day,pushups,abs,squats,completed_at) values
 ('00000000-0000-0000-0000-0000000000a6',date '2026-08-25',true,true,true,timestamptz '2026-08-25 21:00+00'),
 ('00000000-0000-0000-0000-0000000000a7',date '2026-08-25',true,true,true,timestamptz '2026-08-25 21:00+00');
insert into resultats
select 14,'T5-collectif-retire', 'bonus='||string_agg(bonus_points::text,',')||' base='||string_agg(base_points::text,','),
       bool_and(bonus_points=0 and base_points=7)
from public.daily_points where day=date '2026-08-25'
 and player_id in ('00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a7');

-- T8 — semaine pleine : detection 7/7 (réel après 03/08)
insert into public.entries (player_id,day,pushups,abs,squats,completed_at)
select '00000000-0000-0000-0000-0000000000a8', d, true,true,true, d + time '21:00'
from generate_series(date '2026-07-27',date '2026-08-02',interval '1 day') g(d);
insert into resultats
select 15,'T8-detection-7sur7','jours_parfaits='||c, c=7 from (
  select count(*) filter (where pushups and abs and squats) c from public.entries
  where player_id='00000000-0000-0000-0000-0000000000a8' and day between date '2026-07-27' and date '2026-08-02') x;

-- T6 — roue : miroir hors tirage, scoring miroir conservé
insert into resultats
select 16,'T6-miroir-hors-tirage','', position('jour_miroir' in pg_get_functiondef('public.get_daily_event()'::regprocedure))=0;
insert into resultats
select 17,'T6-soeurs-dans-tirage','',
       position('abdos_double' in pg_get_functiondef('public.get_daily_event()'::regprocedure))>0
   and position('squats_double' in pg_get_functiondef('public.get_daily_event()'::regprocedure))>0;
insert into resultats
select 18,'T6-scoring-miroir-conserve','', position('jour_miroir' in pg_get_viewdef('public.daily_points'))>0;

-- T9 — séance rapide bornée dans les deux objets
insert into resultats
select 19,'T9-gating-S3-present-vue','',
       position($$< date '2026-07-27' and fw.player_id$$ in pg_get_viewdef('public.daily_points'))>0;
insert into resultats
select 20,'T9-seance_rapide-bornee-rpc','',
       position($$< date '2026-07-27' and fw.player_id$$ in pg_get_functiondef('public.player_breakdown(uuid,date,date)'::regprocedure))>0;

set session_replication_role = 'origin';

select ord, test,
       case when ok then 'OK' else '### ÉCHEC ###' end as verdict,
       detail
from resultats order by ord;

rollback;   -- TOUJOURS.
