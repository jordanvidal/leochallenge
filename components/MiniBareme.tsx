"use client";

// Le barème, en un seul endroit.
//
// Il vivait tout en bas du détail d'un joueur : pour lire les règles il
// fallait aller au Classement, taper sur quelqu'un, ouvrir son détail et
// descendre jusqu'au pied d'un panneau qui parle des points d'un autre.
// Le contenu était bon, l'accès ne l'était pas — le barème est ce qu'on
// vient chercher quand on ne comprend pas son propre score.
//
// Il est donc sorti ici, utilisé à deux endroits : encastré en pied du
// détail joueur (là où il a toujours été), et ouvrable d'un tap depuis
// l'en-tête du Classement, l'écran où les points vivent.
//
// Une seule source : ces règles sont celles EN VIGUEUR (drapeau `s3`).
// Décrire la saison suivante avant qu'elle commence, c'est répondre à
// côté au seul moment où quelqu'un pose la question.

import { useCoucheRetour } from "@/hooks/useRetour";
import { saison3Started, saison4Started } from "@/lib/challenge";
import { useFenetre } from "./ligue/LigueContexte";

export function MiniBareme({
  s3,
  s4,
  /** Encastré en pied du détail joueur : il porte son propre titre et se
      détache du bloc au-dessus. En destination, l'en-tête de la feuille
      dit déjà « Comment on marque » — le répéter serait du bruit. */
  avecTitre = true,
}: {
  s3: boolean;
  /** La S4 (03/08) : deux tirages de plus dans la roue. Séparé de `s3`
      parce que les deux bascules ne se recouvrent pas — une ligue neuve
      est en S3 sans jamais passer en S4. */
  s4: boolean;
  avecTitre?: boolean;
}) {
  return (
<div className={`${avecTitre ? "mt-8" : "mt-2"} mb-4 rounded-2xl bg-surface p-4 text-xs text-muted`}>
  {avecTitre && <p className="mb-3 font-bold text-faint">Comment on marque</p>}
  <dl className="space-y-2">
    <div className="flex items-baseline gap-3">
      <dt className="num-display w-14 shrink-0 text-ink">1 pt</dt>
      <dd>par exo coché</dd>
    </div>
    <div className="flex items-baseline gap-3">
      <dt className="num-display w-14 shrink-0 text-ink">{s3 ? "+4" : "+2"}</dt>
      <dd>journée parfaite (3 exos sur 3)</dd>
    </div>
    <div className="flex items-baseline gap-3">
      <dt className="num-display w-14 shrink-0 text-ink">×1,5</dt>
      <dd>série de 3 jours parfaits</dd>
    </div>
    <div className="flex items-baseline gap-3">
      <dt className="num-display w-14 shrink-0 text-ink">×2</dt>
      <dd>série de 7 jours parfaits</dd>
    </div>
    {s4 && (
      <div className="flex items-baseline gap-3">
        <dt className="w-14 shrink-0 text-center text-ink" aria-hidden>😴</dt>
        <dd>
          le jour off : un jour par semaine, tiré le matin même parmi
          lundi→vendredi, <b>le même pour tout le monde</b>. Ta série tient
          sans rien cocher, et il compte comme rempli pour la semaine
          pleine. Il ne rapporte aucun point, et ne compte pas dans le
          duel. Si tu t&apos;entraînes quand même, tout compte normalement
          (depuis le 03/08)
        </dd>
      </div>
    )}
    <div className="flex items-baseline gap-3">
      <dt className="w-14 shrink-0 font-bold text-ink">+ bonus</dt>
      <dd>
        {s3 ? "" : "premier du jour, "}séances, événements et exos
        déclarés s&apos;ajoutent par-dessus
      </dd>
    </div>
    <div className="flex items-baseline gap-3">
      <dt className="w-14 shrink-0 font-bold text-ink">⚔️ ±3</dt>
      <dd>duel hebdo : chaque lundi, duel contre ton voisin de classement — le plus de jours parfaits d&apos;ici dimanche prend 3 pts à l&apos;autre</dd>
    </div>
    <div className="flex items-baseline gap-3">
      <dt className="w-14 shrink-0 font-bold text-ink">🏆 +3</dt>
      <dd>gagner la semaine : le vainqueur du classement hebdo prend 3 pts au général (posés le dimanche, depuis le 20/07)</dd>
    </div>
    {s3 && (
      <div className="flex items-baseline gap-3">
        <dt className="w-14 shrink-0 font-bold text-ink">📅 +5</dt>
        <dd>la semaine pleine : 7 jours parfaits du lundi au dimanche, posés le dimanche (depuis le 27/07)</dd>
      </div>
    )}
  </dl>

  {/* Les événements du jour : tirés au hasard, expliqués une bonne fois */}
  <p className="mt-4 mb-3 border-t border-line pt-4 font-bold text-faint">
    Les événements du jour{" "}
    <span className="font-normal">(tirés au hasard, 1 max/jour)</span>
  </p>
  <dl className="space-y-2">
    {s3 ? (
      <div className="flex items-baseline gap-3">
        <dt className="w-6 shrink-0 text-center" aria-hidden>🎲</dt>
        <dd>
          exo doublé : l&apos;exo tiré (pompes, abdos ou squats) voit
          ta coche <b>et</b> tous tes bonus qui le travaillent
          compter double ce jour-là. La coche double à sa valeur du
          jour, série comprise ; les bonus doublés portent un ×2
          au-dessus
        </dd>
      </div>
    ) : (
      <>
        <div className="flex items-baseline gap-3">
          <dt className="w-6 shrink-0 text-center" aria-hidden>🎲</dt>
          <dd>pompes double : tes pompes comptent double ce jour-là</dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="w-6 shrink-0 text-center" aria-hidden>🍻</dt>
          <dd>happy hour : séance finie entre 18h et 20h → +5</dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="w-6 shrink-0 text-center" aria-hidden>🌄</dt>
          <dd>lève-tôt : séance finie avant 7h → +6</dd>
        </div>
      </>
    )}
    <div className="flex items-baseline gap-3">
      <dt className="w-6 shrink-0 text-center" aria-hidden>🎰</dt>
      <dd>
        quitte ou double : si tu boucles ton 3/3, tes points de{" "}
        <b>base</b> du jour comptent double. Si tu rates, rien ne
        change (aucune perte).
      </dd>
    </div>
    {s4 && (
      <>
        <div className="flex items-baseline gap-3">
          <dt className="w-6 shrink-0 text-center" aria-hidden>🔁</dt>
          <dd>
            bonus doublés : toutes les puces que tu <b>déclares</b> ce
            jour-là comptent double. Ni la coche, ni le boss — les puces
            (depuis le 03/08)
          </dd>
        </div>
        <div className="flex items-baseline gap-3">
          <dt className="w-6 shrink-0 text-center" aria-hidden>🎁</dt>
          <dd>
            jour de fête : +5 si tu fais ton 3/3, rien à déclarer
            (depuis le 03/08)
          </dd>
        </div>
      </>
    )}
    {!s3 && (
      <div className="flex items-baseline gap-3">
        <dt className="w-6 shrink-0 text-center" aria-hidden>🪞</dt>
        <dd>
          jour miroir : le <b>dernier</b> du classement général reçoit
          +8 pour se relancer
        </dd>
      </div>
    )}
    <div className="flex items-baseline gap-3">
      <dt className="w-6 shrink-0 text-center" aria-hidden>👊</dt>
      <dd>
        boss du dimanche : 200 pompes sur la journée, <b>les 100 de base
        comprises</b> → +10 (dimanche only). La puce « +100 pompes » se
        coche en plus
      </dd>
    </div>
  </dl>
</div>
  );
}

/** Le même barème, en destination : ouvert depuis l'en-tête du Classement. */
export function BaremeSheet({ onClose }: { onClose: () => void }) {
  const f = useFenetre();
  useCoucheRetour(onClose);
  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-bg px-5 pt-safe pb-safe">
      <div className="flex items-center gap-3 py-2">
        <button
          onClick={onClose}
          aria-label="Retour au classement"
          className="-ml-2 flex min-h-11 min-w-11 items-center justify-center text-2xl text-muted"
        >
          ←
        </button>
        <h1 className="flex-1 text-lg font-bold">Comment on marque</h1>
      </div>
      <MiniBareme s3={saison3Started(f)} s4={saison4Started(f)} avecTitre={false} />
      <div className="h-4 shrink-0" />
    </div>
  );
}
