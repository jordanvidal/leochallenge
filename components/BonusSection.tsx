"use client";

// Section bonus de l'écran Aujourd'hui : bandeau événement (s'il y en a
// un) + rangée de puces déclaratives. Compacte et discrète : la séance
// de base reste le héros de l'écran, les bonus sont l'assaisonnement.

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
  if (!bonus) return null;

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

  // Échelles déjà entamées aujourd'hui : avoir coché « +50 pompes » ferme
  // « +100 pompes », sinon les 50 premières seraient payées deux fois.
  const myLadders = new Set(
    mineToday
      .map((c) => bonus.catalog.find((i) => i.key === c.bonus_key)?.ladder)
      .filter((l): l is string => !!l),
  );

  /** Une puce est déclarable si l'échelle est libre et les plafonds le permettent. */
  function blocked(item: BonusCatalogItem): boolean {
    if (item.kind !== "exercise") return false; // le boss échappe aux plafonds
    if (item.ladder && myLadders.has(item.ladder)) return true;
    return mineCount >= capDay || weekUsed + item.points > capWeek;
  }

  // Le boss du dimanche se déclare directement dans son bandeau.
  const boss = bonus.event?.key === "boss_dimanche" ? bonus.event : null;
  const bossClaimed =
    !!boss && mineToday.some((c) => c.bonus_key === boss.key);

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

      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-bold tracking-wide text-faint uppercase">
          Bonus
        </h2>
        <span className="text-[11px] font-medium text-faint">
          {/* cap jour >= 99, cap semaine >= 999 = limites levées (S2) :
              on garde le total déclaré comme repère, sans plafond affiché */}
          {capDay < 99 && `${mineCount}/${capDay} aujourd'hui · `}
          {fmtPoints(weekUsed)}
          {capWeek < 999 && `/${fmtPoints(capWeek)}`} pts / 7 j
        </span>
      </div>

      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
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
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold whitespace-nowrap transition-transform active:scale-[0.97] disabled:opacity-35"
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
    </section>
  );
}
