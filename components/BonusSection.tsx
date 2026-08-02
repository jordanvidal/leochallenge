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
// famille (migration 31).

import { useEffect, useRef, useState } from "react";
import {
  BonusCatalogItem,
  BonusGroup,
  BonusState,
  claimableGroups,
  doubledToday,
  frequentClaimables,
  movementLockedBy,
  pointsToday,
  todayClaimPoints,
  weekBonusPoints,
} from "@/lib/bonus";
import { useCoucheRetour } from "@/hooks/useRetour";
import { fmtPoints } from "@/lib/gamification";
import { Player } from "@/lib/types";

type Props = {
  player: Player;
  bonus: BonusState | null;
  onClaim: (item: BonusCatalogItem) => void;
  onUnclaim: (item: BonusCatalogItem) => void;
  /** Déclarations notées hors ligne, en file d'attente (lib/outbox.ts). */
  enAttente?: number;
  showToast: (msg: string) => void;
};

export default function BonusSection({
  player,
  bonus,
  onClaim,
  onUnclaim,
  enAttente = 0,
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

      {/* La file d'attente, dite sobrement : une déclaration sans réseau
          n'est plus un échec, mais elle ne doit pas non plus passer pour
          envoyée. Une ligne en `quiet` (information à lire, pas de la
          texture), sans toast ni alarme — la ligne disparaît toute seule
          quand tout est parti, et le refus définitif, lui, garde son
          rollback + toast. */}
      {enAttente > 0 && (
        <p role="status" className="mt-1.5 text-[11px] font-bold text-quiet">
          Noté hors ligne — ça partira au retour du réseau
        </p>
      )}

      {open && (
        <BonusSheet
          player={player}
          bonus={bonus}
          onClaim={onClaim}
          onUnclaim={onUnclaim}
          showToast={showToast}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

// Le glissé vers le bas ferme la feuille. La poignée le promettait depuis
// le début sans que rien ne l'écoute : sur un téléphone, un trait gris en
// haut d'une feuille est une instruction, pas une décoration. Le geste
// échouait en silence, et il fallait viser « Fermer ».
const SEUIL_PX = 88; // un glissé franc suffit, on ne demande pas la moitié de l'écran
const FLICK_PX = 28; // ...et un coup sec part de plus haut
const FLICK_VITESSE = 0.45; // px/ms

/** Rend la feuille tirable vers le bas. La zone de prise est passée à
    l'appelant : plus bas, le doigt appartient à la liste qui défile. */
function useGlisserPourFermer(onClose: () => void) {
  const [dy, setDy] = useState(0);
  const [tire, setTire] = useState(false);
  const feuille = useRef<HTMLDivElement>(null);
  const depart = useRef<{ y: number; t: number } | null>(null);
  const sortie = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sortie.current) clearTimeout(sortie.current);
    },
    [],
  );

  /** Sortie par le bas : la feuille finit son geste avant de disparaître.
      Fermer sèchement sous le doigt donne l'impression d'un bug. */
  function sortirParLeBas() {
    setTire(false);
    setDy(feuille.current?.offsetHeight ?? 600);
    sortie.current = setTimeout(onClose, 200);
  }

  const prise = {
    style: { touchAction: "none" as const },
    onTouchStart: (e: React.TouchEvent) => {
      depart.current = { y: e.touches[0].clientY, t: e.timeStamp };
      setTire(true);
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!depart.current) return;
      const d = e.touches[0].clientY - depart.current.y;
      setDy(d > 0 ? d : 0); // vers le haut, la feuille ne suit pas
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const d = depart.current;
      depart.current = null;
      setTire(false);
      if (!d) return;
      const vitesse = dy / Math.max(1, e.timeStamp - d.t);
      if (dy > SEUIL_PX || (dy > FLICK_PX && vitesse > FLICK_VITESSE)) {
        sortirParLeBas();
      } else {
        setDy(0); // pas assez : elle remonte se remettre en place
      }
    },
    onTouchCancel: () => {
      depart.current = null;
      setTire(false);
      setDy(0);
    },
  };

  return { dy, tire, feuille, prise };
}

