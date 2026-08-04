// La carte de mi-temps en image, au format story (1080 × 1920).
//
// Pourquoi une image et pas le texte du partage : le sélecteur natif du
// téléphone accepte n'importe quoi, mais les applis derrière, non. WhatsApp
// et Messages prennent le texte ; **Instagram et Facebook l'ignorent** — une
// story, ça se poste en image. Le bloc de texte reste (c'est lui qui marche
// dans le groupe WhatsApp), l'image s'ajoute à côté.
//
// Tout est dessiné sur un canvas : aucune dépendance ajoutée, et le résultat
// ne dépend pas du téléphone qui l'affiche. Les polices, elles, viennent du
// document — on lit la pile réelle sur un élément déjà rendu plutôt que de
// nommer « Anton », que `next/font` renomme au build.

import { fmtPoints } from "./gamification";
import { MiTempsData } from "./mitemps";

const L = 1080;
const H = 1920;

/** La pile de polices réellement appliquée, lue sur le document. */
function pileDePolices(selecteur: string, secours: string): string {
  if (typeof document === "undefined") return secours;
  const el = document.querySelector(selecteur);
  if (!el) return secours;
  const f = getComputedStyle(el).fontFamily;
  return f || secours;
}

/** Découpe un texte en lignes qui tiennent dans `largeur`. */
function lignes(
  ctx: CanvasRenderingContext2D,
  texte: string,
  largeur: number,
): string[] {
  const mots = texte.split(" ");
  const out: string[] = [];
  let ligne = "";
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (ctx.measureText(essai).width > largeur && ligne) {
      out.push(ligne);
      ligne = mot;
    } else {
      ligne = essai;
    }
  }
  if (ligne) out.push(ligne);
  return out;
}

/** Une nappe de couleur, comme à l'écran : un radial doux dans un coin. */
function nappe(
  ctx: CanvasRenderingContext2D,
  couleur: string,
  x: number,
  y: number,
  rayon: number,
  alpha: number,
) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rayon);
  g.addColorStop(0, couleur);
  g.addColorStop(0.46, couleur);
  g.addColorStop(1, "transparent");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L, H);
  ctx.restore();
}

/**
 * Dessine la carte et rend un PNG.
 *
 * `couleur` est la couleur du collectif (l'or du ×2 à l'écran) et `accent`
 * celle du lecteur : les deux nappes, comme sur la carte « L'équipe ».
 * Rend `null` si le canvas n'est pas disponible — le partage retombe alors
 * sur le texte, qui n'a jamais cessé de marcher.
 */
export async function carteMiTemps(
  d: MiTempsData,
  couleur: string,
  accent: string,
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = L;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Les polices doivent être chargées AVANT le premier fillText : sinon le
  // canvas dessine avec la police de secours, sans rien signaler.
  if (document.fonts?.ready) await document.fonts.ready;
  const display = pileDePolices(".num-display", "Anton, sans-serif");
  const texte = pileDePolices("body", "system-ui, sans-serif");

  // ---- Le fond ----
  ctx.fillStyle = "#0a0a0b";
  ctx.fillRect(0, 0, L, H);
  nappe(ctx, couleur, L * 0.16, H * 0.1, L * 0.95, 0.42);
  nappe(ctx, accent, L * 0.86, H * 0.92, L * 0.9, 0.34);

  const marge = 84;
  let y = 210;

  // ---- L'en-tête ----
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `700 30px ${texte}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("MI-TEMPS", marge, y);
  ctx.letterSpacing = "0px";

  // ---- Le chiffre héros ----
  y += 235;
  ctx.fillStyle = couleur;
  ctx.font = `400 200px ${display}`;
  ctx.fillText(d.totalReps.toLocaleString("fr-FR"), marge, y);
  y += 70;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `400 42px ${texte}`;
  ctx.fillText("répétitions à nous tous", marge, y);

  // ---- La rangée de stats ----
  y += 120;
  const stats: [number, string][] = [
    [d.totalExos, "exos validés"],
    [d.joursParfaitsCollectifs, "jours parfaits"],
    [d.seances, "séances guidées"],
  ];
  const colonne = (L - marge * 2) / 3;
  stats.forEach(([v, label], i) => {
    const x = marge + i * colonne;
    ctx.fillStyle = "#f2f2f5";
    ctx.font = `400 76px ${display}`;
    ctx.fillText(v.toLocaleString("fr-FR"), x, y);
    ctx.fillStyle = "rgba(255,255,255,0.60)";
    ctx.font = `400 28px ${texte}`;
    ctx.fillText(label, x, y + 44);
  });

  // ---- Les distinctions ----
  y += 118;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(marge, y);
  ctx.lineTo(L - marge, y);
  ctx.stroke();
  y += 78;

  for (const m of d.mvps) {
    ctx.font = `400 38px ${texte}`;
    ctx.fillStyle = "#f2f2f5";
    ctx.fillText(m.emoji, marge, y);

    const xNom = marge + 66;
    ctx.font = `700 34px ${texte}`;
    ctx.fillText(m.nom, xNom, y);
    const largeurNom = ctx.measureText(`${m.nom} — `).width;

    ctx.font = `400 34px ${texte}`;
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(" — ", xNom + ctx.measureText(m.nom).width, y);

    const dispo = L - marge - (xNom + largeurNom);
    const ls = lignes(ctx, m.exploit, dispo);
    ls.forEach((l, k) => {
      ctx.fillText(l, k === 0 ? xNom + largeurNom : xNom, y + k * 43);
    });
    y += 43 * ls.length + 28;
  }

  // ---- Le podium ----
  y += 24;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(marge, y);
  ctx.lineTo(L - marge, y);
  ctx.stroke();
  y += 82;

  const medailles = ["🥇", "🥈", "🥉"];
  d.top3.forEach((p, i) => {
    ctx.font = `400 44px ${texte}`;
    ctx.fillStyle = "#f2f2f5";
    ctx.fillText(medailles[i], marge, y);
    ctx.font = `700 42px ${texte}`;
    ctx.fillText(p.name, marge + 76, y);
    ctx.font = `400 48px ${display}`;
    ctx.fillStyle = p.color || "#f2f2f5";
    const pts = `${fmtPoints(p.points)}`;
    ctx.fillText(pts, L - marge - ctx.measureText(pts).width, y);
    y += 72;
  });

  // ---- Le pied ----
  //
  // Posé sous le contenu, et pas à une hauteur fixe : le nombre de
  // distinctions varie (une par actif) et une position en dur finissait
  // par écrire par-dessus le podium. Le plancher `H - 264` garde la
  // signature au-dessus de la barre « Envoyer un message » qu'Instagram
  // pose sur les ~200 derniers pixels d'une story.
  const pied = Math.max(y + 56, H - 264);
  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.font = `700 32px ${texte}`;
  ctx.fillText(
    `${d.joursFaits} jours faits · ${d.joursRestants} restants`,
    marge,
    pied,
  );
  ctx.fillStyle = couleur;
  ctx.font = `400 46px ${display}`;
  ctx.fillText("100 · 100 · 100", marge, pied + 64);

  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png", 0.92),
  );
}
