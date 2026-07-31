"use client";

// Le lecteur d'une note vocale dans la bulle.
//
// Aucune couleur en dur : tout est tiré de `currentColor`, que la bulle
// a déjà réglé (sombre sur l'accent quand c'est moi, `ink` sur
// `surface` sinon). C'est ce qui permet au même composant de tenir des
// deux côtés de la conversation sans rien savoir de qui parle.
//
// Pas de forme d'onde. Il faudrait décoder le fichier entier pour la
// dessiner honnêtement, et une forme d'onde inventée serait exactement
// l'« élément décoratif gratuit » que PRODUCT.md refuse. Une barre de
// progression dit la même chose et dit vrai.

import { useEffect, useRef, useState } from "react";
import { dureeLisible, preparerLecture } from "@/lib/audio";
import { chatVocalUrl } from "@/lib/chatVocaux";

/** Le vocal en cours d'écoute, quel que soit le message. Deux vocaux qui
    parlent en même temps ne s'écoutent ni l'un ni l'autre ; lancer le
    suivant arrête donc le précédent. */
let enCours: HTMLAudioElement | null = null;

export function ChatVocal({ path, ms }: { path: string; ms: number }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [joue, setJoue] = useState(false);
  /** On a demandé la lecture, le son n'est pas encore sorti. Le fichier
      n'est téléchargé qu'à ce moment-là (`preload="none"`). */
  const [attend, setAttend] = useState(false);
  const [ecoule, setEcoule] = useState(0);
  const [casse, setCasse] = useState(false);

  // Quitter le tchat pendant une écoute ne doit pas laisser le son
  // continuer par-dessus l'écran suivant.
  useEffect(() => {
    const el = audio.current;
    return () => {
      if (el && enCours === el) enCours = null;
      el?.pause();
    };
  }, []);

  const total = ms / 1000;
  // La durée vient de la BASE et jamais du fichier : un WebM de
  // MediaRecorder n'en porte pas, et `el.duration` y rend `Infinity`
  // tant que tout n'est pas téléchargé (lib/audio.ts, migration45).
  const fraction = total > 0 ? Math.min(1, ecoule / total) : 0;

  function basculer() {
    const el = audio.current;
    if (!el || casse) return;
    if (joue) {
      el.pause();
      return;
    }
    // Sur un iPhone dont l'interrupteur latéral est sur silencieux, sans
    // ça, rien ne sort et le lecteur a l'air cassé.
    preparerLecture();
    if (enCours && enCours !== el) enCours.pause();
    enCours = el;
    setAttend(true);
    el.play().catch(() => {
      setAttend(false);
      setCasse(true);
    });
  }

  /** Se déplacer dans le vocal en appuyant sur la barre. Ignoré tant que
      le lecteur ne connaît pas de durée finie : un WebM pas encore
      téléchargé ne sait pas où aller, et sauter à l'aveugle le remettrait
      au début. */
  function pointer(e: React.PointerEvent<HTMLDivElement>) {
    const el = audio.current;
    if (!el || casse || !Number.isFinite(el.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const part = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = part * el.duration;
    setEcoule(el.currentTime);
  }

  return (
    // Les gestes de la bulle (glisser pour répondre, appui long pour la
    // feuille) courent toujours sur le reste de la ligne ; seuls les deux
    // contrôles gardent leurs pointeurs pour eux, comme la pastille de
    // réactions. Sans ça, un appui un peu long sur play ouvrirait la
    // feuille d'actions au lieu de lancer la lecture.
    <div className="flex min-w-45 items-center gap-2.5 py-0.5">
      <audio
        ref={audio}
        src={chatVocalUrl(path)}
        // Rien ne se télécharge tant que personne n'appuie : ouvrir
        // l'onglet ne doit pas tirer les vingt derniers vocaux du salon.
        preload="none"
        onPlaying={() => {
          setAttend(false);
          setJoue(true);
        }}
        onPause={() => {
          setJoue(false);
          setAttend(false);
        }}
        onTimeUpdate={(e) => setEcoule(e.currentTarget.currentTime)}
        onEnded={() => {
          setJoue(false);
          setEcoule(0);
        }}
        // Le cas connu : un vocal encodé en WebM ouvert sur un Safari qui
        // ne sait pas le lire. Le dire vaut mieux qu'un bouton qui ne
        // répond pas (PRODUCT.md, principe 5).
        onError={() => {
          setAttend(false);
          setJoue(false);
          setCasse(true);
        }}
      />

      <button
        onClick={basculer}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        disabled={casse}
        aria-label={joue ? "Mettre en pause" : "Écouter la note vocale"}
        className="flex size-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95 disabled:opacity-40"
        style={{ background: "color-mix(in oklch, currentColor 18%, transparent)" }}
      >
        {joue || attend ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden
            // Le son n'est pas encore sorti : l'icône est déjà celle de la
            // pause, mais en retrait. L'appui a été pris en compte, et ça
            // se voit, sans bloquer quoi que ce soit derrière un sablier.
            style={{ opacity: attend ? 0.5 : 1 }}
          >
            <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <path d="M7.5 5.2l11 6.8-11 6.8z" fill="currentColor" />
          </svg>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            pointer(e);
          }}
          onPointerUp={(e) => e.stopPropagation()}
          role="presentation"
          className="h-1 w-full overflow-hidden rounded-full"
          style={{
            background: "color-mix(in oklch, currentColor 22%, transparent)",
          }}
        >
          <div
            className="h-full rounded-full"
            // Pas de transition : `timeupdate` tombe quatre fois par
            // seconde, et une animation entre deux points la ferait
            // traîner derrière le son.
            style={{
              width: `${fraction * 100}%`,
              background: "currentColor",
            }}
          />
        </div>
        <span className="text-[11px] tabular-nums" style={{ opacity: 0.7 }}>
          {casse
            ? "Lecture impossible ici"
            : // Le temps écoulé pendant l'écoute, la durée totale au
              // repos : c'est ce qu'on veut savoir dans chacun des deux
              // cas, et ça évite d'afficher « 0:00 / 0:34 » en permanence.
              dureeLisible((joue || ecoule > 0 ? ecoule : total) * 1000)}
        </span>
      </div>
    </div>
  );
}
