"use client";

// Tuto de première connexion : 5 cartes qu'on tape pour avancer.
// Une idée par carte, dans l'esprit « on frappe l'écran au pouce ».
// Le tour des onglets a été retiré : cinq lignes pour nommer cinq
// onglets déjà visibles en bas de l'écran, personne ne les lisait.
// Montré une fois (flag localStorage), ou rouvert depuis « Revoir les
// règles ».
//
// Réécrit le 04/08 pour quelqu'un qui n'a jamais ouvert l'app. L'ancienne
// version listait le barème dans le vocabulaire de l'app — « journée
// parfaite », « 3/3 », « ×1,5 », « paliers d'un même exo » — c'est-à-dire
// des mots qu'on ne comprend qu'après avoir joué. Trois règles depuis :
//
//   1. des phrases, pas des libellés de barème ;
//   2. un chiffre concret à chaque fois — « une journée complète vaut 7 »
//      se retient, « +4 journée parfaite » se relit trois fois ;
//   3. on ne dit pas tout. Le barème complet vit au Classement, à un tap.
//
// La branche « barème d'avant la S3 » a sauté avec cette réécriture. Elle
// ne pouvait plus s'afficher (`baremeS3` n'est faux que pour une fenêtre
// dont la bascule est à venir, et celle du groupe d'origine est passée le
// 27/07), et faire vivre deux barèmes dans chaque phrase interdisait d'en
// écrire une seule qui parle.

import { useState } from "react";
import { frenchDayMonth, saison4Started } from "@/lib/challenge";
import { Player } from "@/lib/types";
import { BigButton } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  /** Rouvert manuellement : le bouton final dit « Fermer » au lieu de « C'est parti ». */
  replay?: boolean;
  onDone: () => void;
};

/** Une ligne du barème : montant à gauche, ce qu'il récompense à droite. */
function Rule({ amount, children }: { amount: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="num-display w-16 shrink-0 text-ink">{amount}</dt>
      <dd className="text-muted">{children}</dd>
    </div>
  );
}

/** Une ligne d'événement : emoji + explication courte. */
function EventRow({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
        {emoji}
      </span>
      <span className="text-sm text-muted">{children}</span>
    </div>
  );
}

