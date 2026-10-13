"use client";

export function TabBar({
  tab,
  setTab,
}: {
  tab: string;
  setTab: (t: "dash" | "history" | "settings") => void;
}) {
  const tabs = [
    { id: "dash" as const, label: "Overview" },
    { id: "history" as const, label: "History" },
    { id: "settings" as const, label: "Settings" },
  ];
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      {tabs.map(({ id, label }) => (
        <button type="button" key={id} aria-current={tab === id ? "page" : undefined}
          className={tab === id ? "active" : ""}
          onClick={() => setTab(id)}>
          <span className="tab-icon" aria-hidden="true">
            {id === "dash" && (
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.8" />
                <rect x="14" y="3" width="7" height="7" rx="1.8" />
                <rect x="3" y="14" width="7" height="7" rx="1.8" />
                <rect x="14" y="14" width="7" height="7" rx="1.8" />
              </svg>
            )}
            {id === "history" && (
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3.5 5.5h17v15h-17zM7.5 3v5M16.5 3v5M3.5 10h17M8 14h2M14 14h2M8 18h2" />
              </svg>
            )}
            {id === "settings" && (
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="m19.1 13.3 1.3 1-2 3.5-1.6-.6a7.8 7.8 0 0 1-2 1.1l-.3 1.7h-4l-.3-1.7a7.9 7.9 0 0 1-2-1.1l-1.6.6-2-3.5 1.3-1a8.1 8.1 0 0 1 0-2.5l-1.3-1 2-3.5 1.6.6a7.9 7.9 0 0 1 2-1.1l.3-1.7h4l.3 1.7a7.8 7.8 0 0 1 2 1.1l1.6-.6 2 3.5-1.3 1a8.1 8.1 0 0 1 0 2.5z" />
              </svg>
            )}
          </span>
          <span className="tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
