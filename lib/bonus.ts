// Couche bonus côté client : catalogue (LA source des valeurs de
// points, lue en base), événement du jour (RPC get_daily_event),
// déclarations. Aucun montant en dur ici — tout vient du catalogue.

import { addDays, parisToday, saison3Started } from "./challenge";
import { fmtPoints } from "./gamification";
import { outbox, OutboxEntry, SendOutcome } from "./outbox";
import { supabase, SUPABASE_SCHEMA } from "./supabase";

export type BonusKind = "exercise" | "execution" | "event" | "cap";

/** Paquet d'affichage dans la feuille de déclaration : la zone que
    l'exercice travaille. Purement visuel, aucune règle de points ne s'y
    accroche. */
export type BonusFamily = "cardio" | "haut" | "abdos" | "jambes";

export type BonusCatalogItem = {
  key: string;
  kind: BonusKind;
  emoji: string;
  label: string;
  points: number;
  sort: number;
  // Échelle de volume : deux bonus qui la partagent sont le même exercice
  // à deux hauteurs (+50 pompes / +100 pompes). Ils se cumulent depuis la
  // migration 22 — cocher les deux, c'est déclarer le volume des deux.
  // null = bonus hors échelle.
  ladder: string | null;
  // Famille d'affichage (migration 31). null pour les bonus non
  // déclarables, et pour toute ligne ajoutée sans famille.
  family: BonusFamily | null;
  // Le tirage qui paie cette puce double (migration 33) : la clé d'un
  // événement du catalogue, ou null si aucun ne la double. La base lit
  // la même colonne pour payer — l'appli ne recopie pas la règle, elle
  // la lit. Optionnelle dans le type : tant que la migration n'est pas
  // appliquée, la colonne n'existe pas et rien n'est mis en avant.
  double_event?: string | null;
};

export type BonusClaim = {
  player_id: string;
  day: string;
  bonus_key: string;
  points: number;
};

export type BonusState = {
  catalog: BonusCatalogItem[];
  event: BonusCatalogItem | null; // événement du jour, null si "rien"
  todayClaims: BonusClaim[]; // tous joueurs, aujourd'hui (visibilité = anti-triche)
  weekClaims: BonusClaim[]; // 7 jours glissants, pour afficher le plafond
  // 😴 Les jours off tirés jusqu'ici, 'YYYY-MM-DD'. Un fait de calendrier :
  // la même liste pour tout le monde, pas une par joueur. Toujours vide
  // hors du challenge d'origine (les ligues sont restées au barème S3).
  //
  // Optionnelle dans le type, comme `double_event` plus haut et pour la
  // même raison : tant que la migration 46 n'est pas appliquée, la table
  // n'existe pas. Un écran qui la lit doit donc supporter son absence,
  // pas supposer un ensemble vide fourni par quelqu'un d'autre.
  joursOff?: Set<string>;
};

/** Traduit une erreur des triggers bonus en phrase humaine. */
export function humanBonusError(message: string): string {
  // Pas de chiffre en dur : les plafonds sont des lignes de catalogue et
  // s'affichent déjà en toutes lettres au-dessus de la rangée de puces.
  if (message.includes("CAP_JOUR")) return "Plafond de bonus du jour atteint 🔒";
  if (message.includes("CAP_SEMAINE"))
    return "Plafond de bonus sur 7 jours atteint 🔒";
  if (message.includes("JOUR_VERROUILLE")) return "Ce jour est verrouillé 🔒";
  if (message.includes("JOUR_FUTUR")) return "On ne déclare pas en avance";
  if (message.includes("BOSS_INACTIF")) return "Pas de boss aujourd'hui";
  if (message.includes("duplicate")) return "Déjà déclaré aujourd'hui";
  return "Écriture échouée, re-tape pour réessayer";
}

/** Les jours off tirés jusqu'ici. Séparé du reste et volontairement
    indulgent : cette lecture ne doit JAMAIS faire échouer fetchBonus.
    Le schéma des ligues n'a pas la table — la requête y part en erreur, et
    si elle comptait dans le Promise.all ci-dessous, elle emporterait le
    catalogue, l'événement du jour et la feuille de déclaration avec elle.
    Un bandeau de repos manquant est un désagrément ; une feuille de bonus
    morte sur `/l/<slug>`, c'est l'app cassée pour une autre bande. */
