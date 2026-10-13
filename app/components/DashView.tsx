"use client";

import { useEffect, useMemo, useState } from "react";
import type { Expense, HouseholdConfig, MonthSnapshot } from "../lib/types";
import { categoryChange, forecastMonth, spendByCategory, spendByDescription } from "../lib/insights";
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
  history,
  activeMonth,
  addRequest,
  householdCode,
  onSyncError,
  onHome,
}: {
  config: HouseholdConfig;
  expenses: Expense[];
  setExpenses: React.Dispatch<React.SetStateAction<Expense[]>>;
  actualIncome: number | null;
  history: MonthSnapshot[];
  activeMonth: string | null;
  addRequest: number;
  householdCode: string;
  onSyncError: (message: string) => void;
  onHome: () => void;
}) {
  const [showAdd,   setShowAdd]   = useState(false);
  const [showAll,   setShowAll]   = useState(false);
  useEffect(() => { if (addRequest > 0) setShowAdd(true); }, [addRequest]);
  const [editing,   setEditing]   = useState<Expense | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expenseError, setExpenseError] = useState("");
  const [lastDeleted, setLastDeleted] = useState<Expense | null>(null);
  useEffect(() => {
    if (!lastDeleted) return;
    const timer = setTimeout(() => setLastDeleted(null), 8000);
    return () => clearTimeout(timer);
  }, [lastDeleted]);

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
  const safeToSpend = effectiveIncome - config.monthlySavingsGoal - totalSpent - remainingBudgetReserve;
  const forecast = useMemo(() => forecastMonth(expenses, effectiveIncome), [expenses, effectiveIncome]);
  const currentMonthOpen = activeMonth === getYM();
  const projectedSavings = currentMonthOpen ? forecast.projectedSavings : effectiveIncome - totalSpent;
  const mostSpent = useMemo(() => spendByCategory(expenses).slice(0, 4), [expenses]);
  const topMerchants = useMemo(() => spendByDescription(expenses).slice(0, 3), [expenses]);
  const monthChanges = useMemo(
    () => categoryChange(expenses, history, activeMonth ?? getYM()), [expenses, history, activeMonth]
  );
  const biggestIncrease = monthChanges?.find(item => item.change > 0);

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

  const savingsVariance = projectedSavings - config.monthlySavingsGoal;
  const dailyRate = forecast.variableDailyRate;
  const projectedTotal = forecast.projectedSpent;

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
      await setExpense(householdCode, expense, activeMonth ?? getYM());
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
      await deleteRemoteExpense(householdCode, id, activeMonth ?? getYM());
      const removed = expenses.find(item => item.id === id);
      setExpenses(current => current.filter(item => item.id !== id));
      if (removed) setLastDeleted(removed);
      onSyncError("");
    } catch (error) {
      console.error("Firebase expense delete failed", error);
      const message = error instanceof Error ? error.message : "Could not delete expense.";
      onSyncError(message);
      setExpenseError(message);
    }
  }
  async function undoDelete() {
    if (!lastDeleted) return;
    const restoring = lastDeleted;
    try {
      await persistExpense(restoring);
      setLastDeleted(null);
    } catch {
      // persistExpense already shows a recoverable error.
    }
  }
  function duplicateExpense(e: Expense) {
    void persistExpense({ ...e, id: Date.now(), date: todayISO() }).catch(() => {});
  }
  function dismiss(cat: string)         { setDismissed(prev => new Set([...prev, cat])); }

  return (
    <>
      <header className="topbar">
        <div className="dashboard-brand">
          <button className="home-link" onClick={onHome} aria-label="Switch household">
            <span className="brand-mark" aria-hidden="true">↗</span>
            <span className="brand-name">{config.name}<span className="brand-chevron">⌄</span></span>
          </button>
          <div className="dashboard-title-row">
            <div>
              <div className="overline">YOUR MONTHLY OVERVIEW</div>
              <h1>{labelYM(activeMonth ?? getYM())}</h1>
            </div>
            <span className="month-status"><span className="status-dot" />Current</span>
          </div>
          {actualIncome !== null && <div className="income-override">Custom income this month</div>}
        </div>
      </header>

      <section className="hero-card" aria-label="Monthly spending buffer">
        <div className="hero-topline">
          <span className="hero-kicker"><span className="hero-kicker-dot" /> READY TO SPEND</span>
          <span className="hero-period">THIS MONTH</span>
        </div>
        <div className="hero-label">Safe to spend</div>
        <div className="hero-amount" style={safeToSpend < 0 ? { color: "#ffa7a6" } : undefined}>{money(safeToSpend)}</div>
        <p className="hero-description">
          {safeToSpend < 0
            ? "Your spending and reserved budgets are above what is available after savings."
            : "Your extra room after savings and the rest of your planned budgets."}
        </p>
        <div className="hero-divider" />
        <div className="hero-metrics">
          <div><span>Spent so far</span><strong>{money(totalSpent)}</strong></div>
          <div><span>Still reserved</span><strong>{money(remainingBudgetReserve)}</strong></div>
        </div>
        <div className="hero-track" role="progressbar" aria-label="Monthly take-home spent" aria-valuemin={0}
          aria-valuemax={100} aria-valuenow={Math.round(Math.min(Math.max(effectiveIncome > 0 ? totalSpent / effectiveIncome * 100 : 0, 0), 100))}>
          <div className="hero-track-fill" style={{ width: `${Math.min(Math.max(effectiveIncome > 0 ? totalSpent / effectiveIncome * 100 : 0, 0), 100)}%` }} />
        </div>
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
          label={currentMonthOpen ? "Projected savings" : "Savings so far"}
          value={money(projectedSavings)}
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
          {effectiveIncome > 0 ? Math.round((projectedSavings / effectiveIncome) * 100) : 0}% {currentMonthOpen ? "projected" : "so far"}
        </span>
      </div>

      <section className="section">
        <div className="section-heading">
          <h2>Recent activity</h2>
          <button className="text-button" onClick={() => setShowAll(true)}>View all <span aria-hidden="true">↗</span></button>
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


      {config.budgets.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <h2>Your categories</h2>
            <span className="velocity">{currentMonthOpen ? `${money(Math.round(dailyRate))}/day variable · ${money(projectedTotal)} est.` : "Current entries"}</span>
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
                    <div className="category-title">
                      <span className="category-avatar" aria-hidden="true">{category.slice(0, 1).toUpperCase()}</span>
                      <div className="category-info">
                      <strong>{category}</strong>
                      <span>
                        {money(spent)} of {money(amount)} &middot;{" "}
                        {over
                          ? <span className="over-badge">{money(Math.abs(remaining))} over</span>
                          : <span className="remaining-pos">{money(remaining)} left</span>}
                      </span>
                      </div>
                    </div>
                    <span className="category-percent" style={over ? { color: "#fb8176" } : {}}>{Math.round(pct)}%</span>
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

      {expenses.length > 0 && (
        <section className="section">
          <div className="section-heading"><h2>Spending insights</h2><span>this month</span></div>
          <div className="insights-list">
            {mostSpent.length > 0 && (
              <div className="insight-tile">
                <span className="insight-label">Top categories</span>
                {mostSpent.map(item => (
                  <div key={item.name} className="insight-rank-row">
                    <span>{item.name}</span><strong>{money(item.amount)}</strong>
                    <div className="insight-bar"><div style={{ width: `${(item.amount / mostSpent[0].amount) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
            {topMerchants.length > 0 && (
              <div className="insight-tile">
                <span className="insight-label">Most spent at</span>
                {topMerchants.map(item => (
                  <div key={item.name} className="insight-summary"><span>{item.name} ({item.count})</span><strong>{money(item.amount)}</strong></div>
                ))}
              </div>
            )}
            {biggestIncrease && (
              <div className="insight-tile">
                <span className="insight-label">Vs previous month</span>
                <p><strong>{biggestIncrease.category}</strong> is {money(biggestIncrease.change)} higher than last month so far.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {config.members.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <h2>Payment sources</h2>
            <span>Amount paid · not balances owed</span>
          </div>
          <div className="payer-grid">
            {payerDisplay.map(m => <Stat key={m} label={m} value={money(memberTotals[m] || 0)} />)}
          </div>

        </section>
      )}

      <div className="bottom-spacer" />
      {lastDeleted && <div className="undo-toast" role="status">
        <span>Deleted {lastDeleted.description}</span>
        <button onClick={() => void undoDelete()}>Undo</button>
      </div>}

      {showAdd && (
        <ExpenseFormSheet config={config} recentExpenses={[...expenses, ...history.slice(0, 2).flatMap(item => item.expenses)]}
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
