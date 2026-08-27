export const KEY_CONFIG   = "our-money-config-v1";
export const KEY_EXPENSES = "our-money-expenses-v2";
export const KEY_HISTORY  = "our-money-history-v1";
export const KEY_MONTH         = "our-money-month-v1";
export const KEY_ACTUAL_INCOME = "our-money-actual-income-v1";
export const KEY_HOUSEHOLD     = "our-money-household-v1";
export const KEY_HOUSEHOLDS_LIST = "our-money-households-list-v1";

const HOUSEHOLD_KEYS = [KEY_CONFIG, KEY_EXPENSES, KEY_HISTORY, KEY_MONTH, KEY_ACTUAL_INCOME] as const;

/** Returns a cache key isolated to one household. */
export function householdKey(code: string, key: string): string {
  return `our-money-household-${code}:${key}`;
}

export function loadHousehold<T>(code: string, key: string, fallback: T): T {
  return load(householdKey(code, key), fallback);
}

export function saveHousehold(code: string, key: string, value: unknown): void {
  save(householdKey(code, key), value);
}

export function removeHouseholdCache(code: string): void {
  HOUSEHOLD_KEYS.forEach(key => localStorage.removeItem(householdKey(code, key)));
}

/** Moves the former single-household cache without overwriting newer scoped data. */
export function migrateLegacyHouseholdCache(code: string): void {
  HOUSEHOLD_KEYS.forEach(key => {
    const scopedKey = householdKey(code, key);
    const legacyValue = localStorage.getItem(key);
    if (localStorage.getItem(scopedKey) === null && legacyValue !== null) {
      localStorage.setItem(scopedKey, legacyValue);
    }
  });
}

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
