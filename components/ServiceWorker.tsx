"use client";

// Enregistre le service worker (cache du shell + dernier état des données).

import { useEffect } from "react";

export default function ServiceWorker() {
  useEffect(() => {
    // Prod uniquement : en dev, le cache des chunks casse le Fast Refresh.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // Le `?v=` change à chaque déploiement : le navigateur voit un
      // script différent, installe le nouveau service worker, et celui-ci
      // ouvre un cache de shell neuf en balayant les anciens. C'est ce qui
      // empêche un HTML périmé de réclamer des chunks qui n'existent plus.
      const version = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
      navigator.serviceWorker.register(`/sw.js?v=${version}`).catch(() => {
        // pas bloquant : l'app marche sans, juste pas de lecture hors ligne
      });
    }
  }, []);
  return null;
}
