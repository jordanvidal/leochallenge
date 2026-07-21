# Lancer le challenge avec une nouvelle bande de copains

Le principe : **une bande = une instance complète**. Sa propre base Supabase, son
propre projet Vercel, son propre mot de passe. Le code reste unique — les deux
instances déploient le même repo, la même branche `main`.

## Pourquoi pas tout dans la même base

Le moteur de scoring raisonne sur *tous* les joueurs de la base, pas seulement
sur le joueur courant :

- `first_done` prend le premier arrivé du jour sur toute la table `entries` ;
- le bonus « tout le groupe a fini » fait `count(*) = (select count(*) from players)` ;
- `leaderboard()` fait un `rank() over` sans aucun filtre de groupe.

Mélanger deux bandes dans une base ne casse pas l'affichage : **ça fausse les
points**. Un type de l'autre groupe qui coche à 6h vole le bonus du premier
arrivé. Silencieusement. Tant qu'il n'y a pas de colonne `league_id` (chantier
d'environ 2-4 jours, à faire quand aucune compétition ne tourne), on duplique.

Effet de bord agréable : le cap de 12 joueurs et l'unicité des prénoms sont
globaux à une base. En dupliquant, ils redeviennent par bande — 12 joueurs
chacun, et « Léo » peut exister des deux côtés.

---

## Checklist

### 1. Fixer les dates

Décide le premier et le dernier jour. La durée est libre (le code la déduit, ce
n'est plus 50 en dur). Note-les, elles servent aux étapes 2 et 4 et **doivent
être identiques des deux côtés**.

```
DEBUT=2026-09-07
FIN=2026-10-26
```

### 2. Nouvelle base Supabase

Crée un projet. ⚠️ Le free tier plafonne à 2 projets actifs par organisation :
pour une 3ᵉ bande, il faudra payer ou construire le vrai multi-challenge.

Les dates sont en dur dans 9 endroits du SQL, répartis sur 5 fichiers. Ne les
édite pas dans le repo (ça casserait l'instance actuelle) — travaille sur une
copie :

```bash
cp -r supabase /tmp/nouvelle-bande && cd /tmp/nouvelle-bande
sed -i '' "s/2026-07-13/$DEBUT/g; s/2026-08-31/$FIN/g" *.sql

# Doit ne RIEN renvoyer. Si ça renvoie quelque chose, ne va pas plus loin.
grep -rn "2026-07-13\|2026-08-31" *.sql
```

Ce que le `sed` corrige, pour info :

| Fichier | Objet | Ce qui casserait sans |
|---|---|---|
| `migration.sql` | `CHECK` sur `entries` | Aucune déclaration d'exo possible |
| `migration3-bonus.sql` | `CHECK` sur `bonus_claims`, `daily_events` | Aucun bonus, aucun événement du jour |
| `migration4-seance.sql` | `CHECK` sur `workout_sessions` | Aucune séance chrono |
| `migration2-gamification.sql` | vue `player_badges` (×3) | Badges muets + « finisseur » indécrochable |
| `migration8-events.sql` | `get_daily_event()` | Événement du jour jamais tiré |

Puis colle les 12 fichiers dans l'éditeur SQL Supabase, **dans cet ordre** (pas
de CLI sur ce projet, les migrations se jouent à la main) :

```
migration.sql
migration2-gamification.sql
migration3-bonus.sql
migration4-seance.sql
migration4b-vue-chrono.sql
migration5-feed.sql
migration6-plafond-depassement.sql
migration7-breakdown.sql
migration8-events.sql
migration9-jour-en-cours.sql
migration10-paliers-volume.sql
migration11-bonus-retour.sql
migration12-realtime.sql
migration13-jour-parfait-collectif.sql
migration14-duels.sql
migration15-reequilibrage.sql
migration16-cap-jour-leve.sql
migration17-prime-hebdo.sql
migration18-trio-matinal.sql
migration19-duel-departage-points.sql
migration19-marches-500.sql
migration20-cap-semaine-leve.sql
migration21-bonus-sans-materiel.sql
migration22-paliers-cumulables.sql
migration23-bonus-jour-en-cours.sql
migration24-joker-serie.sql
migration25-feed-joker.sql
migration26-seance-decochee.sql
```

Deux fichiers portent le préfixe `19` : joue `duel-departage-points`
avant `marches-500`. Ils sont indépendants, mais autant garder l'ordre
dans lequel ils sont partis en prod.

L'ordre n'est pas cosmétique : `daily_points` est redéfinie une dizaine
de fois et `get_daily_event()` 2 fois. La dernière version gagne — c'est
`migration24-joker-serie.sql` qui pose la version courante de
`daily_points` et de `leaderboard()`.

### 3. Nouvelles clés

```bash
npx web-push generate-vapid-keys   # paire VAPID, ne réutilise pas celle d'origine
openssl rand -hex 24               # CRON_SECRET
```

### 4. Nouveau projet Vercel

Importe **le même repo** dans un second projet Vercel (`leochallenge-<bande>`).
Même branche `main` : un push déploie les deux instances, et chaque amélioration
profite aux deux bandes sans rien dupliquer.

Variables d'environnement du nouveau projet :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | nouvelle base → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem |
| `NEXT_PUBLIC_GROUP_PASSWORD` | mot de passe de la nouvelle bande |
| `NEXT_PUBLIC_CHALLENGE_START` | `$DEBUT` — **exactement** ce qui est dans le SQL |
| `NEXT_PUBLIC_CHALLENGE_END` | `$FIN` — idem |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | nouvelle paire |
| `VAPID_PRIVATE_KEY` | nouvelle paire |
| `CRON_SECRET` | nouveau |

Une date mal formée fait **échouer le build**. C'est voulu : mieux vaut un
déploiement rouge qu'une instance qui se croit terminée depuis un an.

Les crons Vercel (`reminder-soft` 20h, `reminder-final` 22h30, `weekly-recap`
lundi 10h) suivent le projet, ils sont déjà dans `vercel.json`. Rien à faire.
Le plan Hobby autorise 100 crons par projet — ses contraintes sont ailleurs :
pas plus d'un déclenchement par jour, et l'heure à ±59 min près. Le reste passe
par GitHub Actions : `daily-event` (9h), `streak-risk` (17h), `last-standing`
(21h30), `weekly-close` (dimanche 21h) et le filet du récap hebdo.

⚠️ Les workflows `.github/workflows/*.yml` ne tapent que **l'instance
d'origine**. Pour que la nouvelle bande ait ses notifications, il faut ajouter
dans chaque workflow un second appel avec sa propre URL et son `CRON_SECRET`
(secrets GitHub distincts).

### 5. Vérifier avant de partager le lien

- [ ] La page charge et demande le mot de passe de la nouvelle bande
- [ ] Créer un joueur test → il apparaît dans le classement
- [ ] Cocher un exercice → la ligne passe, pas d'erreur de contrainte (si ça
      coince ici, les dates SQL et env ne correspondent pas)
- [ ] L'onglet Aujourd'hui est visible, pas le Bilan
- [ ] Le header affiche la bonne plage de dates et le bon nombre de jours
- [ ] Autoriser les notifications → la subscription s'enregistre
- [ ] Sur l'instance d'origine : le classement est **strictement inchangé**
- [ ] Supprimer le joueur test

Puis : lien + mot de passe dans leur groupe WhatsApp. Ils s'inscrivent seuls.

---

## Points connus, non traités

- **Étanchéité technique.** Deux bases séparées = aucun chemin entre les deux.
  Solide. En revanche RLS reste ouverte à `anon` à l'intérieur d'une base : entre
  potes c'est assumé, mais ne partage pas une instance avec des inconnus.
- **Nom de la PWA.** « leochallenge » est le nom d'app pour tout le monde. Cosmétique,
  pas branché sur l'env. À sortir si une bande le demande.
- **Exercices et objectif 100.** En dur (`lib/types.ts`, `lib/workout.ts`). Toutes
  les bandes jouent les mêmes règles — c'est le choix assumé.
- **Bandeau « bilan provisoire ».** Suppose que le challenge finit entre avril et
  octobre (CEST codé en dur). Décalé d'une heure pour un challenge d'hiver.
