"use client";

// "Qui es-tu ?" — sélection ou création du joueur. Aucun compte, aucun email.
// Gère les doublons (cache vidé), les fantômes (faute de frappe) et le cap à 12.

import { useMemo, useState } from "react";
import { CreateResult } from "@/hooks/useChallengeData";
import { Entry, Player } from "@/lib/types";
import { Avatar, BigButton } from "./ui";

const MAX_PLAYERS = 12;

type Props = {
  players: Player[];
  entries: Map<string, Entry>;
  onSelect: (player: Player) => void;
  onCreate: (name: string) => Promise<CreateResult>;
  onDelete: (playerId: string) => Promise<boolean>;
};

export default function PlayerSelect({
  players,
  entries,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  // Liste vide → champ de création affiché direct, sans détour.
  const [creating, setCreating] = useState(players.length === 0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<Player | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Joueurs supprimables : zéro entrée. Une seule coche = indestructible.
  const hasEntries = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries.values()) set.add(e.player_id);
    return set;
  }, [entries]);

  const full = players.length >= MAX_PLAYERS;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await onCreate(name);
    setBusy(false);
    if (result.status === "created") onSelect(result.player);
    else if (result.status === "duplicate") setDuplicate(result.player);
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-safe pb-safe">
      <header className="mt-10 mb-8">
        <h1 className="text-3xl font-bold">Qui es-tu&nbsp;?</h1>
        <p className="mt-1 text-muted">Ton choix reste sur ce téléphone.</p>
      </header>

      <div className="flex flex-col gap-3">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <button
              onClick={() => onSelect(p)}
              className="flex min-h-16 flex-1 items-center gap-4 rounded-2xl bg-surface px-4 text-left text-xl font-bold transition-transform active:scale-[0.98]"
            >
              <Avatar name={p.name} color={p.color} />
              {p.name}
            </button>
            {!hasEntries.has(p.id) &&
              (confirmDelete === p.id ? (
                <button
                  onClick={async () => {
                    await onDelete(p.id);
                    setConfirmDelete(null);
                  }}
                  className="min-h-16 rounded-2xl bg-danger/15 px-4 text-sm font-bold text-danger"
                >
                  Supprimer&nbsp;?
                </button>
              ) : (
                <button
                  aria-label={`Supprimer ${p.name}`}
                  onClick={() => setConfirmDelete(p.id)}
                  className="flex size-11 items-center justify-center rounded-full text-faint"
                >
                  ✕
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="mt-6">
        {creating || players.length === 0 ? (
          <form onSubmit={submit}>
            <label htmlFor="name" className="text-sm font-medium text-muted">
              Ton prénom
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDuplicate(null);
              }}
              maxLength={30}
              autoComplete="off"
              autoFocus
              className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-surface px-5 text-lg outline-none focus:border-faint"
            />
            {duplicate && (
              <div className="rise-in mt-3 rounded-2xl bg-surface p-4">
                <p className="font-medium">
                  Ce prénom existe déjà, c&apos;est toi&nbsp;?
                </p>
                <button
                  type="button"
                  onClick={() => onSelect(duplicate)}
                  className="mt-3 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-raised font-bold"
                >
                  <Avatar name={duplicate.name} color={duplicate.color} size={28} />
                  Oui, je suis {duplicate.name}
                </button>
              </div>
            )}
            {full ? (
              <p className="mt-3 text-sm text-muted">
                Groupe complet ({MAX_PLAYERS} joueurs max).
              </p>
            ) : (
              !duplicate && (
                <div className="mt-4">
                  <BigButton disabled={!name.trim() || busy}>
                    {busy ? "…" : "C'est parti"}
                  </BigButton>
                </div>
              )
            )}
          </form>
        ) : (
          !full && (
            <button
              onClick={() => setCreating(true)}
              className="min-h-14 w-full rounded-2xl border border-dashed border-line px-5 font-medium text-muted"
            >
              Je ne suis pas dans la liste
            </button>
          )
        )}
      </div>
    </main>
  );
}