/** La feuille de déclaration : tout le catalogue, en feuille montante
    (fond cliquable, poignée, Échap).

    Un tap sur une puce ne déclare rien : il coche un brouillon. Rien ne
    part en base — donc rien ne réveille les cinq autres — tant que
    « Valider » n'est pas touché. Avant, le pouce qui glissait à 23h
    envoyait une notification au groupe, et la seule réparation était de
    re-taper pour décocher, ce qui n'efface pas la notification déjà
    partie. Sortir autrement (glissé, fond, Échap, retour) jette le
    brouillon : c'est la contrepartie, et elle est dite au passage. */
function BonusSheet({
  player,
  bonus,
  onClaim,
  onUnclaim,
  showToast,
  onClose,
}: Props & { bonus: BonusState; onClose: () => void }) {
  const capDay =
    bonus.catalog.find((c) => c.key === "cap_claims_jour")?.points ?? 3;
  const capWeek =
    bonus.catalog.find((c) => c.key === "cap_points_semaine")?.points ?? 25;
  const exerciseKeys = new Set(
    bonus.catalog.filter((c) => c.kind === "exercise").map((c) => c.key),
  );
  const mineToday = bonus.todayClaims.filter((c) => c.player_id === player.id);
  const groupes = claimableGroups(bonus);

  // Le chemin court : les habitués du joueur d'abord, puis les puces que
  // le tirage double (la nouvelle du jour doit se voir sans « Tout voir »),
  // puis ce qui est déjà déclaré aujourd'hui — sans quoi décocher
  // demanderait d'ouvrir tout le catalogue.
  const raccourci: BonusCatalogItem[] = [];
  {
    const declarables = new Map<string, BonusCatalogItem>();
    for (const g of groupes) for (const i of g.items) declarables.set(i.key, i);
    const pousse = (item: BonusCatalogItem | undefined) => {
      if (item && !raccourci.some((r) => r.key === item.key)) raccourci.push(item);
    };
    for (const item of frequentClaimables(bonus, player.id)) pousse(item);
    for (const item of declarables.values()) {
      if (doubledToday(bonus, item)) pousse(item);
    }
    for (const c of mineToday) pousse(declarables.get(c.bonus_key));
  }

  // Sans historique, il n'y a rien à raccourcir : la feuille ouvre sur le
  // catalogue. L'état ne vit que le temps de la feuille — la rouvrir
  // revient au chemin court.
  const [tout, setTout] = useState(raccourci.length === 0);
  const groups: BonusGroup[] = tout
    ? groupes
    : [{ title: null, items: raccourci }];

  // Les puces que cette feuille affiche : c'est sur elles, et elles
  // seules, que « Valider » a le droit d'écrire. Le boss du dimanche se
  // déclare dans son bandeau, il ne doit pas se faire retirer ici — et en
  // chemin court, le reste du catalogue n'est pas non plus touché.
  const affichees = new Map<string, BonusCatalogItem>();
  for (const g of groups) for (const i of g.items) affichees.set(i.key, i);

  // Le brouillon, parti de ce qui est déjà déclaré aujourd'hui : rouvrir
  // la feuille montre son état du jour, et décocher redevient possible.
  const [choisies, setChoisies] = useState<Set<string>>(
    () =>
      new Set(
        mineToday
          .filter((c) => affichees.has(c.bonus_key))
          .map((c) => c.bonus_key),
      ),
  );
  const initiales = useRef(choisies); // le point de départ, pour le diff

  function basculer(cle: string) {
    setChoisies((prev) => {
      const s = new Set(prev);
      if (s.has(cle)) s.delete(cle);
      else s.add(cle);
      return s;
    });
  }

  const ajouts = [...affichees.values()].filter(
    (i) => choisies.has(i.key) && !initiales.current.has(i.key),
  );
  const retraits = [...affichees.values()].filter(
    (i) => !choisies.has(i.key) && initiales.current.has(i.key),
  );
  const enAttente = ajouts.length + retraits.length;
  // Ce que le bouton promet : le montant du jour, doublement compris,
  // pour que la somme annoncée soit celle que les puces viennent d'écrire.
  const gainNet =
    ajouts.reduce((s, i) => s + pointsToday(bonus, i), 0) -
    retraits.reduce((s, i) => s + pointsToday(bonus, i), 0);

  /** Envoie le brouillon. Les retraits d'abord : sans ça, échanger les
      10 km contre les 10 000 pas se ferait retoquer par le filet de
      useBonus, qui verrait encore la course déclarée au moment où la
      marche part. */
  function valider() {
    for (const item of retraits) onUnclaim(item);
    for (const item of ajouts) onClaim(item);
    onClose();
  }

  /** Sortie sans validation : le brouillon est jeté. Silencieusement,
      ce serait un travail perdu sans un mot — la ligne ne s'affiche donc
      que s'il y avait vraiment quelque chose à valider. */
  function abandonner() {
    if (enAttente > 0) showToast("Bonus non validés");
    onClose();
  }

  // Le retour arrière la ferme, comme le glissé vers le bas et Échap :
  // trois chemins vers la même sortie, et aucun ne traverse la feuille.
  useCoucheRetour(abandonner);

  // Échap pour fermer (desktop / clavier)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && abandonner();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { dy, tire, feuille, prise } = useGlisserPourFermer(abandonner);

  // Les règles se jugent sur le brouillon, pas sur la base : une puce
  // cochée compte tout de suite, sinon cocher les 10 km puis les 10 000
  // pas dans la même passe contournerait l'exclusion de déplacement.
  // S'y ajoute ce qui est déclaré aujourd'hui hors de cette feuille.
  const retenues = new Set(choisies);
  for (const c of mineToday) {
    if (!affichees.has(c.bonus_key)) retenues.add(c.bonus_key);
  }

  const mineCount = [...choisies].filter((k) => exerciseKeys.has(k)).length;
  // Le plafond hebdo se juge sur ce que la feuille s'apprête à envoyer.
  const weekUsed =
    weekBonusPoints(bonus, player.id) +
    ajouts.reduce((s, i) => s + i.points, 0) -
    retraits.reduce((s, i) => s + i.points, 0);

  /** Une puce est déclarable tant que les plafonds le permettent. Les
      paliers d'une même échelle se cumulent depuis la migration 22 :
      +50 pompes et +100 pompes cochés, c'est 150 pompes déclarées. */
  function blocked(item: BonusCatalogItem): boolean {
    if (item.kind !== "exercise") return false; // le boss échappe aux plafonds
    return mineCount >= capDay || weekUsed + item.points > capWeek;
  }

  /** Un déplacement déclaré ferme-t-il les deux autres puces ? Une puce
      éteinte sans un mot passerait pour un bug — c'est la seule raison de
      fermeture que le joueur ne peut pas deviner.

      Lu sur les puces réellement affichées, pas sur le catalogue : la
      phrase doit décrire ce que le joueur voit, jamais une puce de plus. */
  const movementClash = [...affichees.values()].some(
    (item) =>
      !choisies.has(item.key) &&
      movementLockedBy(bonus.catalog, retenues, item),
  );

  // Le bandeau de l'événement est derrière la feuille : sans cette
  // ligne, les puces ×2 arriveraient sans personne pour les annoncer.
  // Une seule phrase, et seulement les jours de doublement.
  //
  // L'ordre sert aussi au halo : les puces doublées s'allument de haut en
  // bas plutôt que toutes ensemble, l'œil suit la liste au lieu de choisir.
  const x2Order = new Map<string, number>();
  for (const g of groups) {
    for (const item of g.items) {
      if (doubledToday(bonus, item) && !x2Order.has(item.key)) {
        x2Order.set(item.key, x2Order.size);
      }
    }
  }
  const doubleDay = x2Order.size > 0;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60"
      onClick={abandonner}
      role="dialog"
      aria-modal="true"
      aria-label="Déclarer un bonus"
    >
      {/* Le transform du glissé vit sur cette enveloppe : sur la feuille
          elle-même, il se ferait écraser par l'animation d'entrée
          (rise-in, fill both, et une animation bat un style inline). */}
      <div
        ref={feuille}
        className={`sheet-drag${tire ? " is-dragging" : ""}`}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      >
        <div
          className="rise-in flex max-h-[80dvh] flex-col rounded-t-3xl bg-raised px-5 pt-4 pb-safe"
          onClick={(e) => e.stopPropagation()}
        >
          {/* La prise : la poignée et le titre. Plus bas, le doigt appartient
            à la liste de puces, qui a son propre défilement — et depuis le
            rangement par familles, elle en a bien plus à faire défiler. */}
          <div {...prise}>
            <div
              className="mx-auto mb-4 h-1 w-10 rounded-full bg-line"
              aria-hidden
            />
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
            {doubleDay && bonus.event && (
              <p className="mb-3 text-[13px] font-medium text-muted">
                <span aria-hidden>🎲 </span>
                {bonus.event.label} — les puces ×2 rapportent le double.
              </p>
            )}
          </div>

          {/* Vingt-trois pastilles à plat, c'était un mur. Quatre paquets
            titrés : on cherche « du cardio », pas une pastille précise. */}
          <div className="flex flex-col gap-4 overflow-y-auto pb-1">
            {groups.map((g) => (
              <div key={g.title ?? "tout"}>
                {g.title && (
                  <h3 className="mb-2 text-xs font-bold tracking-wide text-faint uppercase">
                    {g.title}
                  </h3>
                )}
                {/* Le badge ×2 déborde en haut de la puce : les jours de
                  doublement, la rangée respire un cran de plus, sinon il
                  vient buter contre la puce du dessus. */}
                <div
                  className={`flex flex-wrap content-start gap-2 ${
                    doubleDay ? "gap-y-4 pt-1.5" : ""
                  }`}
                >
                  {g.items.map((item) => {
                    // Cochée dans le brouillon, ce qui inclut ce qui est
                    // déjà déclaré aujourd'hui : la puce a exactement
                    // l'allure qu'elle avait quand elle écrivait direct.
                    const claimed = choisies.has(item.key);
                    // Doublée par le tirage du jour : la puce le dit, et
                    // le dit avant le tap. Pas de réordonnancement — on
                    // vise une pastille connue, la déplacer coûterait
                    // plus de secondes que le ×2 n'en fait gagner.
                    const x2 = doubledToday(bonus, item);
                    // Deux raisons d'éteindre une puce : les plafonds, et
                    // l'exclusion de déplacement. Seule la seconde s'explique
                    // sous les groupes — l'autre est déjà lisible au compteur.
                    const off =
                      !claimed &&
                      (blocked(item) ||
                        movementLockedBy(bonus.catalog, retenues, item));
                    return (
                      <button
                        key={item.key}
                        aria-pressed={claimed}
                        disabled={off}
                        onClick={() => {
                          navigator.vibrate?.(claimed ? 8 : 18);
                          basculer(item.key);
                        }}
                        className="relative flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold whitespace-nowrap transition-transform active:scale-[0.97] disabled:opacity-35"
                        style={
                          claimed
                            ? {
                                background: `color-mix(in oklch, ${player.color} 22%, var(--color-surface))`,
                                boxShadow: `inset 0 0 0 1.5px color-mix(in oklch, ${player.color} 65%, transparent)`,
                                color: player.color,
                              }
                            : {
                                // L'or, pas la couleur joueur : l'événement
                                // est le même pour tout le groupe, il
                                // n'appartient à personne. Le trait seul ne
                                // se voyait pas — une puce doublée doit
                                // sortir de la liste, c'est tout son intérêt.
                                background: x2
                                  ? "color-mix(in oklch, var(--color-x2) 14%, var(--color-surface))"
                                  : "var(--color-surface)",
                                boxShadow: x2
                                  ? "inset 0 0 0 1.5px color-mix(in oklch, var(--color-x2) 70%, transparent)"
                                  : "inset 0 0 0 1px var(--color-line)",
                                color: "var(--color-ink)",
                              }
                        }
                      >
                        {/* Une onde, une fois, au moment où la feuille
                          s'ouvre. Éteinte sur une puce déjà déclarée ou
                          hors plafond : elle appellerait un tap impossible. */}
                        {x2 && !off && !claimed && (
                          <span
                            className="x2-halo pointer-events-none absolute inset-0 rounded-full"
                            style={{
                              animationDelay: `${260 + 70 * (x2Order.get(item.key) ?? 0)}ms`,
                            }}
                            aria-hidden
                          />
                        )}
                        <span aria-hidden>{item.emoji}</span>
                        {item.label}
                        <span
                          className="font-medium"
                          style={{
                            color: claimed
                              ? player.color
                              : x2
                                ? "var(--color-x2)"
                                : "var(--color-faint)",
                          }}
                        >
                          {/* Le montant déjà doublé : « +1 ×2 » laissait la
                            multiplication au joueur, et un bonus qu'on doit
                            calculer n'attire personne. Facteur exact 2,
                            vérifié en base (migration 33). */}
                          +{fmtPoints(pointsToday(bonus, item))}
                        </span>
                        {claimed && <span aria-hidden>✓</span>}
                        {/* Le ×2 est posé sur le contour, pas dans la ligne :
                          au milieu du texte il se lisait comme une deuxième
                          valeur à côté des points. Sur le bord, c'est une
                          étiquette collée sur la puce — elle qualifie la
                          puce entière, et elle survit à la coche. */}
                        {/* Il ne déborde que par le haut : la liste des
                          groupes est en overflow-y-auto, ce qui fait passer
                          overflow-x de visible à auto. Un badge qui dépasse
                          à droite d'une puce en bout de rangée se ferait
                          rogner, ou ouvrirait un défilement horizontal. */}
                        {x2 && (
                          <span className="num-display bg-x2 text-bg absolute -top-2 right-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold">
                            ×2
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {/* Le reste du catalogue, derrière un seul geste. Une
                    puce parmi les puces — même rangée, même hauteur — mais
                    en retrait : elle n'est pas une déclaration. */}
                  {!tout && (
                    <button
                      onClick={() => {
                        navigator.vibrate?.(8);
                        setTout(true);
                      }}
                      className="min-h-11 rounded-full px-4 text-sm font-bold text-quiet transition-transform active:scale-[0.97]"
                      style={{
                        background: "var(--color-surface)",
                        boxShadow: "inset 0 0 0 1px var(--color-line)",
                      }}
                    >
                      Tout voir
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {movementClash && (
            // `quiet`, pas `faint` : c'est la seule explication des puces
            // éteintes — une information seule, elle doit se lire (DESIGN.md).
            <p className="mt-3 text-[11px] font-medium text-quiet">
              🚶 Un seul déplacement par jour : 5 km, 10 km ou 10 000 pas. Tes
              kilomètres comptent une fois. Décoche pour changer.
            </p>
          )}

          {/* Le seul chemin qui écrit. Il s'allume à la couleur du joueur
            dès qu'il y a quelque chose à envoyer, et annonce le gain net,
            doublement compris — c'est le même montant que celui promis
            par les puces juste au-dessus. Sans rien à valider, il reste
            gris et ne fait que fermer : un bouton de sortie, comme avant. */}
          <button
            onClick={valider}
            className="mt-4 mb-2 min-h-12 w-full rounded-2xl font-bold transition-transform active:scale-[0.99]"
            style={
              enAttente > 0
                ? { background: player.color, color: "oklch(0.15 0 0)" }
                : {
                    background: "var(--color-surface)",
                    color: "var(--color-ink)",
                  }
            }
          >
            Valider
            {gainNet > 0 && (
              <span className="num-display ml-1.5">+{fmtPoints(gainNet)}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
