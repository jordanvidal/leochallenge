// Une seule route : l'app est une SPA installée, la navigation vit en bas.
// Le portier de ligue s'intercale devant : c'est lui qui sait dans quelle
// ligue on est, ou qui demande le lien quand cet appareil n'en connaît aucune.
import App from "@/components/App";
import LigueGate from "@/components/ligue/LigueGate";

export default function Home() {
  return (
    <LigueGate>
      <App />
    </LigueGate>
  );
}
