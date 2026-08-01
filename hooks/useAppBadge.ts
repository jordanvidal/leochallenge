// Pastille sur l'icône de l'écran d'accueil : le nombre de non-lus, fil
// et tchat confondus. Exactement le chiffre des pastilles d'onglets, sorti
// de l'app — et éteint dès qu'on a tout lu.
//
// C'est la deuxième tentative de badge d'icône dans cette app, et la
// différence tient en une phrase. La première (feature/badge-pwa, 17/07,
// revertée le soir même) affichait les exos restants du jour : un « 3 »
// qui se rallumait tout seul chaque matin et ne s'éteignait qu'une fois
// la séance faite. Une pastille pareille ne dit rien qu'on ne sache déjà,
// elle réclame. Celle-ci compte du contenu qui existe et qui s'éteint en
// le lisant : elle ne peut pas devenir un rappel permanent.
//
// L'API n'existe pas partout (iOS 16.4+ en PWA installée avec les
// notifications accordées, Chrome/Edge desktop ; rien sur Chrome Android
// ni Firefox). Absente, le hook ne fait rien — aucun repli à inventer,
// une pastille est un bonus.

import { useEffect } from "react";

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function useAppBadge(nonLus: number): void {
  useEffect(() => {
    const nav = navigator as BadgeNavigator;
    if (!nav.setAppBadge || !nav.clearAppBadge) return;

    const appliquer = () => {
      (nonLus > 0 ? nav.setAppBadge(nonLus) : nav.clearAppBadge()).catch(
        () => {},
      );
    };
    appliquer();

    // Retour au premier plan : pendant que l'app dormait, un push a pu
    // poser SON chiffre (celui du tchat seul, voir lib/server/push.ts).
    // Le client est la seule source qui connaisse les deux compteurs :
    // en revenant, il reprend la main.
    document.addEventListener("visibilitychange", appliquer);
    return () => document.removeEventListener("visibilitychange", appliquer);
  }, [nonLus]);
}
