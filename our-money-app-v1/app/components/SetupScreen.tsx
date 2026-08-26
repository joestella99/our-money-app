"use client";

import { useState } from "react";
import type { HouseholdConfig, BudgetLine } from "../lib/types";
import { money } from "../lib/utils";
import { isFirebaseConfigured } from "../lib/firebase";
import { joinHousehold, generateHouseholdCode, type SetupResult } from "../lib/sync";

export function SetupScreen({
  onComplete,
  onBack,
}: {
  onComplete: (r: SetupResult) => Promise<void>;
  onBack?: () => void;
}) {
  const [step,        setStep]        = useState(0);
  const [name,        setName]        = useState("");
  const [members,     setMembers]     = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState("");
  const [takeHome,    setTakeHome]    = useState("");
  const [savings,     setSavings]     = useState("");
  const [budgets,     setBudgets]     = useState<BudgetLine[]>([]);
  const [catName,     setCatName]     = useState("");
  const [catAmt,      setCatAmt]      = useState("");

  // Join existing household
  const [joining,     setJoining]     = useState(false);
  const [joinCode,    setJoinCode]    = useState("");
  const [joinError,   setJoinError]   = useState("");
  const [joinLoading, setJoinLoading] = useState(false);

  function addMember() {
    const t = memberInput.trim();
    if (t && !members.includes(t)) setMembers(p => [...p, t]);
    setMemberInput("");
  }
  function addBudget() {
    const n = catName.trim(), a = Number(catAmt);
    if (n && a > 0 && !budgets.find(b => b.category === n)) {
      setBudgets(p => [...p, { category: n, amount: a }]);
      setCatName(""); setCatAmt("");
    }
  }
  async function finish() {
    const code = generateHouseholdCode();
    const config: HouseholdConfig = {
      name, members, monthlyTakeHome: Number(takeHome),
      monthlySavingsGoal: Number(savings), budgets,
    };
    await onComplete({ type: "create", config, code });
  }

  async function handleJoin() {
    if (!isFirebaseConfigured()) {
      setJoinError("Firebase is not configured yet. Paste your Firebase config in app/lib/firebase.ts first.");
      return;
    }
    setJoinLoading(true);
    setJoinError("");
    const data = await joinHousehold(joinCode.toUpperCase().trim());
    setJoinLoading(false);
    if (!data) {
      setJoinError("Household not found. Check the code and try again.");
      return;
    }
    await onComplete({ type: "join", data, code: joinCode.toUpperCase().trim() });
  }

  const STEPS = [
    // 0 — name
    <div key="name" className="setup-step">
      <div className="setup-emoji">&#x1F3E0;</div>
      <h1>Name your household</h1>
      <p className="subtle">What should we call this budget?</p>
      <input className="field" value={name} onChange={e => setName(e.target.value)}
        placeholder="e.g. The Johnsons" autoFocus
        onKeyDown={e => e.key === "Enter" && name.trim() && setStep(1)} />
      <button className="primary-action full" disabled={!name.trim()} onClick={() => setStep(1)}>
        Continue
      </button>

      {isFirebaseConfigured() && !joining && (
        <button className="text-button" style={{ marginTop: 20, fontSize: "0.88rem" }}
          onClick={() => setJoining(true)}>
          Join an existing household &#x2192;
        </button>
      )}

      {joining && (
        <div style={{ marginTop: 20 }}>
          <div className="field-label">Household code (6 characters)</div>
          <input
            className="field"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
            maxLength={6}
            style={{ letterSpacing: "0.25em", fontFamily: "monospace", fontSize: "1.3rem", textAlign: "center" }}
            autoFocus
            onKeyDown={e => e.key === "Enter" && joinCode.length === 6 && handleJoin()}
          />
          {joinError && (
            <p style={{ color: "#f87171", fontSize: "0.82rem", margin: "8px 0 0" }}>{joinError}</p>
          )}
          <button className="primary-action full"
            disabled={joinCode.length !== 6 || joinLoading}
            onClick={handleJoin}
            style={{ marginTop: 14 }}>
            {joinLoading ? "Joining..." : "Join household"}
          </button>
          <button className="text-button"
            style={{ marginTop: 12, fontSize: "0.82rem" }}
            onClick={() => { setJoining(false); setJoinCode(""); setJoinError(""); }}>
            &#x2190; Back
          </button>
        </div>
      )}
    </div>,

    // 1 — members
    <div key="members" className="setup-step">
      <div className="setup-emoji">&#x1F465;</div>
      <h1>Who&apos;s in the household?</h1>
      <p className="subtle">Add names for each person. Include &quot;Joint&quot; for shared expenses.</p>
      <div className="row-with-btn">
        <input className="field" value={memberInput} onChange={e => setMemberInput(e.target.value)}
          placeholder="Name" onKeyDown={e => e.key === "Enter" && addMember()} />
        <button className="pill-button" onClick={addMember}>Add</button>
      </div>
      <div className="chip-row">
        {members.map(m => (
          <span key={m} className="chip">{m}
            <button onClick={() => setMembers(p => p.filter(x => x !== m))}>&#xD7;</button>
          </span>
        ))}
      </div>
      <button className="primary-action full" disabled={members.length === 0} onClick={() => setStep(2)}>Continue</button>
    </div>,

    // 2 — income
    <div key="income" className="setup-step">
      <div className="setup-emoji">&#x1F4B5;</div>
      <h1>Monthly income</h1>
      <p className="subtle">Total household take-home pay each month.</p>
      <div className="field-label">Take-home pay</div>
      <div className="money-input"><span>$</span>
        <input value={takeHome} onChange={e => setTakeHome(e.target.value)} inputMode="decimal" placeholder="0" autoFocus />
      </div>
      <div className="field-label" style={{ marginTop: 16 }}>Savings goal</div>
      <div className="money-input"><span>$</span>
        <input value={savings} onChange={e => setSavings(e.target.value)} inputMode="decimal" placeholder="0" />
      </div>
      <button className="primary-action full" disabled={!Number(takeHome)} onClick={() => setStep(3)}>Continue</button>
    </div>,

    // 3 — budgets
    <div key="budgets" className="setup-step">
      <div className="setup-emoji">&#x1F4CA;</div>
      <h1>Budget categories</h1>
      <p className="subtle">Add spending categories with monthly limits.</p>
      <div className="row-with-btn">
        <input className="field" value={catName} onChange={e => setCatName(e.target.value)}
          placeholder="Category name" onKeyDown={e => e.key === "Enter" && addBudget()} />
        <div className="money-input tight"><span>$</span>
          <input value={catAmt} onChange={e => setCatAmt(e.target.value)} inputMode="decimal" placeholder="0"
            onKeyDown={e => e.key === "Enter" && addBudget()} />
        </div>
        <button className="pill-button" onClick={addBudget}>Add</button>
      </div>
      <div className="setup-budget-list">
        {budgets.map(b => (
          <div key={b.category} className="setup-budget-row">
            <span>{b.category}</span><span>{money(b.amount)}</span>
            <button onClick={() => setBudgets(p => p.filter(x => x.category !== b.category))}>&#xD7;</button>
          </div>
        ))}
      </div>
      <button className="primary-action full" disabled={budgets.length === 0} onClick={finish}>
        Get started &#x2192;
      </button>
    </div>,
  ];

  return (
    <main className="setup-shell">
      <div className="setup-dots">
        {[0,1,2,3].map(i => (
          <div key={i} className={`setup-dot${i === step ? " active" : i < step ? " done" : ""}`} />
        ))}
      </div>
      {onBack && step === 0 && (
        <button className="text-button" style={{ fontSize: "0.82rem", marginBottom: 8 }} onClick={onBack}>
          &#x2190; Back to households
        </button>
      )}
      {STEPS[step]}
    </main>
  );
}
