// Couche bonus côté client : catalogue (LA source des valeurs de
// points, lue en base), événement du jour (RPC get_daily_event),
// déclarations. Aucun montant en dur ici — tout vient du catalogue.

import { addDays, parisToday, saison3Started } from "./challenge";
import { supabase } from "./supabase";

export type BonusKind = "exercise" | "execution" | "event" | "cap";

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

// --- Exclusion marche / course -------------------------------------
// On ne paie pas deux fois les mêmes kilomètres. Un 5 km, c'est déjà
// ~5 500 pas ; un 10 km, ~11 000 — sur une journée de course, la puce
// « 10 000 pas » n'est pas un deuxième effort, c'est le reçu du premier,
// et elle ajoute +4 aux 8 ou 20 points déjà pris. Les deux ne se
// déclarent donc pas le même jour, dans les deux sens : ce qui est
// coché ferme l'autre camp, et se décoche toujours pour changer d'avis.
// La puce reste entière les jours sans course — c'est ce pour quoi elle
// a été créée le 20/07, le filet des jours sans matériel.
//
// Bornée au 27/07 comme le reste du barème S3. Une règle qui arrive avec
// une saison est une règle ; la même en plein milieu est une règle contre
// quelqu'un. Ça rend aussi la branche mergeable n'importe quand : rien ne
// bouge en prod avant lundi, quelle que soit l'heure du merge.
const PAS_KEY = "pas_10000";

/** Une puce de l'échelle course. Le préfixe de clé double l'échelle :
    avant la migration 29, course_5km est encore ladder null en base. */
function isCourse(c: BonusCatalogItem): boolean {
  return c.ladder === "course" || c.key.startsWith("course_");
}

/** Les puces de l'autre camp. Vide si l'item n'est pas concerné. */
function otherCamp(
  item: BonusCatalogItem,
  catalog: BonusCatalogItem[],
): BonusCatalogItem[] {
  if (item.key === PAS_KEY) return catalog.filter(isCourse);
  if (isCourse(item)) return catalog.filter((c) => c.key === PAS_KEY);
  return [];
}

/** Une déclaration du jour ferme-t-elle cette puce ? */
export function walkRunLocked(
  state: BonusState,
  playerId: string,
  item: BonusCatalogItem,
): boolean {
  if (!saison3Started()) return false;
  const keys = new Set(otherCamp(item, state.catalog).map((c) => c.key));
  if (keys.size === 0) return false;
  return state.todayClaims.some(
    (c) => c.player_id === playerId && keys.has(c.bonus_key),
  );
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
