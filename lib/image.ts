// Prépare une image côté client avant de l'envoyer : deux usages, deux
// destinations, une seule règle commune — le téléphone fait le travail, et
// ce qui part sur le réseau est déjà à la bonne taille.
//
//  · la photo de profil (fileToAvatarDataUri) — recadrée carré, réduite à
//    192px, encodée en data-URI, stockée directement dans players.photo ;
//  · la photo du tchat (fileToChatPhoto) — proportions gardées, réduite à
//    1600px, rendue en Blob à téléverser dans le bucket `tchat-photos`.
//
// JPEG et pas WebP dans les deux cas : l'encodage canvas WebP n'est pas
// garanti sur Safari iOS, notre cible n°1. Le passage par canvas a un
// deuxième effet, gratuit et précieux : il transforme en JPEG le HEIC que
// crache un iPhone par défaut, format que la moitié des navigateurs ne sait
// pas afficher.

const AVATAR_SIZE = 192;
const QUALITY = 0.82;

/** Le côté long d'une photo de tchat. Assez pour remplir un écran de
    téléphone en retina (390pt × 3 = 1170px) avec de la marge, et assez peu
    pour qu'un JPEG q0.78 tienne autour de 200–350 Ko. */
const PHOTO_MAX = 1600;
const PHOTO_QUALITY = 0.78;

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

/** Une photo prête à partir : les octets, et les dimensions FINALES —
    celles qu'il faut mettre en base pour que la bulle réserve sa place
    avant que l'image n'arrive. */
export type PhotoPrete = { blob: Blob; w: number; h: number };

/**
 * Réduit une photo à PHOTO_MAX sur son côté long, en gardant ses
 * proportions, et rend un Blob JPEG. Renvoie null si le fichier n'est pas
 * une image lisible.
 *
 * Proportions gardées, contrairement à l'avatar : un avatar est un rond
 * dans une liste, une photo de séance est ce que quelqu'un a voulu
 * montrer. La recadrer d'autorité, c'est décider à sa place ce qui est
 * dans le cadre.
 *
 * Une image déjà plus petite que la borne n'est jamais agrandie — on ne
 * fabrique pas des pixels, on n'y gagnerait que du poids et du flou.
 * Elle repasse quand même par le canvas : c'est ce qui garantit du JPEG
 * en sortie, quel que soit le format d'entrée.
 */
export async function fileToChatPhoto(file: File): Promise<PhotoPrete | null> {
  if (!file.type.startsWith("image/")) return null;

  let bitmap: ImageBitmap;
  try {
    // imageOrientation: on respecte l'EXIF (photo prise en portrait au tel).
    // Sans ça, la moitié des photos d'iPhone partent couchées.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }

  const ratio = Math.min(
    1,
    PHOTO_MAX / Math.max(bitmap.width, bitmap.height),
  );
  // Math.round et jamais Math.floor : sur une image d'un seul pixel de
  // haut, floor donnerait 0, et la contrainte SQL (photo_h > 0) refuserait
  // le message après un téléversement déjà payé.
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY);
  });
  return blob ? { blob, w, h } : null;
}
