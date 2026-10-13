"use client";

import type { Expense } from "../lib/types";
import { moneyExact, fmtDate } from "../lib/utils";

export function Stat({ label, value, accent }: { label: string; value: string; accent?: "pos" | "neg" }) {
  return (
    <div className="stat-card">
      <div className="eyebrow">{label}</div>
      <div className={`stat-value${accent ? ` stat-${accent}` : ""}`}>{value}</div>
    </div>
  );
}

export function ExpenseRow({
  expense,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  expense: Expense;
  onEdit?: (e: Expense) => void;
  onDuplicate?: (e: Expense) => void;
  onDelete?: (id: number) => void;
}) {
  return (
    <div className="transaction-row">
      <div className="transaction-symbol" aria-hidden="true">
        {expense.category.charAt(0).toUpperCase() || "$"}
      </div>
      <button type="button" className="tr-main"
        disabled={!onEdit}
        aria-label={`Edit ${expense.description} expense`}
        onClick={() => onEdit?.(expense)}>
        <strong>
          {expense.description}
          {expense.recurring && <span className="recurring-badge" title="Repeats monthly"> ↻</span>}
        </strong>
        <span>{expense.category} · {expense.paidBy} · {fmtDate(expense.date)}</span>
        {expense.note && <span className="expense-note">{expense.note}</span>}
      </button>
      <div className="transaction-right">
        <strong>{moneyExact(expense.amount)}</strong>
        <div className="transaction-actions">
          {onDuplicate && (
            <button type="button" className="action-btn"
              aria-label={`Duplicate ${expense.description}`}
              title="Duplicate expense"
              onClick={() => onDuplicate(expense)}>
              <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="8" y="8" width="11" height="11" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button type="button" className="action-btn delete-action"
              aria-label={`Delete ${expense.description}`}
              title="Delete expense"
              onClick={() => onDelete(expense.id)}>
              <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5m4-5v5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
