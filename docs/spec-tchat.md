# Spec — le tchat

Pour l'agent qui implémentera. Tout ce qui suit a été vérifié dans le code le
28/07 : références de fichiers, de lignes et de contraintes SQL incluses.

**Les six décisions structurantes ont été tranchées par Jordan le 28/07** —
voir §15. Il reste **trois feux verts à demander**, tous listés au §15.

Ce document décrit une feature qui **contredit `PRODUCT.md`**. C'est assumé et
c'est le sujet du §2. Le fichier `PRODUCT.md` devra être amendé dans la même PR
que la migration, sinon le prochain agent qui le lit refusera la feature à juste
titre.

---

## 1. L'intention, et le pari

L'app raconte déjà bien : le fil dit qui a coché, qui a pris la tête, qui a
brûlé son joker. Ce qu'elle ne sait pas faire, c'est **héberger la réaction**.
Aujourd'hui la vanne part sur WhatsApp, dix minutes après, sans le contexte.
L'app fabrique la matière sociale et la donne à une autre app.

**Ce qu'on construit : un salon de discussion, un écran à lui, en temps réel,
où le groupe parle.**

Le pari est explicite parce qu'il est risqué. Un salon de discussion à six ne
se juge pas sur sa qualité technique, il se juge sur les **cinq premiers
jours**. S'il n'a pas pris à la fin de la première semaine, il ne prendra pas :
il restera un onglet avec trois messages du jour de la sortie, c'est-à-dire
pire que rien, parce qu'un salon vide dit au groupe que le groupe est mort.

Trois conséquences, qui structurent toute la spec :

1. Le salon doit avoir de la **matière dès le jour 1**, sans que personne n'ait
   à décider d'ouvrir une conversation (§9).
2. Il doit **notifier** — un salon silencieux ne se découvre jamais (§7).
3. Il ne doit **jamais** croiser le chemin des 10 secondes (§3).

---

## 2. La position : le tchat contre WhatsApp

`PRODUCT.md` dit aujourd'hui :

> L'app alimente le groupe WhatsApp existant (partage texte façon Wordle), elle
> ne le concurrence pas.

**Cette phrase est retirée.** La position tranchée le 28/07 est l'inverse :
pendant les sept semaines du challenge, on cherche à ce que la conversation du
groupe **se déplace dans l'app**.

Ce qu'il faut regarder en face avant d'écrire une ligne de code :

| Ce que WhatsApp a | Ce qu'on peut opposer |
|---|---|
| Ouvert 30 fois par jour, déjà installé, notifications fiables | Une PWA ouverte 1 à 2 fois par jour, notifications iOS installées seulement si la PWA est sur l'écran d'accueil |
| Les photos, les vocaux, les GIF | Rien de tout ça en v1 (§11) |
| Tout le monde y est déjà | Six personnes, dont certaines n'ont peut-être pas accepté les notifications |
| Aucun contexte : « t'as fait tes pompes ? » | **Le contexte est natif** : le score, la série, le duel, le classement sont dans la même app |

La seule colonne qui penche de notre côté est la dernière, et c'est donc la
seule sur laquelle on construit. Le tchat ne gagne pas parce qu'il est un
meilleur messager. Il gagne, s'il gagne, parce qu'**on y parle de quelque chose
qui n'est visible que là**.

D'où la mécanique d'amorçage du §9, qui n'est pas un bonus mais la feature
elle-même.

**Le repli est prévu et il n'est pas honteux.** Si au bout de trois semaines le
salon compte moins de 5 messages par jour ouvré, on ne le laisse pas pourrir :
on retire l'onglet et on garde la table. Le critère de sortie est écrit ici pour
qu'il ne se discute pas dans six semaines à chaud.

---

## 3. La forme : un salon, hors du chemin critique

**Un écran dédié, avec sa saisie collée en bas, en temps réel.** Pas de fusion
avec le fil : le fil est factuel et se relit, le salon est bavard et se
consomme. Les mélanger donnerait un fil où l'histoire de la semaine se noie sous
les « mdr ».

**La règle des 10 secondes est intacte et elle prime.** Le tchat est une
destination, jamais une interception :

- Aucune interstitielle, aucune modale, aucun écran de bienvenue.
- L'onglet ouvert au lancement de l'app reste `today` (ou `bilan`), toujours.
- La pastille de non-lus est le **seul** élément de tchat qui touche les autres
  écrans, et elle vit sur l'onglet, comme celle du fil (`components/TabBar.tsx`
  l. 139).
- Le tchat **ne se charge pas** tant qu'on n'est pas allé dessus. Le hook prend
  un `enabled` comme `useFeed(enabled, …)` (`hooks/useFeed.ts` l. 41). Ouvrir
  l'app pour cocher ne doit coûter aucune requête de tchat.

