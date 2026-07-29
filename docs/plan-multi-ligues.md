# Plan technique — passage en multi-ligues

Document de passation. À lire en entier avant d'écrire une ligne de code.

Aujourd'hui l'app sert **un seul challenge**, celui du 13/07 au 31/08/2026, avec
12 joueurs et un mot de passe partagé. La cible : quelqu'un crée une ligue,
invite ses copains par un lien, la ligue dure entre 1 et 6 semaines, et tout
tourne sur **un seul projet Vercel et un seul projet Supabase**.

**Échelle réelle, à garder en tête.** On n'ouvre pas un produit public pour des
milliers d'inconnus. Le besoin concret : ajouter **une deuxième bande d'environ
5 potes** à côté du groupe d'origine, et pouvoir en accueillir quelques autres
ensuite. On parle d'une poignée de ligues de gens qui se connaissent, pas d'une
plateforme. Ça change les priorités : **on simplifie, on ne blinde pas.** Toute
la partie sécurité/anti-abus/passage à l'échelle reste volontairement légère
(voir la dernière section).

## La contrainte qui commande tout

**Le challenge d'origine tourne jusqu'au 31 août et ne doit pas bouger d'un
octet.** Points, historique, records : rien ne change pendant qu'il tourne.
C'est non négociable.

Donc : tout se construit dans un **schéma Postgres neuf** (`app`), jamais dans
`public`. Aucune instruction de ce chantier ne s'exécute sur `public`. Le
groupe d'origine est migré en phase 5, après le 31 août.

Concrètement le client Supabase prend `db: { schema: "app" }` et le filtre
realtime de `hooks/useChallengeData.ts:91` (aujourd'hui `schema: "public"` en
dur) suit. Le reste du code — `.from()`, `.rpc()` — hérite automatiquement.

### Le temps réel doit être cadré par ligue (angle mort corrigé)

`hooks/useChallengeData.ts` s'abonne aux changements de **toute** la table
`entries`. Une fois plusieurs ligues dans le même schéma, chaque appareil reçoit
les coches de **toutes** les ligues : la ligne des potes se met à pulser pour des
inconnus d'un autre groupe. Il faut cadrer.

Vu l'échelle réelle (une poignée de ligues, peu d'événements), le plus simple
suffit : **filtrer côté client**. Le hook connaît déjà la liste des joueurs de sa
ligue courante ; un événement realtime dont le `player_id` n'est pas dans cette
liste est simplement ignoré. Zéro changement de schéma, `entries` n'a pas besoin
de `league_id`. Si un jour le volume explose, on repassera à un canal Supabase
par ligue — inutile aujourd'hui.

---

## Décisions produit figées

Elles ont été tranchées avec Jordan. Ne pas les rouvrir sans lui.

| Sujet | Décision |
|---|---|
| Création | Autonome. Quelqu'un crée une ligue, invite par lien + code. |
| Durée | Libre entre 1 et 6 semaines, choisie à la création. |
| Règles | Identiques pour toutes les ligues. Exercices et barème inchangés. |
| Comptes | **Aucun.** Identité = `player_id` en localStorage + code de récupération à 6 caractères. |
| Multi-ligue | **Oui à terme, mais pas tout de suite.** Un joueur peut appartenir à plusieurs ligues (une identité par ligue). **Au lancement**, l'appareil ne suit qu'**une ligue active à la fois** ; on bascule en re-saisissant le lien de l'autre. Le sélecteur confortable (basculer d'un tap, comme changer de compte) est ajouté **plus tard, seulement quand le va-et-vient devient pénible**. Rien dans le socle ne ferme cette porte. |
| Arrivée tardive | Autorisée tant que la ligue tourne, **sans rattrapage** : les jours écoulés restent à zéro. |
| Fin de ligue | Bilan **en lecture seule, conservé indéfiniment**. Bouton « relancer » = nouvelle saison, **même lien/code**, mais **chaque joueur re-confirme** sa participation (personne n'est repris d'office). La saison précédente reste consultable telle quelle. Détail plus bas. |
| Créateur | Pouvoirs minimaux : modifier nom et dates **avant** le début, régénérer le code. Rien une fois démarrée. |
| Fuseau | Europe/Paris pour tout le monde. Rappels à 20h et 22h30. |
| Taille | 12 joueurs max par ligue (cap actuel, devient par ligue au lieu de global). |

---

## Modèle de données