async function fetchJoursOff(): Promise<Set<string>> {
  if (SUPABASE_SCHEMA !== "public") return new Set();
  try {
    const { data, error } = await supabase.from("jours_off").select("day");
    if (error || !data) return new Set();
    return new Set((data as { day: string }[]).map((r) => r.day));
  } catch {
    return new Set();
  }
}

/** Charge catalogue + événement du jour + déclarations récentes + jours off. */
export async function fetchBonus(): Promise<BonusState | null> {
  const today = parisToday();
  const [cat, ev, claims, joursOff] = await Promise.all([
    supabase.from("bonus_catalog").select("*").order("sort"),
    supabase.rpc("get_daily_event"),
    supabase
      .from("bonus_claims")
      .select("player_id, day, bonus_key, points")
      .gte("day", addDays(today, -6))
      .lte("day", today),
    fetchJoursOff(),
  ]);
  if (cat.error || ev.error || claims.error) return null;

  const catalog = (cat.data as BonusCatalogItem[]).map((c) => ({
    ...c,
    points: Number(c.points),
  }));
  const eventKey = ev.data as string | null;
  const weekClaims = (claims.data as BonusClaim[]).map((c) => ({
    ...c,
    points: Number(c.points),
  }));
  return {
    catalog,
    event:
      eventKey && eventKey !== "rien"
        ? (catalog.find((c) => c.key === eventKey) ?? null)
        : null,
    todayClaims: weekClaims.filter((c) => c.day === today),
    weekClaims,
    joursOff,
  };
}

/** Le jour où la roue du tirage a été montrée. Elle s'ouvre toute seule
    une fois par jour (05/08) ; cette clé est ce qui l'empêche de revenir
    aux ouvertures suivantes. Le bandeau de l'accueil, lui, ne la lit plus :
    il reste posé jusqu'à minuit, vu ou pas. */
export const CLE_EVENEMENT_VU = "lc100.eventSeenDay";

/**
 * Le tirage multiplie-t-il les points au lieu d'en donner un montant ?
 *
 * Le « s? » n'est pas une coquetterie : la clé de la S4 est
 * `bonus_doubles`, au pluriel, parce qu'elle parle de plusieurs puces. Un
 * `endsWith("_double")` la manquait — et comme elle porte 0 point au
 * catalogue (son montant est la somme des puces du jour, pas un forfait),
 * elle retombait sur le montant et annonçait « +0 » au groupe. Ce test a
 * vécu recopié dans trois composants, juste dans deux ; il vit ici
 * maintenant, et il n'y a plus qu'un endroit où se tromper.
 */
export function estDoublement(item: BonusCatalogItem): boolean {
  return /_doubles?$/.test(item.key);
}

/** Le badge du tirage : « ×2 » quand il multiplie, « +N » quand il paie un
    forfait, rien quand il ne promet aucun montant (le jour miroir paie
    quelqu'un d'autre). Même réponse sur tous les écrans. */
export function badgeEvenement(item: BonusCatalogItem): string | null {
  if (estDoublement(item)) return "×2";
  return item.points > 0 ? `+${fmtPoints(item.points)}` : null;
}

/**
 * Ce qu'il faut faire aujourd'hui, dit en phrases.
 *
 * La première porte la règle entière : c'est la seule que montre le
 * bandeau de l'accueil, et elle est calibrée pour ses deux lignes (50 à
 * 85 caractères — en dessous elle laisse un trou, au-dessus elle se fait
 * rogner). Les suivantes ajoutent la nuance, et n'existent que dans la
 * roue, qui a l'écran pour elle.
 *
 * Un seul texte pour les deux écrans : deux copies de la même règle
 * finissent toujours par ne plus dire la même chose. Le montant, lui,
 * n'est jamais écrit ici — il est lu au catalogue, seule source de vérité.
 */
