"use client";

// Section bonus de l'écran Aujourd'hui : bandeau événement (s'il y en a
// un) + un seul rang « Déclarer un bonus ». Le catalogue complet vit dans
// une feuille : des dizaines de puces en permanence, c'était un catalogue
// posé sur le chemin des 10 secondes. Déclarer est un acte volontaire — un
// tap pour ouvrir, et ce qui est déjà déclaré reste visible sur le rang.
//
// La feuille elle-même ouvre sur le chemin court (02/08) : les habitués
// du joueur (ses déclarations des 7 derniers jours, déjà chargées), les
// puces ×2 du tirage, et ce qui est déjà déclaré aujourd'hui. « J'ai fait
// mes 10 000 pas » = un tap sur le rang, un tap sur la puce, Valider.
// Le mur de vingt-trois puces attend derrière « Tout voir », rangé par
// famille (migration 31). La feuille vit dans BonusSheet.tsx.

import { useState } from "react";
import { BonusCatalogItem, BonusState, todayClaimPoints } from "@/lib/bonus";
import { fmtPoints } from "@/lib/gamification";
import { Player } from "@/lib/types";
import BonusSheet from "./BonusSheet";

type Props = {
  player: Player;
  bonus: BonusState | null;
  onClaim: (item: BonusCatalogItem) => void;
  onUnclaim: (item: BonusCatalogItem) => void;
  /** Ouvre le planificateur (« Enchaîner des bonus »). Depuis le 02/08,
      c'est ici qu'il vit : une option au bas de la feuille, plus un onglet
      en face du contrat. Absent = catalogue pas chargé. */
  onPlanBonus?: () => void;
  showToast: (msg: string) => void;
};

export default function BonusSection({
  player,
  bonus,
  onClaim,
  onUnclaim,
  onPlanBonus,
  showToast,
}: Props) {
  const [open, setOpen] = useState(false);
  if (!bonus) return null;

  const mineToday = bonus.todayClaims.filter((c) => c.player_id === player.id);
  // Doublement compris : ce rang est lu juste sous la feuille qui promet
  // le double, il doit annoncer la même somme.
  const minePtsToday = todayClaimPoints(bonus, player.id);
  const emojiByKey = new Map(bonus.catalog.map((c) => [c.key, c.emoji]));

  // Le boss du dimanche se déclare directement dans son bandeau.
  const boss = bonus.event?.key === "boss_dimanche" ? bonus.event : null;
  const bossClaimed = !!boss && mineToday.some((c) => c.bonus_key === boss.key);

  return (
    <section className="mt-5">
      {/* Bandeau événement du jour : global, donc neutre, pas couleur joueur */}
      {bonus.event && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-raised px-4 py-3">
          <span className="text-2xl" aria-hidden>
            {bonus.event.emoji}
          </span>
          <p className="flex-1 text-sm font-medium">{bonus.event.label}</p>
          {boss ? (
            <button
              aria-pressed={bossClaimed}
              onClick={() => {
                navigator.vibrate?.(bossClaimed ? 8 : 18);
                if (bossClaimed) onUnclaim(boss);
                else onClaim(boss);
              }}
              className="min-h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-transform active:scale-[0.97]"
              style={
                bossClaimed
                  ? {
                      background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                      boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 65%, transparent)`,
                      color: player.color,
                    }
                  : {
                      background: "var(--color-surface)",
                      boxShadow: "inset 0 0 0 1px var(--color-line)",
                      color: "var(--color-ink)",
                    }
              }
            >
              {bossClaimed
                ? "Fait ✓"
                : `Je l'ai fait +${fmtPoints(boss.points)}`}
            </button>
          ) : bonus.event.key.endsWith("_double") ? (
            // Quitte ou double et les trois doublements d'exo multiplient :
            // leur montant de catalogue (1) est un rouage interne, pas une
            // promesse. Affiché tel quel, « +1 » annonçait au groupe un
            // point unique là où la journée entière compte double.
            //
            // En or, comme les puces qu'il double : c'est le même sujet sur
            // deux écrans, et le bandeau est le seul endroit où le joueur
            // apprend la nouvelle avant d'ouvrir la feuille.
            <span className="num-display text-x2 shrink-0 text-xl">×2</span>
          ) : (
            <span className="num-display shrink-0 text-xl text-muted">
              +{fmtPoints(bonus.event.points)}
            </span>
          )}
        </div>
      )}

      {/* Le rang unique : ouvrir la feuille, et voir d'un œil ce qu'on a
          déjà déclaré aujourd'hui (l'anti-triche reste sous les yeux). */}
      <button
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-surface px-4 text-left"
      >
        <span className="text-[15px] font-bold">＋ Déclarer un bonus</span>
        {mineToday.length > 0 && (
          <span className="shrink-0 text-sm font-medium">
            <span aria-hidden>
              {mineToday
                .map((c) => emojiByKey.get(c.bonus_key) ?? "")
                .join(" ")}
            </span>{" "}
            <span style={{ color: player.color }}>
              +{fmtPoints(minePtsToday)}
            </span>
          </span>
        )}
      </button>

      {open && (
        <BonusSheet
          player={player}
          bonus={bonus}
          onClaim={onClaim}
          onUnclaim={onUnclaim}
          onPlanBonus={onPlanBonus}
          showToast={showToast}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
