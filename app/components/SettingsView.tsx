"use client";

import { useState } from "react";
import type { Expense, HouseholdConfig, MonthSnapshot } from "../lib/types";
import { getYM, labelYM, exportCSV, money, nextMonthISO } from "../lib/utils";
import { save, KEY_CONFIG, KEY_HISTORY, KEY_EXPENSES, KEY_ACTUAL_INCOME } from "../lib/storage";
import { archiveMonth } from "../lib/sync";

type BackupData = {
  version: number;
  exportedAt: string;
  config: HouseholdConfig;
  expenses: Expense[];
  history: MonthSnapshot[];
  actualIncome: number | null;
};

export function SettingsView({
  config, setConfig, expenses, setExpenses, history, setHistory,
  actualIncome, setActualIncome, householdCode, onDelete, onHome, syncError,
}: {
  config: HouseholdConfig;
  setConfig: (c: HouseholdConfig) => void;
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  history: MonthSnapshot[];
  setHistory: React.Dispatch<React.SetStateAction<MonthSnapshot[]>>;
  actualIncome: number | null;
  setActualIncome: (n: number | null) => void;
  householdCode: string | null;
  onDelete: () => Promise<void>;
  onHome: () => void;
  syncError: string;
}) {
  const [draft,        setDraft]        = useState<HouseholdConfig>(() => ({
    ...config, budgets: [...config.budgets], members: [...config.members],
  }));
  const [memberInput,  setMemberInput]  = useState("");
  const [catName,      setCatName]      = useState("");
  const [catAmt,       setCatAmt]       = useState("");
  const [saved,        setSaved]        = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [showDelete,   setShowDelete]   = useState(false);
  const [deleteInput,  setDeleteInput]  = useState("");
  const [deleting,     setDeleting]     = useState(false);
  const [deleteError,  setDeleteError]  = useState("");
  const [importPreview, setImportPreview] = useState<BackupData | null>(null);

  function patch(p: Partial<HouseholdConfig>) { setDraft(d => ({ ...d, ...p })); }

  function addMember() {
    const t = memberInput.trim();
    if (!t) return window.alert("Please enter a member name.");
    if (draft.members.some(member => member.toLocaleLowerCase() === t.toLocaleLowerCase())) {
      return window.alert("That household member has already been added.");
    }
    patch({ members: [...draft.members, t] });
    setMemberInput("");
  }
  function addBudget() {
    const n = catName.trim(), a = Number(catAmt);
    if (!n) return window.alert("Please enter a category name.");
    if (!Number.isFinite(a) || a <= 0) return window.alert("Please enter a budget amount greater than $0.");
    if (draft.budgets.some(budget => budget.category.toLocaleLowerCase() === n.toLocaleLowerCase())) {
      return window.alert("That budget category has already been added.");
    }
    patch({ budgets: [...draft.budgets, { category: n, amount: a }] });
    setCatName(""); setCatAmt("");
  }
  function saveSettings() {
    const missing: string[] = [];
    if (!draft.name.trim()) missing.push("a household name");
    if (draft.members.length === 0) missing.push("at least one household member");
    if (!Number.isFinite(draft.monthlyTakeHome) || draft.monthlyTakeHome <= 0) missing.push("a take-home amount greater than $0");
    if (!Number.isFinite(draft.monthlySavingsGoal) || draft.monthlySavingsGoal < 0) missing.push("a non-negative savings goal");
    if (draft.budgets.length === 0) missing.push("at least one budget category");
    if (draft.budgets.some(budget => !Number.isFinite(budget.amount) || budget.amount <= 0)) missing.push("positive amounts for every budget category");
    if (missing.length > 0) {
      window.alert(`Please add ${missing.join(", ")} before saving settings.`);
      return;
    }
    setConfig({ ...draft, name: draft.name.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function exportBackup() {
    const data: BackupData = {
      version:     1,
      exportedAt:  new Date().toISOString(),
      config,
      expenses,
      history,
      actualIncome,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `our-money-backup-${getYM()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    const input    = document.createElement("input");
    input.type     = "file";
    input.accept   = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string) as BackupData;
          if (!data.config || !Array.isArray(data.expenses) || !Array.isArray(data.history)) {
            alert("Invalid backup file — missing required data.");
            return;
          }
          setImportPreview(data);
        } catch {
          alert("Could not read backup file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function confirmImport() {
    if (!importPreview) return;
    save(KEY_CONFIG,       importPreview.config);
    save(KEY_EXPENSES,     importPreview.expenses);
    save(KEY_HISTORY,      importPreview.history);
    save(KEY_ACTUAL_INCOME, importPreview.actualIncome ?? null);
    setConfig(importPreview.config);
    setExpenses(importPreview.expenses);
    setHistory(importPreview.history);
    setActualIncome(importPreview.actualIncome ?? null);
    setImportPreview(null);
  }
  async function confirmDelete() {
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete();
      setShowDelete(false);
      setDeleteInput("");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the household from Firebase.");
    } finally {
      setDeleting(false);
    }
  }
  async function closeMonth() {
    if (!householdCode) return;
    const ym = getYM();
    const snap: MonthSnapshot = {
      yearMonth:    ym,
      config,
      expenses,
      actualIncome: actualIncome ?? undefined,
    };
    const newHist = [snap, ...history.filter(h => h.yearMonth !== ym)];

    // Roll recurring expenses into the next month instead of silently dropping them.
    // Each gets a fresh id and its date moves to the same day next month.
    const recurringNextMonth = expenses
      .filter(e => e.recurring)
      .map((e, index) => ({
        ...e,
        id: Date.now() + index,
        date: nextMonthISO(e.date),
      }));

    try {
      await archiveMonth(householdCode, snap, recurringNextMonth);
      save(KEY_HISTORY,       newHist);
      save(KEY_EXPENSES,      recurringNextMonth);
      save(KEY_ACTUAL_INCOME, null);
      setHistory(newHist);
      setExpenses(recurringNextMonth);
      setActualIncome(null);
      setConfirmClose(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not archive this month.");
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <button className="home-link" onClick={onHome}>
            <div className="eyebrow">&#x2190; All households</div>
          </button>
          <h1>Household</h1>
        </div>
      </header>

      <section className="settings-group">
        <div className="settings-label">Household name</div>
        <input className="field" value={draft.name} onChange={e => patch({ name: e.target.value })} placeholder="Name" />
      </section>

      <section className="settings-group">
        <div className="settings-label">Members</div>
        <div className="row-with-btn">
          <input className="field" value={memberInput} onChange={e => setMemberInput(e.target.value)}
            placeholder="Add member" onKeyDown={e => e.key === "Enter" && addMember()} />
          <button className="pill-button" onClick={addMember}>Add</button>
        </div>
        <div className="chip-row">
          {draft.members.map(m => (
            <span key={m} className="chip">{m}
              <button onClick={() => patch({ members: draft.members.filter(x => x !== m) })}>&#xD7;</button>
            </span>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-label">Monthly income</div>
        <div className="field-label">Default take-home pay</div>
        <div className="money-input"><span>$</span>
          <input value={draft.monthlyTakeHome || ""}
            onChange={e => patch({ monthlyTakeHome: Number(e.target.value) })} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0" />
        </div>
        <div className="field-label" style={{ marginTop: 14 }}>Savings goal</div>
        <div className="money-input"><span>$</span>
          <input value={draft.monthlySavingsGoal || ""}
            onChange={e => patch({ monthlySavingsGoal: Number(e.target.value) })} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" />
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-label">This month&apos;s actual income</div>
        <p className="subtle" style={{ marginBottom: 12 }}>
          Override if your income this month differs from the default.
        </p>
        <div className="money-input"><span>$</span>
          <input
            value={actualIncome ?? ""}
            onChange={e => setActualIncome(e.target.value ? Number(e.target.value) : null)}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder={String(config.monthlyTakeHome)}
          />
        </div>
        {actualIncome !== null && (
          <button className="text-button" style={{ marginTop: 10, fontSize: "0.82rem" }}
            onClick={() => setActualIncome(null)}>
            Reset to default ({money(config.monthlyTakeHome)})
          </button>
        )}
      </section>

      <section className="settings-group">
        <div className="settings-label">Budget categories</div>
        <div className="row-with-btn">
          <input className="field" value={catName} onChange={e => setCatName(e.target.value)}
            placeholder="Category" onKeyDown={e => e.key === "Enter" && addBudget()} />
          <div className="money-input tight"><span>$</span>
            <input value={catAmt} onChange={e => setCatAmt(e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0"
              onKeyDown={e => e.key === "Enter" && addBudget()} />
          </div>
          <button className="pill-button" onClick={addBudget}>Add</button>
        </div>
        <div className="cat-list">
          {draft.budgets.map(b => (
            <div key={b.category} className="cat-row">
              <span className="cat-name">{b.category}</span>
              <div className="money-input tight"><span>$</span>
                <input value={b.amount || ""}
                  onChange={e => patch({ budgets: draft.budgets.map(x =>
                    x.category === b.category ? { ...x, amount: Number(e.target.value) } : x) })}
                  type="number" min="0.01" step="0.01" inputMode="decimal" />
              </div>
              <button className="x-btn"
                onClick={() => patch({ budgets: draft.budgets.filter(x => x.category !== b.category) })}>
                &#xD7;
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-label">Export</div>
        <p className="subtle" style={{ marginBottom: 14 }}>Download this month&apos;s expenses as CSV.</p>
        <button className="secondary-action full" disabled={expenses.length === 0}
          onClick={() => exportCSV(expenses, labelYM(getYM()))} style={{ marginTop: 0 }}>
          Export {labelYM(getYM())} to CSV &#x2193;
        </button>
      </section>

      <section className="settings-group">
        <div className="settings-label">Month controls</div>
        <p className="subtle" style={{ marginBottom: 14 }}>
          Close the current month and start fresh. Expenses will be saved to History.
        </p>
        <button className="secondary-action full" onClick={() => setConfirmClose(true)} style={{ marginTop: 0 }}>
          Archive {labelYM(getYM())} &#x2192;
        </button>
      </section>

      <section className="settings-group" style={{ borderBottom: 0 }}>
        <div className="settings-label danger-label-text">Danger zone</div>
        <div className="danger-zone">
          {syncError && (
            <p role="alert" style={{ color: "#f87171", fontSize: "0.82rem", marginBottom: 14 }}>
              Firebase sync failed: {syncError}
            </p>
          )}
          <p className="subtle" style={{ marginBottom: 14 }}>
            Permanently erase all expenses, history, and settings. This cannot be undone.
          </p>
          <button className="danger-btn" onClick={() => setShowDelete(true)}>
            Delete &ldquo;{config.name}&rdquo; household
          </button>
        </div>
      </section>

      <div className="bottom-spacer" />

      <div className="floating-actions">
        <button className="primary-action" onClick={saveSettings}>
          {saved ? "Saved" : "Save settings"}
        </button>
      </div>

      {importPreview && (
        <div className="overlay" onClick={() => setImportPreview(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-header">
              <h2>Import backup?</h2>
              <button className="pill-button" onClick={() => setImportPreview(null)}>Cancel</button>
            </div>
            <p className="subtle" style={{ marginBottom: 16 }}>
              This will replace all current data with the backup. Your existing expenses and history will be overwritten.
            </p>
            <div className="import-preview">
              <div className="import-row"><span>Household</span><strong>{importPreview.config.name}</strong></div>
              <div className="import-row"><span>This month</span><strong>{importPreview.expenses.length} expense{importPreview.expenses.length !== 1 ? "s" : ""}</strong></div>
              <div className="import-row"><span>Archived months</span><strong>{importPreview.history.length}</strong></div>
              <div className="import-row"><span>Exported</span><strong>{new Date(importPreview.exportedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</strong></div>
            </div>
            <button className="primary-action full" style={{ marginTop: 24 }} onClick={confirmImport}>
              Yes, import this backup
            </button>
          </div>
        </div>
      )}

      {showDelete && (
        <div className="overlay" onClick={() => { setShowDelete(false); setDeleteInput(""); }}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-header">
              <h2>Delete household?</h2>
              <button className="pill-button" onClick={() => { setShowDelete(false); setDeleteInput(""); }}>Cancel</button>
            </div>
            <p className="subtle">
              This permanently erases everything. To confirm, type:
            </p>
            <p style={{ margin: "10px 0 16px", fontFamily: "monospace", fontSize: "0.9rem", color: "var(--text)", background: "var(--panel-2)", padding: "10px 14px", borderRadius: 12 }}>
              delete {config.name}
            </p>
            <input
              className="field"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={`delete ${config.name}`}
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter" && deleteInput.toLowerCase() === `delete ${config.name.toLowerCase()}`) {
                  void confirmDelete();
                }
              }}
            />
            <button
              className="danger-confirm-btn"
              disabled={deleting || deleteInput.toLowerCase() !== `delete ${config.name.toLowerCase()}`}
              onClick={() => void confirmDelete()}
              style={{ marginTop: 18 }}
            >
              {deleting ? "Deleting from Firebase..." : "Permanently delete everything"}
            </button>
            {deleteError && (
              <p role="alert" style={{ color: "#f87171", fontSize: "0.82rem", marginTop: 12 }}>
                {deleteError} Nothing was removed from this device.
              </p>
            )}
          </div>
        </div>
      )}
      {confirmClose && (
        <div className="overlay" onClick={() => setConfirmClose(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-header">
              <h2>Archive month?</h2>
              <button className="pill-button" onClick={() => setConfirmClose(false)}>Cancel</button>
            </div>
            <p className="subtle">
              This will archive {labelYM(getYM())} with {expenses.length} expense{expenses.length !== 1 ? "s" : ""}. {expenses.filter(e => e.recurring).length > 0
                ? `${expenses.filter(e => e.recurring).length} recurring expense${expenses.filter(e => e.recurring).length !== 1 ? "s" : ""} will roll into next month.`
                : "The new month will start fresh."}
            </p>
            <button className="primary-action full" style={{ marginTop: 24 }} onClick={closeMonth}>
              Yes, archive this month
            </button>
          </div>
        </div>
      )}
    </>
  );
}
