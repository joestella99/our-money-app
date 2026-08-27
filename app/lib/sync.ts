import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { ensureAnonymousAuth, getDb } from "./firebase";
import type { HouseholdConfig, Expense, MonthSnapshot } from "./types";

export type HouseholdData = {
  config: HouseholdConfig;
  expenses: Expense[];
  history: MonthSnapshot[];
  actualIncome: number | null;
  memberUids?: string[];
  updatedAt: number;
};

export type SetupResult =
  | { type: "create"; config: HouseholdConfig; code: string }
  | { type: "join"; data: HouseholdData; code: string };

type SyncCache = { expenses: Map<string, string>; history: Map<string, string> };
const syncCaches = new Map<string, SyncCache>();

const expensesPath = (db: Firestore, code: string) => collection(db, "households", code, "expenses");
const historyPath = (db: Firestore, code: string) => collection(db, "households", code, "history");
const serialized = (value: unknown) => JSON.stringify(value);

function cacheData(code: string, expenses: Expense[], history: MonthSnapshot[]) {
  syncCaches.set(code, {
    expenses: new Map(expenses.map(item => [String(item.id), serialized(item)])),
    history: new Map(history.map(item => [item.yearMonth, serialized(item)])),
  });
}

function dataFromDocs(meta: DocumentData, expenseDocs: DocumentData[], historyDocs: DocumentData[]): HouseholdData {
  // Arrays are read only as a migration fallback. New writes use subcollections,
  // avoiding Firestore's 1 MiB document limit and rewriting years of data.
  const expenses = expenseDocs.length ? expenseDocs as Expense[] : (meta.expenses ?? []);
  const history = historyDocs.length ? historyDocs as MonthSnapshot[] : (meta.history ?? []);
  return {
    config: meta.config,
    expenses,
    history,
    actualIncome: meta.actualIncome ?? null,
    memberUids: meta.memberUids,
    updatedAt: meta.updatedAt ?? 0,
  };
}

async function readHousehold(db: Firestore, code: string): Promise<HouseholdData | null> {
  const [meta, expenseSnap, historySnap] = await Promise.all([
    getDoc(doc(db, "households", code)),
    getDocs(expensesPath(db, code)),
    getDocs(historyPath(db, code)),
  ]);
  if (!meta.exists()) return null;
  const data = dataFromDocs(
    meta.data(),
    expenseSnap.docs.map(item => item.data()),
    historySnap.docs.map(item => item.data())
  );
  cacheData(code, data.expenses, data.history);
  return data;
}

/** Generates a human-readable 6-char code (no O/0/I/1 confusion). */
export function generateHouseholdCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function joinHousehold(code: string): Promise<HouseholdData | null> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db || !user) return null;

  const cleanCode = code.toUpperCase().trim();
  const householdRef = doc(db, "households", cleanCode);
  try {
    // Rules validate either the invite or the legacy-household migration case.
    await updateDoc(householdRef, { memberUids: arrayUnion(user.uid) });
    return await readHousehold(db, cleanCode);
  } catch (error) {
    console.error("Could not join household", error);
    return null;
  }
}

export function subscribeToHousehold(
  code: string,
  onData: (data: HouseholdData) => void,
  onDeleted: () => void,
  onError: (error: Error) => void
): () => void {
  const db = getDb();
  if (!db) return () => {};

  let cancelled = false;
  let unsubscribes: (() => void)[] = [];
  ensureAnonymousAuth().then(user => {
    if (!user || cancelled) return;
    let meta: DocumentData | null = null;
    let expenses: Expense[] = [];
    let history: MonthSnapshot[] = [];
    const ready = { meta: false, expenses: false, history: false };
    const emit = () => {
      if (!meta || !ready.meta || !ready.expenses || !ready.history) return;
      const data = dataFromDocs(meta, expenses, history);
      cacheData(code, data.expenses, data.history);
      onData(data);
    };

    unsubscribes = [
      onSnapshot(doc(db, "households", code), snap => {
        ready.meta = true;
        if (!snap.exists()) return onDeleted();
        meta = snap.data();
        emit();
      }, onError),
      onSnapshot(expensesPath(db, code), snap => {
        ready.expenses = true;
        expenses = snap.docs.map(item => item.data() as Expense);
        emit();
      }, onError),
      onSnapshot(historyPath(db, code), snap => {
        ready.history = true;
        history = snap.docs.map(item => item.data() as MonthSnapshot);
        emit();
      }, onError),
    ];
  });

  return () => {
    cancelled = true;
    unsubscribes.forEach(unsubscribe => unsubscribe());
  };
}

