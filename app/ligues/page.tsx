// L'entrée des ligues, à part du challenge d'origine qui vit sur `/`.
//
// `lib/supabase.ts` reconnaît cette adresse et vise le schéma `app` : c'est ce
// qui permet aux deux mondes de cohabiter dans la même app, sans que les neuf
// joueurs du challenge voient quoi que ce soit changer.

import EntreeLigues from "@/components/ligue/EntreeLigues";

export default function PageLigues() {
  return <EntreeLigues />;
}