La seule exception : la pastille a besoin d'un compteur, donc d'un chiffre. Ce
chiffre vient d'une requête **de comptage seule** (`head: true`, `count:
'exact'`), pas d'un chargement de messages, et elle part en parallèle du reste.

---

## 4. La navigation : Historique et Stats fusionnent

`components/TabBar.tsx` l. 4 : « Cinq onglets, c'est le maximum absolu : au
sixième, on fusionne. » On fusionne.

**Avant** : Aujourd'hui · Feed · Classement · Historique · Stats
**Après** : Aujourd'hui · Feed · **Tchat** · Classement · Stats

`Historique` disparaît en tant qu'onglet. La grille passe **dans l'écran Stats**.
C'est la fusion la plus naturelle des cinq : les deux écrans regardent le passé,
et aucun des deux n'est sur le chemin d'une coche.

**En bas de l'écran, pas en tête.** La grille fait 50 lignes de 44 px, soit le
bloc le plus haut de toute l'app. En tête, elle enterrerait la carte de profil
sous 2 500 px de tableau, alors que `StatsScreen` est « le profil, pas un
tableau de bord » (l. 3 du fichier). L'ordre est donc : ma carte, les autres,
le bouton de partage, **puis** la grille sous son propre titre. On y va, elle ne
s'impose pas.

Points d'attention :

- Le type `Tab` (`components/TabBar.tsx` l. 7) **perd** sa valeur `history`.
  La garder laisserait `setTab("history")` compiler et rendre un écran vide ;
  la retirer force le compilateur à désigner chaque appel à corriger. Il y en a
  un : `onGoHistory` de `BilanScreen`, qui pointe désormais sur `stats`.
- L'écran fusionné doit rester lisible sur iPhone SE. Si `StatsScreen` +
  `HistoryScreen` empilés dépassent la limite des 500 lignes par fichier, la
  grille reste dans son composant et `StatsScreen` la compose.
- Le tchat prend la **place centrale** (3ᵉ sur 5). Le pouce y arrive sans
  effort, et un salon qu'on veut voir vivre ne se met pas dans un coin.
- Nouvelle icône : une bulle. Le jeu d'icônes du fichier est fait de traits de
  1,7 à 2,2 px, `stroke-linecap="round"`, sur une grille 24. La bulle suit,
  sinon elle jure entre le trophée et l'histogramme.

**Cette fusion est une PR à elle seule** (§13). Elle ne dépend pas du tchat et
peut partir avant.

---

## 5. Le modèle de données

Nouvelle migration : `supabase/migration41-tchat.sql`.

> **Numérotation, à vérifier au moment de brancher.** Les PR multi-ligues en
> cours (#56, #60) posent les migrations 36, 37, 38 et 40. Sur `main` le dernier
> fichier est `migration35-classement-rapide.sql`. Prendre 41 laisse la place ;
> si les PR en vol ont bougé, décaler et ne jamais réutiliser un numéro.

### 5.1 Les messages

```sql
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  body text not null,
  -- réponse citée : le message visé. `set null` et pas `cascade` : la
  -- suppression d'un message ne doit jamais emporter les réponses qu'il a
  -- provoquées, elles portent la moitié de la conversation.
  reply_to uuid references public.chat_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chat_body_500 check (char_length(body) <= 500),
  constraint chat_body_non_vide check (char_length(trim(body)) >= 1)
);

create index chat_messages_created_idx on public.chat_messages (created_at desc);
```

**500 caractères, pas 140.** Les 140 de `feed_comments` sont un choix de forme :
une pique sous un moment. Un salon qui vise WhatsApp a besoin de la place d'un
paragraphe. 500 reste une borne : au-delà, c'est un mail.

**`created_at` vient du serveur**, comme partout. Même garde que
`guard_feed_event_insert()` (`supabase/migration5-feed.sql` l. 37) : un trigger
`before insert` qui écrase `new.created_at := now()` et force `deleted_at` à
null.

### 5.2 La suppression

Le fil ne s'efface pas (« Pas de policy DELETE : l'histoire ne s'efface pas »,
migration 5 l. 91). **Le tchat, si.** Ce n'est pas la même matière : un fil est
une mémoire, une conversation est un présent, et un message parti chez la
mauvaise personne doit pouvoir disparaître.

Suppression **douce**, par son auteur, sans limite de temps :

- `deleted_at` passe de null à `now()`, et `body` est remplacé par la chaîne
  vide au même instant, dans le trigger. On n'archive pas le texte : « supprimé
  mais toujours lisible en base » est un mensonge.
- La bulle reste, en gris, « Message supprimé ». La place vide serait pire :
  les réponses citées deviendraient incompréhensibles.
- Un message supprimé ne se dé-supprime pas.

Le garde d'`update` n'autorise **que** cette transition (modèle :
`guard_feed_event_update()`, migration 5 l. 58, qui lève `FEED_FIGE`) :

```
si (deleted_at ancien is null et deleted_at nouveau is not null
    et body nouveau = '' et player_id/created_at/reply_to inchangés) → ok
