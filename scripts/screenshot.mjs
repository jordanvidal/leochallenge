// Captures d'écran Playwright des écrans « gatés » de l'app (tuto, modale
// événement du jour, onglets). L'app est protégée par un mot de passe de
// groupe puis un choix de joueur : plutôt que de cliquer, on injecte
// directement les flags localStorage pour tomber sur l'écran voulu.
//
// Pré-requis (une fois) : npx playwright install chromium
// Serveur lancé à côté : npm run dev
//
// Exemples :
//   node scripts/screenshot.mjs tutorial
//   node scripts/screenshot.mjs event --event=jour_miroir
//   node scripts/screenshot.mjs app --tab=leaderboard
//
// Options :
//   --event=<clé>   événement forcé (leve_tot, quitte_ou_double, jour_miroir,
//                   happy_hour, pompes_double, boss_dimanche…) — cible « event »
//   --tab=<onglet>  onglet ouvert (today|feed|leaderboard|history|stats) — cible « app »
//   --url=<url>     base (défaut http://localhost:3000)
//   --player=<uuid> joueur à incarner (défaut : premier joueur en base)
//   --out=<dossier> dossier de sortie (défaut ./screenshots)

import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

// ---- args ----
const [, , target = "app", ...rest] = process.argv;
const opt = {};
for (const a of rest) {
  if (a.startsWith("--")) {
    const [k, ...v] = a.slice(2).split("=");
    opt[k] = v.join("=") || "true";
  }
}
const BASE = opt.url || "http://localhost:3000";
const OUT = opt.out || "screenshots";
const EVENT = opt.event || "quitte_ou_double";
const TAB = opt.tab || "today";

// ---- .env.local (pour récupérer un joueur si besoin) ----
function readEnv() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    return Object.fromEntries(
      raw
        .split("\n")
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

async function firstPlayerId() {
  if (opt.player) return opt.player;
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Pas de joueur fourni et .env.local illisible. Passe --player=<uuid>.",
    );
  }
  const res = await fetch(`${url}/rest/v1/players?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await res.json();
  if (!rows?.[0]?.id) throw new Error("Aucun joueur en base. Passe --player=<uuid>.");
  return rows[0].id;
}

// Injecté avant tout script de la page : on saute la porte, le choix du
// joueur et (selon la cible) le tuto / l'install.
function seedScript({ pid, skipTutorial }) {
  localStorage.setItem("lc100.gate", "1");
  localStorage.setItem("lc100.playerId", pid);
  sessionStorage.setItem("lc100.installLater", "1");
  if (skipTutorial) localStorage.setItem("lc100.tutorialSeen", "1");
  // Fait croire à un contexte « installé » pour éviter l'écran d'install.
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) =>
    q.includes("standalone")
      ? {
          matches: true,
          media: q,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
        }
      : mm(q);
}

async function shotTutorial(browser, pid) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.addInitScript(seedScript, { pid, skipTutorial: false });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=jusqu’au 31 août", { timeout: 8000 }).catch(() => {});
  for (let i = 1; i <= 5; i++) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/tutorial-${i}.png` });
    if (i < 5) {
      await page.mouse.click(215, 466); // zone de tap centrale
      await page.waitForTimeout(600);
    }
  }
  await ctx.close();
  console.log(`✓ tuto → ${OUT}/tutorial-1..5.png`);
}

async function shotEvent(browser, pid) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
  });
  // On force l'événement du jour renvoyé par la RPC, sans toucher la base.
  await ctx.route("**/rest/v1/rpc/get_daily_event*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(EVENT),
    }),
  );
  const page = await ctx.newPage();
  await page.addInitScript(seedScript, { pid, skipTutorial: true });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Événement du jour", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/event-${EVENT}.png` });
  await ctx.close();
  console.log(`✓ modale ${EVENT} → ${OUT}/event-${EVENT}.png`);
}

async function shotApp(browser, pid) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.addInitScript(seedScript, { pid, skipTutorial: true });
  // On mémorise l'événement du jour et l'annonce des duels comme déjà vus
  // pour ne pas ouvrir leurs modales par-dessus l'onglet visé.
  await page.addInitScript(() => {
    const d = new Date().toISOString().slice(0, 10);
    localStorage.setItem("lc100.eventSeenDay", d);
    localStorage.setItem("lc100.duelsAnnounceSeen.v2", "1");
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const tab = page.getByText(new RegExp(TAB, "i")).first();
  if (await tab.count()) {
    await tab.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${OUT}/app-${TAB}.png` });
  await ctx.close();
  console.log(`✓ app (${TAB}) → ${OUT}/app-${TAB}.png`);
}

// ---- run ----
mkdirSync(OUT, { recursive: true });
const pid = await firstPlayerId();
const browser = await chromium.launch();
try {
  if (target === "tutorial") await shotTutorial(browser, pid);
  else if (target === "event") await shotEvent(browser, pid);
  else if (target === "app") await shotApp(browser, pid);
  else {
    console.error(`Cible inconnue « ${target} ». Utilise : tutorial | event | app`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
