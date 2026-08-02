"use client";

// Stats = le profil, pas un tableau de bord. Une grande carte pour soi, une
// ligne par pote.
//
// L'ancienne version alignait trois tuiles par joueur — jours parfaits,
// complétion, série. Les trois disaient la même chose : personne ne fait de
// journée partielle, donc « complétion » valait exactement « jours parfaits
// ÷ jours écoulés ». Huit cartes, un seul chiffre répété.
//
// Ce qui les remplace vient de données que l'app possédait déjà sans jamais
// les montrer : l'heure de chaque validation (le créneau) et la durée des
// séances guidées. Plus la meilleure série, calculée depuis le premier jour
// par computeStats et jamais affichée.

import { useEffect, useState } from "react";
import { elapsedDays } from "@/lib/challenge";
import { BADGES, Gamification } from "@/lib/gamification";
import {
  clockOf,
  fetchProfiles,
  hourCounts,
  Profile,
  slotLabel,
} from "@/lib/profile";
import { computeStats } from "@/lib/stats";
import { Entry, Player } from "@/lib/types";
import HistoryGrid from "./HistoryGrid";
import { EditablePhotoAvatar, IconJoker, Skeleton } from "./ui";
import { useFenetre } from "./ligue/LigueContexte";

type Props = {
  player: Player;
  players: Player[];
  entries: Map<string, Entry>;
  /** 😴 Les jours off tirés jusqu'ici. Absent tant que le catalogue
      n'est pas chargé, ou hors du challenge d'origine. */
  joursOff?: Set<string>;
  gamification: Gamification | null;
  /** Reprises épuisées : la tuile joker se tait plutôt que de faire
      respirer un loader qui n'aboutira pas. */
  gamificationEnPanne: boolean;
  onShareWeek: () => void;
  /** Changer sa propre photo depuis son profil, sans repasser par
      « Qui es-tu ? ». */
  onSetPhoto: (playerId: string, photo: string) => Promise<boolean>;
  /** Passé à la grille d'historique : ses cases expliquent au tap. */
  showToast: (msg: string) => void;
  /** Les trois gestes de profil, descendus du pied de page global : ils
      étaient sous la barre d'onglets sur tous les écrans, y compris le
      chemin des dix secondes. Stats porte déjà le profil. */
  onReplayTuto: () => void;
  /** null hors de la fenêtre où l'écran de lancement a encore un sens. */
  onReplayLaunch: (() => void) | null;
  onForget: () => void;
};

/**
 * La bande des 24 heures. Un cran par heure, haut comme le nombre de
 * validations tombées dedans. Ce n'est pas un graphique : il n'y a ni axe
 * ni valeur à lire, juste une forme — du matin ou du soir, régulier ou
 * dispersé. Les heures vides restent visibles en creux, sinon on ne voit
 * plus que le créneau ne couvre qu'un cinquième de la journée.
 */
function HourStrip({
  hours,
  color,
  height,
}: {
  hours: number[];
  color: string;
  height: number;
}) {
  const cells = hourCounts(hours);
  const peak = Math.max(1, ...cells);
  return (
    <div
      className="flex items-end gap-px"
      style={{ height }}
      aria-hidden
    >
      {cells.map((n, h) => (
        <span
          key={h}
          className="flex-1 rounded-[2px]"
          style={
            n === 0
              ? { height: 3, background: "var(--color-raised)" }
              : {
                  height: 3 + Math.round((n / peak) * (height - 3)),
                  background: color,
                  opacity: 0.45 + 0.55 * (n / peak),
                }
          }
        />
      ))}
    </div>
  );
}