sinon → raise exception 'CHAT_FIGE: un message ne se réécrit pas'
```

**Pas d'édition.** Un message édité dans un groupe de six, c'est une dispute sur
ce qui a été dit. Supprimer et réécrire suffit, et c'est honnête.

### 5.3 Les réactions

```sql
create table public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '🔥', '💪', '😂', '💀')),
  created_at timestamptz not null default now(),
  unique (message_id, player_id, emoji)
);

create index chat_reactions_message_idx on public.chat_reactions (message_id);
```

**La même liste de cinq emojis que le fil**, reprise de `REACTION_EMOJIS`
(`lib/feed.ts` l. 13) et de la contrainte `feed_reactions.emoji`. Deux
vocabulaires d'emojis dans la même app seraient une incohérence gratuite. Un
sélecteur complet est refusé : c'est un menu de plus dans un geste qui doit
coûter un tap.

Policies : `select`, `insert`, `delete`. Pas d'`update` — un retap enlève,
exactement comme `feed_reactions` (migration 5 l. 239).

### 5.4 La lecture et la présence

```sql
create table public.chat_reads (
  player_id uuid primary key references public.players (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  -- battement de présence : mis à jour tant que l'écran est ouvert et visible.
  last_seen_at timestamptz not null default now()
);
```

Deux colonnes, deux usages distincts, et c'est la table la plus importante de
la spec :

- **`last_read_at` porte la pastille**, et il est en base et non en
  `localStorage` (le fil, lui, garde son compteur en local :
  `hooks/useFeed.ts` l. 22). Raison : un tchat se lit sur le téléphone puis se
  rouvre sur le même téléphone après une purge iOS de la PWA, et une pastille
  qui ressuscite 40 messages déjà lus est le premier pas vers la désinstallation.
- **`last_seen_at` protège des notifications** (§7). Quelqu'un qui a l'écran
  ouvert sous les yeux n'a pas besoin qu'on le prévienne.

Le battement de présence part **toutes les 30 secondes**, uniquement quand
l'écran du tchat est monté **et** `document.visibilityState === "visible"`, et
il s'arrête à la fermeture de l'onglet. Six joueurs × 2 écritures/minute est
négligeable ; un battement qui continue en arrière-plan ne l'est pas, il
rendrait le joueur éternellement « présent » et couperait toutes ses notifs.

### 5.5 Les préférences de notification

```sql
create table public.chat_prefs (
  player_id uuid primary key references public.players (id) on delete cascade,
  notify text not null default 'tous' check (notify in ('tous', 'mentions', 'aucune')),
  updated_at timestamptz not null default now()
);
```

Une ligne absente vaut `'tous'`. Voir §7 pour ce que chaque valeur fait, et
pourquoi le réglage est obligatoire dès la v1.

### 5.6 RLS

Même politique que tout le reste de l'app : **RLS activée, policies ouvertes à
`anon`**. L'app n'a pas d'auth Supabase, l'identité vit côté client
(`hooks/useIdentity.ts`) et la porte est le mot de passe de groupe. Ce n'est pas
un modèle à durcir ici : le durcir pour le seul tchat créerait une incohérence
sans rien protéger.

En revanche, **toutes les fonctions de garde sont révoquées de l'API RPC**,
comme aux lignes 293-299 de la migration 5. C'est le durcissement qui compte
vraiment dans ce schéma.

---

## 6. Le temps réel

`supabase/migration12-realtime.sql` donne le motif exact, idempotent :

```sql
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception
  when duplicate_object then null;
end $$;
```

Trois tables à publier : `chat_messages`, `chat_reactions`, et **pas**
`chat_reads` (un battement toutes les 30 s × 6 joueurs diffusé à tout le monde,
c'est du bruit pur pour un affichage qu'on n'a même pas décidé de faire).

Côté client :

- Un seul canal, abonné aux `INSERT` et `UPDATE` de `chat_messages` et aux
  `INSERT`/`DELETE` de `chat_reactions`.
- **Abonnement seulement quand l'écran est ouvert.** À la sortie de l'onglet, on
  se désabonne. Une PWA qui garde un WebSocket ouvert en fond mange la batterie
  pour rien, et le compteur de la pastille n'en a pas besoin (§3).
- **Le realtime ne remplace pas le rechargement.** Au retour de visibilité, on
  refetch la dernière page, comme `useFeed` le fait déjà (`hooks/useFeed.ts`
  l. 80). Un WebSocket qui a dormi pendant que le téléphone était verrouillé a
  perdu des messages, toujours.
- **Déduplication par `id`** à l'arrivée : le message qu'on vient d'envoyer
  arrive aussi par le canal, et il ne doit pas s'afficher deux fois. L'optimiste
  porte un id temporaire `tmp-…` remplacé par la ligne serveur.

---

## 7. Les notifications : le pacte se renégocie

C'est la partie la plus délicate de la spec, parce que c'est celle qui peut
faire désinstaller l'app.

**Décision : chaque message notifie.** Pas de throttle 15 minutes comme
`/api/feed-notify`. Un salon qui prévient un quart d'heure plus tard n'est pas
un salon, c'est une boîte aux lettres, et il perd contre WhatsApp le premier
jour.

Cette décision n'est tenable que si les quatre gardes suivantes sont **toutes**
implémentées. Ce ne sont pas des optimisations, ce sont les conditions.

### Garde 1 — le `tag` du service worker

`public/sw.js` l. 171 pose `tag: "lc100"` en dur, avec le commentaire « une
seule notif visible à la fois, pas d'empilement ». C'est déjà le bon
comportement pour un tchat : dix messages n'empilent pas dix notifications, ils
en remplacent une.

Mais le tag est **partagé avec tout le reste** : une vanne à 22h effacerait le
rappel « ta série est en jeu » qui vient de tomber. Il faut donc :

- que le payload push porte un `tag` facultatif, avec `"lc100"` en repli
  (aucune notification existante ne change de comportement) ;
- que le tchat envoie `tag: "lc100-chat"` ;
- que `notificationclick` (l. 177) ouvre **le tchat** et pas la racine, via un
  `url` dans le payload et un `postMessage` au client déjà ouvert.

Sans ce point, « chaque message notifie » est un bug de sécurité produit : la
seule notification qui compte vraiment dans cette app (la série en jeu) devient
effaçable par un « lol ».

### Garde 2 — ne pas notifier qui est en train de lire

Le serveur exclut tout joueur dont `chat_reads.last_seen_at` a moins de
**90 secondes** (trois battements de 30 s, donc une marge d'un battement perdu).
Sans cette garde, six personnes qui discutent en direct reçoivent une
notification par message qu'elles voient déjà à l'écran.

### Garde 3 — le réglage, obligatoire en v1

`chat_prefs.notify` : `tous` (défaut), `mentions`, `aucune`.

- `mentions` : ne notifie que si le corps contient `@prénom` du joueur.
- `aucune` : ne notifie jamais. La pastille continue de compter.

Le réglage est accessible **depuis le tchat lui-même** (une icône dans
l'en-tête), pas enterré dans un écran de réglages qui n'existe pas. Un mute
qu'on ne trouve pas ne sert à rien, et celui qui veut couper le bruit le veut à
l'instant où le bruit le dérange.

### Garde 4 — l'agrégation du texte

La notification ne dit pas seulement le dernier message. S'il y a plusieurs
messages non lus depuis `last_read_at`, le corps le dit :

- 1 message : `Jordan : « on se cale à 22h ? »`
- 2 et plus : `3 nouveaux messages · Jordan : « on se cale à 22h ? »`

Titre : `💬 Le tchat`. Court, et il ne ment pas sur ce qui attend.

### La route

`app/api/chat-notify/route.ts`, `POST`, **avec le header `x-group-pass`** et
`isAuthorizedApp(request)` en première ligne, exactement comme
`app/api/feed-notify/route.ts` l. 25. Cette vérification est une zone interdite
de `CLAUDE.md` : elle ne se retire ni ne se contourne.

Appel côté client en « tire et oublie », sans attendre la réponse et sans
casser l'envoi si elle échoue — modèle `notifyFeedActivity()` (`lib/feed.ts`
l. 472). Une notification est un bonus, pas un contrat.

**Aucun cron ajouté, aucun cron déplacé.** `vercel.json` et `app/api/cron/` ne
sont pas touchés.

### Les heures de nuit

Volontairement, **aucune plage silencieuse**. L'usage type de cette app est
23h dans un lit : une plage de nuit couperait précisément le moment où le groupe
parle. Le réglage du §7.3 est la réponse, et elle est individuelle.

---

## 8. L'écran

### Structure

De haut en bas : en-tête (titre + accès au réglage), liste des messages
(scroll), barre de saisie collée en bas, TabBar.

**Des bulles, pas des cartes.** `PRODUCT.md` range les cartes grises du côté du
dashboard SaaS, et une conversation en cartes empilées est illisible.

- **Mes messages** : alignés à droite, fond `--pc` (ma couleur), texte sombre
  `oklch(0.15 0 0)`. C'est la convention du bouton primaire de l'app
  (`components/feed/Interactions.tsx` l. 218), elle est déjà comprise.
- **Les autres** : alignés à gauche, fond `--color-surface`, prénom en gras à
  la couleur du joueur au-dessus de la bulle. La couleur, c'est les joueurs :
  principe 2 de `PRODUCT.md`, et c'est ce qui rend le salon lisible en diagonale.
- **Groupement** : messages consécutifs du même auteur à moins de 5 minutes
  d'écart, le prénom n'apparaît qu'une fois, les bulles se resserrent (gap 2px
  au lieu de 8px) et seule la dernière porte l'heure.
- **Séparateurs de jour** : « Aujourd'hui », « Hier », « samedi 12 juillet ».
  `dayLabel()` existe déjà et fait exactement ça (`lib/feed.ts` l. 381).
- **L'heure** : `timeOf()` (`lib/feed.ts` l. 376), en `--color-faint`, discrète.

### La saisie

- `<textarea>` à une ligne qui grandit jusqu'à 4 lignes puis scrolle.
  `font-size: 16px` minimum : en dessous, iOS zoome au focus et casse la mise
  en page, définitivement.
- Bouton d'envoi rond, 44px, à la couleur du joueur, désactivé sur brouillon
  vide. Même dessin que la flèche de `Interactions.tsx` l. 220.
- `Enter` envoie sur clavier physique ; sur mobile, `Enter` fait un retour à la
  ligne et c'est le bouton qui envoie. Ne pas se tromper : envoyer sur `Enter`
  au clavier iOS rend impossible d'écrire deux lignes.
- Compteur de caractères à partir de 440 (comme le fil le fait à 110/140).

### Le clavier iOS, en PWA

C'est le piège numéro un de cette feature, et il ne se voit qu'sur un vrai
iPhone en mode installé. À l'ouverture du clavier, iOS ne redimensionne pas la
fenêtre : la barre de saisie part sous le clavier.

La réponse : `visualViewport`. On écoute `resize` et `scroll` de
`window.visualViewport`, et on translate le conteneur de la hauteur masquée
(`window.innerHeight - visualViewport.height - visualViewport.offsetTop`). La
TabBar se masque pendant la saisie : 5 onglets sous un clavier ouvert ne servent
à personne et volent 56px à la conversation.

Ce point est **un critère d'acceptation à part entière** (§14). Il ne se valide
pas au simulateur.

### Le scroll

- À l'ouverture : ancré **en bas**, sans animation. On arrive sur le dernier
  message, pas sur un scroll qui défile.
- Nouveau message reçu alors qu'on est en bas : la liste suit, en douceur.
- Nouveau message reçu alors qu'on a remonté : la liste **ne bouge pas**, et
  une pastille « ↓ 2 nouveaux » apparaît en bas. Voler le scroll de quelqu'un
  qui lit est la faute la plus agaçante d'un tchat.
- Pagination : 50 messages par page (comme `FEED_PAGE_SIZE`), « voir plus » en
  haut. Pas de scroll infini vers le haut : sur iOS il fait sauter la position.

### Les gestes

- **Tap long sur une bulle** → les 5 emojis + « Répondre » + « Supprimer » (mes
  messages seulement). 450 ms, avec `navigator.vibrate?.(12)` : c'est le timing
  et le retour déjà en place dans `ReactionPill` (`Interactions.tsx` l. 62).
- **Glissé vers la droite sur une bulle** → répondre. Le geste WhatsApp, connu
  de tout le monde, gratuit à apprendre.
- **Réponse citée** : au-dessus de la saisie, un bandeau avec le prénom coloré
  et le début du message, plus une croix. Dans le fil, la bulle porte le message
  cité en tête, en petit, sur un fond plus sombre ; un tap dessus scrolle
  jusqu'à l'original.

### Les états

| État | Ce qu'on montre |
|---|---|
| Chargement | Squelettes de bulles (classe `.skeleton`, `globals.css` l. 489), largeurs alternées, jamais un spinner |
| Vide | §9 |
| Envoi en cours | La bulle est là, à 60 % d'opacité, sans heure. Optimiste, comme partout |
| Envoi échoué | La bulle passe en `--color-danger` avec « Renvoyer ». Rollback visible + toast : principe 5 de `PRODUCT.md` |
| Hors ligne | Bandeau discret « Pas de réseau, ton message part dès que ça revient ». La saisie reste active |
| Message supprimé | Bulle grise, italique, « Message supprimé » |

### Le mouvement

- Un message qui arrive : `.rise-in` (260 ms, `globals.css` l. 113), déjà défini
  et déjà neutralisé sous `prefers-reduced-motion`.
- Une réaction qui apparaît : rien. Elle se pose, c'est tout.
- **Pas d'indicateur de saisie** (« Jordan écrit… »). Voir §11.

---

## 9. L'amorçage : les cinq premiers jours

Le tchat vide est le seul vrai risque de cette feature. La réponse tient en une
décision, et elle a un coût.

### Le rebond depuis le fil

Chaque carte du fil gagne une action **« En parler »**. Un tap ouvre le tchat
avec la carte citée dans la saisie : « Léo a brûlé son joker, sa série de 12
jours tient ». On écrit sa vanne, elle part dans le salon, attachée à un fait.

C'est le mécanisme entier du §2 rendu concret : la seule chose que le tchat a
que WhatsApp n'a pas, c'est le contexte, alors le contexte est le point
d'entrée. Personne n'a jamais à « démarrer une conversation » — geste que
personne ne fait jamais dans un groupe de six.

Techniquement : le message porte `payload.feed_event_id`, la bulle affiche la
phrase de la carte via `eventPhrase()` en tête, exactement comme une réponse
citée. Ça n'ajoute pas de table, seulement une colonne nullable
`feed_event_id uuid references public.feed_events (id) on delete set null`.

### Le chemin retour (ajouté le 29/07)

La citation ramène au fil : un tap dessus rouvre l'onglet Feed, amène la carte
au centre de l'écran et l'entoure d'un anneau qui s'efface. Un chevron sur la
citation prévient qu'on va changer d'écran — le seul moyen de le savoir avant
d'appuyer, la citation d'un message se contentant, elle, de remonter la
conversation.

C'est le pendant d'« En parler », et il ne s'invente rien : la citation dit de
quoi on parle, elle ne dit pas ce qui s'est passé autour. Les réactions du
groupe, les moments d'avant et d'après, le bilan de la semaine sont dans le fil,
et sans ce tap il faut les retrouver à la main.

Le moment cité peut être plus vieux que la page chargée. Le fil remonte alors
jusqu'à quatre pages de plus (250 événements, une dizaine de jours de vie du
groupe), puis renonce en le disant : « Ce moment est trop loin dans le fil ».
Une roue qui tourne sans fin serait pire que l'aveu.

### La conséquence, à valider

**Les commentaires du fil ferment.** L'action « Commenter » de
`components/feed/Interactions.tsx` (l. 147-238) est remplacée par « En parler ».
Les commentaires existants restent affichés, en lecture seule. Aucune donnée
n'est supprimée, aucune policy n'est retirée : on cesse simplement d'en écrire.

Sans ça, on obtient exactement le pire scénario du §1 : **deux endroits à moitié
vides**. La vanne se répartit entre les commentaires du fil et le salon, aucun
des deux n'atteint la masse critique, et les deux meurent.

C'est le **feu vert n°2** du §15. Si Jordan refuse, le repli est de garder les
deux, et il faut alors accepter que le salon démarre plus lentement.

### L'état vide

Il ne dit pas « aucun message ». Il montre le geste :

> **Personne n'a encore parlé.**
> Le fil raconte ce qui se passe. Ici, on en parle.
> [Voir le fil]

Le bouton renvoie au fil, là où se trouve l'action « En parler ». Un état vide
qui apprend l'interface, pas qui constate le vide.

---

## 10. Les règles d'écriture

Peu de copy dans cette feature, mais elle est visible.

1. **Le placeholder de la saisie ne fait pas d'humour.** « Écrire un message »,
   point. Le fil se permet « Une pique, un bravo… » parce qu'il cadre un geste
   inhabituel ; ici le geste est évident, et une blague relue 400 fois devient
   une blague nulle.
2. **Aucun libellé n'invente de vocabulaire.** « Répondre », « Supprimer »,
   « Réagir », « Notifications ». Un tchat est le lieu où la familiarité est une
   qualité, pas un manque d'ambition.
3. **Les libellés de boutons disent ce qui va se passer** : « Supprimer le
   message », pas « OK ».
4. **Les erreurs disent la vérité et proposent le geste** : « Message non
   envoyé. Renvoyer ». Jamais « Une erreur est survenue ».
5. **Le français parlé du reste de l'app**, sans majuscule emphatique et sans
   point d'exclamation.

---

## 11. Ce qu'on ne fait pas

- **Pas de photos, pas de vocaux, pas de fichiers.** Décision du 28/07. C'est le
  manque le plus visible face à WhatsApp et c'est assumé pour la v1 : Storage,
  RLS de bucket, compression client, miniatures et états d'upload doublent le
  périmètre. À rouvrir **seulement** si le salon a pris (§2, critère de sortie).
- **Pas d'indicateur de saisie.** À six, « Jordan écrit… » est une pression
  sociale gratuite, un canal realtime supplémentaire ouvert en permanence, et un
  scintillement dans un écran qu'on regarde à 23h.
- **Pas d'accusés de lecture.** Savoir qui a lu et n'a pas répondu est le
  meilleur moyen de transformer un groupe de potes en reproche silencieux. La
  pression sociale de cette app porte sur les coches, pas sur les réponses.
- **Pas de fils de discussion imbriqués.** La réponse citée suffit à six.
- **Pas d'édition de message** (§5.2).
- **Pas de LLM, pas de résumé automatique, pas de bot.** Un message dans ce
  salon a toujours un humain derrière.
- **Pas de cron**, pas de modification de `vercel.json` ni de `app/api/cron/`.
- **Pas de suppression du fil ni de ses données.** Le fil garde son rôle : il
  raconte, il ne discute plus (§9).
- **Pas de mention `@tous`.** Six personnes, tout le monde est déjà notifié par
  défaut ; `@tous` ne servirait qu'à contourner le mute de quelqu'un.

---

## 12. Multi-ligues : ce qu'on prépare sans le construire

Les PR #56, #60 et #62 sont en train de rendre l'app multi-ligues (schéma `app`,
table `app.leagues`, fenêtre de dates injectée). Un tchat est évidemment
**par ligue** : deux groupes ne partagent pas un salon.

On ne construit pas ça maintenant, mais on ne se ferme pas la porte :

- `chat_messages` vit dans `public`, comme tout le reste de l'app aujourd'hui.
  Ne pas la poser dans `app` : le schéma `app` n'est pas encore mergé, et une
  table qui référence `app.leagues` ne s'applique pas sur `main`.
- Quand `app.leagues` arrive, la migration d'adaptation est une colonne
  `league_id` nullable + un backfill sur la ligue historique + un index
  `(league_id, created_at desc)`. C'est mécanique, à condition que **toutes les
  requêtes de tchat passent par `lib/chat.ts`** et jamais par un appel Supabase
  écrit en ligne dans un composant. C'est déjà la convention (`lib/feed.ts`),
  elle devient ici une condition de survie.
- Idem pour `chat_reads` et `chat_prefs`, qui deviendront des clés composites
  `(player_id, league_id)`.

Cette section n'ajoute **aucun travail** à la PR. Elle interdit seulement de
raccourcir la couche d'accès.

---

## 13. Le découpage en PR

`CLAUDE.md` : une PR, un sujet ; 4-5 fichiers maximum. Cette feature en fait
trois, dans cet ordre.

| PR | Sujet | Fichiers | Dépend de |
|---|---|---|---|
| **A** | La fusion Historique → Stats, libère le 5ᵉ slot | `TabBar.tsx`, `StatsScreen.tsx`, `HistoryScreen.tsx`, `App.tsx` | rien |
| **B** | Le socle : migration, `lib/chat.ts`, `hooks/useChat.ts` | `migration41-tchat.sql`, `lib/chat.ts`, `hooks/useChat.ts`, `lib/types.ts` | feu vert n°1 |
| **C** | L'écran, la route de notification, le `tag` du SW | `components/chat/ChatScreen.tsx`, `components/chat/Bubble.tsx`, `app/api/chat-notify/route.ts`, `public/sw.js`, `App.tsx` | A et B |
| **D** | Le rebond « En parler » depuis le fil | `Interactions.tsx`, `FeedItem.tsx`, `lib/chat.ts` | C, feu vert n°2 |

La PR B ne se merge pas sans la C (une table sans écran ne sert à rien), mais
elle se **relit** séparément, et c'est ce qui compte : le SQL mérite une lecture
qui ne soit pas noyée dans 600 lignes de composant.

`PRODUCT.md` est amendé dans la **PR B** (la phrase du §2 et le principe 4).

---

## 14. Critères d'acceptation

- [ ] `npm run build` passe.
- [ ] Les tests passent (`npm test`). Le pur métier de `lib/chat.ts` (groupement
      des bulles, découpage par jour, détection de `@prénom`) est testé dans
      `tests/tchat.test.ts` — c'est de la logique pure, elle rentre dans le
      périmètre de `vitest.config.ts`.
- [ ] **Testé sur l'URL de preview Vercel, sur un vrai iPhone, en mode
      installé.** Non négociable pour cette feature : le clavier, le
      `visualViewport` et les notifications ne se testent nulle part ailleurs.
- [ ] Le clavier ouvert ne masque **jamais** la barre de saisie, ni en portrait
      ni après rotation.
- [ ] Deux téléphones côte à côte : un message part de l'un et apparaît sur
      l'autre en moins de 2 secondes, sans rechargement.
- [ ] Le téléphone qui a l'écran ouvert **ne reçoit pas** de notification
      (garde 2 du §7).
- [ ] Le téléphone en veille en reçoit une, et **une seule visible** après trois
      messages d'affilée, avec le compte dans le corps (gardes 1 et 4).
- [ ] Une notification de tchat **n'efface pas** un rappel de série arrivé juste
      avant (tags distincts).
- [ ] Le réglage `aucune` coupe vraiment les notifications, et la pastille
      continue de compter.
- [ ] Un tap sur la notification ouvre l'app **sur le tchat**.
- [ ] La pastille survit à une purge du stockage local (état en base).
- [ ] Un message envoyé hors ligne affiche l'erreur et « Renvoyer » fonctionne.
- [ ] Un message supprimé par son auteur devient « Message supprimé » chez les
      autres en temps réel, et les réponses qui le citaient restent lisibles.
- [ ] Toute autre transition d'`update` sur `chat_messages` lève `CHAT_FIGE`
      (le tester à la main en SQL).
- [ ] Les fonctions de garde ne sont pas appelables via RPC (`revoke execute`).
- [ ] `POST /api/chat-notify` sans `x-group-pass` renvoie 401.
- [ ] `prefers-reduced-motion` : rien ne bouge, tout reste lisible.
- [x] **Contraste des bulles « moi » : mesuré, pas estimé.** Texte
      `oklch(0.15 0 0)` sur chacune des 8 couleurs de `lib/palette.ts`, calcul
      OKLCH → sRGB → luminance relative → ratio WCAG :

      | couleur | ratio | | couleur | ratio |
      |---|---|---|---|---|
      | corail | 7,04 | | cyan | 11,08 |
      | ambre | 9,50 | | bleu | 7,34 |
      | jaune | 12,96 | | violet | **6,88** |
      | vert | 9,11 | | rose | 7,58 |

      Le pire cas est le violet à 6,88:1, soit une marge de 53 % sur le seuil
      de 4,5. Le repli en fond teinté envisagé ici n'a pas lieu d'être, et le
      motif accent déjà en place (`BigButton`, bouton d'envoi du fil) est donc
      repris tel quel.
- [ ] Ouvrir l'app et cocher trois exos ne déclenche **aucune requête de
      tchat** hors le comptage de la pastille (à vérifier dans l'onglet réseau).
- [ ] Aucun fichier ne dépasse 500 lignes.

---

## 15. Décisions et feux verts

### Tranché par Jordan le 28/07

1. **Le tchat vise à ramener la conversation du groupe dans l'app**, WhatsApp
   compris. `PRODUCT.md` est amendé. → §2
2. **Un salon séparé**, écran dédié, temps réel. Pas de fusion avec le fil. → §3
3. **Historique et Stats fusionnent** pour libérer le 5ᵉ onglet. → §4
4. **Texte, réactions et réponses citées.** Pas de photos en v1. → §11
5. **Chaque message notifie**, avec mute par joueur obligatoire. → §7
6. **Livraison complète** : spec, SQL, écran, notifications, tests. → §13

### Feux verts — accordés par Jordan le 28/07

1. **La migration `migration41-tchat.sql` est accordée, écriture et
   application comprises.** `supabase/*.sql` reste une zone interdite pour tout
   le reste : cet accord porte sur cette migration-ci, purement additive
   (quatre tables neuves, aucune table existante modifiée, aucune donnée
   touchée).
2. **La fermeture des commentaires du fil est accordée** (§9). « Commenter »
   devient « En parler ». Les commentaires existants restent lisibles, aucune
   ligne n'est supprimée, aucune policy n'est retirée : on cesse d'écrire, on
   n'efface rien.
3. **La modification de `public/sw.js` est accordée** pour le `tag` par famille
   de notification (§7, garde 1). Le service worker porte tout le hors-ligne de
   l'app ; le repli `"lc100"` est obligatoire pour qu'aucune notification
   existante ne change de comportement.

### Le critère de sortie, écrit à froid

Trois semaines après la mise en production : **moins de 5 messages par jour
ouvré en moyenne** sur les 7 derniers jours, l'onglet est retiré. La table
reste, les messages restent lisibles, on ne détruit rien. Un salon mort dans la
barre de navigation coûte plus cher au produit que l'absence de salon.
