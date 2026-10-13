"use client";

import { useEffect, useMemo, useState } from "react";
import type { Expense, HouseholdConfig, MonthSnapshot } from "../lib/types";
import { calculateBudgetOutlook, spendByDescription } from "../lib/insights";
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
  householdCode: string;
  onSyncError: (message: string) => void;
  onHome: () => void;
}) {
  const [showAdd,   setShowAdd]   = useState(false);
  const [showAll,   setShowAll]   = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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

  // Budgets, not elapsed days, determine the savings outlook. Paying rent
  // on day one cannot inflate next month's hypothetical rent spending.
  const outlook = useMemo(
    () => calculateBudgetOutlook(expenses, config.budgets, effectiveIncome, config.monthlySavingsGoal),
    [expenses, config.budgets, effectiveIncome, config.monthlySavingsGoal]
  );
  const { safeToSpend, onBudgetSavings, remainingBudget } = outlook;
  const savingsVariance = outlook.versusGoal;
  const totalBudget = config.budgets.reduce((sum, item) => sum + item.amount, 0);
  const actualSpentPercent = totalBudget > 0
    ? Math.max(0, Math.round((totalSpent / totalBudget) * 100))
    : 0;
  const spentPercent = Math.min(100, actualSpentPercent);
  const topFrequent = useMemo(
    () => spendByDescription(expenses)
      .sort((a, b) => b.count - a.count || b.amount - a.amount)
      .slice(0, 3),
    [expenses]
  );

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

  function openTransactions(category: string | null = null) {
    setSelectedCategory(category);
    setShowAll(true);
  }

  return (
    <main className="dashboard-shell">
      <header className="topbar topbar-budget">
        <div className="topbar-copy">
          <div className="brandline"><span className="brand-mark" /> OUR MONEY</div>
          <h1>{labelYM(activeMonth ?? getYM())}</h1>
          <div className="subtle">
            Your household overview
            {actualIncome !== null && <span className="income-override"> · income adjusted</span>}
          </div>
        </div>
        <button className="home-switch" onClick={onHome} aria-label="Switch household" title="Switch household">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 10 9-7 9 7v10H3V10Z" />
            <path d="M9 20v-7h6v7" />
          </svg>
        </button>
      </header>

      <section className="hero-card" aria-label="Money available beyond your budget plan">
        <div className="hero-topline">
          <span className="hero-label"><span className="hero-label-dot" /> AVAILABLE TO SPEND</span>
          <span className="hero-caption">This month</span>
        </div>
        <div className={`hero-amount${safeToSpend < 0 ? " hero-amount-negative" : ""}`}>{money(safeToSpend)}</div>
        <p className="hero-description">
          {safeToSpend < 0
            ? "Your spending plan exceeds your take-home and savings goal."
            : "Extra after your savings goal and remaining category budgets."}
        </p>
        <div className="hero-divider" />
        <div className="hero-bottom">
          <div className="hero-bottom-copy">
            <span>Spent this month</span>
            <strong>{money(totalSpent)} <small>of {money(totalBudget)} budgeted</small></strong>
          </div>
          <div
            className="budget-donut"
            style={{ background: `conic-gradient(${actualSpentPercent > 100 ? "var(--negative)" : "var(--accent)"} 0 ${spentPercent}%, rgba(255,255,255,.12) ${spentPercent}% 100%)` }}
            role="img" aria-label={`${actualSpentPercent}% of monthly budget spent`}
          >
            <div>{actualSpentPercent}%</div>
          </div>
        </div>
      </section>

      {budgetAlerts.length > 0 && (
        <div className="alert-strip" aria-label="Budget alerts">
          {budgetAlerts.map(({ category, pct, over }) => (
            <div key={category} className={`alert-chip ${over ? "over" : "warn"}`}>
              <span>{over ? "!" : "↗"} {category} {pct}%</span>
              <button aria-label={`Dismiss ${category} alert`} onClick={() => dismiss(category)}>×</button>
            </div>
          ))}
        </div>
      )}

      <section className="snapshot-section" aria-label="Monthly budget snapshot">
        <div className="section-heading"><h2>At a glance</h2><span>Based on your budget</span></div>
        <div className="stat-grid">
          <Stat label="Spent so far" value={money(totalSpent)} />
          <Stat label="Still budgeted" value={money(remainingBudget)} />
          <Stat label="Savings on budget" value={money(onBudgetSavings)} accent={onBudgetSavings >= config.monthlySavingsGoal ? "pos" : "neg"} />
          <Stat label="Savings goal" value={money(config.monthlySavingsGoal)} />
        </div>
        <div className={`savings-status ${savingsVariance < 0 ? "savings-status--behind" : ""}`}>
          <span className="savings-status-icon" aria-hidden="true">{savingsVariance >= 0 ? "✓" : "!"}</span>
          <div>
            <strong>{savingsVariance >= 0 ? "Your budget supports your savings goal" : "Your budget needs an adjustment"}</strong>
            <span>{savingsVariance >= 0
              ? `${money(savingsVariance)} left beyond the savings goal`
              : `${money(Math.abs(savingsVariance))} short of your savings goal`}</span>
          </div>
        </div>
      </section>

      {config.budgets.length > 0 && (
        <section className="section budget-section">
          <div className="section-heading">
            <div><h2>Categories</h2><p>Tap one to see its transactions</p></div>
            <span>{config.budgets.length} budgets</span>
          </div>
          <div className="budget-list">
            {config.budgets.map(({ category, amount }, i) => {
              const spent = categorySpent[category] || 0;
              const remaining = amount - spent;
              const pct = Math.min(amount > 0 ? (spent / amount) * 100 : 0, 100);
              const over = spent > amount;
              return (
                <button className="budget-row budget-row-action" key={category}
                  onClick={() => openTransactions(category)}
                  aria-label={`View ${category} expenses, ${money(spent)} spent of ${money(amount)} budget`}>
                  <div className="category-emblem" aria-hidden="true">{category.charAt(0).toUpperCase()}</div>
                  <div className="budget-row-content">
                    <div className="budget-row-heading">
                      <strong>{category}</strong>
                      <strong>{money(spent)} <span>/ {money(amount)}</span></strong>
                    </div>
                    <div className="progress"><div className={`progress-fill ${over ? "progress-fill-over" : ""}`}
                      style={{ width: `${pct}%` }} /></div>
                    <div className="budget-row-foot">
                      <span className={over ? "savings-neg" : ""}>{over ? `${money(-remaining)} over budget` : `${money(remaining)} remaining`}</span>
                      <span>{Math.round(amount > 0 ? (spent / amount) * 100 : 0)}% used</span>
                    </div>
                  </div>
                  <span className="budget-chevron" aria-hidden="true">›</span>
                </button>
              );
            })}
            {Object.entries(categorySpent)
              .filter(([category, spent]) => spent > 0 && !config.budgets.some(b => b.category === category))
              .map(([category, spent]) => (
                <button className="budget-row budget-row-action" key={category}
                  onClick={() => openTransactions(category)}>
                  <div className="category-emblem" aria-hidden="true">?</div>
                  <div className="budget-row-content">
                    <div className="budget-row-heading"><strong>{category}</strong><strong>{money(spent)}</strong></div>
                    <div className="budget-row-foot"><span>No budget set</span><span>View expenses</span></div>
                  </div>
                  <span className="budget-chevron" aria-hidden="true">›</span>
                </button>
              ))}
          </div>
        </section>
      )}

      {topFrequent.length > 0 && (
        <section className="section">
          <div className="section-heading">
            <div><h2>Your patterns</h2><p>Places you log most often</p></div>
          </div>
          <div className="pattern-list">
            {topFrequent.map((item, index) => (
              <div className="pattern-item" key={item.name.toLocaleLowerCase()}>
                <span className="pattern-index">{String(index + 1).padStart(2, "0")}</span>
                <div><strong>{item.name}</strong><span>{item.count} {item.count === 1 ? "expense" : "expenses"}</span></div>
                <strong>{money(item.amount)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section recent-section">
        <div className="section-heading">
          <div><h2>Recent activity</h2><p>Everything in one place</p></div>
          <button className="text-button" onClick={() => openTransactions()}>
            See all <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="transaction-list">
          {expenseError && <p className="form-error" role="alert">Could not save: {expenseError}</p>}
          {expenses.length === 0
            ? <p className="empty-state">No expenses yet. Add your first expense to start tracking.</p>
            : [...expenses].sort((a,b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, 5).map(e => (
                <ExpenseRow key={e.id} expense={e}
                  onEdit={setEditing} onDuplicate={duplicateExpense} onDelete={deleteExpense} />
              ))}
        </div>
      </section>

      <div className="bottom-spacer" />
      {lastDeleted && <div className="undo-toast" role="status">
        <span>Deleted {lastDeleted.description}</span>
        <button onClick={() => void undoDelete()}>Undo</button>
      </div>}

      <div className="floating-actions">
        <button className="primary-action add-expense-button" onClick={() => setShowAdd(true)}>
          <span className="add-icon" aria-hidden="true">+</span> Add expense
        </button>
      </div>

      {showAdd && (
        <ExpenseFormSheet config={config} householdCode={householdCode} recentExpenses={[...expenses, ...history.slice(0, 2).flatMap(item => item.expenses)]}
          onSave={persistExpense} onClose={() => setShowAdd(false)} />
      )}
      {showAll && (
        <AllSheet expenses={expenses} initialCategory={selectedCategory}
          onEdit={setEditing} onDuplicate={duplicateExpense} onDelete={deleteExpense}
          onClose={() => { setShowAll(false); setSelectedCategory(null); }} />
      )}
      {editing && (
        <ExpenseFormSheet config={config} householdCode={householdCode} initial={editing}
          onSave={persistExpense} onClose={() => setEditing(null)} />
      )}
    </main>
  );
}
