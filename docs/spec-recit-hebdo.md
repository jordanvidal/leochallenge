# Spec — le récit du lundi

Pour l'agent qui implémentera. Tout ce qui suit a été vérifié dans le code et
sur la base de prod le 26/07.

**Les quatre points ouverts ont été tranchés par Jordan le 26/07** — voir §11.
Il reste **un seul feu vert à demander** : l'`alter` de contrainte du §4.

**Calendrier : lundi 27/07, pas ce soir.** Le bloc B de la MEP de la S3 tire à
minuit ce soir ; on ne pose pas un job neuf sur cet instant-là. Les deux
semaines de la S2 sont figées dès minuit passé et se rattrapent en un run
one-shot, à n'importe quelle heure du lundi (§10). Le job `pg_cron` n'est armé
qu'ensuite, pour les dimanches suivants.

---

## 1. L'intention

Le classement dit qui est devant. Il ne dit jamais **ce qui s'est passé**.

Un exemple réel, au 26/07, que le classement ne montre nulle part :

- **Léo a coché 14 jours parfaits sur 14.** Le seul sans-faute intégral du
  groupe. Il est **4ᵉ**.
- **Doren a coché 11 jours, avec 3 jours sans rien.** Il est **1ᵉʳ**, avec le
  meilleur jour du groupe à 64 points.

La régularité parfaite finit derrière l'intensité irrégulière. C'est l'histoire
la plus intéressante de la saison, et personne ne peut la lire.

Autre exemple : Jordan est passé 4ᵉ → 2ᵉ en une semaine, avec 80 points sur les
deux derniers jours — le double de Doren — et un joker brûlé en route. Un rang
qui bouge de deux places raconte quelque chose ; « 2ᵉ, 326,5 pts » ne raconte
rien.

**Ce qu'on construit : une carte de fil, chaque lundi, qui raconte l'histoire
de la semaine close.** Une seule carte, pas une par joueur. Aucun point en jeu,
rien à optimiser.

---

## 2. La forme

**Une carte de fil. Pas un écran, pas une interstitielle.**

Le carrousel de lancement de la S3 est une exception assumée : on le voit une
fois par saison. Un écran hebdomadaire s'intercalerait entre l'ouverture et les
trois coches **un jour sur sept**, et la règle des 10 secondes de `CLAUDE.md`
est non négociable. Une carte de fil ne coûte rien au chemin critique : elle est
là si on descend, invisible sinon.

**Une seule carte pour la semaine, pas une par joueur.** Six cartes le même
lundi, c'est le fil noyé et la nouveauté banalisée dès la deuxième semaine. Le
précédent est déjà en base : `migration13-jour-parfait-collectif.sql` pose le
kind `collectif` comme « une seule carte, portée par celui qui ferme la
journée — pas sept cartes identiques ».

**Portée par son protagoniste.** `feed_events.player_id` est `not null` et
référence `players` : une carte sans auteur demanderait une migration de
colonne **et** un changement de rendu. Inutile — la carte a toujours un
protagoniste (§6), c'est lui qui la porte, son prénom s'affiche coloré comme
partout ailleurs, et la phrase nomme les autres dans son texte. `co_lead` fait
déjà exactement ça (`et Léo et Doren se partagent la tête`).

**Et on remplace la génération de texte à la main par du calcul.** Les `NOTES`
de `components/LaunchS3Screen.tsx` (indexées par prénom, écrites à la main) sont
la preuve du problème : elles sont écrites pour un podium supposé et ne
survivent pas à un autre résultat. Une ligne calculée est vraie quoi qu'il
arrive.

---

## 3. Le moment de l'émission

**Le bilan porte sur la semaine close et doit arriver à la bascule** — au
passage de la semaine n-1 à la semaine n, pas dix heures plus tard.

Ce moment est net et il est déjà celui de tout le reste : **dimanche minuit,
heure de Paris**. C'est là que `duel_results` bascule, que la prime hebdo est
attribuée, et que les trois gardes (`guard_bonus_claim`, `guard_bonus_delete`,
`guard_entry_write`) verrouillent la semaine. Après cette seconde, plus une
coche, plus un décochage : **les chiffres du bilan ne peuvent plus bouger**.

