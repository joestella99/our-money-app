"use client";

import { useRef, useState } from "react";
import type { HouseholdConfig, BudgetLine } from "../lib/types";
import { money } from "../lib/utils";
import { isFirebaseConfigured } from "../lib/firebase";
import { HouseholdCodeCollisionError, joinHousehold, generateHouseholdCode, type SetupResult } from "../lib/sync";

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
  const [finishing,   setFinishing]   = useState(false);
  const [finishError, setFinishError] = useState("");
  const creationCode = useRef<string | null>(null);

  // Join existing household
  const [joining,     setJoining]     = useState(false);
  const [joinCode,    setJoinCode]    = useState("");
  const [joinError,   setJoinError]   = useState("");
  const [joinLoading, setJoinLoading] = useState(false);

  function addMember() {
    const t = memberInput.trim();
    if (!t) return window.alert("Please enter a member name.");
    if (members.some(member => member.toLocaleLowerCase() === t.toLocaleLowerCase())) {
      return window.alert("That household member has already been added.");
    }
    setMembers(p => [...p, t]);
    setMemberInput("");
  }
  function addBudget() {
    const n = catName.trim(), a = Number(catAmt);
    if (!n) return window.alert("Please enter a category name.");
    if (!Number.isFinite(a) || a <= 0) return window.alert("Please enter a budget amount greater than $0.");
    if (budgets.some(budget => budget.category.toLocaleLowerCase() === n.toLocaleLowerCase())) {
      return window.alert("That budget category has already been added.");
    }
    setBudgets(p => [...p, { category: n, amount: a }]);
    setCatName(""); setCatAmt("");
  }
  async function finish() {
    // Keep one code for all retries. If the network response is lost after the
    // write succeeds, retrying must update that household rather than create a
    // second household containing the same setup data.
    if (finishing) return;
    if (!name.trim() || members.length === 0 || Number(takeHome) <= 0 || Number(savings) < 0 || budgets.length === 0) {
      window.alert("Please complete every required setup field with valid positive amounts before creating the household.");
      return;
    }
    const code = creationCode.current ?? generateHouseholdCode();
    creationCode.current = code;
    const config: HouseholdConfig = {
      name: name.trim(), members, monthlyTakeHome: Number(takeHome),
      monthlySavingsGoal: Number(savings), budgets,
    };
    setFinishing(true);
    setFinishError("");
    try {
      await onComplete({ type: "create", config, code });
    } catch (error) {
      if (error instanceof HouseholdCodeCollisionError) creationCode.current = null;
      setFinishError(error instanceof Error ? error.message : "Could not create the household. Please try again.");
    } finally {
      setFinishing(false);
    }
  }

  async function handleJoin() {
    if (!isFirebaseConfigured()) {
      setJoinError("Firebase is not configured yet. Paste your Firebase config in app/lib/firebase.ts first.");
      return;
    }
    setJoinLoading(true);
    setJoinError("");
    try {
      const data = await joinHousehold(joinCode.toUpperCase().trim());
      if (!data) {
        setJoinError("Household not found. Check the code and try again.");
        return;
      }
      await onComplete({ type: "join", data, code: joinCode.toUpperCase().trim() });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "Could not open the household. Please try again.");
    } finally {
      setJoinLoading(false);
    }
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
        <input value={takeHome} onChange={e => setTakeHome(e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0" autoFocus />
      </div>
      <div className="field-label" style={{ marginTop: 16 }}>Savings goal</div>
      <div className="money-input"><span>$</span>
        <input value={savings} onChange={e => setSavings(e.target.value)} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" />
      </div>
      <button className="primary-action full" disabled={Number(takeHome) <= 0 || Number(savings) < 0} onClick={() => setStep(3)}>Continue</button>
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
          <input value={catAmt} onChange={e => setCatAmt(e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0"
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
      {finishError && <p className="form-error" role="alert">{finishError}</p>}
      <button className="primary-action full" disabled={budgets.length === 0 || finishing} onClick={() => void finish()}>
        {finishing ? "Creating household..." : <>Get started &#x2192;</>}
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
