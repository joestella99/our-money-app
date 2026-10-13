import type { BudgetLine, Expense, MonthSnapshot } from "./types";
import { getYM } from "./utils";

/**
 * An intentionally NON time-based savings plan. Fixed bills such as rent are
 * counted only once regardless of the day they are recorded.
 *
 * Savings if on budget = income - already logged spending - unspent category
 * envelopes. Uncategorized/unbudgeted spending is included through logged
 * spending and reduces savings immediately.
 */
export function calculateBudgetOutlook(
  expenses: Expense[],
  budgets: BudgetLine[],
  income: number,
  savingsGoal: number,
) {
  const spentByCategory = new Map<string, number>();
  let spent = 0;
  for (const expense of expenses) {
    spent += expense.amount;
    spentByCategory.set(
      expense.category,
      (spentByCategory.get(expense.category) ?? 0) + expense.amount,
    );
  }
  const remainingBudget = budgets.reduce(
    (sum, budget) => sum + Math.max(0, budget.amount - (spentByCategory.get(budget.category) ?? 0)),
    0,
  );
  const onBudgetSpending = spent + remainingBudget;
  const onBudgetSavings = income - onBudgetSpending;
  return {
    spent,
    remainingBudget,
    onBudgetSpending,
    onBudgetSavings,
    safeToSpend: onBudgetSavings - savingsGoal,
    versusGoal: onBudgetSavings - savingsGoal,
  };
}

export function spendByCategory(expenses: Expense[]): { name: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const e of expenses) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  return [...totals].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}

export function spendByDescription(expenses: Expense[]): { name: string; amount: number; count: number }[] {
  const totals = new Map<string, { name: string; amount: number; count: number }>();
  for (const e of expenses) {
    const normalized = e.description.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!normalized) continue;
    const prev = totals.get(normalized);
    if (prev) {
      prev.amount += e.amount;
      prev.count += 1;
    } else {
      totals.set(normalized, { name: e.description.trim(), amount: e.amount, count: 1 });
    }
  }
  return [...totals.values()].sort((a, b) => b.amount - a.amount);
}

export function previousMonth(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return getYM(new Date(year, month - 2, 1));
}

export function followingMonth(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return getYM(new Date(year, month, 1));
}

/** Preserve the calendar day where possible, adjusting for shorter months. */
export function dateInMonth(iso: string, ym: string): string {
  const day = Number(iso.slice(8, 10));
  const [year, month] = ym.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return `${ym}-${String(Math.min(Math.max(day || 1, 1), last)).padStart(2, "0")}`;
}

export function categoryChange(current: Expense[], history: MonthSnapshot[], activeMonth: string) {
  const previous = history.find(item => item.yearMonth === previousMonth(activeMonth));
  if (!previous) return null;
  const before = spendByCategory(previous.expenses);
  const after = spendByCategory(current);
  const beforeMap = new Map(before.map(item => [item.name, item.amount]));
  const differences = after.map(item => ({
    category: item.name, current: item.amount,
    previous: beforeMap.get(item.name) ?? 0,
    change: item.amount - (beforeMap.get(item.name) ?? 0),
  }));
  return differences.sort((a, b) => b.change - a.change);
}
