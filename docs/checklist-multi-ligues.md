# Checklist multi-ligues — une PR par phase

Compagnon de `plan-multi-ligues.md`. Coche au fur et à mesure. **Une phase = une
branche `feature/…` = une PR.** Aucune phase ne touche `public`. `npm run build`
et `npx tsc --noEmit` doivent passer avant chaque PR.

Rappel de la contrainte qui commande tout : **tout se construit dans le schéma
`app`, jamais dans `public`.** Le groupe d'origine n'est migré qu'en phase 5,
après le 31 août.

> **Phases 1 à 3 : mergées dans `main` le 29/07 et déployées en production**
> (#87, un merge et non un squash — tous les commits de la pile sont dans
> l'historique). Vérifié en prod après déploiement : les 9 joueurs, le
> classement, les séries et le duel de la semaine sont inchangés.
>
> L'app reste **exactement celle d'avant** pour le groupe d'origine :
> `MULTI_LIGUES` est faux tant que `NEXT_PUBLIC_SUPABASE_SCHEMA` n'est pas
> posée, et elle ne l'est pas en production. Le schéma `app` est vide et sans
> lecteur ; il le restera jusqu'à la phase 5.
>
> **Le SQL, lui, est appliqué.** Le 28/07, avec l'accord de Jordan, les
> migrations 36, 37, 38 et 42 ont été jouées sur le projet Supabase de prod
> (`fnvayegsjhlesczpfshx`). Elles sont **purement additives** : elles créent le
> schéma `app` et rien d'autre — aucun `drop`, aucun `alter` sur un objet
> existant. Vérifié par une empreinte md5 de tous les objets de `public`,
> identique avant et après (`31a30556…`, 50 objets). Le rollback tient en une
> commande : `drop schema app cascade`.
>
> **`public` ne bouge pas, et rien ne lit `app`** tant que
> `NEXT_PUBLIC_SUPABASE_SCHEMA` n'est pas posée côté Vercel. Les 9 joueurs du
> groupe d'origine continuent de jouer sur `public` sans rien voir — une entrée
> a d'ailleurs été cochée pendant l'opération.
>
> État au 28/07 : phases 1 et 2 livrées, phase 3 **débloquée** par cette
> application — les écrans peuvent désormais être testés sur une preview.

---

## Phase 1 — Socle SQL *(le gros morceau, 4-6 soirées)* — **livrée, PR #56**

`migration36-app-structure.sql`, `migration37-app-gardes.sql`,
`migration38-app-scoring.sql`, `tests/multi-ligues.sql`.

**Structure**
- [x] Créer le schéma `app` (aucune instruction sur `public`)
- [x] Table `app.leagues` : `slug`, `name`, `invite_code`, `start_day`,
      `end_day`, `creator_player_id`, `parent_league_id`, `created_at`, +
      `CHECK` durée
      → **la borne haute est devenue un trigger** (`guard_league_insert`), pas un
      `CHECK`. Le challenge d'origine fait 50 jours : un `CHECK` à 42 aurait
      rendu la phase 5 impossible. Le trigger se désactive le temps de l'import.
- [x] `app.players` avec `league_id uuid not null` (FK) + `recovery_code text not null`
- [x] Recréer dans `app` les tables rattachées au joueur
      → **12 et non 11** : le plan en oubliait une, et `workout_presets` porte un
      `player_id` (ce sont les réglages d'un joueur, pas des données de référence).
- [x] `bonus_catalog` global, pas de `league_id` — 46 seeds repris de `public`
- [x] `daily_events` : global par jour civil, son `CHECK` de fenêtre saute

**Unicité & cap par ligue**
- [x] Index unique prénom **par ligue** : `(league_id, lower(f_unaccent(trim(name))))`
- [x] Cap 12 joueurs **par ligue** dans `guard_player_insert` (filtré sur la ligue)

**Scoring — le vrai risque, à revoir un par un avec filtre par ligue**
- [x] `leaderboard()` — plus de `rank() over` global, et le `as materialized` de
      migration35 conservé (sans lui, on retombe sur le bug de lenteur)
- [x] `daily_points` — réécrite en barème S3 pur, cadrée par ligue
- [x] Premier arrivé du jour (`first_done`) — par ligue
      → **le piège annoncé par le plan n'existe plus** : sous S3, `premier_du_jour`
      vaut 0. Ce n'est plus qu'un drapeau d'affichage. Il fallait quand même le
      cadrer, mais pour l'affichage, pas pour les points.
- [x] Bonus « tout le groupe a fini » — `count` sur les joueurs **de la ligue**
- [x] `get_daily_event()`, `player_breakdown()`, `duel_results`, `recit_hebdo()`
- [x] Les fonctions `guard_*` — 20 fonctions, 22 triggers
- [x] **×2 du jour (migrations 33-34)** re-vérifié : double par ligue

> **Trois fuites inter-ligues trouvées, qui n'étaient pas celle annoncée** : le
> jour miroir (`CROSS JOIN players` sur toute la base), la prime hebdo (`rank()`
> non partitionné) et `premier_de_la_classe` (classement sur toute la base).
>
> **Et un vrai bug, présent aussi dans `public.daily_points`** : un joueur
> arrivé en cours de route entrait au classement du jour miroir sur des journées
> **antérieures à son arrivée**, avec un cumul de zéro — donc dernier, donc
> gagnant. Corrigé dans `app` en bornant à la date d'entrée. Jamais déclenché en
> prod : aucun jour miroir n'y a été tiré à ce jour.

**Dates en triggers**
- [x] Convertir les 4 `CHECK` de dates en triggers `before insert or update`
      (entries, workout_sessions, bonus_claims, daily_events) joignant
      `players → leagues`, message explicite (`HORS_FENETRE: …`)
- [x] Gardes inter-ligues ajoutées au passage : pas de duel entre deux ligues
      (`DUEL_INTER_LIGUES`), pas de commentaire ni de réaction sur le fil d'une
      autre ligue (`FIL_HORS_LIGUE`)

**Câblage client**
- [x] Client Supabase : `db: { schema }` piloté par `NEXT_PUBLIC_SUPABASE_SCHEMA`
      → **défaut `public`**, décidé avec Jordan : la PR est mergeable sans que la
      prod bouge. La bascule se fait en posant la variable côté Vercel, en phase 5.
- [x] Realtime `useChallengeData.ts` : même schéma + **ignorer côté client** les
      événements dont le `player_id` n'est pas dans la ligue courante

**Vérifs de fin de phase**
- [x] Deux ligues actives, dates chevauchantes : cocher dans l'une ne bouge pas
      les points de l'autre — 10 assertions dans `supabase/tests/multi-ligues.sql`
- [x] Premier arrivé + bonus « groupe fini » calculés par ligue
- [x] `public` n'a reçu **aucune** instruction — prouvé par une empreinte md5 de
      tous ses objets, avant/après application de 36-38 **dans la même base**
- [x] Non-régression du barème : même jeu de données dans `public.daily_points`
      et `app.daily_points` → 145 lignes identiques
- [x] `npx tsc --noEmit` + `npm run build` OK
- [x] **Appliqué en prod le 28/07** — 15 tables, 5 vues, 28 fonctions, 23
      triggers, 46 bonus au catalogue, 0 ligue. Test de fumée sans résidu : le
      trigger de durée refuse bien une ligue d'un an, et les six vues et
      fonctions de scoring s'exécutent à vide sans erreur.
- [x] `migration42` : `app.code_court()` fige son `search_path`, seule des 28
      fonctions à ne pas le faire — repéré par le linter Supabase après coup.

---

## Phase 2 — Badges proportionnels *(1 soirée)* — **livrée, PR #60**

`migration40-badges-proportionnels.sql`, `tests/badges-proportionnels.sql`.

- [x] Formule sur la durée `N` dans `player_badges` :
      `premiere_semaine = max(3, ceil(0.14·N))`,
      `machine = max(3, ceil(0.28·N))`,
      `increvable = max(3, ceil(0.60·N))`,
      `centurion = 2·N` exos
- [x] `finisseur` se déclenche sur `leagues.end_day` (fait dès la phase 1)
- [x] **Test non-régression** : à N=50 → exactement 7 / 14 / 30 / 100
- [x] Ligue de 7 j et ligue de 42 j → badges cohérents (7, 42 **et** 50 testées)
- [x] Le catalogue client suit : `BADGES` devient `badgesFor(nJours, finDeLigue)`,
      sinon le libellé sous le badge annonce un seuil que la base n'applique pas
- [x] `npm run build` OK

> **Piège de flottant, trouvé en écrivant le test.** Écrites naïvement en
> JavaScript, ces formules donnent **8 et 15** à N = 50 : `0.14 * 50` vaut
> `7.000000000000001` et `Math.ceil` arrondit à 8. Postgres n'a pas le problème
> (il calcule en `numeric`). D'où l'arithmétique entière côté client
> (`14 * n / 100`) et un test qui tient toute la table.
>
> Deux seuils restent **fixes**, faute d'être dans la table de la spec :
> `retour_de_flamme` (2 séries ≥ 5) et `premier_de_la_classe` (n°1 7 jours
> d'affilée). Sur une ligue d'une semaine, le second revient à être n°1 tous les
> jours — dur mais atteignable. **Décision produit en attente.**

---

## Phase 3 — Création & invitation — **complète**

Le schéma `app` existe sur le projet Supabase de prod depuis le 28/07, vide et
sans lecteur. Les écrans sont écrits et déployés sur une preview, avec
`NEXT_PUBLIC_SUPABASE_SCHEMA=app` posée **sur la seule branche
`feature/ligue-ecrans`** — pas sur toutes les previews, sinon les branches en
cours sans rapport (#43, #58) basculeraient sur un schéma vide et passeraient
pour cassées.

> ⛔ **Il manque un réglage, et le plan ne l'avait pas vu.** Créer le schéma ne
> suffit pas : PostgREST ne sert que les schémas déclarés dans les réglages
> d'API du projet. Testé sur la preview le 29/07, toute requête sur `app`
> répond :
>
> ```
> PGRST106 — Only the following schemas are exposed: public, graphql_public
> ```
>
> **À faire par Jordan, une fois :** Supabase → Settings → API → *Exposed
> schemas* → ajouter `app` à côté de `public`.
>
> C'est additif et réversible. Un client doit **demander** explicitement le
> schéma (en-tête `Accept-Profile`, posé par l'option `db.schema` du client) :
> l'app de prod ne l'envoie pas et ne l'enverra pas tant que
> `NEXT_PUBLIC_SUPABASE_SCHEMA` reste absente en production. `public` ne change
> ni de comportement ni de surface.
>
> Tant que ce n'est pas fait, les écrans s'affichent mais aucune ligue ne peut
> être créée ni rejointe.

**Fait — la plomberie, qui ne dépend pas de la base**

- [x] `lib/challenge.ts` ne décide plus des dates, il les **reçoit** : les 10
      fonctions qui se fermaient sur `CHALLENGE_START/END/DAYS` prennent une
      `Fenetre`, avec les constantes d'env par défaut *(PR #62)*
- [x] Les modules purs suivent : `stats`, `share`, `duels` *(PR #63)*
      → sans ça, une ligue d'une semaine en mars partageait **sept cases
      blanches** dans WhatsApp, sous « Plus que 35 jours »
- [x] Génération du `slug` depuis le nom, lecture d'un code tapé, lecture d'un
      lien d'invitation collé *(PR #64, `lib/ligue.ts`)*
      → l'`invite_code` lui-même est généré par la base (`app.code_court(6)`,
      phase 1) ; l'alphabet client en est une copie exacte, tenue par un test
- [x] Code de récupération (6 car.) : même générateur, déjà en base *(phase 1)*

**Livré — les écrans et la donnée ligue** *(PR #74 et #75)*

- [x] Routing `/l/[slug]` — l'app se monte **sur cette route**, sans
      redirection vers `/` : le `?c=` du lien reste dans l'URL pour la garde
      qui le lira, et le slug est mémorisé au passage
- [x] Écran de création : nom, date de début, durée (1 à 6 semaines)
      → la borne haute client tombe pile sur celle du trigger
      (`finDeLigue(d, 6) === addDays(d, 41)`), tenue par un test
- [x] Entrée dans une ligue par **lien collé ou code tapé**, un seul champ pour
      les deux — `lib/ligue` démêle
- [x] Bascule entre ligues **au lancement = re-saisir le lien** (pas de
      sélecteur pour l'instant ; ne pas fermer la porte au sélecteur futur)
- [x] Trois échecs, trois phrases : ligue inconnue, saisie illisible, et
      « injoignable » qui ne nomme **pas** sa cause — le premier jet accusait le
      réseau, la preview a montré que c'était le serveur qui refusait
- [x] `MULTI_LIGUES` : tout ce chemin est inerte sur le schéma `public`, ce qui
      rend les PR mergeables sans que la prod bouge

**Livré — la ligue traverse tout** *(PR #79, #83, #85, #86, #87)*

- [x] Données cadrées : joueurs par `league_id`, coches par jointure interne
      (#79). Mesuré : 2 coches remontaient, 1 remonte.
- [x] Classement (#83) — `app.leaderboard(p_league, …)` exige la ligue en
      premier argument, sans défaut : les 6 appels clients répondaient
      `PGRST202`. L'app en ligue n'avait **aucun** classement.
- [x] Fil et tchat (#85), + `migration43` qui crée enfin le tchat dans `app`
- [x] Les 11 écrans prennent leurs dates de la ligue (#86) — une ligue finissant
      le 2 août annonçait « 34 jours restants »
- [x] `aUneBasculeDeBareme()` (#86) : sans elle, l'écran « la saison 3 démarre »
      s'affichait à la création de **chaque** ligue neuve
- [x] `PasswordGate` → code de ligue, garde `x-group-pass` portée et
      **jamais retirée**, fail-closed sur tous les chemins (#87)
- [x] Arrivé par le lien, on n'a pas à retaper le code qu'il porte (#87)

**Reste à faire**

- [ ] Code de récupération **affiché au joueur** à l'entrée
- [ ] `components/PasswordGate.tsx` → écran de saisie du **code de ligue**
- [ ] Reporter la garde `x-group-pass` des POST (`/api/moments`,
      `/api/feed-notify`) sur le code de ligue — **ne jamais la retirer**
      → aujourd'hui elle compare `NEXT_PUBLIC_GROUP_PASSWORD` côté client
      (`PasswordGate`) **et** côté serveur (`lib/server/push.ts`). La porter
      veut dire aller chercher la ligue en base : d'où le blocage.
- [x] Ligue disponible **avant tout rendu** : `LigueGate` ne monte pas l'app
      tant qu'il ne sait pas dans quelle ligue on est. Toujours pas de contexte
      React — il attend son premier consommateur, c'est-à-dire le point
      ci-dessus
      → reporté ici volontairement : un contexte dont la valeur serait une
      constante est de la plomberie sans consommateur, et ce repo ne teste pas
      les composants (`vitest.config.ts`). Il arrivera avec le chargement de la
      ligue, qui lui donne une raison d'exister et de quoi le tester.
- [ ] Pouvoirs créateur : modifier nom/dates **avant** le début + régénérer le
      code ; **rien** une fois la ligue démarrée
- [ ] Test : rejoindre au jour 4 démarre à zéro sans casser le classement
      → déjà couvert côté SQL par l'assertion 9 de `tests/multi-ligues.sql`

> **Correction au plan** : il annonçait « 23 fichiers importateurs » pour sortir
> les dates de `lib/challenge.ts`. Il y en a **12**, dont 5 dans `lib/server/`.
> Ces 5-là ne relèvent pas de cette phase — un contexte React n'existe pas côté
> serveur — mais de la phase 4. **La phase 3 est plus petite que prévu, la phase
> 4 plus grosse.**

---

## Phase 4 — Crons multi-ligues — **complète, PR #89**

- [x] Passer la fenêtre aux 4 fichiers `lib/server/` — c'est un « terrain »
      (ligue + fenêtre) qui circule, en dernier paramètre et avec un défaut
      qui est exactement le challenge d'origine
- [x] Helper **« ligue active » = démarrée, non finie, ≥ 2 joueurs**
      → le seuil de deux n'est pas une optimisation : « plus que 3 jours, ne
      lâche pas » envoyé à quelqu'un qui n'a encore invité personne ne parle
      de personne. Liste vide en cas d'erreur — un cron qui ne sait pas à qui
      parler se tait.
- [x] Les 7 routes `app/api/cron/*` bouclent sur les ligues actives, chaque
      terrain isolé : une ligue qui échoue n'en fait pas taire six
- [x] Push cadrées par ligue (destinataires calculés par terrain)
- [x] `daily-event` : le **tirage** reste global (un événement par jour civil),
      les **destinataires** non — sinon quelqu'un dont la ligue n'a pas encore
      commencé recevrait « aujourd'hui, double pompes »

> **Aucun cron ajouté, `vercel.json` inchangé.** Même nombre de rendez-vous,
> mêmes horaires : ces routes font simplement leur travail pour la bonne ligue.
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
- [ ] Copier les joueurs en **préservant l'ordre des `created_at`** (il commande
      les couleurs et l'historique du premier arrivé)
      → **ils sont 9, pas 12.** Le plan et `README-nouvelle-instance.md` disent
      12 ; la prod en compte 9, tous entrés après le 13/07. Le cap de 12 est une
      limite, pas un effectif.
- [ ] Vérifier que `player_breakdown` lit bien `execution_bonus` : dans `app`
      elle le prend depuis `points_bruts`, que la table de gel ne fournit pas.
      À traiter au moment de remplir `legacy_daily_points`.
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

---

## Décisions en attente de Jordan

Sorties du code en chemin. Aucune n'est urgente, aucune n'est tranchée.

- [x] ~~**Appliquer le socle SQL**~~ — fait le 28/07 : 36, 37, 38 et 42
      appliquées sur le projet de prod, `public` prouvé inchangé.
- [x] ~~**Poser `NEXT_PUBLIC_SUPABASE_SCHEMA=app`**~~ — fait le 29/07, cadrée
      sur la seule branche `feature/ligue-ecrans`, jamais en production.
      Vérifié : une branche témoin (`feature/seance-bonus`) ne la reçoit pas.
- [x] ~~**Exposer le schéma `app` dans l'API Supabase**~~ — fait le 29/07 par
      Jordan. Vérifié dans la foulée : `app.leagues` répond en HTTP 200.
- [x] ~~**`migration43-app-tchat.sql`**~~ — appliquée le 29/07 avec l'accord de
      Jordan. Le tchat, livré le 28/07, n'avait jamais été transposé dans `app`
      (15 tables contre 17). Empreinte de `public` identique avant/après
      (`14602406e9dffe910c79f65078001d3e`), ses 30 messages intacts.
- [ ] **Duels sur les ligues courtes.** Le premier appariement tombe au lundi de
      la 2ᵉ semaine — il faut un classement de S1 pour apparier. Conséquence :
      **une ligue d'une ou deux semaines n'aura jamais de duel.** Règle actuelle
      appliquée telle quelle ; l'ouvrir aux formats sprint est une décision produit.
- [ ] **`premier_de_la_classe` et `retour_de_flamme`** gardent des seuils fixes
      (7 jours n°1, 2 séries ≥ 5). Sur une ligue d'une semaine, le premier
      revient à être n°1 tous les jours. Les proportionner ou pas.
- [ ] **`migration39`** (`public.duel_results` au barème S3) touche `public` :
      elle attend une validation explicite. ⏰ Elle devient nécessaire à la
      clôture de la semaine du 27/07, **vers le 03/08**.
- [ ] **Nom affiché dans les partages** : « Challenge 100-100-100 » est en dur
      dans `lib/share.ts`. En multi-ligues, faut-il y mettre le nom de la ligue ?
