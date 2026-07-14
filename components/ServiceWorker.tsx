"use client";

// Enregistre le service worker (cache du shell + dernier état des données).

import { useEffect } from "react";

export default function ServiceWorker() {
  useEffect(() => {
    // Prod uniquement : en dev, le cache des chunks casse le Fast Refresh.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // pas bloquant : l'app marche sans, juste pas de lecture hors ligne
      });
    }
  }, []);
  return null;
}