Les deux mécanismes existants ratent cette bascule :

| Mécanisme | Quand il tombe vraiment | Pourquoi ça ne va pas |
|---|---|---|
| Cron `weekly-recap` (`0 8 * * 1`) | lundi 10h Paris, ±59 min | dix heures de retard sur la fin de semaine |
| `/api/moments` | au premier joueur qui coche, souvent lundi 23h | déclenchement imprévisible, et surtout **il envoie un push à chaque moment inséré** — une notification de plus aux six |

**Décision (accordée le 26/07) : un job `pg_cron` le lundi à 00h05 Paris**
(22h05 UTC en été, 23h05 en hiver — attention au changement d'heure du 25/10,
à ne pas oublier). Il n'ajoute aucun cron Vercel, ne touche pas à
`app/api/cron/`, et **n'envoie aucune notification** : il écrit une ligne dans
`feed_events`, rien d'autre. L'extension est déjà installée et éprouvée sur ce
projet — voir `docs/mep-s3-applique.sql`, où un job du même genre a porté le
bloc B de la MEP de la S3, avec garde de date, réessai et désinscription
automatique.

**Le partage des rôles qui va avec :** le job SQL **ne rédige pas de français**.
Il calcule les faits du §5, choisit l'angle du §6 et les écrit tels quels dans
`payload` (JSON) ; c'est `eventPhrase()` qui écrit la phrase, en TypeScript, là
où vivent déjà toutes les formulations de l'app. Des gabarits français dans du
PL/pgSQL seraient illisibles et intestables.

À noter : le job tourne à 00h05 mais **personne ne lit le fil à cette
heure-là**. L'intérêt n'est pas d'être vu à minuit, c'est que la carte soit
**déjà là, et juste**, pour le premier qui ouvre l'app — à 7h comme à 23h.

---

## 4. Ce qui existe déjà — à copier, pas à réinventer

**Le mécanisme complet est déjà en place pour les duels.** Ne rien inventer :

| Besoin | Où c'est déjà fait |
|---|---|
| Écrire un événement persisté, une fois par semaine, dédupliqué | Le modèle est `lib/server/duels.ts` → `runWeeklyDuels()` : un `upsert` sur `feed_events` avec `onConflict: "player_id,kind,dedupe_key"`. **Attention** : là-bas c'est du TypeScript via `supabase-js` ; ici l'écriture est faite en SQL par le job `pg_cron`. Et la contrainte ne suffit pas — lire la garde du §9 |
| Se déclencher tout seul à une heure précise, sans notification | `docs/mep-s3-applique.sql` : un job `pg_cron` avec garde de date, réessai toutes les 5 min et désinscription automatique. L'extension est installée depuis le 26/07 |
| Déclarer un nouveau type de carte | `lib/feed.ts` : union `FeedKind` (l. 15), `FeedPayload` (l. 30) |
| Rendre la carte | `lib/feed.ts` → `eventPhrase()` (l. 111), un `case` par kind ; prendre `duel_result` (l. 198) comme modèle, et `co_lead` (l. 130) pour l'accord d'une phrase qui nomme d'autres joueurs |

**Zone interdite rappelée** (`CLAUDE.md`) : ne pas ajouter ni déplacer de cron
dans `vercel.json` ou `app/api/cron/`. Le job `pg_cron` du §3 ne touche ni à
l'un ni à l'autre et n'envoie aucune notification ; il a été accordé le 26/07.

Le cron `weekly-recap` du lundi n'est **pas** le porteur de cette carte : il
arrive dix heures après la bascule, et il ne portera pas non plus de ligne de
récit (§11, point 2).

### Le seul geste sur le schéma — feu vert à demander

Le kind retenu est **`recit`**. `feed_events.kind` porte un
`feed_events_kind_check` qui énumère les kinds autorisés ; il a été étendu à
chaque nouveau type (migrations 13, 14, 25, 28). Ajouter `recit` demande donc
**un `alter table public.feed_events … add constraint feed_events_kind_check`**,
et ça tombe dans `supabase/*.sql`, zone interdite.

