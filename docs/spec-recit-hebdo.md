# Spec — le récit du lundi

Pour l'agent qui implémentera. Tout ce qui suit a été vérifié dans le code et
sur la base de prod le 26/07 ; les points laissés ouverts sont marqués comme
tels et se tranchent avec Jordan.

**Aucune urgence.** À démarrer après le lancement de la S3 (27/07). Ne touche
ni au carrousel de lancement, ni à la MEP.

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

**Ce qu'on construit : une carte de fil, chaque lundi, qui dit à chacun ce que
sa semaine a eu de remarquable.** Aucun point en jeu, rien à optimiser.

---

## 2. La décision de forme, et pourquoi

**Une carte de fil. Pas un écran, pas une interstitielle.**

Le carrousel de lancement de la S3 est une exception assumée : on le voit une
fois par saison. Un écran hebdomadaire s'intercalerait entre l'ouverture et les
trois coches **un jour sur sept**, et la règle des 10 secondes de `CLAUDE.md`
est non négociable. Une carte de fil ne coûte rien au chemin critique : elle est
là si on descend, invisible sinon.

**Et on remplace la génération de texte à la main par du calcul.** Les `NOTES`
de `components/LaunchS3Screen.tsx` (indexées par prénom, écrites à la main) sont
la preuve du problème : elles sont écrites pour un podium supposé et ne
survivent pas à un autre résultat. Une ligne calculée est vraie quoi qu'il
arrive.

---

## 3. Ce qui existe déjà — à copier, pas à réinventer

**Le mécanisme complet est déjà en place pour les duels.** Ne rien inventer :

| Besoin | Où c'est déjà fait |
|---|---|
| Écrire un événement persisté, une fois par semaine, dédupliqué | `lib/server/duels.ts` → `runWeeklyDuels()`, l'`upsert` sur `feed_events` avec `onConflict: "player_id,kind,dedupe_key"` |
| Être appelé le lundi | `app/api/cron/weekly-recap/route.ts`, cron `0 8 * * 1` — **déjà existant, ne pas en ajouter** |
| Déclarer un nouveau type de carte | `lib/feed.ts` : union `FeedKind` (l. 15), `FeedPayload` (l. 30) |
| Rendre la carte | `lib/feed.ts` → `eventPhrase()` (l. 111), un `case` par kind ; prendre `duel_result` (l. 198) comme modèle |
| Ajouter une ligne au push du lundi | `runWeeklyDuels()` renvoie `lines: DuelLines`, que le récap embarque dans **sa** notification — un seul push le lundi |

**Zone interdite rappelée** (`CLAUDE.md`) : ne pas ajouter ni déplacer de cron.
Le rendez-vous du lundi existe, on s'y greffe. Une notification de plus, ça se
décide avec Jordan, pas ici.

---

## 4. Ce qu'on calcule

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

**Aucune migration.** Tout vient de `daily_points`, `entries`, `leaderboard()`
et `duel_results`. Si tu crois avoir besoin d'une table, relis ce tableau.

Est **actif** un joueur ayant au moins une coche sur la semaine (même
sémantique que l'appariement des duels, `createPairings`). Un joueur sans
aucune coche **ne reçoit pas de carte** — surtout pas une carte triste.

---

## 5. Les angles, par priorité

Un joueur, une carte, **un seul angle** : le premier qui s'applique en
descendant cette liste. L'ordre est le sujet de la spec ; c'est lui qui décide
si la carte est intéressante ou générique.

| # | Angle | Condition | Forme |
|---|---|---|---|
| 1 | **Sans-faute** | `jours_parfaits = 7` | « Sept sur sept. » + le rang que ça donne |
| 2 | **Bond** | `rang_avant - rang_apres >= 2` | « Xᵉ → Yᵉ » + d'où viennent les points |
| 3 | **Chute** | `rang_apres - rang_avant >= 2` | « Xᵉ → Yᵉ » + le fait qui l'explique |
| 4 | **Finish** | `finish >= 40 %` de `points_semaine` | le sprint des deux derniers jours, comparé à quelqu'un |
| 5 | **Série record** | `serie_record` | la série, et depuis quand |
| 6 | **Joker** | `joker_brule` | le joker consommé, et ce qu'il a sauvé |
| 7 | **Duel** | duel gagné ou perdu au départage | le score et l'écart aux points |
| 8 | **Défaut** | toujours vrai | jours parfaits + points de la semaine |

Exemples produits à partir des vraies données du 26/07 :

> **Léo** — Quatorze sur quatorze. Le seul sans-faute du groupe, et quatrième :
> la régularité ne suffit pas, il faut aussi charger.
>
> **Jordan** — Quatrième il y a une semaine. 80 points sur les deux derniers
> jours, le double de Doren, un joker brûlé en route.
>
> **Doren** — Premier du premier au dernier jour. Trois jours sans rien cocher,
> et toujours devant : meilleur jour du groupe à 64 points.

---

## 6. Les règles d'écriture

Elles comptent autant que le calcul. `PRODUCT.md` interdit les badges à
confettis ; une phrase générée molle, c'est la même chose en texte.

1. **Ne dire que ce que le classement ne montre pas.** « 2ᵉ avec 326 points »
   est déjà à l'écran. « Quatrième il y a une semaine » ne l'est pas.
2. **Jamais un adjectif sans un chiffre derrière.** Pas de « belle
   performance », pas de « impressionnant ». Un fait, un nombre.
3. **Deux phrases maximum**, la seconde facultative.
4. **Du français parlé**, le ton du reste de l'app (voir `BONUS_PHRASES` dans
   `lib/feed.ts`). Tutoiement, pas de vouvoiement, pas de majuscule
   emphatique.
