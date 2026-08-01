"use client";

// Les deux feuilles du tchat : les actions sur un message (appui long) et
// le réglage des notifications.
//
// Feuilles et pas menus flottants : un menu en `position: absolute` dans
// une liste qui défile se fait rogner par le premier conteneur qui
// découpe, et il faut viser au pouce dans le noir. Une feuille arrive
// par le bas, là où le pouce est déjà.

import { CHAT_EMOJIS, ChatReaction, NotifyPref } from "@/lib/chat";
import { Sheet } from "../ui";
import { Player } from "@/lib/types";

/** Actions sur un message : réagir, répondre, et supprimer si c'est le mien. */
export function MessageSheet({
  mine,
  supprime,
  reactions,
  byId,
  myId,
  onReact,
  onReply,
  onDelete,
  onClose,
}: {
  mine: boolean;
  supprime: boolean;
  reactions: ChatReaction[];
  byId: Map<string, Player>;
  myId: string;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const mesEmojis = new Set(
    reactions.filter((r) => r.player_id === myId).map((r) => r.emoji),
  );
  // Qui a mis quoi. C'est ce que le tapback ne peut pas dire : posé sur la
  // bulle, il montre les emojis mais pas les gens. Cette feuille est donc
  // l'endroit où l'on apprend qui, et c'est pour ça qu'un tap dessus
  // l'ouvre.
  const parEmoji = [...new Set(reactions.map((r) => r.emoji))].map((emoji) => ({
    emoji,
    qui: reactions
      .filter((r) => r.emoji === emoji)
      .map((r) => byId.get(r.player_id))
      .filter((p): p is Player => Boolean(p)),
  }));

  return (
    <Sheet onClose={onClose} label="Actions sur le message">
      {!supprime && (
        <div className="flex justify-between gap-1">
          {CHAT_EMOJIS.map((e) => {
            const deja = mesEmojis.has(e);
            return (
              <button
                key={e}
                onClick={() => {
                  onReact(e);
                  onClose();
                }}
                aria-pressed={deja}
                aria-label={deja ? `Retirer ${e}` : `Réagir ${e}`}
                className="flex size-14 items-center justify-center rounded-2xl text-2xl transition-transform active:scale-95"
                style={{
                  background: deja
                    ? "color-mix(in oklch, var(--pc) 22%, var(--color-surface))"
                    : "var(--color-surface)",
                  boxShadow: deja
                    ? "inset 0 0 0 1.5px color-mix(in oklch, var(--pc) 60%, transparent)"
                    : undefined,
                }}
              >
                {e}
              </button>
            );
          })}
        </div>
      )}

      {parEmoji.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {parEmoji.map(({ emoji, qui }) => (
            <li key={emoji} className="flex items-baseline gap-2 text-sm">
              <span className="shrink-0">{emoji}</span>
              <span className="min-w-0">
                {qui.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && <span className="text-faint">, </span>}
                    <span className="font-bold" style={{ color: p.color }}>
                      {p.id === myId ? "toi" : p.name}
                    </span>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-col">
        {!supprime && (
          <button
            onClick={() => {
              onReply();
              onClose();
            }}
            className="min-h-13 border-b border-line py-3 text-left font-bold"
          >
            Répondre
          </button>
        )}
        {mine && !supprime && (
          <button
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="min-h-13 py-3 text-left font-bold"
            style={{ color: "var(--color-danger)" }}
          >
            Supprimer le message
          </button>
        )}
        {supprime && (
          <p className="py-3 text-sm text-muted">
            Ce message a été supprimé par son auteur.
          </p>
        )}
      </div>
    </Sheet>
  );
}

const CHOIX: { key: NotifyPref; titre: string; detail: string }[] = [
  {
    key: "tous",
    titre: "Tous les messages",
    detail: "Comme WhatsApp. C'est le réglage par défaut.",
  },
  {
    key: "mentions",
    titre: "Seulement les mentions",
    detail: "Quand quelqu'un écrit ton prénom précédé d'un @.",
  },
  {
    key: "aucune",
    titre: "Aucune notification",
    detail: "La pastille continue de compter les non-lus.",
  },
];

/** Le réglage des notifications, atteignable depuis le tchat lui-même :
    un mute qu'on ne trouve pas ne sert à rien, et celui qui veut couper
    le bruit le veut à l'instant où le bruit le dérange. */
export function NotifySheet({
  value,
  onChange,
  onClose,
}: {
  value: NotifyPref;
  onChange: (v: NotifyPref) => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} label="Notifications du tchat">
      <h2 className="text-lg font-bold">Me prévenir</h2>
      <ul className="mt-2 flex flex-col">
        {CHOIX.map(({ key, titre, detail }) => {
          const actif = key === value;
          return (
            <li key={key}>
              <button
                onClick={() => {
                  onChange(key);
                  onClose();
                }}
                aria-pressed={actif}
                className="flex min-h-14 w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0"
              >
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded-full"
                  style={{
                    boxShadow: actif
                      ? "inset 0 0 0 6px var(--pc)"
                      : "inset 0 0 0 1.5px var(--color-line)",
                  }}
                />
                <span className="min-w-0">
                  <span className="block font-bold">{titre}</span>
                  <span className="block text-xs text-muted">{detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
