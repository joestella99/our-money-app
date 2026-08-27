"use client";

import { useState } from "react";
import type { Expense, HouseholdConfig } from "../lib/types";
import { todayISO } from "../lib/utils";

export function ExpenseFormSheet({
  config,
  initial,
  onSave,
  onClose,
}: {
  config: HouseholdConfig;
  initial?: Expense;
  onSave: (e: Expense) => Promise<void | boolean>;
  onClose: () => void;
}) {
  const isEdit    = !!initial;
  const [amount,    setAmount]    = useState(initial ? String(initial.amount) : "");
  const [desc,      setDesc]      = useState(initial?.description ?? "");
  const [cat,       setCat]       = useState(initial?.category ?? config.budgets[0]?.category ?? "Uncategorized");
  const [paidBy,    setPaidBy]    = useState(initial?.paidBy ?? config.members[0] ?? "");
  const [date,      setDate]      = useState(initial?.date ?? todayISO());
  const [note,      setNote]      = useState(initial?.note ?? "");
  const [recurring, setRecurring] = useState(initial?.recurring ?? false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function submit() {
    const a = Number(amount);
    const missing: string[] = [];
    if (!Number.isFinite(a) || a <= 0) missing.push("an amount greater than $0");
    if (!desc.trim()) missing.push("a description");
    if (!date) missing.push("a date");
    if (!cat) missing.push("a category");
    if (!paidBy) missing.push("who paid");
    if (missing.length > 0) {
      window.alert(`Please add ${missing.join(", ")} before saving this expense.`);
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const saved = await onSave({
      id:          initial?.id ?? Date.now(),
      amount:      a,
      description: desc.trim(),
      category:    cat,
      paidBy,
      date,
        note:        note.trim(),
        recurring,
      });
      if (saved !== false) onClose();
    } catch (error) {
      console.error("Firebase expense write failed", error);
      setSaveError(error instanceof Error ? error.message : "Could not save expense to Firebase.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={() => { if (!saving) onClose(); }}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>{isEdit ? "Edit expense" : "Add expense"}</h2>
          <button className="pill-button" disabled={saving} onClick={onClose}>Close</button>
        </div>

        <label>Amount</label>
        <div className="money-input"><span>$</span>
          <input value={amount} onChange={e => setAmount(e.target.value)}
            inputMode="decimal" type="number" min="0.01" step="0.01" placeholder="0" autoFocus={!isEdit} />
        </div>

        <label>Description</label>
        <input className="field" value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="What was this?" autoFocus={isEdit} />

        <label>Date</label>
        <input type="date" className="field" value={date} onChange={e => setDate(e.target.value)} />

        {config.budgets.length > 0 && <>
          <label>Category</label>
          <select className="field" value={cat} onChange={e => setCat(e.target.value)}>
            {config.budgets.map(b => <option key={b.category}>{b.category}</option>)}
            <option value="Uncategorized">Uncategorized</option>
          </select>
        </>}

        {/* Always include Joint so shared expenses can always be marked */}
        {config.members.length >= 1 && (() => {
          const payers = config.members.includes("Joint")
            ? config.members
            : [...config.members, "Joint"];
          return <>
            <label>Paid by</label>
            <div className="segmented"
              style={{ gridTemplateColumns: `repeat(${Math.min(payers.length, 4)}, 1fr)` }}>
              {payers.map(m => (
                <button key={m} className={paidBy === m ? "active" : ""} onClick={() => setPaidBy(m)}>
                  {m}
                </button>
              ))}
            </div>
          </>;
        })()}

        <label>
          Note{" "}
          <span style={{ color: "var(--muted-2)", fontWeight: "normal", fontSize: "0.78rem" }}>optional</span>
        </label>
        <textarea
          className="field note-area"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note..."
          rows={2}
        />

        <div className="recurring-row">
          <div>
            <div className="recurring-label">Recurring monthly</div>
            <div className="recurring-sub">Auto-add to next month</div>
          </div>
          <button
            type="button"
            className={`toggle-btn${recurring ? " active" : ""}`}
            onClick={() => setRecurring(r => !r)}
          >
            {recurring ? "On" : "Off"}
          </button>
        </div>

        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <button className="primary-action full" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving..." : isEdit ? "Save changes" : "Add expense"}
        </button>
      </div>
    </div>
  );
}