const CONSIGNES: Record<string, string[]> = {
  // Le doublement porte sur la coche ET sur les bonus de l'exo déclarés
  // dans la journée. Le dire : c'est là que se gagnent les gros points,
  // et la feuille de déclaration marque les puces concernées d'un ×2.
  pompes_double: [
    "Tes pompes comptent double : la coche, et les bonus de pompes.",
    "Le bon jour pour empiler les séries.",
  ],
  abdos_double: [
    "Tes abdos comptent double : la coche, et les bonus d'abdos.",
    "Le bon jour pour empiler les séries.",
  ],
  squats_double: [
    "Tes squats comptent double : la coche, et les bonus de squats.",
    "Le bon jour pour empiler les séries.",
  ],
  happy_hour: [
    "Termine ta séance entre 18h et 20h : c'est la fenêtre qui paie.",
    "En dehors, la séance compte toujours — le bonus, non.",
  ],
  leve_tot: [
    "Termine ta séance avant 7h du matin : le lève-tôt est récompensé.",
    "Le créneau ne repasse pas dans la journée.",
  ],
  quitte_ou_double: [
    "Boucle ton 3/3 et tes points de BASE du jour comptent double.",
    "Si tu rates, rien ne change — aucune perte.",
  ],
  jour_miroir: [
    "Le dernier du classement général reçoit un coup de pouce.",
    "Le bas de tableau a sa chance de se relancer.",
  ],
  // « 200 au total » se lisait comme 200 EN PLUS des 100 du contrat, et
  // rien ne disait que la puce « +100 pompes » restait cochable à côté.
  // Les deux se disent en deux temps : le compte, puis le cumul.
  boss_dimanche: [
    "200 pompes sur la journée, les 100 du challenge comprises.",
    "100 de plus, et c'est plié. À déclarer dans le bandeau des bonus, en bas de l'accueil — la puce « +100 pompes » se coche en plus.",
  ],
  // S4 (03/08). Le premier tirage qui ne vise aucun exo en particulier :
  // il paie la feuille entière. Dire « déclarées » est essentiel — il ne
  // double ni la coche ni le boss du dimanche, seulement les puces.
  bonus_doubles: [
    "Toutes les puces que tu déclares aujourd'hui comptent double.",
    "C'est le jour où charger rapporte vraiment.",
  ],
  // Le seul événement qui ne demande rien de plus que le contrat : aucune
  // puce à cocher, aucune heure à viser.
  jour_de_fete: [
    "Boucle ton 3/3 et c'est tout : les points tombent en plus.",
    "Rien à déclarer, aucune heure à viser.",
  ],
};

/** La consigne du tirage, phrase par phrase. Un événement inconnu du
    tableau (ajouté en base avant l'app) retombe sur son libellé : jamais
    un bandeau muet. */
export function consigneEvenement(item: BonusCatalogItem): string[] {
  return CONSIGNES[item.key] ?? [item.label];
}

/** Aujourd'hui est-il le jour off ? La question que posent les écrans. */
export function estJourOffAujourdhui(state: BonusState | null): boolean {
  return !!state?.joursOff?.has(parisToday());
}

/** Ce jour-là était-il un jour off ? Pour l'historique, qui relit le passé. */
export function estJourOff(state: BonusState | null, day: string): boolean {
  return !!state?.joursOff?.has(day);
}

/** Bonus d'exercice déclarables (le boss se déclare dans son bandeau). */
export function claimables(state: BonusState): BonusCatalogItem[] {
  return state.catalog.filter((c) => c.kind === "exercise");
}

/** Ordre et titres des paquets. Décidé ici et pas en base : c'est de la
    mise en page, et la base n'a pas à connaître le français. */
const FAMILIES: { key: BonusFamily; title: string }[] = [
  { key: "cardio", title: "Cardio" },
  { key: "haut", title: "Haut du corps" },
  { key: "abdos", title: "Abdos & gainage" },
  { key: "jambes", title: "Jambes" },
];

export type BonusGroup = { title: string | null; items: BonusCatalogItem[] };

/** Les déclarables rangés par famille. Un paquet vide ne sort pas, et les
    bonus sans famille finissent ensemble à la fin — tant que la migration
    31 n'est pas passée, ça fait exactement la liste à plat d'avant. */
export function claimableGroups(state: BonusState): BonusGroup[] {
  const items = claimables(state);
  const groups: BonusGroup[] = FAMILIES.map((f) => ({
    title: f.title,
    items: items.filter((c) => c.family === f.key),
  })).filter((g) => g.items.length > 0);

  const orphans = items.filter(
    (c) => !FAMILIES.some((f) => f.key === c.family),
  );
  // Seuls des orphelins : rien à ranger, donc pas de titre à afficher.
  if (groups.length === 0) return orphans.length ? [{ title: null, items: orphans }] : [];
  if (orphans.length) groups.push({ title: "Autres", items: orphans });
  return groups;
}

