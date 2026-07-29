"use client";

// La ligue courante : celle dont cet appareil a mémorisé le slug.
//
// Il n'y a pas de sélecteur de ligue, et c'est voulu (voir la checklist) :
// changer de ligue, c'est retaper le lien reçu. Cet appareil n'en connaît donc
// qu'une à la fois, gardée en localStorage comme l'est déjà le joueur choisi.
//
// Tout ce module est inerte quand `MULTI_LIGUES` est faux : sur le schéma
// `public`, la table `leagues` n'existe pas, et l'app est celle d'aujourd'hui.

import { useCallback, useEffect, useState } from "react";
import { parisToday } from "@/lib/challenge";
import { finDeLigue, slugifie, type Ligue } from "@/lib/ligue";
import { nextColor } from "@/lib/palette";
import { MULTI_LIGUES, supabase } from "@/lib/supabase";
import type { Player } from "@/lib/types";

const LIGUE_KEY = "lc100.ligue"; // localStorage : le slug de la ligue courante

/** Les colonnes de `app.leagues`, nommées une fois pour toutes. */
const COLONNES =
  "id, slug, name, invite_code, start_day, end_day, creator_player_id, parent_league_id, created_at";

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

/**
 * Trois issues bien distinctes, parce qu'elles n'appellent pas la même phrase à
 * l'écran : la ligue existe, elle n'existe pas (lien périmé, faute de frappe),
 * ou on n'a pas pu demander (réseau). Confondre les deux dernières, c'est
 * annoncer « cette ligue n'existe plus » à quelqu'un qui est juste dans le
 * métro.
 */
export type Trouvaille =
  | { statut: "trouvee"; ligue: Ligue }
  | { statut: "inconnue" }
  | { statut: "injoignable" };

async function cherche(colonne: "slug" | "invite_code", valeur: string): Promise<Trouvaille> {
  if (!MULTI_LIGUES) return { statut: "inconnue" };
  const { data, error } = await supabase
    .from("leagues")
    .select(COLONNES)
    .eq(colonne, valeur)
    .maybeSingle();
  if (error) return { statut: "injoignable" };
  return data ? { statut: "trouvee", ligue: data as Ligue } : { statut: "inconnue" };
}

/** La ligue derrière un `/l/<slug>`. */
export function chercheParSlug(slug: string): Promise<Trouvaille> {
  return cherche("slug", slug.toLowerCase());
}

/** La ligue derrière un code tapé au clavier. `normaliseCode` d'abord. */
export function chercheParCode(code: string): Promise<Trouvaille> {
  return cherche("invite_code", code);
}

// ---------------------------------------------------------------------------
// Créer une ligue
// ---------------------------------------------------------------------------

export type ResultatCreation =
  | { statut: "creee"; ligue: Ligue }
  | { statut: "duree-refusee" }
  | { statut: "erreur"; message: string };

/**
 * Crée la ligue et rend la ligne complète — dont son `invite_code`, généré par
 * la base et jamais par le client : c'est `app.code_court(6)` qui fait foi.
 *
 * Le slug vient du nom. Deux ligues peuvent très bien s'appeler « Les potes » :
 * on suffixe jusqu'à trouver libre, plutôt que de renvoyer le créateur à son
 * clavier pour un détail d'URL dont il n'a rien à faire.
 */
export async function creeLigue(
  nom: string,
  debut: string,
  semaines: number,
): Promise<ResultatCreation> {
  const propre = nom.trim();
  if (propre === "") return { statut: "erreur", message: "Il faut un nom." };

  let fin: string;
  try {
    fin = finDeLigue(debut, semaines);
  } catch {
    return { statut: "duree-refusee" };
  }

  const racine = slugifie(propre) || "ligue";
  // 12 essais : au-delà, ce n'est plus une collision, c'est un problème.
  for (let essai = 0; essai < 12; essai++) {
    const slug = essai === 0 ? racine : `${racine}-${essai + 1}`;
    const { data, error } = await supabase
      .from("leagues")
      .insert({ slug, name: propre, start_day: debut, end_day: fin })
      .select(COLONNES)
      .single();
    if (!error) return { statut: "creee", ligue: data as Ligue };
    // 23505 = violation d'unicité. Sur le slug, on retente ; sinon on s'arrête.
    if (error.code !== "23505") {
      if (error.message.includes("DUREE_INVALIDE")) return { statut: "duree-refusee" };
      return { statut: "erreur", message: "Création impossible, réessaie." };
    }
  }
  return { statut: "erreur", message: "Ce nom est déjà très pris, change-le." };
}

// ---------------------------------------------------------------------------
// Entrer dans une ligue
// ---------------------------------------------------------------------------

