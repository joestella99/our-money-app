"use client";

import { useMemo, useState } from "react";
import type { Expense, HouseholdConfig } from "../lib/types";
import { todayISO } from "../lib/utils";

export function ExpenseFormSheet({
  config,
  initial,
  recentExpenses = [],
  onSave,
  onClose,
}: {
  config: HouseholdConfig;
  initial?: Expense;
  recentExpenses?: Expense[];
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
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [payerTouched, setPayerTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const quickEntries = useMemo(() => {
    const latest = [...recentExpenses].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const unique = new Map<string, Expense>();
    for (const item of latest) {
      const key = item.description.trim().toLocaleLowerCase();
      if (key && !unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()].slice(0, 12);
  }, [recentExpenses]);

  const suggested = quickEntries.filter(item =>
    !desc.trim() || item.description.toLocaleLowerCase().includes(desc.trim().toLocaleLowerCase())
  ).slice(0, 4);

  function fillFromRecent(item: Expense, updateDescription: boolean) {
    if (updateDescription) setDesc(item.description);
    if (!categoryTouched && config.budgets.some(budget => budget.category === item.category)) setCat(item.category);
    if (!payerTouched && (config.members.includes(item.paidBy) || item.paidBy === "Joint")) setPaidBy(item.paidBy);
  }

  function changeDescription(value: string) {
    setDesc(value);
    if (isEdit) return;
    const exact = quickEntries.find(item => item.description.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
    if (exact) fillFromRecent(exact, false);
  }
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
        <input className="field" value={desc} onChange={e => changeDescription(e.target.value)}
          placeholder="What was this?" autoFocus={isEdit} />
        {!isEdit && suggested.length > 0 && (
          <div className="quick-entry-chips" aria-label="Recent descriptions">
            {suggested.map(item => (
              <button type="button" key={item.description.toLocaleLowerCase()} className="quick-entry-chip"
                onClick={() => fillFromRecent(item, true)}>{item.description}</button>
            ))}
          </div>
        )}

        <label>Date</label>
        <input type="date" className="field" value={date} onChange={e => setDate(e.target.value)} />

        {config.budgets.length > 0 && <>
          <label>Category</label>
          <select className="field" value={cat} onChange={e => { setCategoryTouched(true); setCat(e.target.value); }}>
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
                <button key={m} className={paidBy === m ? "active" : ""} onClick={() => { setPayerTouched(true); setPaidBy(m); }}>
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