/** Les habitués du joueur : les bonus d'exercice qu'il a déclarés ces
    7 derniers jours, les plus fréquents d'abord, le plus récent en
    départage. Lu dans `weekClaims`, déjà chargé pour le plafond hebdo —
    aucune table ni requête de plus. C'est le chemin court de la feuille
    de déclaration : on re-déclare surtout ce qu'on fait chaque semaine. */
export function frequentClaimables(
  state: BonusState,
  playerId: string,
  max = 5,
): BonusCatalogItem[] {
  const byKey = new Map(claimables(state).map((c) => [c.key, c]));
  const freq = new Map<string, { n: number; last: string }>();
  for (const c of state.weekClaims) {
    if (c.player_id !== playerId || !byKey.has(c.bonus_key)) continue;
    const f = freq.get(c.bonus_key);
    if (f) {
      f.n += 1;
      if (c.day > f.last) f.last = c.day;
    } else {
      freq.set(c.bonus_key, { n: 1, last: c.day });
    }
  }
  return [...freq.entries()]
    .sort(([, a], [, b]) => b.n - a.n || (a.last < b.last ? 1 : -1))
    .slice(0, max)
    .map(([k]) => byKey.get(k)!);
}

// --- Un seul déplacement par jour -----------------------------------
// Trois puces décrivent la même chose : la distance parcourue dans la
// journée. 🏃 5 km, 🏃 10 km, 🚶 10 000 pas. Une seule peut être vraie,
// et on ne paie pas deux fois les mêmes kilomètres.
//
//   · 5 km et 10 km sont deux distances absolues, pas deux paliers qui
//     s'empilent : cocher les deux annoncerait 15 km.
//   · Un 5 km fait déjà ~5 500 pas, un 10 km ~11 000. Les jours de
//     course, la puce « 10 000 pas » n'est pas un deuxième effort,
//     c'est le reçu du premier — et elle ajouterait +4 aux 8 ou 20
//     points déjà pris.
//
// Ce qui est coché ferme les deux autres, et se décoche toujours pour
// changer d'avis. Les 10 000 pas restent entiers les jours sans course :
// c'est ce pour quoi ils ont été créés le 20/07, le filet des jours sans
// matériel.
//
// Bornée au 27/07 comme le reste du barème S3. Une règle qui arrive avec
// une saison est une règle ; la même en plein milieu est une règle contre
// quelqu'un. Ça rend aussi la branche mergeable n'importe quand : rien ne
// bouge en prod avant lundi, quelle que soit l'heure du merge.
const PAS_KEY = "pas_10000";

/** Une puce de déplacement : la marche, ou n'importe quelle distance de
    course. Le préfixe de clé est le repère — il ne dépend d'aucune
    colonne, donc il vaut avant comme après la migration 29. */
function isMovement(c: BonusCatalogItem): boolean {
  return c.key === PAS_KEY || c.key.startsWith("course_");
}

/** Le noyau de la règle : un autre déplacement déjà retenu ferme-t-il
    cette puce ? « Retenu » est volontairement plus large que « déclaré » —
    depuis que la feuille se valide d'un bloc, une puce cochée mais pas
    encore envoyée doit fermer les autres tout de suite. Sinon la règle ne
    s'appliquerait qu'entre deux ouvertures de la feuille, et cocher les
    10 km puis les 10 000 pas dans la même passe la contournerait. */
export function movementLockedBy(
  catalog: BonusCatalogItem[],
  retenues: Iterable<string>,
  item: BonusCatalogItem,
): boolean {
  if (!saison3Started() || !isMovement(item)) return false;
  const others = new Set(catalog.filter(isMovement).map((c) => c.key));
  others.delete(item.key); // décocher la sienne reste toujours possible
  for (const cle of retenues) if (others.has(cle)) return true;
  return false;
}

/** Un autre déplacement déclaré aujourd'hui ferme-t-il cette puce ? */
export function movementLocked(
  state: BonusState,
  playerId: string,
  item: BonusCatalogItem,
): boolean {
  return movementLockedBy(
    state.catalog,
    state.todayClaims
      .filter((c) => c.player_id === playerId)
      .map((c) => c.bonus_key),
    item,
  );
}

