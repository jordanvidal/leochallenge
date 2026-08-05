"use client";

// Le bandeau « événement du jour », en tête de TodayScreen.
//
// Il a beaucoup changé le 05/08, après un matin où le doublement des
// pompes est passé inaperçu de bout en bout. Deux défauts se cumulaient.
//
// Il disait le nom du tirage, jamais ce qu'il change : « Pompes double »
// posé sur une ligne de 68 px, à côté d'un « voir » gris, se lit comme un
// libellé décoratif. Il dit maintenant la consigne — la même phrase que la
// roue, écrite pour tenir ici (lib/bonus.ts) — et le badge du multiplicateur
// prend la forme pleine des doublements (DESIGN.md : `badge-x2`, un aplat à
// texte sombre, jamais une pastille ronde).
//
// Il s'écartait surtout d'un ✕, et le même drapeau servait à la roue :
// ouvrir la roue effaçait le bandeau, donc l'événement disparaissait de
// l'écran pour la journée entière, sans aucun chemin de retour. Le ✕ est
// parti. Le bandeau reste jusqu'à minuit, et il est la porte qui rouvre la
// roue autant de fois qu'on veut.
//
// Sa hauteur est fixe (deux lignes de consigne réservées, `line-clamp-2`) :
// TodayScreen tient sa place au chargement, et une place réservée doit être
// une place exacte.

import { BonusCatalogItem, badgeEvenement, consigneEvenement } from "@/lib/bonus";

export default function EventBanner({
  event,
  onOpen,
}: {
  event: BonusCatalogItem;
  onOpen: () => void;
}) {
  // Même titre que la roue (avant le « : » de description).
  const title = event.label.split(" : ")[0];
  const badge = badgeEvenement(event);
  const consigne = consigneEvenement(event)[0];

  return (
    <button
      onClick={onOpen}
      aria-label={`Événement du jour : ${title}. ${consigne} Voir le tirage.`}
      className="mt-4 block w-full rounded-2xl px-4 py-3 text-left transition-transform active:scale-[0.99]"
      style={{
        background: "color-mix(in oklch, var(--pc) 14%, var(--color-surface))",
        boxShadow:
          "inset 0 0 0 1px color-mix(in oklch, var(--pc) 32%, transparent)",
      }}
    >
      <span
        aria-hidden
        className="block text-[11px] leading-4 font-bold tracking-wide uppercase"
        style={{ color: "var(--pc)" }}
      >
        Événement du jour
      </span>

      <span aria-hidden className="mt-1.5 flex items-center gap-2.5">
        <span className="shrink-0 text-2xl leading-7">{event.emoji}</span>
        <span className="min-w-0 flex-1 truncate text-lg leading-7 font-bold">
          {title}
        </span>
        {badge && (
          // L'aplat plein du doublement : c'est la forme, pas la teinte,
          // qui distingue le ×2 des couleurs joueur (DESIGN.md).
          <span
            className="num-display shrink-0 rounded-full px-2 py-0.5 text-sm leading-6 font-bold"
            style={{ background: "var(--color-x2)", color: "var(--color-bg)" }}
          >
            {badge}
          </span>
        )}
        {/* Le chevron, seul reste de l'affordance : le bandeau ouvre la
            roue, et rien d'autre sur cet écran n'a cette forme. */}
        <span className="shrink-0 leading-7 text-muted">›</span>
      </span>

      {/* Deux lignes réservées, toujours : la consigne la plus courte en
          occupe deux à 375 px, et une hauteur qui danse d'une ligne ferait
          sauter tout ce qui est en dessous — jusqu'au lanceur. */}
      <span
        aria-hidden
        className="mt-1 line-clamp-2 block min-h-10 text-sm leading-5 text-muted"
      >
        {consigne}
      </span>
    </button>
  );
}
