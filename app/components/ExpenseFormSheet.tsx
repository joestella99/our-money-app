"use client";

import { useMemo, useState } from "react";
import type { Expense, HouseholdConfig } from "../lib/types";
import { todayISO } from "../lib/utils";

/** Payer selection is a local, per-household device preference.
 * Never infer it from shared household expenses: two people may log
 * purchases at the same merchant from different devices. */
function preferredPayer(householdCode: string, members: string[]): string {
  const fallback = members[0] ?? "";
  if (typeof window === "undefined") return fallback;
  try {
    const preference = window.localStorage.getItem(`our-money:payer:${householdCode}`);
    return preference && (members.includes(preference) || preference === "Joint")
      ? preference
      : fallback;
  } catch {
    return fallback;
  }
}

export function ExpenseFormSheet({
  config,
  householdCode,
  initial,
  recentExpenses = [],
  onSave,
  onClose,
}: {
  config: HouseholdConfig;
  householdCode: string;
  initial?: Expense;
  recentExpenses?: Expense[];
  onSave: (e: Expense) => Promise<void | boolean>;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [startingPayer] = useState(() =>
    initial?.paidBy ?? preferredPayer(householdCode, config.members)
  );
  const [amount,    setAmount]    = useState(initial ? String(initial.amount) : "");
  const [desc,      setDesc]      = useState(initial?.description ?? "");
  const [cat,       setCat]       = useState(initial?.category ?? config.budgets[0]?.category ?? "Uncategorized");
  const [paidBy,    setPaidBy]    = useState(startingPayer);
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
    // Never copy the payer of a shared suggestion; users pay independently.
  }

  function changeDescription(value: string) {
    setDesc(value);
    if (isEdit) return;
    const exact = quickEntries.find(item => item.description.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
    if (exact) fillFromRecent(exact, false);
  }
  const [saveError, setSaveError] = useState("");

  function attemptClose() {
    if (saving) return;
    const dirty = amount !== (initial ? String(initial.amount) : "")
      || desc !== (initial?.description ?? "")
      || cat !== (initial?.category ?? config.budgets[0]?.category ?? "Uncategorized")
      || paidBy !== startingPayer
      || date !== (initial?.date ?? todayISO())
      || note !== (initial?.note ?? "")
      || recurring !== (initial?.recurring ?? false);
    if (!dirty || window.confirm("Discard unsaved expense changes?")) onClose();
  }

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
      if (saved !== false) {
        if (!isEdit && payerTouched) {
          try {
            window.localStorage.setItem(`our-money:payer:${householdCode}`, paidBy);
          } catch { /* Storage may be disabled; expense is still saved. */ }
        }
        onClose();
      }
    } catch (error) {
      console.error("Firebase expense write failed", error);
      setSaveError(error instanceof Error ? error.message : "Could not save expense to Firebase.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={attemptClose}>
      <div className="sheet expense-sheet" role="dialog" aria-modal="true" aria-labelledby="expense-sheet-title" onClick={e => e.stopPropagation()}>
        <div className="sheet-drag-handle" aria-hidden="true" />
        <div className="sheet-header">
          <div>
            <span className="sheet-eyebrow">OUR MONEY</span>
            <h2 id="expense-sheet-title">{isEdit ? "Edit expense" : "New expense"}</h2>
          </div>
          <button className="pill-button" type="button" disabled={saving} onClick={attemptClose}>Close</button>
        </div>

        <label htmlFor="expense-amount">Amount</label>
        <div className="money-input expense-amount-input"><span>$</span>
          <input id="expense-amount" aria-label="Expense amount in dollars" value={amount} onChange={e => setAmount(e.target.value)}
            inputMode="decimal" type="number" min="0.01" step="0.01" placeholder="0" autoFocus={!isEdit} />
        </div>

        <label htmlFor="expense-description">Description</label>
        <input id="expense-description" className="field" value={desc} onChange={e => changeDescription(e.target.value)}
          placeholder="What was this?" autoFocus={isEdit} />
        {!isEdit && suggested.length > 0 && (
          <div className="quick-entry-chips" aria-label="Recent descriptions">
            {suggested.map(item => (
              <button type="button" key={item.description.toLocaleLowerCase()} className="quick-entry-chip"
                onClick={() => fillFromRecent(item, true)}>{item.description}</button>
            ))}
          </div>
        )}

        <div className="form-dual-fields">
          <div>
            <label htmlFor="expense-date">Date</label>
            <input id="expense-date" type="date" className="field" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {config.budgets.length > 0 && <div>
            <label htmlFor="expense-category">Category</label>
            <select id="expense-category" className="field" value={cat} onChange={e => { setCategoryTouched(true); setCat(e.target.value); }}>
              {config.budgets.map(b => <option key={b.category} value={b.category}>{b.category}</option>)}
              <option value="Uncategorized">Uncategorized</option>
            </select>
          </div>}
        </div>

        {/* Always include Joint so shared expenses can always be marked */}
        {config.members.length >= 1 && (() => {
          const payers = config.members.includes("Joint")
            ? config.members
            : [...config.members, "Joint"];
          return <>
            <label>Paid by <span className="label-hint">· for your records, not a debt split</span></label>
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

        <details className="optional-note" open={Boolean(initial?.note) || undefined}>
          <summary>Add a note <span>Optional</span></summary>
          <textarea
            aria-label="Expense note"
            className="field note-area"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Anything you'd like to remember..."
            rows={2}
          />
        </details>

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
        <button className="primary-action full save-expense-action" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving..." : isEdit ? "Save changes" : "Add expense"}
        </button>
      </div>
    </div>
  );
}
