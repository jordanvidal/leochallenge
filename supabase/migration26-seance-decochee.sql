-- =============================================================
-- Migration 26 — décocher retire la carte du fil
-- =============================================================
-- Constaté en prod le 20/07 : Jerem coche ses 3 exos à 22:00, le fil
-- l'annonce, il décoche derrière. L'entrée repart à zéro, l'événement
-- reste. Résultat : le fil affirme qu'il a validé sa journée pendant
-- que le classement lui donne 0 point, les deux visibles dans l'app.
--
-- Le trigger feed_on_entry_complete (migration 5) n'écoute que
-- l'aller : completed_at null -> non-null. On ajoute le retour.
--
-- C'est une entorse assumée au « le fil est un journal ». Elle est
-- volontairement étroite : SEUL l'événement « seance » disparaît, et
-- seulement quand la journée cesse d'être à 3/3. Un journal qui garde
-- une affirmation devenue fausse contredit le principe « dire la
-- vérité » de PRODUCT.md, et décocher est une action prévue par le
-- produit (retap = annulé), donc le cas se reproduira.
--
-- NOTE : les bonus gardent le comportement inverse — annuler un claim
-- ne retire pas sa carte (migration 5, commentaire du point 3). C'est
-- désormais une asymétrie consciente entre les deux, pas un oubli.
-- =============================================================

create or replace function public.feed_on_entry_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  dur int;
begin
  -- L'aller : la journée devient complète, on annonce.
  if new.completed_at is not null
     and (tg_op = 'INSERT' or old.completed_at is null) then
    select ws.duration_seconds into dur
    from public.workout_sessions ws
    where ws.player_id = new.player_id
      and ws.day = new.day
      and ws.finished_at is not null;

    insert into public.feed_events (player_id, kind, dedupe_key, payload)
    values (
      new.player_id,
      'seance',
      new.day::text,
      jsonb_strip_nulls(
        jsonb_build_object('day', new.day, 'duration_seconds', dur)
      )
    )
    on conflict (player_id, kind, dedupe_key) do nothing;
  end if;

  -- Le retour : la journée cesse d'être complète, on retire l'annonce.
  --
  -- Les réactions et commentaires partent avec : les FK sont en
  -- ON DELETE CASCADE (vérifié en base, pas supposé). C'est le coût
  -- assumé de ce correctif — si quelqu'un décoche après avoir été
  -- félicité, les félicitations disparaissent. En pratique la fenêtre
  -- est courte : le trigger tire à l'instant du décochage, pas trois
  -- jours plus tard.
  if tg_op = 'UPDATE'
     and old.completed_at is not null
     and new.completed_at is null then
    delete from public.feed_events
    where player_id = new.player_id
      and kind = 'seance'
      and dedupe_key = new.day::text;
  end if;

  return null;
end;
$$;

-- Le trigger lui-même ne change pas (after insert or update on entries),
-- seule la fonction est remplacée.

-- -------------------------------------------------------------
-- Rattrapage : VOLONTAIREMENT NON EXÉCUTÉ.
--
-- Une carte fantôme existe déjà en base au 20/07 : celle de Nathan du
-- 17/07. Elle porte 4 réactions et 2 commentaires écrits par d'autres
-- joueurs — et les clés étrangères sont en ON DELETE CASCADE, donc la
-- supprimer détruit ces six interactions avec elle.
--
-- Effacer du contenu écrit par cinq personnes il y a trois jours n'est
-- pas une décision de migration. Le trigger ci-dessus règle l'avenir ;
-- le passé se traite à la main, en connaissance de cause.
--
-- Pour lister les cartes fantômes et ce qu'elles emporteraient :
--
--   select p.name, f.dedupe_key,
--          (select count(*) from public.feed_reactions r where r.event_id = f.id) as reactions,
--          (select count(*) from public.feed_comments c where c.event_id = f.id) as commentaires
--   from public.feed_events f
--   join public.players p on p.id = f.player_id
--   where f.kind = 'seance'
--     and not exists (
--       select 1 from public.entries e
--       where e.player_id = f.player_id and e.day::text = f.dedupe_key
--         and e.pushups and e.abs and e.squats
--     );
--
-- Pour les supprimer une fois la décision prise, remplacer le select
-- par un delete from public.feed_events f avec le même where.
-- -------------------------------------------------------------
