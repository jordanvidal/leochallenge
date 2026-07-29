// L'adresse d'une ligue : c'est ce lien-là qu'on colle dans la conversation.
//
// Pas de redirection vers `/` : l'app se monte ici, et le `?c=` du lien reste
// dans l'URL pour la garde qui le lira. Le slug est mémorisé au passage, donc
// la prochaine ouverture depuis l'icône de l'écran d'accueil retombera sur la
// bonne ligue sans que personne ait à recoller quoi que ce soit.

import App from "@/components/App";
import LigueGate from "@/components/ligue/LigueGate";

export default async function LiguePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <LigueGate slugUrl={slug}>
      <App />
    </LigueGate>
  );
}