### Nouvelle table

```sql
create table app.leagues (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,        -- dans l'URL : /l/<slug>
  name              text not null,
  invite_code       text not null unique,        -- 6 caractères, régénérable
  start_day         date not null,
  end_day           date not null,
  creator_player_id uuid,                        -- FK posée après création du 1er joueur
  parent_league_id  uuid references app.leagues (id),  -- saison 2 → saison 1
  created_at        timestamptz not null default now(),
  constraint duree_valide check (
    end_day >= start_day and end_day <= start_day + 41   -- 42 jours = 6 semaines
  )
);
```

### La seule colonne à propager

`app.players` gagne `league_id uuid not null references app.leagues (id)` et
`recovery_code text not null`.

**C'est tout.** Les 11 autres tables (`entries`, `duels`, `feed_events`,
`feed_comments`, `feed_reactions`, `push_subscriptions`, `rank_snapshots`,
`bonus_claims`, `workout_sessions`) sont déjà rattachées à un joueur : elles se
cadrent par jointure sur `players.league_id`. Ne pas dénormaliser — au volume
visé (une poignée de ligues × ~12 joueurs) la jointure est gratuite, et une
colonne dupliquée est une désynchronisation qui attend son heure.

`bonus_catalog` et `workout_presets` sont des données de référence : globales,
pas de `league_id`.

`daily_events` reste **global par jour civil** : toutes les ligues actives
partagent l'événement du jour. Plus simple, et sans conséquence sur l'équité
puisque chaque ligue est classée séparément. En revanche sa contrainte `CHECK`
sur la fenêtre du challenge doit sauter.

**Attention au ×2 du jour (chantier postérieur à ce plan).** Depuis fin juillet,
l'événement du jour peut **doubler** les points d'un ou plusieurs exercices
(migrations 33-34, puces ×2 en surbrillance dans la feuille bonus). Cette
mécanique de doublement a été écrite pour **une seule ligue** et doit être
re-vérifiée en phase 1 : comme `daily_events` reste global mais que le scoring
devient par ligue, il faut s'assurer que le ×2 s'applique bien **à chaque ligue
sur sa propre fenêtre**, sans jamais doubler les points d'une ligue sur la base
de l'activité d'une autre. À tester avec deux ligues actives le même jour.

### Contraintes à revoir

L'unicité du prénom et le cap de 12 joueurs sont aujourd'hui **globaux à la
base**. Ils deviennent par ligue — index unique sur `(league_id, lower(name))`,
et le compte dans `guard_player_insert` filtre sur la ligue.

---

## Le vrai travail : les vues et les fonctions

C'est ici que se cachent les bugs, pas dans les colonnes. Ces objets raisonnent
tous aujourd'hui sur **la totalité de la base**, ce qui est précisément ce qui
rendait le multi-ligue impossible :

- `leaderboard()` — `rank() over` sans aucun filtre de groupe
- `daily_points` — vue de base, redéfinie 5 fois au fil des migrations
- `player_badges` — vue jamais redéfinie après `migration2-gamification.sql`
- le premier arrivé du jour (`first_done`) — prend le premier sur toute la table `entries`
- le bonus « tout le groupe a fini » — `count(*) = (select count(*) from players)`
- `get_daily_event()`
- `player_breakdown()`, `duel_results`
- les ~10 fonctions `guard_*` — les gardes d'écriture

**Attention au piège de scoring.** Sans filtre par ligue, un joueur d'une autre
ligue qui coche à 6h vole le bonus du premier arrivé. Silencieusement : rien ne
casse à l'affichage, seuls les points sont faux. Chaque objet ci-dessus doit
être revu un par un, et testé avec **au moins deux ligues actives simultanément
sur des fenêtres de dates qui se chevauchent**. Un test sur une seule ligue ne
prouve rien.

### Les CHECK de dates deviennent des triggers

4 contraintes `CHECK` codent en dur la fenêtre 13/07 → 31/08 :
`migration.sql` (entries), `migration4-seance.sql` (workout_sessions),
`migration3-bonus.sql` (bonus_claims et daily_events).

Postgres **interdit les sous-requêtes dans un `CHECK`** : impossible d'y lire
`leagues.end_day`. Il faut les convertir en triggers `before insert or update`
qui joignent `players → leagues` et rejettent hors fenêtre. Message d'erreur
explicite : c'est le garde-fou qui attrapera les incohérences de dates.