function Fact({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex-1 rounded-xl bg-bg px-2.5 py-2">
      <p className="num-display text-xl">{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight font-semibold text-muted">
        {label}
      </p>
    </div>
  );
}

export default function StatsScreen({
  player,
  players,
  entries,
  joursOff,
  gamification,
  gamificationEnPanne,
  onShareWeek,
  onSetPhoto,
  showToast,
  onReplayTuto,
  onReplayLaunch,
  onForget,
}: Props) {
  const f = useFenetre();
  const [profiles, setProfiles] = useState<Map<string, Profile> | null>(null);
  useEffect(() => {
    // Un rejet laisserait `profiles` à null pour toujours, donc des blocs
    // gris qui respirent sans fin. La map vide, elle, dit « rien à montrer ».
    fetchProfiles()
      .then(setProfiles)
      .catch(() => setProfiles(new Map()));
  }, []);

  const elapsed = elapsedDays(f).length;
  const mine = computeStats(player.id, entries, f);
  const myProfile = profiles?.get(player.id);
  const mySlot = myProfile ? slotLabel(myProfile.hours) : null;
  const myBadges = gamification?.badges.get(player.id) ?? [];
  // Le joker a trois états, pas deux : brûlé, intact, et « on ne sait pas
  // encore ». Le classement met une seconde à revenir, il ne revient jamais
  // hors ligne, et `fetchGamification` rend null dès qu'un de ses appels
  // échoue — sans retry. Traiter ce troisième cas comme « intact », c'est
  // affirmer le contraire de la vérité à qui a déjà brûlé le sien. Tant
  // qu'on ne sait pas, on se tait (comme le créneau plus bas).
  const myRow = gamification?.total.find((r) => r.player_id === player.id);
  const jokerDay = myRow?.joker_day ?? null;
  // undefined = ligne absente, ou colonne absente de la RPC (migration 24
  // pas encore jouée) ; null = joker bel et bien intact.
  const jokerKnown = myRow?.joker_day !== undefined;

  // Les autres, du plus régulier au moins régulier. Pas par points : ce
  // serait le Classement en double, et ce n'est pas la question ici.
  const others = players
    .filter((p) => p.id !== player.id)
    .map((p) => ({ p, s: computeStats(p.id, entries, f) }))
    .sort((a, b) => b.s.bestStreak - a.s.bestStreak);

  return (
    <div className="flex min-h-full flex-col px-5 pt-safe">
      <h1 className="mt-4 mb-4 text-2xl font-bold">Stats</h1>

      {/* ---- Moi ---- */}
      <section
        className="rounded-3xl p-4"
        style={{
          background: `color-mix(in oklch, ${player.color} 8%, var(--color-surface))`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${player.color} 22%, transparent)`,
        }}
        aria-label="Ton profil"
      >
        <div className="flex items-center gap-2.5">
          <EditablePhotoAvatar player={player} onSetPhoto={onSetPhoto} size={32} />
          <span className="font-bold">Toi</span>
          {jokerKnown && (
            <span
              className="ml-auto text-muted"
              title={
                jokerDay
                  ? `Joker brûlé le ${jokerDay}`
                  : "Joker de série disponible"
              }
              style={jokerDay ? { opacity: 0.35 } : undefined}
            >
              <IconJoker size={18} />
              {/* Le title d'un span non focusable n'existe pour personne
                  d'autre que la souris : l'état du joker passe en sr-only. */}
              <span className="sr-only">
                {jokerDay
                  ? `Joker brûlé le ${jokerDay}`
                  : "Joker de série disponible"}
              </span>
            </span>
          )}
        </div>

        <div className="mt-3 flex items-baseline gap-2">
          <span
            className="num-display text-6xl"
            style={{ color: player.color }}
          >
            {mine.bestStreak}
          </span>
          <span className="text-xs leading-snug font-bold text-muted">
            jours d&apos;affilée
            <br />
            {mine.bestStreak === 0
              ? "ton record t'attend"
              : mine.streak === mine.bestStreak
                ? "ton record — et ta série en cours"
                : `ton record · en cours : ${mine.streak}`}
          </span>
        </div>

        {/* Le créneau : la place est tenue pendant le chargement (sinon la
            carte grandit d'un coup sous le doigt), puis définitivement
            absente pour qui n'a jamais bouclé une journée. */}
        {profiles === null && (
          <div
            className="mt-3.5"
            role="status"
            aria-label="Ton créneau se charge"
          >
            <Skeleton w={110} h={12} radius={6} />
            <Skeleton className="mt-2" h={26} radius={6} />
          </div>
        )}
        {mySlot && myProfile && (
          <div className="mt-3.5">
            <div className="flex items-baseline justify-between text-[11px] font-semibold text-muted">
              <span>Ton créneau</span>
              <b className="text-xs text-ink">
                {mySlot.emoji} {mySlot.moment} · {mySlot.hour}
              </b>
            </div>
            <div className="mt-1.5">
              <HourStrip
                hours={myProfile.hours}
                color={player.color}
                height={26}
              />
            </div>
            {/* Les seules graduations de la bande : elles disent à quelle
                heure on s'entraîne, donc elles se lisent. */}
            <div className="mt-0.5 flex justify-between text-[11px] font-semibold text-quiet">
              <span>0 h</span>
              <span>6 h</span>
              <span>12 h</span>
              <span>18 h</span>
              <span>24 h</span>
            </div>
          </div>
        )}

        <div className="mt-3.5 flex gap-2">
          {profiles === null && <Skeleton className="flex-1" h={56} />}
          {myProfile?.fastestSeconds != null && (
            <Fact
              value={clockOf(myProfile.fastestSeconds)}
              label="ta séance la plus rapide"
            />
          )}
          <Fact
            value={
              <>
                {mine.perfectDays}
                <span className="text-[0.6em]"> / {elapsed}</span>
              </>
            }
            label="jours parfaits"
          />
          {/* Le joker : une tuile grise pendant que le classement arrive,
              plutôt qu'un trou qui se remplit après coup. Ligne absente
              une fois chargé (jamais joué) : rien, comme avant. */}
          {gamification === null && !gamificationEnPanne ? (
            <Skeleton className="flex-1" h={56} />
          ) : (
            jokerKnown && (
              <Fact
                value={<IconJoker size={22} className="text-muted" />}
                label={jokerDay ? "joker brûlé" : "joker intact"}
              />
            )
          )}
        </div>

        {myBadges.length > 0 && <BadgeRow unlocked={myBadges} />}
      </section>

      {/* ---- Les autres ---- */}
      <h2 className="mt-5 mb-1 text-xs font-bold tracking-wide text-faint uppercase">
        Les autres · meilleure série
      </h2>
      {/* Plus de `flex-1` ici : il servait à pousser le bouton de partage tout
          en bas quand la liste finissait l'écran. Il y a maintenant la grille
          derrière, et l'étirement ne ferait qu'un trou au milieu. */}
      <ul className="flex flex-col">
        {others.map(({ p, s }) => {
          const prof = profiles?.get(p.id);
          const active = !!prof && prof.hours.length > 0;
          // Tant que les profils ne sont pas là, on ne sait rien : écrire
          // « pas encore de séance » à tout le monde pendant une seconde,
          // c'est accuser à tort ceux qui ont coché ce matin.
          const chargement = profiles === null;
          return (
            <li
              key={p.id}
              className="flex items-center gap-2.5 border-t border-line py-2 first:border-t-0"
            >
              <span
                className="w-16 shrink-0 truncate text-sm font-bold"
                style={{
                  // `quiet`, pas `faint` : un prénom inactif reste un prénom
                  // à lire — l'état « pas de séance » ne le rend pas décoratif.
                  color: chargement
                    ? "var(--color-muted)"
                    : active
                      ? p.color
                      : "var(--color-quiet)",
                }}
              >
                {p.name}
              </span>
              {chargement ? (
                <>
                  <div className="min-w-0 flex-1">
                    <Skeleton h={14} radius={4} />
                  </div>
                  <Skeleton className="shrink-0" w={36} h={18} radius={6} />
                </>
              ) : active ? (
                <>
                  <div className="min-w-0 flex-1">
                    <HourStrip hours={prof.hours} color={p.color} height={14} />
                  </div>
                  <span
                    className="num-display w-9 shrink-0 text-right text-base"
                    style={{ color: p.color }}
                  >
                    {s.bestStreak}
                    {/* L'unité suit la taille du chiffre, mais jamais sous
                        11 px : ici le parent est à 16 px, et 0.55em tombait
                        à 8,8 px — la plus petite chose de l'app. */}
                    <span className="text-[max(11px,0.55em)] font-semibold text-muted">
                      {" "}
                      j
                    </span>
                  </span>
                </>
              ) : (
                <>
                  {/* `quiet` : cette ligne est la seule explication de
                      l'absence de bande — une information seule. Le tiret,
                      lui, reste `faint` : il ne fait que tenir la colonne. */}
                  <span className="flex-1 text-[11px] text-quiet">
                    pas encore de séance
                  </span>
                  <span className="w-9 shrink-0 text-right text-faint">—</span>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <button
        onClick={onShareWeek}
        className="mt-4 min-h-12 w-full shrink-0 rounded-2xl bg-surface text-sm font-bold"
      >
        Partager ma semaine 💬
      </button>

      {/* La grille en dernier : c'est l'archive, on descend la chercher. Le
          bouton de partage reste au-dessus d'elle — placé après 2 500 px de
          tableau, plus personne ne l'atteindrait. */}
      <HistoryGrid
        player={player}
        players={players}
        entries={entries}
        joursOff={joursOff}
        gamification={gamification}
        showToast={showToast}
      />

      {/* Les gestes de profil, en bas de l'écran qui porte le profil. Ils
          étaient sous la barre d'onglets, donc sur le chemin d'une coche
          tous les soirs — et masqués à la main sur le tchat, ce qui disait
          déjà qu'ils n'étaient pas chez eux. */}
      <div className="mt-8 flex flex-col items-start gap-1 border-t border-line pt-4">
        <button onClick={onReplayTuto} className="min-h-11 text-sm text-quiet">
          Revoir les règles
        </button>
        {onReplayLaunch && (
          <button
            onClick={onReplayLaunch}
            className="min-h-11 text-sm text-quiet"
          >
            Revoir le lancement
          </button>
        )}
        <button onClick={onForget} className="min-h-11 text-sm text-quiet">
          Ce n&apos;est pas moi ({player.name})
        </button>
      </div>

      <div className="h-3 shrink-0" />
    </div>
  );
}

/** Les badges décrochés, sobres. Les verrouillés ne s'affichent pas :
    une liste de cases vides n'a jamais motivé personne. */
function BadgeRow({ unlocked }: { unlocked: string[] }) {
  const set = new Set(unlocked);
  const earned = BADGES.filter((b) => set.has(b.key));
  if (earned.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {earned.map((b) => (
        <span
          key={b.key}
          title={b.hint}
          className="rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ background: "var(--color-raised)", color: "var(--color-ink)" }}
        >
          {b.emoji} {b.label}
        </span>
      ))}
    </div>
  );
}
