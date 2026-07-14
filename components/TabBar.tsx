"use client";

// Trois onglets en bas, pouce-friendly. Pas de burger, pas de sidebar.

export type Tab = "today" | "history" | "stats";

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

const TABS: { key: Tab; label: string; icon: () => React.ReactNode }[] = [
  { key: "today", label: "Aujourd'hui", icon: IconToday },
  { key: "history", label: "Historique", icon: IconHistory },
  { key: "stats", label: "Stats", icon: IconStats },
];

export default function TabBar({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav
      aria-label="Navigation"
      className="sticky bottom-0 z-30 border-t border-line bg-bg/95 pb-safe backdrop-blur"
    >
      <div className="flex">
        {TABS.map(({ key, label, icon: Icon }) => {
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
