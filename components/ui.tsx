"use client";

// Petites pièces partagées : avatar, pastilles d'exos, toast, boutons.
// Un seul vocabulaire visuel sur tous les écrans.

import { useRef, useState } from "react";
import { fileToAvatarDataUri } from "@/lib/image";
import { Entry, EXERCISES, Player } from "@/lib/types";

/**
 * Avatar du joueur : sa photo si elle existe, sinon l'initiale du prénom.
 * Dans les deux cas l'anneau reste à la couleur du joueur — la couleur, c'est
 * l'identité (PRODUCT.md), une photo la complète, elle ne l'efface pas.
 */
export function Avatar({
  name,
  color,
  size = 44,
  photo,
}: {
  name: string;
  color: string;
  size?: number;
  photo?: string | null;
}) {
  const ring = `inset 0 0 0 1.5px color-mix(in oklch, ${color} 55%, transparent)`;

  if (photo) {
    return (
      <span
        aria-hidden
        className="relative inline-flex shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
        {/* L'anneau par-dessus l'image, sinon object-cover le recouvre. */}
        <span
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: ring }}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        color,
        background: `color-mix(in oklch, ${color} 18%, var(--color-surface))`,
        boxShadow: ring,
      }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Avatar tappable qui ouvre le sélecteur photo pour ce joueur : l'unique
 * point d'entrée « changer ma photo », réutilisé partout où on l'expose
 * (écran « Qui es-tu ? » et son propre profil dans Stats). L'image est
 * recadrée et réduite côté client avant d'être remontée via onSetPhoto.
 */
export function EditablePhotoAvatar({
  player,
  size = 44,
  onSetPhoto,
}: {
  player: Player;
  size?: number;
  onSetPhoto: (playerId: string, photo: string) => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const badge = Math.max(14, Math.round(size * 0.4));

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // autorise re-choisir le même fichier
    if (!file) return;
    setBusy(true);
    const uri = await fileToAvatarDataUri(file);
    if (uri) await onSetPhoto(player.id, uri);
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        aria-label={`Changer la photo de ${player.name}`}
        className="relative shrink-0 rounded-full transition-transform active:scale-95"
        style={busy ? { opacity: 0.5 } : undefined}
      >
        <Avatar
          name={player.name}
          color={player.color}
          photo={player.photo}
          size={size}
        />
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full bg-raised leading-none"
          style={{
            width: badge,
            height: badge,
            fontSize: badge * 0.6,
            boxShadow: "0 0 0 2px var(--color-surface)",
          }}
        >
          📷
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPick}
      />
    </>
  );
}

/** Les 3 pastilles d'un jour (pompes, abdos, squats), pleines ou vides. */
export function ExoDots({
  entry,
  color,
  size = 10,
}: {
  entry: Entry | undefined;
  color: string;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {EXERCISES.map(({ key }) => {
        const done = entry?.[key] ?? false;
        return (
          <span
            key={key}
            className="rounded-full"
            style={{
              width: size,
              height: size,
              background: done ? color : "transparent",
              boxShadow: done
                ? "none"
                : `inset 0 0 0 1.5px var(--color-line)`,
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * Le bloc d'attente : la forme de ce qui arrive, à sa place définitive.
 * Une seule pièce pour toute l'app — un écran qui charge se reconnaît
 * partout pareil, et personne n'invente son propre « Chargement… ».
 *
 * Le comportement (retard de 250 ms puis respiration) vit dans .skeleton,
 * côté CSS : pas de minuteur JS, donc pas de re-rendu pour faire patienter.
 */
export function Skeleton({
  h = 16,
  w = "100%",
  radius = 12,
  className = "",
}: {
  h?: number | string;
  w?: number | string;
  radius?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`skeleton block ${className}`}
      style={{ height: h, width: w, borderRadius: radius }}
    />
  );
}

/** Toast en bas d'écran : erreurs d'écriture, confirmations de copie. */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-6">
      <div className="toast-in rounded-full bg-raised px-5 py-3 text-sm font-medium text-ink shadow-lg shadow-black/40">
        {message}
      </div>
    </div>
  );
}

/** Bouton plein largeur, l'action principale d'un écran. */
export function BigButton({
  children,
  onClick,
  disabled,
  tone = "accent",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "accent" | "neutral";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="min-h-14 w-full rounded-2xl px-5 text-base font-bold transition-transform active:scale-[0.98] disabled:opacity-40"
      style={
        tone === "accent"
          ? {
              background: "var(--pc)",
              color: "oklch(0.15 0 0)",
            }
          : { background: "var(--color-raised)", color: "var(--color-ink)" }
      }
    >
      {children}
    </button>
  );
}
