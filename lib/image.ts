// Prépare une photo de profil avant de la stocker en base : recadrage carré
// « cover », réduction à une petite taille, encodage data-URI. On garde tout
// côté client — la colonne players.photo reçoit directement le data-URI.
//
// JPEG et pas WebP : l'encodage canvas WebP n'est pas garanti sur Safari iOS,
// notre cible n°1. 192px couvre les avatars retina (le plus grand rendu fait
// 76px). Un avatar 192px JPEG q0.82 pèse ~8–15 Ko en base64, loin du plafond
// de la contrainte SQL.

const AVATAR_SIZE = 192;
const QUALITY = 0.82;

/**
 * Recadre au carré (centré), réduit à AVATAR_SIZE, renvoie un data-URI JPEG.
 * Renvoie null si le fichier n'est pas une image lisible.
 */
export async function fileToAvatarDataUri(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;

  let bitmap: ImageBitmap;
  try {
    // imageOrientation: on respecte l'EXIF (photo prise en portrait au tel).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return null;
  }

  // « cover » : remplir le carré, rogner le débord, centré.
  const scale = Math.max(
    AVATAR_SIZE / bitmap.width,
    AVATAR_SIZE / bitmap.height,
  );
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (AVATAR_SIZE - w) / 2, (AVATAR_SIZE - h) / 2, w, h);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", QUALITY);
}
