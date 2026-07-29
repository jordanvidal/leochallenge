// L'adresse d'une ligue : c'est ce lien-là qu'on colle dans la conversation.
//
// Pas de redirection vers `/` : l'app se monte ici, et le `?c=` du lien reste
// dans l'URL pour la garde qui le lira. Le slug est mémorisé au passage, donc
// la prochaine ouverture depuis l'icône de l'écran d'accueil retombera sur la
// bonne ligue sans que personne ait à recoller quoi que ce soit.

import type { Metadata } from "next";
import App from "@/components/App";
import LigueGate from "@/components/ligue/LigueGate";
import { frenchDayMonth } from "@/lib/challenge";
import { serverSupabase } from "@/lib/server/push";

type Params = { params: Promise<{ slug: string }> };

/**
 * L'aperçu du lien, dans la conversation où il est collé.
 *
 * C'est la première chose que voit celui qu'on invite — avant même d'avoir
 * cliqué. Lui montrer le nom de SA ligue et SES dates plutôt qu'une
 * description générique, c'est la différence entre « un truc que quelqu'un a
 * envoyé » et « Les potes du bureau, du 29 juillet au 25 août ».
 *
 * Ligue inconnue : on ne dit rien de plus que le titre général. Un lien mort
 * ne mérite pas un aperçu qui promet une ligue.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await serverSupabase("app")
    .from("leagues")
    .select("name, start_day, end_day")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();

  const ligue = data as
    | { name: string; start_day: string; end_day: string }
    | null;
  if (!ligue) return {};

  return {
    title: `${ligue.name} · 100 · 100 · 100`,
    description:
      `100 pompes, 100 abdos, 100 squats par jour, ` +
      `du ${frenchDayMonth(ligue.start_day)} au ${frenchDayMonth(ligue.end_day)}.`,
  };
}

export default async function LiguePage({ params }: Params) {
  const { slug } = await params;
  return (
    <LigueGate slugUrl={slug}>
      <App />
    </LigueGate>
  );
}
