import type { Expense } from "./types";

export function money(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export function getYM(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function labelYM(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function exportCSV(expenses: Expense[], label: string) {
  const rows = [
    ["Date", "Description", "Category", "Paid By", "Amount"],
    ...expenses.map((e) => [
      e.date,
      `"${e.description.replace(/"/g, '""')}"`,
      e.category,
      e.paidBy,
      e.amount.toFixed(2),
    ]),
  ];
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-${label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


/** Move an ISO date to the same day next month, clamped to month-end. */
export function nextMonthISO(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  const nextMonthIndex = month; // Date month index is 0-based; this is next month.
  const lastDay = new Date(year, nextMonthIndex + 1, 0).getDate();
  const d = new Date(year, nextMonthIndex, Math.min(day, lastDay));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
