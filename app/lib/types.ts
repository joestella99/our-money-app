export type Expense = {
  id: number;
  amount: number;
  description: string;
  category: string;
  paidBy: string;
  date: string;
  recurring: boolean;
  note: string;
};

export type BudgetLine = { category: string; amount: number };

export type HouseholdConfig = {
  name: string;
  members: string[];
  monthlyTakeHome: number;
  monthlySavingsGoal: number;
  budgets: BudgetLine[];
};

export type MonthSnapshot = {
  yearMonth: string;
  config: HouseholdConfig;
  expenses: Expense[];
  actualIncome: number | null;
};

export type SortKey = "date-desc" | "date-asc" | "amount-desc" | "amount-asc";

export type HouseholdEntry = {
  code: string;
  name: string;
};