export default function TutorialScreen({ player, replay = false, onDone }: Props) {
  const f = useFenetre();
  // Le seul drapeau qui reste : les deux tirages et le jour de repos de la
  // S4 n'existent que sur le challenge d'origine. Une ligue neuve ne les a
  // pas en base — les lui promettre serait le mensonge d'à côté.
  const s4 = saison4Started(f);
  const cards = [
    // 1 — Ce qu'on fait, et le geste qui le valide.
    <div key="principe">
      <p className="num-display text-4xl" style={{ color: player.color }}>
        100·100·100
      </p>
      <h1 className="mt-4 text-2xl font-bold">
        Chaque jour, jusqu&apos;au {frenchDayMonth(f.end)}
      </h1>
      <p className="mt-3 text-muted">
        100 pompes, 100 abdos, 100 squats. Le soir, tu appuies sur
        « Lancer ma séance ». L&apos;app affiche un chiffre, tu le fais, tu
        tapes « Terminé ». Une douzaine de fois, un quart d&apos;heure.
      </p>
      <p className="mt-3 text-muted">
        <b className="text-ink">Pas de séance, pas de journée.</b> C&apos;est
        le seul moyen de valider — et tout le groupe voit qui a fait quoi.
      </p>
    </div>,

    // 2 — Le chiffre à retenir, et ce que la régularité en fait. Une journée
    // complète vaut 7 (3 exos + 4), ×1,5 à partir du 3e jour d'affilée, ×2 à
    // partir du 7e. On montre le même soir à trois moments plutôt que
    // d'énoncer deux multiplicateurs.
    <div key="score">
      <h1 className="text-2xl font-bold">Une journée complète vaut 7 points</h1>
      <dl className="mt-5 space-y-3">
        <Rule amount="7">tes trois exos, ce soir</Rule>
        <Rule amount="10,5">le même soir, si tu tiens 3 jours d&apos;affilée</Rule>
        <Rule amount="14">le même soir, si tu tiens 7 jours d&apos;affilée</Rule>
      </dl>
      <p className="mt-6 border-t border-line pt-4 text-muted">
        Un jour sauté remet ce compteur à zéro. Ce n&apos;est pas le gros soir
        qui gagne le challenge, c&apos;est celui qui ne s&apos;arrête pas.
      </p>
    </div>,

    // 3 — Le rendez-vous du dimanche : duel, semaine gagnée, semaine pleine.
    // Trois lignes qui pèsent plus de 10 points par semaine et n'étaient
    // nommées nulle part à l'arrivée d'un joueur.
    <div key="semaine">
      <h1 className="text-2xl font-bold">
        Le lundi, tu es opposé à quelqu&apos;un
      </h1>
      <p className="mt-3 text-muted">
        Chaque lundi, tu es mis face au joueur qui te colle au classement.
        Celui qui a le plus de journées complètes d&apos;ici dimanche{" "}
        <b className="text-ink">prend 3 points à l&apos;autre</b>. C&apos;est
        le seul endroit du jeu où on peut en perdre.
      </p>
      <p className="mt-5 text-muted">Et dimanche soir, deux fois de plus :</p>
      <dl className="mt-4 space-y-3">
        <Rule amount="+3">au meilleur de la semaine</Rule>
        <Rule amount="+5">à qui a fait ses sept jours, du lundi au dimanche</Rule>
      </dl>
    </div>,

    // 4 — Ce qu'on ajoute et qu'on déclare. Les montants sont ceux du
    // catalogue en base (bonus_catalog) : quatre exemples parlants, pas la
    // liste des vingt-trois.
    <div key="bonus">
      <h1 className="text-2xl font-bold">Ce que tu fais en plus compte</h1>
      <p className="mt-3 text-muted">
        Après tes 100, tu déclares ce que tu as ajouté. Par exemple :
      </p>
      <dl className="mt-5 space-y-3">
        <Rule amount="+4">50 pompes de plus</Rule>
        <Rule amount="+4">100 abdos de plus</Rule>
        <Rule amount="+8">5 km de course</Rule>
        <Rule amount="+20">10 km</Rule>
      </dl>
      <p className="mt-6 border-t border-line pt-4 text-muted">
        Deux gars qui font leurs trois exos tous les soirs finissent à
        égalité. C&apos;est ici que ça se décide.
      </p>
    </div>,

    // 5 — Le tirage du jour. Les événements listés sont ceux que la base
    // tire vraiment (get_daily_event) ; les deux du milieu et le jour de
    // repos n'existent que sur le challenge d'origine, d'où le drapeau.
    <div key="events">
      <h1 className="text-2xl font-bold">Chaque matin, une carte est tirée</h1>
      <p className="mt-3 text-muted">
        La même pour tout le groupe. Souvent, il n&apos;y a rien. Sinon :
      </p>
      <div className="mt-5 space-y-2.5">
        <EventRow emoji="🎲">
          un exo compte double. Si ce sont les pompes, tes pompes du jour
          valent le double, et ce que tu déclares en pompes aussi
        </EventRow>
        <EventRow emoji="🎰">
          quitte ou double : tu finis tes trois exos, ta journée compte
          double — 14 au lieu de 7. Tu ne finis pas, tu ne perds rien
        </EventRow>
        {s4 && (
          <>
            <EventRow emoji="🔁">
              tout ce que tu déclares ce jour-là compte double
            </EventRow>
            <EventRow emoji="🎁">
              jour de fête : +5 si tu fais tes trois exos
            </EventRow>
          </>
        )}
        <EventRow emoji="👊">
          le boss du dimanche : 200 pompes dans la journée, les 100 de base
          comprises, et tu prends +10
        </EventRow>
      </div>
      {s4 && (
        <p className="mt-5 text-sm text-muted">
          <span aria-hidden>😴</span> Et un jour de repos par semaine, tiré le
          matin même, le même pour tout le monde : ta série tient sans que tu
          fasses ta séance.
        </p>
      )}
      <p className="mt-6 border-t border-line pt-4 text-muted">
        Le {frenchDayMonth(f.end)}, il y aura un premier au classement. Ce
        soir, tout le monde est à zéro.
      </p>
    </div>,
  ];

  const [i, setI] = useState(0);
  const last = i === cards.length - 1;

  function next() {
    if (last) onDone();
    else setI((v) => v + 1);
  }

  return (
    <main className="fixed inset-0 z-50 flex flex-col bg-bg pt-safe pb-safe">
      {/* En-tête : progression + passer. Hors zone de tap. */}
      <div className="flex items-center gap-3 px-6 py-3">
        <div className="flex flex-1 gap-1.5" aria-hidden>
          {cards.map((_, n) => (
            <span
              key={n}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{
                background:
                  n <= i ? player.color : "var(--color-line)",
              }}
            />
          ))}
        </div>
        <button
          onClick={onDone}
          className="min-h-11 px-2 text-sm font-medium text-faint"
        >
          {replay ? "Fermer" : "Passer"}
        </button>
      </div>

      {/* Zone de tap : tape n'importe où pour avancer. */}
      <button
        onClick={next}
        aria-label={last ? "Terminer" : "Carte suivante"}
        className="flex flex-1 flex-col justify-center px-8 text-left"
      >
        <div key={i} className="rise-in">
          {cards[i]}
        </div>
      </button>

      {/* Pied : bouton net sur la dernière carte, sinon indice de tap. */}
      <div className="px-6 pb-3">
        {last ? (
          <BigButton onClick={onDone}>
            {replay ? "Fermer" : "C'est parti"}
          </BigButton>
        ) : (
          <p className="py-3 text-center text-sm text-faint">
            Tape pour continuer
          </p>
        )}
      </div>
    </main>
  );
}
