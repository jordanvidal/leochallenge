// Badge d'icône PWA : le nombre d'exos restants aujourd'hui, effacé au
// 3/3. Un rappel silencieux qui survit à la fermeture de l'app, et le
// filet de secours des jours où le push ne part pas. No-op quand l'API
// n'existe pas (iOS ne l'expose qu'en PWA installée, 16.4+).

import { useEffect } from "react";
import { challengeIsOver, parisToday } from "@/lib/challenge";
import { Entry, entryCount, entryKey } from "@/lib/types";

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function useAppBadge(
  playerId: string | null,
  entries: Map<string, Entry>,
): void {
  useEffect(() => {
    const apply = () => {
      const nav = navigator as BadgeNavigator;
      if (!nav.setAppBadge || !nav.clearAppBadge) return;
      if (!playerId || challengeIsOver()) {
        nav.clearAppBadge().catch(() => {});
        return;
      }
      const left =
        3 - entryCount(entries.get(entryKey(playerId, parisToday())));
      (left > 0 ? nav.setAppBadge(left) : nav.clearAppBadge()).catch(() => {});
    };
    apply();
    // Minuit est passé pendant que l'app dormait en fond : le retour au
    // premier plan réapplique le badge du nouveau jour.
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, [playerId, entries]);
}
