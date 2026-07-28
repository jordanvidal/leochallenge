"use client";

// Les deux feuilles du tchat : les actions sur un message (appui long) et
// le réglage des notifications.
//
// Feuilles et pas menus flottants : un menu en `position: absolute` dans
// une liste qui défile se fait rogner par le premier conteneur qui
// découpe, et il faut viser au pouce dans le noir. Une feuille arrive
// par le bas, là où le pouce est déjà.

import { CHAT_EMOJIS, NotifyPref } from "@/lib/chat";

/** Le châssis commun : voile, panneau bas, fermeture au tap dehors. */
function Sheet({
  onClose,
  label,
  children,
}: {
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="rise-in relative rounded-t-3xl bg-raised px-5 pt-4 pb-safe">
        {children}
        <div className="h-2" />
      </div>
    </div>
  );
}

/** Actions sur un message : réagir, répondre, et supprimer si c'est le mien. */
export function MessageSheet({
  mine,
  supprime,
  onReact,
  onReply,
  onDelete,
  onClose,
}: {
  mine: boolean;
  supprime: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} label="Actions sur le message">
      {!supprime && (
        <div className="flex justify-between gap-1">
          {CHAT_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => {
                onReact(e);
                onClose();
              }}
              aria-label={`Réagir ${e}`}
              className="flex size-14 items-center justify-center rounded-2xl bg-surface text-2xl transition-transform active:scale-95"
            >
              {e}
            </button>
          ))}
        </div>
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
