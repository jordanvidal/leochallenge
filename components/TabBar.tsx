"use client";

// Trois onglets en bas, pouce-friendly. Pas de burger, pas de sidebar.

export type Tab = "today" | "bilan" | "leaderboard" | "history" | "stats";

function IconTrophy() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 4h8v6a4 4 0 0 1-8 0V4ZM8 5H4.5v1.5A3.5 3.5 0 0 0 8 10M16 5h3.5v1.5A3.5 3.5 0 0 1 16 10M12 14v3.5M8.5 20h7M12 17.5c-1.2 0-2 .9-2.4 2.5h4.8c-.4-1.6-1.2-2.5-2.4-2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconToday() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="16"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m8.5 12.5 2.5 2.5 4.5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      {[4, 10.5, 17].flatMap((x) =>
        [4, 10.5, 17].map((y) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="4"
            height="4"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        )),
      )}
    </svg>
  );
}

function IconStats() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 20V13M12 20V5M19 20v-9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBilan() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 21V4M5 4h11l-1.5 3.5L16 11H5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TODAY_TAB = { key: "today" as Tab, label: "Aujourd'hui", icon: IconToday };
const BILAN_TAB = { key: "bilan" as Tab, label: "Bilan", icon: IconBilan };
const REST_TABS: { key: Tab; label: string; icon: () => React.ReactNode }[] = [
  { key: "leaderboard", label: "Classement", icon: IconTrophy },
  { key: "history", label: "Historique", icon: IconHistory },
  { key: "stats", label: "Stats", icon: IconStats },
];

export default function TabBar({
  tab,
  onChange,
  over = false,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
  // Challenge terminé : « Aujourd'hui » s'efface, « Bilan » prend sa place en tête.
  over?: boolean;
}) {
  const tabs = [over ? BILAN_TAB : TODAY_TAB, ...REST_TABS];
  return (
    <nav
      aria-label="Navigation"
      className="sticky bottom-0 z-30 border-t border-line bg-bg/95 pb-safe backdrop-blur"
    >
      <div className="flex">
        {tabs.map(({ key, label, icon: Icon }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              onClick={() => onChange(key)}
              aria-current={active ? "page" : undefined}
              className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1"
              style={{ color: active ? "var(--pc)" : "var(--color-faint)" }}
            >
              <Icon />
              <span className="text-[11px] font-bold">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