Ce n'est pas négociable autrement : le contournement existe — la migration 28
recycle le kind `record` pour deux familles de cartes, discriminées sur le
payload — mais l'appliquer ici rendrait le rendu illisible pour rien.

**L'agent présente le SQL exact à Jordan et attend son accord avant de
l'exécuter.** C'est un `alter` de contrainte, pas une table ni une colonne : il
ne touche à aucune donnée.

---

## 5. Ce qu'on calcule

Pour chaque joueur **actif** sur la semaine close (lundi → dimanche, celle qui
vient de se terminer, soit `today - 7` à `today - 1`) :

| Donnée | Source |
|---|---|
| `rang_avant` / `rang_apres` | `leaderboard(null, lundi - 1)` et `leaderboard(null, dimanche)` |
| `jours_parfaits` (sur 7) | `entries` : `pushups and abs and squats` |
| `serie_max` | `max(streak_pos)` sur `daily_points` de la semaine |
| `serie_record` | `serie_max` de la semaine > `max(streak_pos)` de tout l'avant |
| `joker_brule` | `daily_points.jokered` sur la semaine |
| `meilleur_jour` | `max(points)` sur `daily_points` de la semaine |
| `points_semaine` | `sum(points)` sur `daily_points` de la semaine |
| `finish` | `sum(points)` des deux derniers jours de la semaine |
| `duel` | vue `duel_results` sur `week_monday` (déjà résolue) |
| `prime` | gagnant du classement hebdo — déjà dans `daily_points` |

**Aucune migration de données.** Tout vient de `daily_points`, `entries`,
`leaderboard()` et `duel_results`. Si tu crois avoir besoin d'une table, relis
ce tableau. Le seul geste sur le schéma est l'`alter` de contrainte du §4.

Est **actif** un joueur ayant au moins une coche sur la semaine (même
sémantique que l'appariement des duels, `createPairings`). Un joueur inactif ne
peut être ni protagoniste ni nommé dans la phrase — une carte n'est jamais un
reproche, et surtout pas envers celui qui n'était pas là.

**Moins de deux joueurs actifs : pas de carte.** Il n'y a pas d'histoire à un.

---

## 6. Le choix de l'histoire

**Une carte, un angle, un protagoniste.** On calcule les faits du §5 pour tous
les joueurs actifs, puis on descend cette liste : **le premier angle qui trouve
un candidat gagne**, et c'est son candidat qui porte la carte. L'ordre est le
sujet de la spec ; c'est lui qui décide si la carte est intéressante ou
générique.

| # | Angle | Condition | Ce que la carte dit |
|---|---|---|---|
| 1 | **Le sans-faute qui ne paie pas** | `jours_parfaits = 7` et pas 1ᵉʳ au général | ses 7/7, le rang que ça donne, et le 1ᵉʳ avec ses jours sautés |
| 2 | **Le sans-faute** | `jours_parfaits = 7` et 1ᵉʳ au général | ses 7/7 et l'écart au 2ᵉ |
| 3 | **Le bond** | `rang_avant - rang_apres >= 2` | « Xᵉ → Yᵉ » et d'où viennent les points |
| 4 | **La chute** | `rang_apres - rang_avant >= 2` | « Xᵉ → Yᵉ » et le fait qui l'explique — un fait, jamais un reproche |
| 5 | **Le finish** | `finish >= 40 %` de `points_semaine` | le sprint des deux derniers jours, comparé à celui d'un autre |
| 6 | **La série record** | `serie_record` | la série, et ce qu'elle bat |
| 7 | **Le duel au départage** | un duel gagné au `tiebreak` | le score en jours parfaits, puis l'écart aux points |
| 8 | **Défaut** | toujours vrai | le gagnant de la semaine, ses points, l'écart au 2ᵉ |

L'angle 1 est en tête parce que c'est exactement l'histoire que le classement
cache : celle où l'effort le plus visible ne se voit nulle part.

**Départage, si plusieurs joueurs remplissent le même angle** — dans cet ordre,
jusqu'à ce qu'un seul reste :

1. la plus grande amplitude (places gagnées ou perdues, part du finish,
   longueur de série) ;
2. le joueur le plus loin de la 1ʳᵉ place au général — c'est encore l'histoire
   que le classement ne raconte pas ;
3. l'ordre alphabétique du prénom. Ce dernier cran n'est pas cosmétique : sans
   lui, deux exécutions du même job pourraient élire deux protagonistes
   différents, et la garde du §9 sauterait.

Exemples produits à partir des vraies données de la semaine du 20/07 (angle 1) :

> **Léo** — a coché sept jours sur sept, seul sans-faute du groupe, et finit
> quatrième. Doren, premier, a sauté trois jours.

Et pour la semaine du 13/07 (angle 3, à confirmer sur les chiffres réels) :

> **Jordan** — était quatrième il y a une semaine, il est deuxième. 80 points
> sur les deux derniers jours, le double de Doren, un joker brûlé en route.

---

## 7. Les règles d'écriture

Elles comptent autant que le calcul. `PRODUCT.md` interdit les badges à
confettis ; une phrase générée molle, c'est la même chose en texte.

1. **Ne dire que ce que le classement ne montre pas.** « 2ᵉ avec 326 points »
   est déjà à l'écran. « Quatrième il y a une semaine » ne l'est pas.
2. **Jamais un adjectif sans un chiffre derrière.** Pas de « belle
   performance », pas de « impressionnant ». Un fait, un nombre.
3. **Deux phrases maximum**, la seconde facultative. La première parle du
   protagoniste, la seconde contraste avec un autre joueur.
4. **Du français parlé**, le ton du reste de l'app (voir `BONUS_PHRASES` dans
   `lib/feed.ts`). Pas de majuscule emphatique.
