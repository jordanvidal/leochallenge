"use client";

// État gamification : classements + badges, rechargés après chaque coche
// et au retour sur l'app. La vérité vient du serveur (RPC leaderboard).

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGamification, Gamification } from "@/lib/gamification";
import { useLigueCourante } from "@/components/ligue/LigueContexte";

// Le classement coûte cher (trois RPC qui recalculent tout depuis les
// entries, ~300 ms chacune) et il échoue pour de vrai : réseau du métro,
// Supabase qui tousse, PWA réveillée avant que le wifi ne soit revenu.
// `fetchGamification` rend null au moindre échec — sans reprise, un seul
// raté laissait l'app sans classement jusqu'au prochain passage en
// avant-plan : « Calcul en cours… » qui ne s'en va plus, et l'écran Stats
// qui affirmait « joker intact » faute de savoir.
//
// Trois reprises, de plus en plus espacées, puis on rend la main : le
// retour en avant-plan et le retour du réseau relanceront de toute façon.
// Pas de boucle infinie qui martèle une base déjà en peine.
const REPRISES = [800, 2000, 5000]; // ms

export function useGamification(enabled: boolean) {
  const ligueId = useLigueCourante()?.id ?? null;
  const [data, setData] = useState<Gamification | null>(null);
  // Vrai quand les reprises sont épuisées et qu'on n'a toujours rien.
  // Sans ça, l'écran restait sur « Calcul en cours… » — un message qui
  // ment dès la dernière reprise passée, et qui n'offre aucune sortie.
  const [enPanne, setEnPanne] = useState(false);
  const inflight = useRef(false);
  // Un rechargement demandé pendant qu'un autre tourne était purement
  // perdu : c'est ce qui faisait rater le +1 de série après une séance
  // validée (rescore() tombant pendant le fetch du retour d'app). Il est
  // maintenant rejoué à la fin plutôt que jeté.
  const encore = useRef(false);
  const essai = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivant = useRef(true);

  useEffect(() => {
    vivant.current = true;
    return () => {
      vivant.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // `reprise` distingue la relance programmée (qui continue l'échelle des
  // délais) d'une demande fraîche (qui repart de zéro).
  const load = useCallback<(reprise: boolean) => Promise<void>>(
    async (reprise) => {
      if (inflight.current) {
        encore.current = true;
        return;
      }
      if (!reprise) {
        essai.current = 0;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        // Une tentative fraîche efface le constat de panne : le temps
        // qu'elle tourne, l'écran remontre « Calcul en cours… » plutôt
        // que de garder un message d'échec périmé sous les yeux.
        setEnPanne(false);
      }

      inflight.current = true;
      let g: Gamification | null = null;
      try {
        g = await fetchGamification(ligueId);
      } catch {
        // Un rejet se traite comme un échec : la reprise s'en occupe.
      } finally {
        inflight.current = false;
      }
      if (!vivant.current) return;

      if (g) {
        essai.current = 0;
        setData(g);
        setEnPanne(false);
      }

      // Une demande arrivée pendant ce chargement passe devant la reprise :
      // elle est plus récente, et elle repart avec l'échelle complète.
      if (encore.current) {
        encore.current = false;
        void load(false);
        return;
      }

      if (!g) {
        const attente = REPRISES[essai.current];
        if (attente === undefined) {
          setEnPanne(true); // on a assez insisté : l'écran prend le relais
          return;
        }
        essai.current += 1;
        timer.current = setTimeout(() => void load(true), attente);
      }
    },
    // `ligueId` en dépendance : sans lui, changer de ligue laisserait cette
    // fonction rappeler l'ancienne — un classement d'une autre ligue.
    [ligueId],
  );

  const reload = useCallback(() => load(false), [load]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    // Le retour du réseau est le seul signal qui vaille quand l'app est
    // restée ouverte pendant la coupure : sans lui, l'écran attend le
    // prochain aller-retour en arrière-plan pour se réparer.
    const onOnline = () => reload();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, reload]);

  return {
    gamification: data,
    gamificationEnPanne: enPanne,
    reloadGamification: reload,
  };
}
