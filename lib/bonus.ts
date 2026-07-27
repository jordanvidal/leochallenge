// Couche bonus côté client : catalogue (LA source des valeurs de
// points, lue en base), événement du jour (RPC get_daily_event),
// déclarations. Aucun montant en dur ici — tout vient du catalogue.

import { addDays, parisToday, saison3Started } from "./challenge";
import { supabase } from "./supabase";

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

/** Charge catalogue + événement du jour + déclarations récentes. */
export async function fetchBonus(): Promise<BonusState | null> {
  const today = parisToday();
  const [cat, ev, claims] = await Promise.all([
    supabase.from("bonus_catalog").select("*").order("sort"),
    supabase.rpc("get_daily_event"),
    supabase
      .from("bonus_claims")
      .select("player_id, day, bonus_key, points")
      .gte("day", addDays(today, -6))
      .lte("day", today),
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
  };
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

/** Un autre déplacement déclaré aujourd'hui ferme-t-il cette puce ? */
export function movementLocked(
  state: BonusState,
  playerId: string,
  item: BonusCatalogItem,
): boolean {
  if (!saison3Started() || !isMovement(item)) return false;
  const others = new Set(
    state.catalog.filter(isMovement).map((c) => c.key),
  );
  others.delete(item.key); // décocher la sienne reste toujours possible
  return state.todayClaims.some(
    (c) => c.player_id === playerId && others.has(c.bonus_key),
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

/** Points de bonus d'exercice déjà déclarés par un joueur sur 7 jours. */
export function weekBonusPoints(state: BonusState, playerId: string): number {
  const exerciseKeys = new Set(
    state.catalog.filter((c) => c.kind === "exercise").map((c) => c.key),
  );
  return state.weekClaims
    .filter((c) => c.player_id === playerId && exerciseKeys.has(c.bonus_key))
    .reduce((sum, c) => sum + c.points, 0);
}

/** Déclare un bonus pour aujourd'hui. Les points sont figés par la base. */
export async function insertClaim(
  playerId: string,
  item: BonusCatalogItem,
): Promise<string | null> {
  const { error } = await supabase.from("bonus_claims").insert({
    player_id: playerId,
    day: parisToday(),
    bonus_key: item.key,
    points: item.points, // écrasé par le trigger : le client ne décide pas
  });
  return error ? error.message : null;
}

/** Annule une déclaration du jour (erreur de pouce). */
export async function deleteClaim(
  playerId: string,
  bonusKey: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("bonus_claims")
    .delete()
    .match({ player_id: playerId, day: parisToday(), bonus_key: bonusKey });
  return error ? error.message : null;
}
