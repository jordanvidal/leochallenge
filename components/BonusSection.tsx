"use client";

// Section bonus de l'écran Aujourd'hui : bandeau événement (s'il y en a
// un) + un seul rang « Déclarer un bonus ». Le catalogue complet vit dans
// une feuille : 17 puces en permanence, c'était un catalogue posé sur le
// chemin des 10 secondes. Déclarer est un acte volontaire — un tap pour
// ouvrir, et ce qui est déjà déclaré reste visible sur le rang.

import { useEffect, useState } from "react";
import { BonusCatalogItem, BonusState, claimables, weekBonusPoints } from "@/lib/bonus";
import { fmtPoints } from "@/lib/gamification";
import { Player } from "@/lib/types";

type Props = {
  player: Player;
  bonus: BonusState | null;
  onClaim: (item: BonusCatalogItem) => void;
  onUnclaim: (item: BonusCatalogItem) => void;
};

export default function BonusSection({ player, bonus, onClaim, onUnclaim }: Props) {
  const [open, setOpen] = useState(false);
  if (!bonus) return null;

  const mineToday = bonus.todayClaims.filter((c) => c.player_id === player.id);
  const minePtsToday = mineToday.reduce((sum, c) => sum + c.points, 0);
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
          ) : bonus.event.key === "quitte_ou_double" ? (
            // Valeur dynamique (la base du jour ×2) : on montre le facteur, pas +0.
            <span className="num-display shrink-0 text-xl text-muted">×2</span>
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
              {mineToday.map((c) => emojiByKey.get(c.bonus_key) ?? "").join(" ")}
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
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/** La feuille de déclaration : tout le catalogue, même pattern que
    DayEditor (fond cliquable, poignée, Échap). Elle reste ouverte après
    une déclaration — une grosse séance en fait plusieurs d'affilée. */
function BonusSheet({
  player,
  bonus,
  onClaim,
  onUnclaim,
  onClose,
}: Props & { bonus: BonusState; onClose: () => void }) {
  // Échap pour fermer (desktop / clavier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const capDay = bonus.catalog.find((c) => c.key === "cap_claims_jour")?.points ?? 3;
  const capWeek =
    bonus.catalog.find((c) => c.key === "cap_points_semaine")?.points ?? 25;
  const exerciseKeys = new Set(
    bonus.catalog.filter((c) => c.kind === "exercise").map((c) => c.key),
  );
  const mineToday = bonus.todayClaims.filter((c) => c.player_id === player.id);
  const mineCount = mineToday.filter((c) => exerciseKeys.has(c.bonus_key)).length;
  const weekUsed = weekBonusPoints(bonus, player.id);
  const items = claimables(bonus);

  /** Une puce est déclarable tant que les plafonds le permettent. Les
      paliers d'une même échelle se cumulent depuis la migration 22 :
      +50 pompes et +100 pompes cochés, c'est 150 pompes déclarées. */
  function blocked(item: BonusCatalogItem): boolean {
    if (item.kind !== "exercise") return false; // le boss échappe aux plafonds
    return mineCount >= capDay || weekUsed + item.points > capWeek;
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Déclarer un bonus"
    >
      <div
        className="rise-in flex max-h-[80dvh] flex-col rounded-t-3xl bg-raised px-5 pt-4 pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden />
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-lg font-bold">Déclarer un bonus</p>
          {/* Les plafonds sont levés en S2 (cap jour >= 99, cap semaine >= 999) :
              plus rien à afficher. Un total sans plafond ne guide aucune
              décision — il se lisait comme une jauge et semait le doute. Le
              compteur ne revient que si un plafond revient. */}
          {(capDay < 99 || capWeek < 999) && (
            <span className="text-[11px] font-medium text-faint">
              {capDay < 99 && `${mineCount}/${capDay} aujourd'hui`}
              {capDay < 99 && capWeek < 999 && " · "}
              {capWeek < 999 &&
                `${fmtPoints(weekUsed)}/${fmtPoints(capWeek)} pts / 7 j`}
            </span>
          )}
        </div>

        <div className="flex flex-wrap content-start gap-2 overflow-y-auto pb-1">
          {items.map((item) => {
            const claimed = mineToday.some((c) => c.bonus_key === item.key);
            const off = !claimed && blocked(item);
            return (
              <button
                key={item.key}
                aria-pressed={claimed}
                disabled={off}
                onClick={() => {
                  navigator.vibrate?.(claimed ? 8 : 18);
                  if (claimed) onUnclaim(item);
                  else onClaim(item);
                }}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold whitespace-nowrap transition-transform active:scale-[0.97] disabled:opacity-35"
                style={
                  claimed
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
                <span aria-hidden>{item.emoji}</span>
                {item.label}
                <span
                  className="font-medium"
                  style={{
                    color: claimed ? player.color : "var(--color-faint)",
                  }}
                >
                  +{fmtPoints(item.points)}
                </span>
                {claimed && <span aria-hidden>✓</span>}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="mt-4 mb-2 min-h-12 w-full rounded-2xl bg-surface font-bold"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
