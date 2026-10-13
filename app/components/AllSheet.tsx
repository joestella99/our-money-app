"use client";

import { useMemo, useState } from "react";
import type { Expense, SortKey } from "../lib/types";
import { ExpenseRow } from "./Shared";

export function AllSheet({
  expenses,
  initialCategory = null,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: {
  expenses: Expense[];
  initialCategory?: string | null;
  onEdit: (e: Expense) => void;
  onDuplicate: (e: Expense) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [sort,   setSort]   = useState<SortKey>("date-desc");
  const [category, setCategory] = useState<string | null>(initialCategory);
  const categories = useMemo(() => [...new Set(expenses.map(expense => expense.category))].sort(), [expenses]);

  const filtered = useMemo(() => {
    let list = [...expenses];
    if (category) list = list.filter(expense => expense.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.description.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          e.paidBy.toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sort === "date-desc")   return b.date.localeCompare(a.date);
      if (sort === "date-asc")    return a.date.localeCompare(b.date);
      if (sort === "amount-desc") return b.amount - a.amount;
      return a.amount - b.amount;
    });
    return list;
  }, [expenses, search, sort, category]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet tall transactions-sheet" role="dialog" aria-modal="true" aria-labelledby="transactions-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2 id="transactions-title">Your transactions</h2>
          <button className="pill-button" onClick={onClose}>Close</button>
        </div>

        <div className="search-row">
          <input
            className="field"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses..." aria-label="Search expenses"
          />
          <select
            className="field sort-select"
            aria-label="Sort transactions"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="date-desc">Newest</option>
            <option value="date-asc">Oldest</option>
            <option value="amount-desc">Highest</option>
            <option value="amount-asc">Lowest</option>
          </select>
        </div>

        {categories.length > 1 && (
          <div className="category-filter-scroll" aria-label="Filter by category">
            <button className={category === null ? "filter-chip selected" : "filter-chip"} onClick={() => setCategory(null)}>All</button>
            {categories.map(item => (
              <button key={item} className={category === item ? "filter-chip selected" : "filter-chip"}
                onClick={() => setCategory(item)}>{item}</button>
            ))}
          </div>
        )}

        <div className="tx-count">
          {filtered.length === expenses.length
            ? `${expenses.length} transactions`
            : `${filtered.length} of ${expenses.length}`}
        </div>

        <div className="transaction-list">
          {filtered.length === 0 ? (
            <p className="empty-state">{search ? "No matches." : "No expenses yet."}</p>
          ) : (
            filtered.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                onEdit={onEdit}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