// --- Ce que le tirage du jour double --------------------------------
// « Les squats comptent double » ne double pas que la coche : depuis le
// 27/07, les puces déclarées de l'exo tiré sont payées une seconde fois.
// Encore faut-il le savoir AVANT de choisir sa puce — sinon le ×2
// récompense ceux qui avaient déjà prévu de faire des squats, et
// n'incite personne.

/** Cette puce est-elle payée double aujourd'hui ? Vrai seulement si le
    tirage du jour est celui que la puce nomme. Faux tant que la
    migration 33 n'est pas passée : la colonne est alors absente, donc
    la feuille ressemble exactement à ce qu'elle était. */
export function doubledToday(
  state: BonusState,
  item: BonusCatalogItem,
): boolean {
  return !!item.double_event && item.double_event === state.event?.key;
}

/** Ce que la puce rapporte réellement aujourd'hui. Le facteur est
    exactement 2, et c'est vérifié en base : la vue ajoute les points des
    puces doublées une seconde fois (migration 33), sans les faire passer
    par le multiplicateur de série — la série ne touche pas aux bonus.
    Afficher le montant doublé n'est donc pas une approximation. */
export function pointsToday(
  state: BonusState,
  item: BonusCatalogItem,
): number {
  return doubledToday(state, item) ? item.points * 2 : item.points;
}

/** Total réel des puces déclarées aujourd'hui par un joueur, doublement
    compris. Sans ça, le rang « Déclarer un bonus » annonce moins que ce
    que la feuille vient de promettre juste au-dessus : la puce dit +2, le
    rang dit +1, et l'écart se lit comme un bug. Les points stockés dans
    la déclaration sont ceux du catalogue — le doublement vit dans le
    calcul du score, pas dans la ligne. */
export function todayClaimPoints(
  state: BonusState,
  playerId: string,
): number {
  const byKey = new Map(state.catalog.map((c) => [c.key, c]));
  return state.todayClaims
    .filter((c) => c.player_id === playerId)
    .reduce((sum, c) => {
      const item = byKey.get(c.bonus_key);
      const x2 = !!item && doubledToday(state, item);
      return sum + (x2 ? c.points * 2 : c.points);
    }, 0);
}

/** Points de bonus d'exercice déjà déclarés par un joueur sur 7 jours. */
export function weekBonusPoints(state: BonusState, playerId: string): number {
  const exerciseKeys = new Set(
    state.catalog.filter((c) => c.kind === "exercise").map((c) => c.key),
  );
  return state.weekClaims
    .filter((c) => c.player_id === playerId && exerciseKeys.has(c.bonus_key))
    .reduce((sum, c) => sum + c.points, 0);
}

/** Déclare un bonus. Les points sont figés par la base. Le jour est celui
    du GESTE : un envoi rejoué par la file d'attente défend le jour où le
    pouce a tapé, jamais celui de la synchro — au serveur de trancher. */
export async function insertClaim(
  playerId: string,
  item: Pick<BonusCatalogItem, "key" | "points">,
  day: string = parisToday(),
): Promise<string | null> {
  const { error } = await supabase.from("bonus_claims").insert({
    player_id: playerId,
    day,
    bonus_key: item.key,
    points: item.points, // écrasé par le trigger : le client ne décide pas
  });
  return error ? error.message : null;
}

/** Annule une déclaration (erreur de pouce). Même contrat de jour. */
export async function deleteClaim(
  playerId: string,
  bonusKey: string,
  day: string = parisToday(),
): Promise<string | null> {
  const { error } = await supabase
    .from("bonus_claims")
    .delete()
    .match({ player_id: playerId, day, bonus_key: bonusKey });
  return error ? error.message : null;
}

// --- La file d'attente (lib/outbox.ts) ------------------------------
// Les déclarations sont la première écriture branchée sur l'outbox : à
// 23h sur une 4G qui ment, « noté, ça partira » vaut mieux qu'un toast
// d'échec. L'idempotence est garantie par la base — `unique (player_id,
// day, bonus_key)` (migration 3) côté insert, delete ciblé sur le même
// triplet côté retrait — donc un rejeu ne crée jamais de doublon, et un
// doublon au rejeu est un succès (l'écriture était déjà passée).

export const OUTBOX_BONUS_CLAIM = "bonus.claim";
export const OUTBOX_BONUS_UNCLAIM = "bonus.unclaim";

