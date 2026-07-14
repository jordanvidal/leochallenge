// Service worker : lecture hors ligne du dernier état connu.
// - Navigation : réseau d'abord, cache en secours.
// - Statiques Next (/_next/static) : cache d'abord (fichiers hashés, immuables).
// - Lectures Supabase (GET) : réseau d'abord, dernier état en secours.
// Les écritures (POST/PATCH) ne passent jamais par le cache.

const SHELL_CACHE = "lc-shell-v1";
const DATA_CACHE = "lc-data-v1";

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
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    throw err;
  }
}

/** Cache d'abord pour les assets hashés. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // écritures : jamais de cache

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(() => caches.match("/")),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(cacheFirst(request));
    } else {
      event.respondWith(networkFirst(request, SHELL_CACHE));
    }
    return;
  }

  // Lectures Supabase : le dernier état connu reste consultable hors ligne.
  if (url.hostname.endsWith(".supabase.co")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});
