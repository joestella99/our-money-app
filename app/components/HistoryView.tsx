"use client";

import { useState } from "react";
import type { MonthSnapshot } from "../lib/types";
import { money, moneyExact, labelYM, fmtDate, getYM } from "../lib/utils";
import { Stat } from "./Shared";
import { spendByCategory, spendByDescription } from "../lib/insights";

export function HistoryView({ history }: { history: MonthSnapshot[] }) {
  const [detail,    setDetail]    = useState<MonthSnapshot | null>(null);
  const [detailIdx, setDetailIdx] = useState<number>(-1);

  const currentYear = getYM().slice(0, 4);
  const ytdMonths   = history.filter(s => s.yearMonth.startsWith(currentYear));
  const recentMonths = [...history].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth)).slice(0, 3);
  const recentExpenses = recentMonths.flatMap(month => month.expenses);
  const leadingCategories = spendByCategory(recentExpenses).slice(0, 5);
  const leadingMerchants = spendByDescription(recentExpenses).slice(0, 3);

  function calcTotals(months: typeof history) {
    return {
      months:  months.length,
      spent:   months.reduce((s, m) => s + m.expenses.reduce((a, e) => a + e.amount, 0), 0),
      saved:   months.reduce((s, m) => {
        const inc   = m.actualIncome ?? m.config.monthlyTakeHome;
        const spent = m.expenses.reduce((a, e) => a + e.amount, 0);
        return s + (inc - spent);
      }, 0),
      goal: months.reduce((s, m) => s + m.config.monthlySavingsGoal, 0),
    };
  }

  const allTime = history.length > 0 ? calcTotals(history) : null;
  const ytd     = ytdMonths.length > 0 && ytdMonths.length < history.length ? calcTotals(ytdMonths) : null;

  return (
    <>
      <header className="topbar">
        <div>
          <div className="brandline"><span className="brand-mark" /> OUR MONEY / HISTORY</div>
          <h1>Past months</h1>
          <p className="subtle">A clear view of how your money moves</p>
        </div>
      </header>

      {allTime && (
        <div className="ytd-card">
          <div className="ytd-title">
            All time &middot; {allTime.months} month{allTime.months !== 1 ? "s" : ""}
          </div>
          <div className="ytd-grid">
            <div>
              <div className="eyebrow">Spent</div>
              <div className="ytd-value">{money(allTime.spent)}</div>
            </div>
            <div>
              <div className="eyebrow">Saved</div>
              <div className={`ytd-value ${allTime.saved >= allTime.goal ? "savings-pos" : "savings-neg"}`}>
                {money(allTime.saved)}
              </div>
            </div>
            <div>
              <div className="eyebrow">vs goal</div>
              <div className={`ytd-value ${allTime.saved >= allTime.goal ? "savings-pos" : "savings-neg"}`}>
                {allTime.saved >= allTime.goal ? "+" : ""}{money(allTime.saved - allTime.goal)}
              </div>
            </div>
          </div>
        </div>
      )}

      {ytd && (
        <div className="ytd-card" style={{ marginTop: 10 }}>
          <div className="ytd-title">
            {currentYear} year-to-date &middot; {ytd.months} month{ytd.months !== 1 ? "s" : ""}
          </div>
          <div className="ytd-grid">
            <div>
              <div className="eyebrow">Spent</div>
              <div className="ytd-value">{money(ytd.spent)}</div>
            </div>
            <div>
              <div className="eyebrow">Saved</div>
              <div className={`ytd-value ${ytd.saved >= ytd.goal ? "savings-pos" : "savings-neg"}`}>
                {money(ytd.saved)}
              </div>
            </div>
            <div>
              <div className="eyebrow">vs goal</div>
              <div className={`ytd-value ${ytd.saved >= ytd.goal ? "savings-pos" : "savings-neg"}`}>
                {ytd.saved >= ytd.goal ? "+" : ""}{money(ytd.saved - ytd.goal)}
              </div>
            </div>
          </div>
        </div>
      )}

      {recentMonths.length > 0 && (
        <section className="section" style={{ marginBottom: 26 }}>
          <div className="section-heading">
            <h2>Spending trends</h2>
            <span>last {recentMonths.length} archived month{recentMonths.length === 1 ? "" : "s"}</span>
          </div>
          <div className="insights-list">
            <div className="insight-tile">
              <span className="insight-label">Top categories over this period</span>
              {leadingCategories.map(item => (
                <div className="insight-rank-row" key={item.name}>
                  <span>{item.name}</span><strong>{money(item.amount)}</strong>
                  <div className="insight-bar">
                    <div style={{ width: `${(item.amount / leadingCategories[0].amount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="insight-tile">
              <span className="insight-label">Category trend by month</span>
              <div className="history-trend-table">
                <div className="history-trend-row heading">
                  <span>Category</span>
                  {recentMonths.map(month => <span key={month.yearMonth}>{labelYM(month.yearMonth).split(" ")[0].slice(0, 3)}</span>)}
                </div>
                {leadingCategories.map(cat => (
                  <div className="history-trend-row" key={cat.name}>
                    <span>{cat.name}</span>
                    {recentMonths.map(month => (
                      <span key={month.yearMonth}>
                        {money(month.expenses.filter(expense => expense.category === cat.name).reduce((sum, item) => sum + item.amount, 0))}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            {leadingMerchants.length > 0 && (
              <div className="insight-tile">
                <span className="insight-label">Top places / descriptions</span>
                {leadingMerchants.map(item => (
                  <div className="insight-summary" key={item.name}>
                    <span>{item.name} ({item.count})</span><strong>{money(item.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {history.length === 0 ? (
        <div className="empty-page">
          <div className="setup-emoji">&#x1F4C5;</div>
          <p>Past months appear here automatically when a new month begins.</p>
        </div>
      ) : (
        <div className="history-grid">
          {history.map((snap, i) => {
            const total     = snap.expenses.reduce((s, e) => s + e.amount, 0);
            const budget    = snap.config.budgets.reduce((s, b) => s + b.amount, 0);
            const pct       = budget > 0 ? Math.min((total / budget) * 100, 100) : 0;
            const prevSnap  = history[i + 1];
            const prevTotal = prevSnap ? prevSnap.expenses.reduce((s, e) => s + e.amount, 0) : null;
            const delta     = prevTotal !== null ? total - prevTotal : null;
            const saved     = (snap.actualIncome ?? snap.config.monthlyTakeHome) - total;
            const sVar      = saved - snap.config.monthlySavingsGoal;

            return (
              <button key={snap.yearMonth} className="history-card"
                onClick={() => { setDetail(snap); setDetailIdx(i); }}>
                <div className="history-label-row">
                  <div className="history-label">{labelYM(snap.yearMonth)}</div>
                  {delta !== null && (
                    <div className={`delta-chip ${delta > 0 ? "neg" : "pos"}`}>
                      {delta > 0 ? "+" : ""}{money(delta)} vs prev
                    </div>
                  )}
                </div>
                <div className="history-amount">{money(total)}</div>
                <div className="history-sub">of {money(budget)} budget &middot; {Math.round(pct)}% spent</div>
                <div className="history-savings">
                  Saved {money(saved)}{" "}
                  <span className={sVar >= 0 ? "savings-pos" : "savings-neg"}>
                    ({sVar >= 0 ? "+" : ""}{money(sVar)} vs goal)
                  </span>
                </div>
                <div className="progress" style={{ marginTop: 10 }}>
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detail && (
        <MonthDetail
          snapshot={detail}
          prevSnapshot={detailIdx >= 0 ? history[detailIdx + 1] : undefined}
          onClose={() => { setDetail(null); setDetailIdx(-1); }}
        />
      )}
    </>
  );
}

function MonthDetail({
  snapshot, prevSnapshot, onClose,
}: {
  snapshot: MonthSnapshot;
  prevSnapshot?: MonthSnapshot;
  onClose: () => void;
}) {
  const { config, expenses, yearMonth } = snapshot;
  const effectiveIncome = snapshot.actualIncome ?? config.monthlyTakeHome;
  const totalSpent      = expenses.reduce((s, e) => s + e.amount, 0);
  const totalBudget     = config.budgets.reduce((s, b) => s + b.amount, 0);
  const totalSaved      = effectiveIncome - totalSpent;

  const catSpent: Record<string, number> = {};
  for (const e of expenses) catSpent[e.category] = (catSpent[e.category] || 0) + e.amount;

  // Build previous month's category totals for trend display
  const prevCatSpent: Record<string, number> = {};
  if (prevSnapshot) {
    for (const e of prevSnapshot.expenses) {
      prevCatSpent[e.category] = (prevCatSpent[e.category] || 0) + e.amount;
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet tall" onClick={e => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>{labelYM(yearMonth)}</h2>
          <button className="pill-button" onClick={onClose}>Close</button>
        </div>

        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <Stat label="Total spent"  value={money(totalSpent)} />
          <Stat label="Budget"       value={money(totalBudget)} />
          <Stat label="Total saved"  value={money(totalSaved)}
            accent={totalSaved >= config.monthlySavingsGoal ? "pos" : "neg"} />
          <Stat label="Savings goal" value={money(config.monthlySavingsGoal)} />
        </div>

        {config.budgets.length > 0 && (
          <div className="budget-list" style={{ marginBottom: 20 }}>
            {config.budgets.map(({ category, amount }) => {
              const spent     = catSpent[category] || 0;
              const pct       = Math.min(amount > 0 ? (spent / amount) * 100 : 0, 100);
              const prevSpent = prevCatSpent[category];
              const trend     = prevSpent !== undefined ? spent - prevSpent : null;
              return (
                <div className="budget-row" key={category}>
                  <div className="budget-meta">
                    <div>
                      <strong>{category}</strong>
                      <span>
                        {money(spent)} of {money(amount)}
                        {trend !== null && (
                          <span className={trend <= 0 ? "savings-pos" : "savings-neg"}>
                            {" "}({trend > 0 ? "+" : ""}{money(trend)} vs prev)
                          </span>
                        )}
                      </span>
                    </div>
                    <span>{Math.round(pct)}%</span>
                  </div>
                  <div className="progress">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="section-heading" style={{ marginBottom: 12 }}>
          <h2>Transactions</h2>
          <span>{expenses.length} items</span>
        </div>
        <div className="transaction-list">
          {expenses.map(e => (
            <div key={e.id} className="transaction-row">
              <div>
                <strong>
                  {e.description}
                  {e.recurring && <span className="recurring-badge"> &#x21BB;</span>}
                </strong>
                <span>{e.category} &middot; {e.paidBy} &middot; {fmtDate(e.date)}</span>
                {e.note && <span className="expense-note">{e.note}</span>}
              </div>
              <div><strong>{moneyExact(e.amount)}</strong></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