---

## Badges proportionnels

Les seuils actuels ont été calibrés pour 50 jours. Sur une ligue courte,
plusieurs deviennent inatteignables. Ils se calculent désormais depuis la durée
`N` de la ligue :

| Badge | Formule | Vérification à N=50 |
|---|---|---|
| `premiere_semaine` | `max(3, ceil(0.14 × N))` jours parfaits consécutifs | 7 ✓ |
| `machine` | `max(3, ceil(0.28 × N))` | 14 ✓ |
| `increvable` | `max(3, ceil(0.60 × N))` | 30 ✓ |
| `centurion` | `2 × N` exos cumulés | 100 ✓ |

**La formule doit reproduire exactement les valeurs actuelles à N=50.** C'est le
test de non-régression : si le groupe d'origine migré voit ses badges changer,
la formule est fausse.

`finisseur` se déclenche sur le dernier jour de la ligue (`leagues.end_day`) au
lieu de la date en dur `2026-08-31` — c'est aujourd'hui à
`migration2-gamification.sql:185`.

**Limite connue, acceptée :** sur une ligue de 7 jours, `premiere_semaine` et
`machine` tombent tous les deux à 3 à cause du plancher. Le format sprint reste
pauvre en progression. Ne pas chercher à le corriger dans ce chantier.

---

## Ce qui disparaît

