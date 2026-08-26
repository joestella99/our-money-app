export const KEY_CONFIG   = "our-money-config-v1";
export const KEY_EXPENSES = "our-money-expenses-v2";
export const KEY_HISTORY  = "our-money-history-v1";
export const KEY_MONTH         = "our-money-month-v1";
export const KEY_ACTUAL_INCOME = "our-money-actual-income-v1";
export const KEY_HOUSEHOLD     = "our-money-household-v1";
export const KEY_HOUSEHOLDS_LIST = "our-money-households-list-v1";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, val: unknown): void {
  localStorage.setItem(key, JSON.stringify(val));
}
