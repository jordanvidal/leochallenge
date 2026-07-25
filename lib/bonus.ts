// Couche bonus côté client : catalogue (LA source des valeurs de
// points, lue en base), événement du jour (RPC get_daily_event),
// déclarations. Aucun montant en dur ici — tout vient du catalogue.

import { addDays, parisToday } from "./challenge";
import { supabase } from "./supabase";

export type BonusKind = "exercise" | "execution" | "event" | "cap";

/** Paquet d'affichage dans la feuille de déclaration. Purement visuel :
    aucune règle de points ne s'y accroche. */
export type BonusFamily = "contrat" | "cardio" | "renfo";

export type BonusCatalogItem = {
  key: string;
  kind: BonusKind;
  emoji: string;
  label: string;
  points: number;
  sort: number;
  // Échelle de volume : deux bonus qui la partagent sont le même exercice
  // à deux hauteurs (+50 pompes / +100 pompes). Ils se cumulent depuis la
  // migration 22. null = bonus hors échelle.
  ladder: string | null;
  // Famille d'affichage (migration 31). null pour les bonus non
  // déclarables, et pour toute ligne ajoutée sans famille.
  family: BonusFamily | null;
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
  { key: "contrat", title: "Le contrat, en plus" },
  { key: "cardio", title: "Cardio" },
  { key: "renfo", title: "Renfo & gainage" },
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
