// La porte de retour vers le challenge d'origine.
//
// Elle sert à quelqu'un qui joue le challenge ET a créé une ligue : sa ligue
// prend son `/` (c'est voulu — elle est ce qu'il ouvre tous les soirs), et
// cette adresse lui rend le chemin court vers le groupe.
//
// `lib/supabase.ts` reconnaît ce chemin et vise `public`, quelle que soit la
// ligue en mémoire. Elle disparaîtra avec la phase 5, quand tout le monde
// sera en ligues.

import App from "@/components/App";
import { FournisseurLigue } from "@/components/ligue/LigueContexte";

export default function PageChallenge() {
  return (
    <FournisseurLigue ligue={null}>
      <App />
    </FournisseurLigue>
  );
}