export type BonusOutboxPayload = {
  playerId: string;
  bonusKey: string;
  points: number;
};

/** La clé d'idempotence : le triplet de la contrainte d'unicité en base.
    Déclarer puis annuler la même puce partagent la clé — hors ligne, le
    dernier geste remplace l'autre dans la file. */
export function cleEcritureBonus(
  playerId: string,
  day: string,
  bonusKey: string,
): string {
  return `bonus:${playerId}:${day}:${bonusKey}`;
}

export function estEcritureBonus(e: OutboxEntry): boolean {
  return e.kind === OUTBOX_BONUS_CLAIM || e.kind === OUTBOX_BONUS_UNCLAIM;
}

/** Classe la réponse de la base pour la file : parti, à retenter, ou
    refusé pour de bon. Les messages des triggers sont des refus — le
    serveur a répondu, réessayer donnerait la même chose. Tout le reste
    (fetch qui casse, timeout) est un problème de réseau. */
export function issueEcritureBonus(
  err: string | null,
  sens: "insert" | "delete",
): SendOutcome {
  if (!err) return "ok";
  // Rejeu après un succès dont la réponse s'est perdue, ou deuxième
  // appareil passé devant : la ligne est en base, c'est tout ce qu'on
  // voulait. Un doublon d'unicité n'est un refus que pour un geste neuf —
  // et un geste neuf sur une puce déjà déclarée n'existe pas dans l'UI.
  if (sens === "insert" && err.includes("duplicate")) return "ok";
  const DEFINITIFS = [
    "CAP_JOUR",
    "CAP_SEMAINE",
    "JOUR_VERROUILLE",
    "JOUR_FUTUR",
    "BOSS_INACTIF",
    "BONUS_INCONNU",
    "BONUS_NON_DECLARABLE",
    "duplicate",
    "violates", // contraintes check/FK : le serveur a dit non, pas le réseau
  ];
  return DEFINITIFS.some((t) => err.includes(t)) ? { refus: err } : "retry";
}

/** Rejoue la file sur l'état lu en base : les déclarations en attente
    restent visibles après un re-fetch. Sans ça, revenir au premier plan
    hors ligne ferait DISPARAÎTRE un bonus pourtant « noté » — le mensonge
    exact que la file existe pour éviter. */
export function appliquerFileBonus(
  state: BonusState,
  entries: OutboxEntry[],
): BonusState {
  const attente = entries.filter(estEcritureBonus);
  if (attente.length === 0) return state;
  const today = parisToday();
  let todayClaims = [...state.todayClaims];
  let weekClaims = [...state.weekClaims];
  const meme = (c: BonusClaim, p: BonusOutboxPayload, day: string) =>
    c.player_id === p.playerId && c.day === day && c.bonus_key === p.bonusKey;
  for (const e of attente) {
    const p = e.payload as BonusOutboxPayload;
    if (e.kind === OUTBOX_BONUS_UNCLAIM) {
      todayClaims = todayClaims.filter((c) => !meme(c, p, e.day));
      weekClaims = weekClaims.filter((c) => !meme(c, p, e.day));
    } else {
      const claim: BonusClaim = {
        player_id: p.playerId,
        day: e.day,
        bonus_key: p.bonusKey,
        points: p.points,
      };
      if (!weekClaims.some((c) => meme(c, p, e.day))) weekClaims.push(claim);
      if (e.day === today && !todayClaims.some((c) => meme(c, p, e.day)))
        todayClaims.push(claim);
    }
  }
  return { ...state, todayClaims, weekClaims };
}

/** Apprend à la file à envoyer les bonus. Appelé au chargement du hook
    qui écrit (useBonus) : dès que déclarer est possible, rejouer l'est. */
export function enregistrerExpediteursBonus(): void {
  outbox.register(OUTBOX_BONUS_CLAIM, async (payload, entry) => {
    const p = payload as BonusOutboxPayload;
    const err = await insertClaim(
      p.playerId,
      { key: p.bonusKey, points: p.points },
      entry.day,
    );
    return issueEcritureBonus(err, "insert");
  });
  outbox.register(OUTBOX_BONUS_UNCLAIM, async (payload, entry) => {
    const p = payload as BonusOutboxPayload;
    const err = await deleteClaim(p.playerId, p.bonusKey, entry.day);
    return issueEcritureBonus(err, "delete");
  });
}
