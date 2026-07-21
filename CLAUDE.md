# CLAUDE.md — contexte pour les sessions Claude sur ce repo

PWA de challenge sportif entre potes : 100 pompes, 100 abdos, 100 squats par jour, chacun coche, tout le monde voit tout. Avant de coder quoi que ce soit, lis `README.md` (setup, migrations, crons) et `PRODUCT.md` (utilisateurs, principes de design, anti-références). Ils font foi.

## Stack

- Next.js 15 (App Router, Turbopack), React 19, TypeScript, Tailwind 4.
- Supabase : Postgres + RLS + Realtime. Le client est dans `lib/supabase.ts`, le code serveur dans `lib/server/`.
- PWA installée sur iPhone/Android, notifications via `web-push`.
- Déploiement Vercel. La prod est branchée sur `main` : tout merge part en prod.

## Workflow — non négociable

1. **Jamais de commit ni push sur `main`.** Branche `feature/nom-court`, puis PR. Jordan est le seul à merger.
2. Chaque PR déclenche une preview Vercel : teste ton changement sur l'URL de preview, sur téléphone, avant de demander la review.
3. `npm run build` doit passer sans erreur avant d'ouvrir la PR.
4. Une PR = un sujet. Petite et lisible. Si tu touches plus de 4-5 fichiers, découpe.

## Zones interdites sans accord explicite de Jordan

- **`supabase/*.sql`** : ces migrations sont déjà appliquées en prod. On ne modifie jamais une migration existante. Une nouvelle migration, c'est possible, mais seulement après validation de Jordan — le schéma en prod contient les données réelles du groupe.
- **`vercel.json` et `app/api/cron/`** : ne pas ajouter ni déplacer de cron sans accord. Le plan Vercel Hobby autorise 100 crons par projet (pas 2, comme l'ont longtemps affirmé les commentaires de ce repo) ; ses vraies contraintes sont un déclenchement par jour maximum et une heure garantie à ±59 min près. La règle tient quand même : un cron de plus, c'est une notification de plus envoyée à six personnes, et ça se décide avec Jordan.
- **L'auth des routes API** : les POST `/api/moments` et `/api/feed-notify` exigent le header `x-group-pass`. Ne jamais retirer ou contourner cette vérification.
- **Secrets** : jamais de clé, mot de passe ou `.env*` dans un commit. Les variables d'env sont déjà configurées côté Vercel, tu n'en as pas besoin.

## Règles produit — elles priment sur toute idée de feature

- **10 secondes.** L'usage type : dans un lit à 23h, ouvrir → lancer sa séance → cocher 3 exos → fermer. Chaque écran se juge au temps entre ouverture et coche. Une feature qui ralentit ce chemin est refusée d'office.
- **Pas de coche sans séance lancée** (depuis le 21/07). « Lancer ma séance » ouvre un chrono côté serveur, et c'est cette ligne en base qui déverrouille la journée — jusqu'à minuit, sur tous les écrans. Le portier est `hooks/useTodaySession.ts`, avec un dernier filet dans `App.toggleAndScore`. Une carte verrouillée s'affiche à 50 % avec un cadenas et ouvre le lanceur au tap : elle ne râle jamais. C'est la seule étape jamais ajoutée au chemin critique, et elle a coûté une discussion — ne la contourne pas « pour aller plus vite », et n'ajoute pas de deuxième porte au nom du même raisonnement.
- **Mobile-first, sombre, physique.** Touch targets ≥ 44px, optimistic UI (jamais de spinner bloquant), feedback immédiat. La couleur, c'est les joueurs (palette fixe dans `lib/palette.ts`), le reste est neutre.
- **Anti-références** (voir `PRODUCT.md`) : pas de dashboard SaaS, pas de badges à confettis, pas d'élément décoratif gratuit.
- Toute l'UI est en **français**.

## Conventions de code

- TypeScript partout, camelCase, composants dans `components/`, logique métier dans `lib/`.
- Les dates du challenge vivent dans `lib/challenge.ts` (surcharge via `NEXT_PUBLIC_CHALLENGE_START/END`). Ne jamais coder une date en dur dans un composant.
- Fichiers courts (< 500 lignes), commentaires en français, pas de dépendance nouvelle sans raison solide.

## En cas de doute

Ne devine pas. Ouvre la PR en draft avec ta question dedans, ou demande à Jordan avant. Une question coûte 2 minutes, un bug en prod réveille 6 personnes à 23h.
