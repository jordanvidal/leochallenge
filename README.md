# 100 · 100 · 100

Challenge sportif entre potes : 100 pompes, 100 abdos, 100 squats par jour, du 13 juillet au 31 août 2026. Chacun coche, tout le monde voit tout. PWA mobile-first, Next.js 15 + Supabase.

## Mise en route (10 minutes)

### 1. Supabase

1. Crée un projet sur [supabase.com](https://supabase.com) (région EU de préférence).
2. Ouvre **SQL Editor**, colle tout le contenu de `supabase/migration.sql`, exécute. Ça crée les tables, l'index unique sur les prénoms, la RLS et les triggers qui font respecter les règles (fenêtre d'édition 48h, cap 12 joueurs, suppression bloquée). Aucun seed : la liste des joueurs démarre vide.
3. Récupère l'URL du projet et la clé `anon` dans **Settings → API**.

### 2. Variables d'environnement

```bash
cp .env.example .env.local
```

Remplis les 3 valeurs : URL Supabase, clé anon, mot de passe du groupe. Les dates du challenge sont en dur dans `lib/challenge.ts`, elles ne changeront pas.

### 3. Lancer en local

```bash
npm install
npm run dev
```

### 4. Déployer sur Vercel

```bash
npx vercel
```

Ajoute les 3 variables d'environnement dans le dashboard Vercel (ou `npx vercel env add`), puis `npx vercel --prod`. Envoie l'URL au groupe WhatsApp. Chacun s'ajoute lui-même à l'arrivée et rattrape son historique (fenêtre de 48h après inscription).

## Phase 2 — gamification

Points côté serveur (1/exo, +2 le jour parfait, ×1,5 dès 3 jours parfaits consécutifs, ×2 dès 7), classement général + semaine, 8 badges, notifications push (rappels 20h/22h30 Paris + dépassements).

1. Exécute `supabase/migration2-gamification.sql` dans l'éditeur SQL (additive, aucune donnée perdue).
2. Génère les clés VAPID (`npx web-push generate-vapid-keys`) et un `CRON_SECRET` (`openssl rand -hex 24`), ajoute les 3 variables (`.env.example`) en local et sur Vercel.
3. Les crons de rappel sont dans `vercel.json` (18h00 et 20h30 UTC = 20h/22h30 à Paris l'été). Sur le plan Hobby, Vercel garantit l'heure à ±59 min près — si la précision compte, pointe un cron externe (cron-job.org) sur les deux routes avec le header `Authorization: Bearer $CRON_SECRET`.

**Limites plateforme, sans détour** : sur iOS, les push web n'existent que si la PWA est installée sur l'écran d'accueil (iOS 16.4+) — l'app force déjà l'installation, mais un pote qui reste dans Safari n'aura jamais de notification. Sur Android/Chrome, tout marche, installé ou pas. Les crons ne tournent que sur le déploiement production.

## Ce qu'il faut savoir

- **Pas de comptes.** Un mot de passe partagé, un prénom, c'est tout. L'identité vit en localStorage — d'où l'écran qui insiste pour installer la PWA (Safari purge le localStorage des sites peu visités).
- **Les règles vivent en base.** Fenêtre d'édition de 48h (heure de Paris), pas de jour futur, pas d'entrée hors challenge : triggers Postgres, pas seulement du React. Les devtools ne servent à rien.
- **Icônes** : régénérables avec `node scripts/make-icons.mjs` (aucune dépendance).

## Captures d'écran (Playwright)

Certains écrans sont « gatés » (mot de passe de groupe, choix du joueur, tuto, événement du jour), donc pas atteignables par une simple URL. `scripts/screenshot.mjs` injecte les flags `localStorage` pour tomber directement sur l'écran voulu et le photographier.

Une fois, pour récupérer le navigateur (mis en cache global, hors repo) :

```bash
npx playwright install chromium
```

Puis, avec le serveur lancé à côté (`npm run dev`) :

```bash
node scripts/screenshot.mjs tutorial                     # les 5 cartes du tuto
node scripts/screenshot.mjs event --event=jour_miroir    # la modale d'un événement
node scripts/screenshot.mjs app --tab=leaderboard        # un onglet de l'app
```

Les images atterrissent dans `screenshots/` (ignoré par git). Options : `--event=<clé>` (`leve_tot`, `quitte_ou_double`, `jour_miroir`, `happy_hour`, `pompes_double`, `boss_dimanche`…), `--tab=<onglet>`, `--url=<base>` (défaut `http://localhost:3000`), `--player=<uuid>` (défaut : premier joueur en base), `--out=<dossier>`. L'événement forcé est **mocké côté client** (interception de la RPC `get_daily_event`) : la base n'est jamais touchée.