5. **Une comparaison vaut mieux qu'un superlatif** : « le double de Doren »
   plutôt que « énorme ».
6. **Pas de LLM.** Des gabarits paramétrés, choisis par condition. C'est
   déterministe, testable, et ça ne dépend d'aucun service. Un texte généré
   qu'on ne peut pas rejouer à l'identique n'a rien à faire dans un fil qui
   sert de mémoire au groupe.

La phrase s'écrit **à la suite du prénom coloré**, comme toutes les cartes du
fil : `eventPhrase()` ne renvoie jamais le prénom du porteur. Vérifier l'accord
sur les huit angles — c'est le piège de `co_lead`.

---

## 8. Ce qu'on ne fait pas

- **Pas de nouveau cron Vercel**, pas de déplacement de cron existant, et
  surtout **pas de notification supplémentaire**. C'est la raison de fond pour
  laquelle on ne passe pas par `/api/moments` : il pousse tout ce qu'il insère.
- **Pas de ligne dans le push du lundi** (tranché le 26/07). `sendWeeklyRecap()`
  envoie déjà 4 à 5 lignes par joueur, lignes de duel comprises. Une carte qu'on
  découvre en ouvrant le fil vaut mieux qu'une ligne de plus dans un message
  qu'on lit à moitié.
- **Pas de migration de données** — le seul geste sur le schéma est l'`alter`
  de contrainte du §4, et il passe par Jordan.
- **Pas d'écran bloquant** ni d'interstitielle hebdomadaire.
- **Pas de points.** Aucun angle ne doit rapporter quoi que ce soit ; sinon on
  crée une mécanique à optimiser, et le récit devient un objectif.
- **Pas de résumé du classement.** La carte raconte un fait que le classement
  ne montre pas. Si la phrase peut se déduire de l'écran de classement, l'angle
  est mauvais.
- **Ne pas toucher** à `components/LaunchS3Screen.tsx` dans cette PR. Le
  remplacement des `NOTES` par du calcul est une suite possible, à décider une
  fois le récit hebdo en place et jugé.

---

## 9. Critères d'acceptation

