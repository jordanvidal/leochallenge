# Checklist multi-ligues — une PR par phase

Compagnon de `plan-multi-ligues.md`. Coche au fur et à mesure. **Une phase = une
branche `feature/…` = une PR.** Aucune phase ne touche `public`. `npm run build`
et `npx tsc --noEmit` doivent passer avant chaque PR.

Rappel de la contrainte qui commande tout : **tout se construit dans le schéma
`app`, jamais dans `public`.** Le groupe d'origine n'est migré qu'en phase 5,
après le 31 août.

---

## Phase 1 — Socle SQL *(le gros morceau, 4-6 soirées)*

**Structure**
- [ ] Créer le schéma `app` (aucune instruction sur `public`)
- [ ] Table `app.leagues` : `slug`, `name`, `invite_code`, `start_day`,
      `end_day`, `creator_player_id`, `parent_league_id`, `created_at`, +
      `CHECK` durée (`end_day >= start_day and end_day <= start_day + 41`)
- [ ] `app.players` avec `league_id uuid not null` (FK) + `recovery_code text not null`
- [ ] Recréer dans `app` les 11 tables rattachées au joueur (entries, duels,
      feed_events, feed_comments, feed_reactions, push_subscriptions,
      rank_snapshots, bonus_claims, workout_sessions)
- [ ] `bonus_catalog` et `workout_presets` : globales, pas de `league_id`
- [ ] `daily_events` : global par jour civil, mais son `CHECK` de fenêtre saute

**Unicité & cap par ligue**
- [ ] Index unique prénom **par ligue** : `(league_id, lower(name))`
- [ ] Cap 12 joueurs **par ligue** dans `guard_player_insert` (filtré sur la ligue)

**Scoring — le vrai risque, à revoir un par un avec filtre par ligue**
- [ ] `leaderboard()` — plus de `rank() over` global
- [ ] `daily_points`
- [ ] Premier arrivé du jour (`first_done`) — par ligue, pas sur toute la table
- [ ] Bonus « tout le groupe a fini » — `count` sur les joueurs **de la ligue**
- [ ] `get_daily_event()`, `player_breakdown()`, `duel_results`
- [ ] Les ~10 fonctions `guard_*`
- [ ] **×2 du jour (migrations 33-34)** re-vérifié : double par ligue, jamais
      d'une ligue sur l'activité d'une autre

**Dates en triggers**
- [ ] Convertir les 4 `CHECK` de dates en triggers `before insert or update`
      (entries, workout_sessions, bonus_claims, daily_events) joignant
      `players → leagues`, message d'erreur explicite

**Câblage client**
- [ ] Client Supabase : `db: { schema: "app" }`
- [ ] Realtime `useChallengeData.ts:91` : schéma `app` + **ignorer côté client**
      les événements dont le `player_id` n'est pas dans la ligue courante

**Vérifs de fin de phase**
- [ ] Deux ligues actives, dates chevauchantes : cocher dans l'une ne bouge pas
      les points de l'autre
- [ ] Premier arrivé + bonus « groupe fini » calculés par ligue
- [ ] `public` n'a reçu **aucune** instruction (relire le SQL joué)
- [ ] `npx tsc --noEmit` + `npm run build` OK

---

## Phase 2 — Badges proportionnels *(1 soirée)*

- [ ] Formule sur la durée `N` dans `player_badges` :
      `premiere_semaine = max(3, ceil(0.14·N))`,
      `machine = max(3, ceil(0.28·N))`,
      `increvable = max(3, ceil(0.60·N))`,
      `centurion = 2·N` exos
- [ ] `finisseur` se déclenche sur `leagues.end_day` (plus la date en dur
      `2026-08-31`)
- [ ] **Test non-régression** : à N=50 → exactement 7 / 14 / 30 / 100
- [ ] Ligue de 7 j et ligue de 42 j → badges cohérents
- [ ] `npm run build` OK

---

## Phase 3 — Création & invitation *(3-4 soirées)*

- [ ] Routing `/l/[slug]`
- [ ] Écran de création : nom, date de début, durée (1 à 6 semaines)
- [ ] Génération du `slug` + de l'`invite_code` (court, simple, pas d'anti-abus)
- [ ] Entrée dans une ligue par prénom via le lien/code
- [ ] Code de récupération (6 car.) généré et **affiché au joueur** à l'entrée
- [ ] Bascule entre ligues **au lancement = re-saisir le lien** (pas de
      sélecteur pour l'instant ; ne pas fermer la porte au sélecteur futur)
- [ ] `components/PasswordGate.tsx` → écran de saisie du **code de ligue**
- [ ] Reporter la garde `x-group-pass` des POST (`/api/moments`,
      `/api/feed-notify`) sur le code de ligue — **ne jamais la retirer**
- [ ] `lib/challenge.ts` : `CHALLENGE_START/END/DAYS` viennent de la ligue
      courante ; ligue disponible en contexte React **avant tout rendu**
- [ ] Pouvoirs créateur : modifier nom/dates **avant** le début + régénérer le
      code ; **rien** une fois la ligue démarrée
- [ ] Test : rejoindre au jour 4 démarre à zéro sans casser le classement
- [ ] `npm run build` OK

---

## Phase 4 — Crons multi-ligues *(2 soirées)*

- [ ] Helper unique **« ligue active » = démarrée, non finie, ≥ 2 joueurs**
- [ ] Les 7 routes `app/api/cron/*` bouclent sur les ligues actives
- [ ] Push cadrées par ligue (destinataires + contenu propres à chaque ligue)
- [ ] **Ne pas ajouter ni déplacer de cron** : 2 sur Vercel (`vercel.json`) + 5
      sur GitHub Actions (`.github/workflows/`) inchangés
- [ ] Test : une ligue vide ou pas encore commencée ne reçoit **aucune** notif
- [ ] `npm run build` OK

---

## Phase 5 — Migration du groupe d'origine *(après le 31/08 SEULEMENT, 1-2 soirées)*

⚠️ **Seule phase qui touche les vraies données de prod. À faire de tête froide.**

- [ ] **Ne rien lancer avant le 1er septembre**
- [ ] Sauvegarde complète de `public` **avant** toute écriture
- [ ] Créer la ligue n°1 (dates 13/07 → 31/08)
- [ ] Copier les 12 joueurs en **préservant l'ordre des `created_at`** (il
      commande les couleurs et l'historique du premier arrivé)
- [ ] Copier ~50 jours d'entries + feed + duels + badges/snapshots, **état final
      tel quel**
- [ ] **Ne rien recalculer en direct** : les triggers de scoring ne rejouent pas
      les journées déjà closes
- [ ] Comparaison avant/après : le **classement du groupe est strictement
      identique**
- [ ] `npm run build` OK

---

## Transverse — Le « relancer » (saison 2)

À implémenter avec/après la phase 3 (ce n'est pas une phase à part).

- [ ] Fin de ligue → bascule en **lecture seule** (classement, badges, records figés)
- [ ] Bouton « relancer » (créateur) → **nouvelle ligue** avec `parent_league_id`,
      **même code**, nouvelles dates, compteurs à zéro
- [ ] Chaque joueur **re-confirme** (rouvre le lien, re-entre par prénom) —
      personne repris d'office ; nouvelle identité (`player_id`) sur la nouvelle ligue
- [ ] Saison précédente reste consultable via son `slug`, marquée
      « Saison N — terminée » pour éviter toute confusion
