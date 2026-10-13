"use client";

type Tab = "dash" | "history" | "settings";

function NavIcon({ kind }: { kind: "budget" | "history" | "settings" }) {
  const common = { width: 23, height: 23, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (kind === "budget") return (
    <svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18M8 15h3" /></svg>
  );
  if (kind === "history") return (
    <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4M17 3v4M3 10h18M8 14h3M8 18h5" /></svg>
  );
  return (
    <svg {...common}><path d="M12 3.5l1.6 1.2 2-.2.8 1.9 1.9.8-.2 2L19.5 11l-1.4 1.8.2 2-1.9.8-.8 1.9-2-.2-1.6 1.2-1.6-1.2-2 .2-.8-1.9-1.9-.8.2-2L4.5 11l1.4-1.8-.2-2 1.9-.8.8-1.9 2 .2L12 3.5z" /><circle cx="12" cy="11" r="2.6" /></svg>
  );
}

export function TabBar({
  tab,
  setTab,
  onAdd,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  onAdd: () => void;
}) {
  return (
    <nav className="tab-bar" aria-label="Main navigation">
      <button type="button" className={tab === "dash" ? "active" : ""}
        aria-current={tab === "dash" ? "page" : undefined} onClick={() => setTab("dash")}>
        <NavIcon kind="budget" /><span>Overview</span>
      </button>
      <button type="button" className={tab === "history" ? "active" : ""}
        aria-current={tab === "history" ? "page" : undefined} onClick={() => setTab("history")}>
        <NavIcon kind="history" /><span>History</span>
      </button>
      <button type="button" className="nav-add" onClick={onAdd} aria-label="Add an expense">
        <span className="nav-add-symbol" aria-hidden="true">+</span><span>Add</span>
      </button>
      <button type="button" className={tab === "settings" ? "active" : ""}
        aria-current={tab === "settings" ? "page" : undefined} onClick={() => setTab("settings")}>
        <NavIcon kind="settings" /><span>Settings</span>
      </button>
    </nav>
  );
}