- [ ] `npm run build` passe.
- [ ] Testé sur l'URL de preview Vercel, **sur téléphone**.
- [ ] **Une seule carte par semaine close**, `kind = 'recit'`,
      `dedupe_key = week_monday`, `player_id` = le protagoniste du §6.
- [ ] **Rejouable — et la contrainte ne suffit pas.**
      `feed_events_player_id_kind_dedupe_key_key UNIQUE (player_id, kind,
      dedupe_key)` a été vérifiée en prod le 26/07, mais elle porte sur
      `player_id` : si un rejeu élisait un autre protagoniste, `on conflict …
      do nothing` laisserait passer **une deuxième carte pour la même
      semaine**. L'`insert` doit donc être gardé sur la semaine, pas sur le
      joueur :
      `insert … select … where not exists (select 1 from public.feed_events
      where kind = 'recit' and dedupe_key = :week_monday)`.
- [ ] **Déterministe** : deux exécutions sur la même semaine élisent le même
      protagoniste et écrivent le même `payload`. Le tester pour de vrai, en
      rejouant le job à la main : c'est ce qui rend un incident de nuit
      réparable sans réveiller personne.
- [ ] Moins de deux joueurs actifs sur la semaine : aucune carte.
- [ ] Aucun joueur inactif n'est nommé dans la phrase.
- [ ] Chaque angle a été vu au moins une fois sur des données réelles ou
      forgées, et son texte relu contre les six règles du §7.
- [ ] La carte se lit bien **juste au-dessus des cartes `duel_result` du même
      lundi**, qui tombent au même moment. Si les deux disent la même chose,
      l'angle 7 est de trop — revenir vers Jordan avant de bricoler.
- [ ] Une PR, un sujet. Si ça dépasse 4-5 fichiers, découper.

---

## 10. Le rattrapage de la S2

La S2 court du **13/07 au 26/07** (`CHALLENGE_START` = `2026-07-13`,
`SAISON3_START` = `2026-07-27`) : exactement **deux semaines closes**,
`week_monday = 2026-07-13` et `week_monday = 2026-07-20`. Donc **deux cartes**,
pas douze — c'est ce que la carte unique rend possible.

Ces deux semaines sont figées dès minuit passé dans la nuit du 26 au 27 : plus
une coche, plus un décochage. Le calcul donnera exactement le même résultat à
00h05 qu'à 15h. **Le rattrapage est donc un run one-shot du même SQL, à
n'importe quelle heure du lundi 27**, sans dépendre du `pg_cron`.

Deux points d'exécution :

1. **Insérer la plus ancienne d'abord** (13/07, puis 20/07).
   `guard_feed_event_insert()` force `created_at := now()`, et le fil trie par
   `created_at desc` : les deux cartes porteront l'horodatage du lundi, donc
   c'est l'ordre d'insertion qui décide laquelle est au-dessus. La plus récente
   doit finir en haut.
2. **Ces deux cartes atterrissent au sommet du fil le jour 1 de la S3.** C'est
   assumé : elles referment la S2 au moment où la S3 démarre. Ne pas les
   antidater — l'horodatage serveur est une garantie du fil, on ne la contourne
   pas pour une question de cosmétique.

Le `pg_cron` du §3 n'est armé **qu'après** ce rattrapage, pour la première
semaine de la S3 (`week_monday = 2026-08-03`, carte le lundi 03/08 à 00h05).

---

## 11. Décisions — tranchées le 26/07

1. **Une carte pour la semaine**, pas une par joueur. → §2, §6.
2. **Pas de ligne dans le push du lundi** : le message est déjà dense. → §8.
3. **Rétroactif sur les deux semaines de la S2**, en un run one-shot le lundi
   27/07 ; `pg_cron` armé ensuite. → §10.
4. **Le job `pg_cron` est accordé.** → §3.

**Reste un feu vert à obtenir** : l'`alter table public.feed_events` qui ajoute
`recit` à `feed_events_kind_check` (§4). L'agent le présente à Jordan, SQL
exact sous les yeux, et n'exécute rien avant sa réponse.
