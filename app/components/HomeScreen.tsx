"use client";

import { useState } from "react";
import type { HouseholdEntry } from "../lib/types";
import { isFirebaseConfigured } from "../lib/firebase";
import { joinHousehold, type SetupResult } from "../lib/sync";

export function HomeScreen({
  households,
  onSelect,
  onCreateNew,
  onComplete,
  onRemove,
}: {
  households: HouseholdEntry[];
  onSelect: (entry: HouseholdEntry) => void;
  onCreateNew: () => void;
  onComplete: (result: SetupResult) => Promise<void>;
  onRemove: (code: string) => void;
}) {
  const [joining,     setJoining]     = useState(false);
  const [joinCode,    setJoinCode]    = useState("");
  const [joinError,   setJoinError]   = useState("");
  const [joinLoading, setJoinLoading] = useState(false);

  async function handleJoin() {
    if (!isFirebaseConfigured()) {
      setJoinError("Firebase is not configured yet. Paste your config in app/lib/firebase.ts.");
      return;
    }
    setJoinLoading(true);
    setJoinError("");
    const data = await joinHousehold(joinCode.toUpperCase().trim());
    setJoinLoading(false);
    if (!data) {
      setJoinError("Household not found. Double-check the code.");
      return;
    }
    await onComplete({ type: "join", data, code: joinCode.toUpperCase().trim() });
  }

  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="eyebrow">Our Money</div>
        <h1>Your households</h1>
        <p className="subtle">Select a budget or start a new one.</p>
      </header>

      <div className="household-picker">
        {households.length === 0 && !joining && (
          <div className="empty-page" style={{ paddingTop: 0 }}>
            <div className="setup-emoji">&#x1F3E0;</div>
            <p>No households yet. Create one to get started.</p>
          </div>
        )}

        {households.map(h => (
          <button key={h.code} className="household-item" onClick={() => onSelect(h)}>
            <div className="household-item-info">
              <div className="household-item-name">{h.name}</div>
              <div className="household-item-code">{h.code}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "var(--muted)", fontSize: "1.4rem" }}>&#x203A;</span>
              <button
                className="x-btn"
                aria-label="Remove from list"
                onClick={e => { e.stopPropagation(); onRemove(h.code); }}
              >
                &#xD7;
              </button>
            </div>
          </button>
        ))}

        {joining && (
          <div className="join-form">
            <div className="field-label">Enter household code</div>
            <input
              className="field"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCDEF"
              maxLength={6}
              style={{ letterSpacing: "0.25em", fontFamily: "monospace", fontSize: "1.4rem", textAlign: "center" }}
              autoFocus
              onKeyDown={e => e.key === "Enter" && joinCode.length === 6 && handleJoin()}
            />
            {joinError && (
              <p style={{ color: "#f87171", fontSize: "0.82rem", marginTop: 8 }}>{joinError}</p>
            )}
            <button className="primary-action full" style={{ marginTop: 14 }}
              disabled={joinCode.length !== 6 || joinLoading}
              onClick={handleJoin}>
              {joinLoading ? "Joining..." : "Join household"}
            </button>
            <button className="text-button" style={{ marginTop: 12, fontSize: "0.82rem" }}
              onClick={() => { setJoining(false); setJoinCode(""); setJoinError(""); }}>
              &#x2190; Back
            </button>
          </div>
        )}
      </div>

      {!joining && (
        <div className="home-actions">
          <button className="primary-action" onClick={onCreateNew}>
            + Create new household
          </button>
          {isFirebaseConfigured() && (
            <button className="secondary-action" style={{ boxShadow: "none" }}
              onClick={() => setJoining(true)}>
              Join with a code
            </button>
          )}
        </div>
      )}
    </main>
  );
}
