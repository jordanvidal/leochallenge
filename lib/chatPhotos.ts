// Les octets des photos du tchat : le bucket Storage, et rien d'autre.
//
// Séparé de `lib/chat.ts` parce que ce sont deux mondes qui n'échouent
// pas de la même façon. Là-bas, on parle à Postgres et une erreur est
// une contrainte violée ; ici on parle à Storage et une erreur est un
// transfert qui n'a pas abouti. La colonne `photo_path` est le seul
// point de contact entre les deux, et elle vit du côté de la base.
//
// Même règle qu'ailleurs, en revanche : aucun composant n'appelle
// `supabase.storage` en direct. Tout passe par ce fichier.

import { supabase } from "./supabase";

/** Le bucket créé par migration44. Public en lecture, JPEG seulement,
    3 Mo par objet. */
const BUCKET = "tchat-photos";

/** Au-delà, on n'attend plus la photo. Mieux vaut un bref clignotement
    qu'un message qui a l'air de ne pas partir. */
const PRECHARGE_MS = 2500;

/**
 * Téléverse une photo et rend son chemin.
 *
 * Le chemin est `<player_id>/<uuid>.jpg`. Le préfixe par joueur n'est pas
 * de la sécurité — le bucket est public en lecture — c'est ce qui rend le
 * ménage possible le jour où quelqu'un quitte le groupe. L'uuid, lui,
 * fait le travail que la RLS ne fait pas : un chemin non devinable.
 *
 * `cacheControl` à un an : ces octets ne changeront jamais, puisqu'une
 * photo ne se réécrit pas (migration44, pas de policy UPDATE). Sans lui,
 * Storage sert un cache d'une heure et le téléphone retélécharge la même
 * image toute la semaine.
 */
export async function uploadChatPhoto(
  playerId: string,
  blob: Blob,
): Promise<{ path: string } | { error: string }> {
  const path = `${playerId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (error) return { error: error.message };
  return { path };
}

/** L'URL publique d'une photo. Purement locale : Storage la fabrique à
    partir du chemin, sans aller-retour réseau. */
export function chatPhotoUrl(path: string): string {
  // Un message encore en vol porte, à la place du chemin, l'URL locale de
  // la photo qu'on est en train de téléverser. Elle s'affiche telle
  // quelle : c'est ce qui fait qu'une photo apparaît dans la conversation
  // à l'instant où on appuie sur Envoyer, et pas trois secondes plus tard.
  if (path.startsWith("blob:")) return path;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Efface les octets d'une photo. Tire et oublie, volontairement.
 *
 * La suppression du message a déjà coupé le lien en base (le trigger vide
 * photo_path), donc plus personne dans l'app ne peut retrouver cette
 * photo. Effacer l'objet est la deuxième moitié, celle qui fait que
 * « supprimer » supprime vraiment ; mais si le réseau tombe entre les
 * deux, on ne va pas rendre à l'écran un message que son auteur croit
 * effacé. Ce qui reste alors est un objet orphelin dans un bucket, que
 * personne ne sait plus atteindre.
 */
export function removeChatPhoto(path: string): void {
  supabase.storage
    .from(BUCKET)
    .remove([path])
    .catch(() => {
      // silencieux, par construction
    });
}

/**
 * Met la photo fraîchement téléversée dans le cache du navigateur.
 *
 * Ne rejette jamais et ne bloque jamais longtemps : ce n'est pas une
 * étape de l'envoi, c'est un confort d'affichage. Un réseau lent ou une
 * image qui refuse de se charger n'ont aucune raison de retenir un
 * message déjà écrit.
 */
export function prechargerPhoto(path: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    const fini = () => resolve();
    img.onload = fini;
    img.onerror = fini;
    img.src = chatPhotoUrl(path);
    setTimeout(fini, PRECHARGE_MS);
  });
}
