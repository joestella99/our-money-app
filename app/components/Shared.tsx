"use client";

import type { Expense } from "../lib/types";
import { money, fmtDate } from "../lib/utils";

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
      <div className="tr-main" onClick={() => onEdit?.(expense)}>
        <strong>
          {expense.description}
          {expense.recurring && <span className="recurring-badge"> &#x21BB;</span>}
        </strong>
        <span>
          {expense.category} &middot; {expense.paidBy} &middot; {fmtDate(expense.date)}
        </span>
        {expense.note && <span className="expense-note">{expense.note}</span>}
      </div>
      <div className="transaction-right">
        <strong>{money(expense.amount)}</strong>
        {onDuplicate && (
          <button
            className="action-btn"
            aria-label="Duplicate"
            onClick={(e) => { e.stopPropagation(); onDuplicate(expense); }}
          >
            &#x2398;
          </button>
        )}
        {onDelete && (
          <button
            className="action-btn"
            aria-label={`Delete ${expense.description}`}
            onClick={(e) => { e.stopPropagation(); onDelete(expense.id); }}
          >
            &#xD7;
          </button>
        )}
      </div>
    </div>
  );
}