`NEXT_PUBLIC_GROUP_PASSWORD` **ne peut pas survivre**. Il est inliné au build,
une seule valeur pour tout le déploiement : plusieurs ligues ne peuvent pas
partager un même mot de passe. Il est remplacé par `leagues.invite_code`,
vérifié côté serveur. `components/PasswordGate.tsx` devient l'écran de saisie du
code de ligue. Le code reste **court et simple** (entre potes qui se
connaissent, pas de rallongement ni d'anti-abus — voir dernière section).

Attention : deux routes POST (`app/api/feed-notify` et `app/api/moments`) ont
été sécurisées par un header `x-group-pass` adossé à cette variable. Cette garde
doit être refaite sur le code de ligue.

`lib/challenge.ts` ne porte plus de dates en dur ni d'env : `CHALLENGE_START`,
`CHALLENGE_END` et `CHALLENGE_DAYS` viennent de la ligue courante. C'est le
fichier le plus importé du projet — tous les helpers de dates en dépendent.
Prévoir que la ligue soit disponible en contexte React avant tout rendu.

---

## Le « relancer » : ce qui se passe vraiment (angle mort comblé)

Le plan disait « il existe un bouton relancer » sans décrire l'enchaînement.
Décision prise :

1. Une ligue se termine → elle bascule en **lecture seule** (classement final,
   badges, records figés). Elle ne disparaît jamais.
2. Le créateur clique **« relancer »** → une **nouvelle ligue** est créée,
   rattachée à l'ancienne (`parent_league_id`), avec le **même code** et de
   nouvelles dates. Ses compteurs repartent de zéro.
3. Chaque joueur de l'ancienne saison **doit re-confirmer** : il rouvre le lien
   et re-rentre par son prénom. Personne n'est basculé d'office. Tant qu'il n'a
   pas confirmé, il n'est pas dans la saison 2.

Concrètement, une saison 2 est **une ligue de plus** dans le même système — pas
un cas spécial. Les joueurs qui re-confirment obtiennent une **nouvelle identité
de joueur** (nouveau `player_id`, rattaché à la nouvelle `league_id`). Leur code
de récupération d'origine ne les ramène que dans la saison où il a été créé :
c'est voulu, chaque saison est une page blanche. La saison 1 reste lisible via
son propre `slug`.

À vérifier : afficher clairement « Saison 1 — terminée » quand on la consulte,
pour qu'un joueur ne croie pas cocher dans une ligue qui tourne encore.

---

## Les phases

Chacune est livrable et testable seule. Aucune ne touche `public`.

**Phase 1 — socle SQL.** Table `leagues`, `players.league_id`, réécriture des
vues et fonctions avec filtre par ligue, `CHECK` de dates convertis en triggers,
unicité et cap passés par ligue. *4 à 6 soirées. C'est le gros morceau.*

**Phase 2 — badges proportionnels.** Formule ci-dessus dans `player_badges`,
plus le test de non-régression à N=50. *1 soirée.*

**Phase 3 — création et invitation.** Routing `/l/[slug]`, écran de création
(nom, date de début, durée), génération du code, entrée par prénom, code de
récupération. `PasswordGate` reconverti. *3 à 4 soirées.*

**Phase 4 — crons multi-ligues.** Les 7 routes `app/api/cron/*` bouclent sur les
ligues actives au lieu d'en traiter une. Rappel : 2 crons sur Vercel
(`vercel.json`, plan Hobby plafonné à 2) et 5 sur GitHub Actions
(`.github/workflows/`). Push cadrées par ligue. Définition simple et unique de
**« ligue active »** à réutiliser partout : *démarrée, pas encore finie, et au
moins 2 joueurs*. En dessous, le cron l'ignore — pas de notification envoyée
dans le vide à une ligue vide ou pas encore commencée. *2 soirées.*

**Phase 5 — migration du groupe d'origine (la plus sensible).** Après le 31 août
uniquement. C'est la **seule** phase qui touche les vraies données de prod : elle
recopie les 12 joueurs et ~50 jours d'historique de `public` vers `app`, en les
rattachant à la ligue n°1. Deux pièges à traiter explicitement, sinon
l'historique se réécrit tout seul :

- **L'ordre d'inscription des joueurs doit être préservé à l'identique.** Il sert
  à deux choses invisibles : la couleur de chaque joueur (attribuée selon son
  rang d'arrivée) et l'historique du « premier arrivé du jour ». Un ordre
  bousculé = des couleurs qui changent et des bonus passés recalculés faux.
- **Rien ne doit être rejoué "en direct".** On copie l'état final tel quel, sans
  laisser les triggers de scoring recalculer les journées déjà closes.

À faire de tête froide, avec une sauvegarde préalable et une comparaison
avant/après du classement. Ce n'est pas la case "vite fait un soir". *1 à 2
soirées, sauvegarde et vérification comprises.*

Total : **deux à trois semaines de soirées**, marge comprise.

---

## Vérifications avant de considérer une phase terminée

- [ ] `npx tsc --noEmit` et `npm run build` passent
- [ ] Le schéma `public` n'a reçu **aucune** instruction (vérifier le SQL joué)
- [ ] Le classement du groupe d'origine est strictement inchangé
- [ ] **Deux ligues actives aux dates chevauchantes** : les points de l'une ne
      bougent pas quand on coche dans l'autre
- [ ] Le premier arrivé du jour et le bonus « tout le groupe a fini » sont
      calculés par ligue
- [ ] Une ligue de 7 jours et une de 42 jours donnent des badges cohérents
- [ ] Un joueur qui rejoint au jour 4 démarre à zéro sans casser le classement
- [ ] **La ligne des potes ne pulse jamais pour un joueur d'une autre ligue**
      (temps réel bien cadré, deux ligues ouvertes côte à côte)
- [ ] Le ×2 du jour double les points **par ligue**, jamais d'une ligue sur
      l'activité d'une autre
- [ ] « Relancer » crée bien une saison 2 vide, la saison 1 reste en lecture
      seule, et un joueur doit re-confirmer pour y entrer

## Volontairement laissé simple (échelle « potes », pas « plateforme »)

Ces points seraient de vrais sujets pour un produit public. À notre échelle —
quelques bandes de gens qui se connaissent — on les **assume tels quels** et on
n'y consacre pas une ligne de code pour l'instant. Écrit ici pour que ce soit un
choix conscient, pas un oubli.

- **Code d'invitation court, sans anti-abus.** Devinable en théorie, mais entre
  potos personne ne va énumérer des codes pour espionner un autre groupe. On ne
  rallonge pas, on ne met pas de blocage. À revoir **le jour où** on ouvrirait à
  des inconnus.
- **RLS ouverte à `anon`.** Même logique : aujourd'hui assumé entre potes. Ne
  devient un sujet que si l'app s'ouvre au public.
- **Ménage des ligues vides.** Une ligue que personne ne rejoint traîne sans
  gêner (les crons l'ignorent déjà via la règle « ≥ 2 joueurs »). On fera le
  ménage à la main si ça s'accumule — pas de suppression automatique à coder.
- **Free tier Supabase** : un seul projet, largement dans les clous à cette
  échelle. Juste un œil sur le volume si ça grandit vraiment.
- **Fuseau unique** : Europe/Paris pour tout le monde. Une ligue hors de France
  verrait ses rappels décalés — non concerné aujourd'hui.
