// Les octets des notes vocales : le bucket Storage, et rien d'autre.
//
// Même partage qu'entre `lib/chat.ts` et `lib/chatPhotos.ts`, pour la
// même raison : ici une erreur est un transfert qui n'a pas abouti, pas
// une contrainte violée. La colonne `audio_path` est le seul point de
// contact avec la base.
//
// Et même règle qu'ailleurs : aucun composant n'appelle
// `supabase.storage` en direct, tout passe par ce fichier.

import { supabase } from "./supabase";

/** Le bucket créé par migration45. Public en lecture, mp4 ou webm,
    2 Mo par objet. */
const BUCKET = "tchat-vocaux";

/**
 * Téléverse un vocal et rend son chemin.
 *
 * `<player_id>/<uuid>.<ext>`, comme les photos : le préfixe par joueur
 * rend le ménage possible le jour où quelqu'un quitte le groupe, l'uuid
 * fait le travail que la RLS ne fait pas (un chemin non devinable).
 *
 * L'extension suit le format réellement encodé, et le `contentType`
 * avec : le bucket n'accepte que ces deux types-là, et un navigateur qui
 * reçoit un mp4 annoncé en webm refuse de le lire.
 *
 * `cacheControl` à un an : ces octets ne changeront jamais, puisqu'un
 * vocal ne se réenregistre pas (migration45, pas de policy UPDATE).
 */
export async function uploadChatVocal(
  playerId: string,
  blob: Blob,
  mime: string,
  ext: string,
): Promise<{ path: string } | { error: string }> {
  const path = `${playerId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: mime,
    cacheControl: "31536000",
  });
  if (error) return { error: error.message };
  return { path };
}

/** L'URL publique d'un vocal. Purement locale : Storage la fabrique à
    partir du chemin, sans aller-retour réseau. */
export function chatVocalUrl(path: string): string {
  // Un message encore en vol porte, à la place du chemin, l'URL locale
  // du blob qu'on est en train de téléverser. Elle s'affiche telle
  // quelle : le vocal est écoutable à l'instant où on appuie sur
  // Envoyer, et pas trois secondes plus tard.
  if (path.startsWith("blob:")) return path;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Efface les octets d'un vocal. Tire et oublie, volontairement — même
 * politique que `removeChatPhoto`.
 *
 * La suppression du message a déjà coupé le lien en base (le trigger
 * vide `audio_path`), donc plus personne dans l'app ne peut retrouver ce
 * vocal. Effacer l'objet est la deuxième moitié, celle qui fait que
 * « supprimer » supprime vraiment ; mais si le réseau tombe entre les
 * deux, on ne va pas rendre à l'écran un message que son auteur croit
 * effacé. Ce qui reste alors est un objet orphelin dans un bucket, que
 * personne ne sait plus atteindre.
 */
export function removeChatVocal(path: string): void {
  supabase.storage
    .from(BUCKET)
    .remove([path])
    .catch(() => {
      // silencieux, par construction
    });
}
