// Génère les icônes PWA en PNG, sans aucune dépendance (zlib natif).
// Design : fond sombre, trois barres arrondies vertes — les 3 exos du jour.
// Usage : node scripts/make-icons.mjs

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [21, 21, 21]; // fond de l'icône
const BAR = [61, 214, 140]; // vert validation

/** Distance d'un point à un segment à bouts ronds. */
function segmentDist(px, py, ax, ay, bx, by, radius) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.min(
    Math.max(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0),
    1,
  );
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.sqrt(dx * dx + dy * dy) - radius;
}

/** Rasterise l'icône : une coche massive, le geste central de l'app.
    Tracé dans la safe zone maskable (80% centraux). */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const r = size * 0.075; // épaisseur du trait
  // deux segments : descente courte + remontée longue
  const segs = [
    [0.28, 0.52, 0.44, 0.68],
    [0.44, 0.68, 0.74, 0.34],
  ].map((s) => s.map((v) => v * size));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dist = Infinity;
      for (const [ax, ay, bx, by] of segs) {
        dist = Math.min(dist, segmentDist(x + 0.5, y + 0.5, ax, ay, bx, by, r));
      }
      // antialiasing sur 1.5px
      const t = Math.min(Math.max(0.5 - dist / 1.5, 0), 1);
      const i = (y * size + x) * 4;
      px[i] = BG[0] + (BAR[0] - BG[0]) * t;
      px[i + 1] = BG[1] + (BAR[1] - BG[1]) * t;
      px[i + 2] = BG[2] + (BAR[2] - BG[2]) * t;
      px[i + 3] = 255;
    }
  }
  return px;
}

// ---- Encodeur PNG minimal (couleur RGBA 8 bits, filtre 0) ----

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits par canal
  ihdr[9] = 6; // RGBA
  // scanlines : un octet de filtre (0) devant chaque ligne
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(
      raw,
      y * (size * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public/icons", { recursive: true });
for (const [size, path] of [
  [192, "public/icons/icon-192.png"],
  [512, "public/icons/icon-512.png"],
  [512, "app/icon.png"], // favicon générée par Next
  [180, "app/apple-icon.png"], // apple-touch-icon, lien ajouté par Next
]) {
  writeFileSync(path, encodePNG(drawIcon(size), size));
  console.log(`✓ ${path} (${size}×${size})`);
}
