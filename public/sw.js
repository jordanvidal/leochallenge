// Service worker : lecture hors ligne du dernier état connu.
// - Navigation : réseau d'abord, cache en secours, page « hors ligne » en
//   dernier recours — jamais rien.
// - Statiques Next (/_next/static) : cache d'abord (fichiers hashés, immuables).
// - Lectures Supabase (GET) : réseau d'abord, dernier état en secours.
// Les écritures (POST/PATCH) ne passent jamais par le cache.
//
// Le cache du shell porte la version du build, passée en `?v=` à
// l'enregistrement (voir components/ServiceWorker.tsx). Deux raisons :
//
// 1. Le nom était fixe (« lc-shell-v1 »), donc `activate` ne supprimait
//    jamais rien : il ne balaie que les caches dont le nom diffère du
//    courant, et le nom ne changeait pas. Le cache accumulait les chunks
//    de tous les déploiements depuis le début, sans limite.
// 2. Surtout : le HTML de `/` mis en cache pouvait dater d'un build
//    précédent et réclamer des chunks absents du cache (iOS purge le
//    stockage d'une PWA ouverte une fois par jour sans prévenir). Le shell
//    de cette app est vide — tout est client — donc un chunk qui ne charge
//    pas, c'est littéralement un écran blanc.
//
// Avec la version dans le nom, shell et chunks vivent dans le même cache
// et y sont écrits pendant la même visite : ils sont cohérents entre eux
// par construction. Un déploiement crée un cache neuf, `activate` efface
// les anciens.
//
// Le cache des données n'est PAS versionné : son contenu ne dépend pas du
// build, et le purger à chaque déploiement priverait le groupe de son
// dernier état connu hors ligne pour rien.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL_CACHE = `lc-shell-${VERSION}`;
const DATA_CACHE = "lc-data-v1";

// Dernier recours d'une navigation : mieux vaut trois lignes lisibles
// qu'un écran blanc muet dont on ne sait pas s'il charge ou s'il est mort.
const OFFLINE_HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>100 · 100 · 100</title>
<style>
  html,body{margin:0;height:100%;background:#0a0a0b;color:#8a8a90;
    font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
  main{height:100%;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:1rem;padding:2rem;text-align:center}
  p{margin:0}
  b{color:#ededf0;font-size:1.125rem}
  button{min-height:44px;padding:0 1.5rem;border:0;border-radius:12px;
    background:#1c1c20;color:#ededf0;font-size:1rem;font-weight:700}
</style></head>
<body><main>
  <b>Pas de réseau</b>
  <p>L'app n'a pas pu se charger. Rien n'est perdu : tes coches sont en base.</p>
  <button onclick="location.reload()">Réessayer</button>
</main></body></html>`;

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Réponse vide mais valide. Une promesse rejetée — ou `undefined` —
    passée à respondWith() coupe le chargement de la ressource ; c'est
    exactement ce qu'on cherche à éviter. */
function vide() {
  return new Response("", { status: 503, statusText: "Hors ligne" });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

/** Réseau d'abord ; en cas d'échec, dernière réponse mise en cache. */
async function networkFirst(request, cacheName, matchOptions) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, {
      ignoreVary: true,
      ...matchOptions,
    });
    if (cached) return cached;
    throw err;
  }
}

/** Cache d'abord pour les assets hashés. Ne rejette jamais. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return vide();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // écritures : jamais de cache

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    // `ignoreSearch` : on ouvre parfois l'app avec un paramètre
    // (?lancement=1), la navigation ne doit pas rater le shell pour ça.
    // Le `|| offlinePage()` n'est pas décoratif : `caches.match` rend
    // `undefined` quand rien n'est en cache, et respondWith(undefined),
    // c'est la page blanche.
    event.respondWith(
      networkFirst(request, SHELL_CACHE, { ignoreSearch: true })
        .catch(() => caches.match("/", { ignoreSearch: true }))
        .then((response) => response || offlinePage())
        .catch(() => offlinePage()),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(cacheFirst(request));
    } else {
      event.respondWith(networkFirst(request, SHELL_CACHE).catch(vide));
    }
    return;
  }

  // Lectures Supabase : le dernier état connu reste consultable hors ligne.
  if (url.hostname.endsWith(".supabase.co")) {
    event.respondWith(networkFirst(request, DATA_CACHE).catch(vide));
  }
});

// ---- Notifications push (phase 2) ----

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = { title: "💪 100 · 100 · 100", body: "" };
  try {
    payload = event.data.json();
  } catch {
    payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "lc100", // une seule notif visible à la fois, pas d'empilement
    }),
  );
});

// Tap sur la notification : on ouvre (ou focus) l'app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow("/");
    }),
  );
});
