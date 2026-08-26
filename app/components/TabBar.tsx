"use client";

export function TabBar({
  tab,
  setTab,
}: {
  tab: string;
  setTab: (t: "dash" | "history" | "settings") => void;
}) {
  const tabs = [
    { id: "dash"     as const, icon: "&#x1F4B0;",          label: "Budget"   },
    { id: "history"  as const, icon: "&#x1F4C5;",          label: "History"  },
    { id: "settings" as const, icon: "&#x2699;&#xFE0F;",   label: "Settings" },
  ];
  return (
    <nav className="tab-bar">
      {tabs.map(({ id, icon, label }) => (
        <button
          key={id}
          className={tab === id ? "active" : ""}
          onClick={() => setTab(id)}
        >
          <span className="tab-icon" dangerouslySetInnerHTML={{ __html: icon }} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