5. **Une comparaison vaut mieux qu'un superlatif** : « le double de Doren »
   plutôt que « énorme ».
6. **Pas de LLM.** Des gabarits paramétrés, choisis par condition. C'est
   déterministe, testable, et ça ne dépend d'aucun service. Un texte généré
   qu'on ne peut pas rejouer à l'identique n'a rien à faire dans un fil qui
   sert de mémoire au groupe.

---

## 7. Ce qu'on ne fait pas

- **Pas de nouveau cron**, pas de déplacement de cron, pas de notification
  supplémentaire.
- **Pas de migration** — sauf si la revue montre que c'est inévitable, et alors
  ça passe par Jordan avant d'écrire une ligne.
- **Pas d'écran bloquant** ni d'interstitielle hebdomadaire.
- **Pas de points.** Aucun angle ne doit rapporter quoi que ce soit ; sinon on
  crée une mécanique à optimiser, et le récit devient un objectif.
- **Pas de classement bis.** La carte parle du joueur, pas du groupe.
- **Ne pas toucher** à `components/LaunchS3Screen.tsx` dans cette PR. Le
  remplacement des `NOTES` par du calcul est une suite possible, à décider une
  fois le récit hebdo en place et jugé.

---

## 8. Critères d'acceptation

- [ ] `npm run build` passe.
- [ ] Testé sur l'URL de preview Vercel, **sur téléphone**.
- [ ] Une carte par joueur actif, une seule par semaine, avec
      `dedupe_key = week_monday`.
- [ ] **Rejouable** : appeler deux fois le cron du lundi n'insère rien la
      seconde fois. La contrainte existe et a été vérifiée en prod le 26/07 —
      `feed_events_player_id_kind_dedupe_key_key UNIQUE (player_id, kind,
      dedupe_key)` — il reste à vérifier que l'`upsert` s'en sert bien
      (`ignoreDuplicates: true`, comme `runWeeklyDuels`).
- [ ] Un joueur sans aucune coche sur la semaine n'a pas de carte.
- [ ] Chaque angle a été vu au moins une fois sur des données réelles ou
      forgées, et son texte relu contre les six règles du §6.
- [ ] Le fil reste lisible un lundi : vérifier ce que donnent 5 ou 6 cartes
      d'affilée. Si c'est indigeste, revenir vers Jordan **avant** de bricoler.
- [ ] Une PR, un sujet. Si ça dépasse 4-5 fichiers, découper.

---

## 9. Points ouverts — à trancher avec Jordan

1. **Une carte par joueur, ou une carte pour la semaine ?** La spec part sur
   une carte par joueur, parce que `duel_result` fait déjà exactement ça et que
   personne ne s'en est plaint. L'alternative — une seule carte qui nomme deux
   ou trois joueurs — inonde moins le fil mais est moins personnelle.
2. **Une ligne dans le push du lundi ?** `runWeeklyDuels` sait déjà en ajouter
   au push existant, donc ce serait sans notification supplémentaire. À décider
   : ça allonge un message déjà dense.
3. **À partir de quelle semaine ?** Rien n'empêche de générer rétroactivement
   les semaines passées, mais ça remplirait le fil d'un coup. Proposition :
   démarrer à la première semaine close après la mise en production.