export type ResultatEntree =
  | { statut: "entre"; joueur: Player & { recovery_code: string } }
  | { statut: "prenom-pris" }
  | { statut: "complet" }
  | { statut: "erreur"; message: string };

/**
 * Ajoute un joueur à la ligue et rend la ligne créée, **code de récupération
 * compris** : c'est le seul moment où il est montré, et il ne ramène que dans
 * cette ligue-là.
 *
 * Le prénom est unique par ligue (index sur `(league_id, …)`), pas globalement :
 * « Léo » peut jouer dans deux ligues à la fois.
 */
export async function entreDansLigue(
  ligue: Ligue,
  prenom: string,
  joueursExistants: number,
): Promise<ResultatEntree> {
  const propre = prenom.trim();
  if (propre === "") return { statut: "erreur", message: "Il faut un prénom." };

  const { data, error } = await supabase
    .from("players")
    .insert({
      league_id: ligue.id,
      name: propre,
      color: nextColor(joueursExistants),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return { statut: "prenom-pris" };
    if (error.message.includes("CAP_JOUEURS")) return { statut: "complet" };
    return { statut: "erreur", message: "Entrée impossible, réessaie." };
  }
  return { statut: "entre", joueur: data as Player & { recovery_code: string } };
}

/** Le premier entré devient le créateur — celui qui pourra régler les dates. */
export async function marqueCreateur(ligue: Ligue, joueurId: string): Promise<void> {
  if (ligue.creator_player_id) return;
  await supabase
    .from("leagues")
    .update({ creator_player_id: joueurId })
    .eq("id", ligue.id)
    .is("creator_player_id", null); // course entre deux premiers : le plus rapide gagne
}

// ---------------------------------------------------------------------------
// La ligue mémorisée par cet appareil
// ---------------------------------------------------------------------------

export type EtatLigue =
  | { etat: "chargement" }
  | { etat: "aucune" } // rien de mémorisé : il faut un lien ou une création
  | { etat: "introuvable"; slug: string }
  | { etat: "injoignable" }
  | { etat: "prete"; ligue: Ligue | null }; // null = groupe unique (schéma `public`)

/** Le slug retenu par cet appareil, s'il y en a un. */
export function slugMemorise(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LIGUE_KEY);
}

/** Retenir une ligue. C'est ce que fait `/l/<slug>` en arrivant. */
export function memoriseSlug(slug: string): void {
  localStorage.setItem(LIGUE_KEY, slug.toLowerCase());
}

/** Oublier la ligue courante — sans toucher au joueur choisi ni aux données. */
export function oublieSlug(): void {
  localStorage.removeItem(LIGUE_KEY);
}

/**
 * Charge la ligue mémorisée. Rend toujours `prete` avec `ligue: null` quand
 * l'app tourne en groupe unique : les écrans n'ont alors rien de spécial à
 * faire, ils prennent la fenêtre des variables d'env comme aujourd'hui.
 */
export function useLigue(slugUrl?: string | null) {
  const [etat, setEtat] = useState<EtatLigue>(() =>
    MULTI_LIGUES ? { etat: "chargement" } : { etat: "prete", ligue: null },
  );

  const charge = useCallback(async () => {
    if (!MULTI_LIGUES) return;
    // L'URL prime sur la mémoire : arriver par `/l/<slug>`, c'est justement
    // dire « celle-là, maintenant ». C'est aussi la seule façon de changer de
    // ligue, faute de sélecteur.
    const slug = slugUrl ?? slugMemorise();
    if (!slug) {
      setEtat({ etat: "aucune" });
      return;
    }
    setEtat({ etat: "chargement" });
    const t = await chercheParSlug(slug);
    if (t.statut === "trouvee") {
      // On ne retient qu'une ligue qui existe : un lien mort ne doit pas
      // remplacer celle qui marchait hier.
      memoriseSlug(t.ligue.slug);
      setEtat({ etat: "prete", ligue: t.ligue });
    } else if (t.statut === "injoignable") setEtat({ etat: "injoignable" });
    else setEtat({ etat: "introuvable", slug });
  }, [slugUrl]);

  useEffect(() => {
    charge();
  }, [charge]);

  /** Après une création ou une entrée : on retient et on affiche, sans relire. */
  const installe = useCallback((ligue: Ligue) => {
    memoriseSlug(ligue.slug);
    setEtat({ etat: "prete", ligue });
  }, []);

  const quitte = useCallback(() => {
    oublieSlug();
    setEtat({ etat: "aucune" });
  }, []);

  return { ...etat, recharge: charge, installe, quitte };
}

/** Aujourd'hui, pour proposer une date de début par défaut à la création. */
export function debutParDefaut(): string {
  return parisToday();
}