export async function pushHousehold(
  code: string,
  data: Omit<HouseholdData, "updatedAt" | "memberUids">
): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");

  const cache = syncCaches.get(code) ?? { expenses: new Map(), history: new Map() };
  const nextExpenses = new Map(data.expenses.map(item => [String(item.id), serialized(item)]));
  const nextHistory = new Map(data.history.map(item => [item.yearMonth, serialized(item)]));
  const householdRef = doc(db, "households", code);
  type RecordWrite = { ref: DocumentReference; value?: Expense | MonthSnapshot };
  const writes: RecordWrite[] = [];

  // Subcollection rules require an existing member-owned parent. New households
  // establish that small parent before writing any child records.
  if (!(await getDoc(householdRef)).exists()) {
    await setDoc(householdRef, {
      config: data.config,
      actualIncome: data.actualIncome,
      memberUids: [user.uid],
      updatedAt: Date.now(),
      schemaVersion: 2,
    });
  }

  for (const item of data.expenses) {
    const id = String(item.id);
    if (cache.expenses.get(id) !== nextExpenses.get(id)) writes.push({ ref: doc(expensesPath(db, code), id), value: item });
  }
  for (const id of cache.expenses.keys()) {
    if (!nextExpenses.has(id)) writes.push({ ref: doc(expensesPath(db, code), id) });
  }
  for (const item of data.history) {
    const id = item.yearMonth;
    if (cache.history.get(id) !== nextHistory.get(id)) writes.push({ ref: doc(historyPath(db, code), id), value: item });
  }
  for (const id of cache.history.keys()) {
    if (!nextHistory.has(id)) writes.push({ ref: doc(historyPath(db, code), id) });
  }

  // Bound batches well below Firestore's 500-write limit, including large JSON
  // imports and migrations from the former single-document representation.
  for (let offset = 0; offset < writes.length; offset += 450) {
    const recordsBatch = writeBatch(db);
    for (const write of writes.slice(offset, offset + 450)) {
      if (write.value) recordsBatch.set(write.ref, write.value);
      else recordsBatch.delete(write.ref);
    }
    await recordsBatch.commit();
  }

  const batch = writeBatch(db);
  // The household document stays small; high-growth records live separately.
  batch.set(householdRef, {
    config: data.config,
    actualIncome: data.actualIncome,
    memberUids: arrayUnion(user.uid),
    updatedAt: Date.now(),
    schemaVersion: 2,
    expenses: deleteField(),
    history: deleteField(),
  }, { merge: true });
  batch.set(doc(db, "householdInvites", code), {
    householdCode: code,
    active: true,
    updatedAt: Date.now(),
  }, { merge: true });
  await batch.commit();
  syncCaches.set(code, { expenses: nextExpenses, history: nextHistory });
}

/** Permanently removes the household and all client-owned subcollection data. */
export async function deleteHousehold(code: string): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");

  const [expenseSnap, historySnap] = await Promise.all([
    getDocs(expensesPath(db, code)),
    getDocs(historyPath(db, code)),
  ]);
  const refs = [...expenseSnap.docs, ...historySnap.docs].map(item => item.ref);
  // Firestore batches allow at most 500 writes. Leave room for parent + invite.
  for (let offset = 0; offset < refs.length; offset += 450) {
    const batch = writeBatch(db);
    refs.slice(offset, offset + 450).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(doc(db, "householdInvites", code));
  batch.delete(doc(db, "households", code));
  await batch.commit();
  syncCaches.delete(code);
}
