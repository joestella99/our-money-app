import type { Expense, MonthSnapshot } from "./types";
import { getYM } from "./utils";

export type Forecast = {
  projectedSpent: number;
  projectedSavings: number;
  spentSoFar: number;
  variableDailyRate: number;
  remainingDays: number;
  dayOfMonth: number;
  daysInMonth: number;
};

/**
 * Recurring charges are already recorded when a month is opened, so project
 * only the additional NON-recurring spending. The estimate is a pace-based
 * guide, not a guaranteed balance.
 */
export function forecastMonth(expenses: Expense[], income: number, now = new Date()): Forecast {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);
  const currentMonth = getYM(now);
  const spentSoFar = expenses.reduce((total, item) => total + item.amount, 0);
  const variableSpent = expenses
    .filter(item => !item.recurring && item.date.startsWith(currentMonth))
    .reduce((total, item) => total + item.amount, 0);
  const variableDailyRate = variableSpent / Math.max(dayOfMonth, 1);
  const projectedSpent = spentSoFar + variableDailyRate * remainingDays;
  return {
    projectedSpent,
    projectedSavings: income - projectedSpent,
    spentSoFar,
    variableDailyRate,
    remainingDays,
    dayOfMonth,
    daysInMonth,
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
