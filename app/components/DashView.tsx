"use client";

import { useMemo, useState } from "react";
import type { Expense, HouseholdConfig } from "../lib/types";
import { money, getYM, labelYM, todayISO } from "../lib/utils";
import { Stat, ExpenseRow } from "./Shared";
import { ExpenseFormSheet } from "./ExpenseFormSheet";
import { AllSheet } from "./AllSheet";
import { deleteExpense as deleteRemoteExpense, setExpense } from "../lib/sync";

export function DashView({
  config,
  expenses,
  setExpenses,
  actualIncome,
  householdCode,
  onSyncError,
  onHome,
}: {
  config: HouseholdConfig;
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  actualIncome: number | null;
  householdCode: string;
  onSyncError: (message: string) => void;
  onHome: () => void;
}) {
  const [showAdd,   setShowAdd]   = useState(false);
  const [showAll,   setShowAll]   = useState(false);
  const [editing,   setEditing]   = useState<Expense | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expenseError, setExpenseError] = useState("");

  // Use actual income if set for the month, otherwise fall back to config default
  const effectiveIncome = actualIncome ?? config.monthlyTakeHome;

  const totalSpent  = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const categorySpent = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of expenses) m[e.category] = (m[e.category] || 0) + e.amount;
    return m;
  }, [expenses]);

  // Reserve the unspent portion of every category budget before calling money
  // "safe to spend". This makes the hero number a true extra cushion rather
  // than money that still needs to cover rent, groceries, utilities, etc.
  const remainingBudgetReserve = useMemo(() =>
    config.budgets.reduce((sum, b) => sum + Math.max(b.amount - (categorySpent[b.category] || 0), 0), 0),
    [config.budgets, categorySpent]
  );
  const safeToSpend = Math.max(
    effectiveIncome - config.monthlySavingsGoal - totalSpent - remainingBudgetReserve,
    0
  );

  const memberTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of config.members) m[n] = 0;
    // Include Joint even if not in config.members
    if (!config.members.includes("Joint")) m["Joint"] = 0;
    for (const e of expenses) m[e.paidBy] = (m[e.paidBy] || 0) + e.amount;
    return m;
  }, [expenses, config.members]);

  // Show Joint in Who Paid if any joint expenses exist or always as an option
  const payerDisplay = useMemo(() => {
    const hasJointExpenses = expenses.some(e => e.paidBy === "Joint");
    if (config.members.includes("Joint") || hasJointExpenses) return config.members.includes("Joint")
      ? config.members
      : [...config.members, "Joint"];
    return config.members;
  }, [config.members, expenses]);

  const settlement = useMemo(() => {
    const people = config.members.filter(m => m.toLowerCase() !== "joint");
    if (people.length !== 2) return null;
    const [a, b] = people;
    const aPaid = memberTotals[a] || 0;
    const bPaid = memberTotals[b] || 0;
    const halfDifference = Math.abs(aPaid - bPaid) / 2;
    if (halfDifference < 0.5) return { even: true as const, a, b, amount: 0, from: "", to: "" };
    return aPaid > bPaid
      ? { even: false as const, a, b, amount: halfDifference, from: b, to: a }
      : { even: false as const, a, b, amount: halfDifference, from: a, to: b };
  }, [config.members, memberTotals]);

  const actualSavings   = effectiveIncome - totalSpent;
  const savingsVariance = actualSavings - config.monthlySavingsGoal;

  const { dailyRate, projectedTotal } = useMemo(() => {
    const now         = new Date();
    const day         = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const rate        = day > 0 ? totalSpent / day : 0;
    return { dailyRate: rate, projectedTotal: Math.round(rate * daysInMonth) };
  }, [totalSpent]);

  // Budget alerts for categories at 80%+ utilization (dismissed per session)
  const budgetAlerts = useMemo(() => {
    return config.budgets
      .filter(({ category, amount }) => {
        if (dismissed.has(category)) return false;
        const pct = amount > 0 ? (categorySpent[category] || 0) / amount : 0;
        // warn at 80–99%; alert when actually over; skip exactly 100% (budget met, not exceeded)
        return (pct >= 0.8 && pct < 1.0) || pct > 1.0;
      })
      .map(({ category, amount }) => ({
        category,
        pct:  Math.round(((categorySpent[category] || 0) / amount) * 100),
        over: (categorySpent[category] || 0) > amount,
      }));
  }, [config.budgets, categorySpent, dismissed]);

  async function persistExpense(expense: Expense) {
    try {
      await setExpense(householdCode, expense);
      setExpenses(current => [expense, ...current.filter(item => item.id !== expense.id)]);
      onSyncError("");
      setExpenseError("");
    } catch (error) {
      console.error("Firebase expense save failed", error);
      const message = error instanceof Error ? error.message : "Could not save expense.";
      onSyncError(message);
      setExpenseError(message);
      throw error;
    }
  }
  async function deleteExpense(id: number) {
    try {
      await deleteRemoteExpense(householdCode, id);
      setExpenses(current => current.filter(item => item.id !== id));
      onSyncError("");
    } catch (error) {
      console.error("Firebase expense delete failed", error);
      const message = error instanceof Error ? error.message : "Could not delete expense.";
      onSyncError(message);
      setExpenseError(message);
    }
  }
  function duplicateExpense(e: Expense) {
    void persistExpense({ ...e, id: Date.now(), date: todayISO() }).catch(() => {});
  }
  function dismiss(cat: string)         { setDismissed(prev => new Set([...prev, cat])); }

  return (
    <>
      <header className="topbar">
        <div>
          <button className="home-link" onClick={onHome}>
            <div className="eyebrow">&#x2190; {config.name}</div>
          </button>
          <h1>{labelYM(getYM())}</h1>
          <div className="subtle">
            Monthly budget
            {actualIncome !== null && <span className="income-override"> &middot; income adjusted</span>}
          </div>
        </div>
      </header>

      <section className="hero-card">
        <div className="eyebrow">Safe to spend</div>
        <div className="hero-amount">{money(safeToSpend)}</div>
        <div className="subtle">after savings + {money(remainingBudgetReserve)} reserved for the rest of your budgets</div>
      </section>

      {budgetAlerts.length > 0 && (
        <div className="alert-strip">
          {budgetAlerts.map(({ category, pct, over }) => (
            <div key={category} className={`alert-chip ${over ? "over" : "warn"}`}>
              <span>{over ? "⚠" : "↑"} {category} {pct}%</span>
              <button onClick={() => dismiss(category)}>&#xD7;</button>
            </div>
          ))}
        </div>
      )}

      <section className="stat-grid">
        <Stat label="Spent"          value={money(totalSpent)} />
        <Stat label="Savings goal"   value={money(config.monthlySavingsGoal)} />
        <Stat label="Take-home"      value={money(effectiveIncome)} />
        <Stat
          label="Projected saved"
          value={money(actualSavings)}
          accent={savingsVariance >= 0 ? "pos" : "neg"}
        />
      </section>

      <div className="savings-status">
        <span>
          {savingsVariance >= 0
            ? <><span className="savings-pos">&#x2191; {money(savingsVariance)} ahead</span> of goal</>
            : <><span className="savings-neg">&#x2193; {money(Math.abs(savingsVariance))} behind</span> goal</>}
        </span>
        <span className="savings-rate">
          {config.monthlyTakeHome > 0 ? Math.round((actualSavings / effectiveIncome) * 100) : 0}% saved
        </span>
      </div>

      {config.budgets.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <h2>Categories</h2>
            <span className="velocity">{money(Math.round(dailyRate))}/day &rarr; {money(projectedTotal)} projected</span>
          </div>
          <div className="budget-list">
            {config.budgets.map(({ category, amount }) => {
              const spent     = categorySpent[category] || 0;
              const remaining = amount - spent;
              const pct       = Math.min(amount > 0 ? (spent / amount) * 100 : 0, 100);
              const over      = spent > amount;
              return (
                <div className="budget-row" key={category}>
                  <div className="budget-meta">
                    <div>
                      <strong>{category}</strong>
                      <span>
                        {money(spent)} of {money(amount)} &middot;{" "}
                        {over
                          ? <span className="over-badge">{money(Math.abs(remaining))} over</span>
                          : <span className="remaining-pos">{money(remaining)} left</span>}
                      </span>
                    </div>
                    <span style={over ? { color: "#f87171" } : {}}>{Math.round(pct)}%</span>
                  </div>
                  <div className="progress">
                    <div className="progress-fill"
                      style={{ width: `${pct}%`, background: over ? "#f87171" : undefined }} />
                  </div>
                </div>
              );
            })}
            {/* Show uncategorized spending so it's never invisible */}
            {(categorySpent["Uncategorized"] ?? 0) > 0 && (
              <div className="budget-row">
                <div className="budget-meta">
                  <div>
                    <strong style={{ color: "var(--muted)" }}>Uncategorized</strong>
                    <span>{money(categorySpent["Uncategorized"])} &middot; no budget set</span>
                  </div>
                  <span style={{ color: "var(--muted-2)" }}>—</span>
                </div>
                <div className="progress">
                  <div className="progress-fill" style={{ width: "100%", background: "var(--muted-2)", opacity: 0.4 }} />
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {config.members.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <h2>Who paid</h2>
            <span>this month</span>
          </div>
          <div className="payer-grid">
            {payerDisplay.map(m => <Stat key={m} label={m} value={money(memberTotals[m] || 0)} />)}
          </div>
          {settlement && (
            <div className="settlement-card">
              <div>
                <div className="eyebrow">50/50 shared balance</div>
                <strong>{settlement.even ? "You're even" : `${settlement.from} is ${money(settlement.amount)} behind`}</strong>
              </div>
              <span>
                {settlement.even
                  ? "No settle-up needed"
                  : `${settlement.from} → ${settlement.to}`}
              </span>
            </div>
          )}
        </section>
      )}

      <section className="section">
        <div className="section-heading">
          <h2>Recent</h2>
          <button className="text-button" onClick={() => setShowAll(true)}>See all</button>
        </div>
        <div className="transaction-list">
          {expenseError && <p className="form-error" role="alert">Firebase error: {expenseError}</p>}
          {expenses.length === 0
            ? <p className="empty-state">No expenses yet &mdash; tap Add expense to get started.</p>
            : expenses.slice(0, 5).map(e => (
                <ExpenseRow key={e.id} expense={e}
                  onEdit={setEditing} onDuplicate={duplicateExpense} onDelete={deleteExpense} />
              ))}
        </div>
      </section>

      <div className="bottom-spacer" />

      <div className="floating-actions">
        <button className="primary-action" onClick={() => setShowAdd(true)}>+ Add expense</button>
      </div>

      {showAdd && (
        <ExpenseFormSheet config={config}
          onSave={persistExpense} onClose={() => setShowAdd(false)} />
      )}
      {showAll && (
        <AllSheet expenses={expenses}
          onEdit={setEditing} onDuplicate={duplicateExpense} onDelete={deleteExpense}
          onClose={() => setShowAll(false)} />
      )}
      {editing && (
        <ExpenseFormSheet config={config} initial={editing}
          onSave={persistExpense} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
