import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
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

const expensesPath = (db: Firestore, code: string) => collection(db, "households", code, "expenses");
const archivedMonthsPath = (db: Firestore, code: string) => collection(db, "households", code, "archivedMonths");
const legacyHistoryPath = (db: Firestore, code: string) => collection(db, "households", code, "history");

export function firestoreSafe<T>(value: T): T {
  if (Array.isArray(value)) return value.filter(item => item !== undefined).map(item => firestoreSafe(item)) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, firestoreSafe(item)])) as T;
  }
  return value;
}

function normalizeExpense(value: Partial<Expense>): Expense {
  return firestoreSafe({ id: Number(value.id), amount: Number(value.amount), description: String(value.description ?? ""),
    category: String(value.category ?? "Uncategorized"), paidBy: String(value.paidBy ?? ""), date: String(value.date ?? ""),
    recurring: value.recurring === true, note: String(value.note ?? "") });
}

function normalizeSnapshot(value: Partial<MonthSnapshot>): MonthSnapshot {
  return firestoreSafe({ yearMonth: String(value.yearMonth ?? ""), config: value.config as HouseholdConfig,
    expenses: Array.isArray(value.expenses) ? value.expenses.map(normalizeExpense) : [],
    actualIncome: typeof value.actualIncome === "number" ? value.actualIncome : null });
}

function dataFromDocs(meta: DocumentData, expenseDocs: DocumentData[], historyDocs: DocumentData[]): HouseholdData {
  const expenses = expenseDocs.map(item => normalizeExpense(item));
  const history = historyDocs.map(item => normalizeSnapshot(item));
  return {
    config: meta.config,
    expenses,
    history,
    actualIncome: meta.actualIncome ?? null,
    memberUids: meta.memberUids,
    updatedAt: typeof meta.updatedAt?.toMillis === "function" ? meta.updatedAt.toMillis() : (meta.updatedAt ?? 0),
  };
}

async function migrateLegacyData(db: Firestore, code: string): Promise<void> {
  const parentRef = doc(db, "households", code);
  const [parent, currentExpenses, currentArchives, oldHistory] = await Promise.all([
    getDoc(parentRef), getDocs(expensesPath(db, code)), getDocs(archivedMonthsPath(db, code)), getDocs(legacyHistoryPath(db, code)),
  ]);
  if (!parent.exists()) return;
  const meta = parent.data();
  const legacyExpenses = Array.isArray(meta.expenses) ? meta.expenses.map(normalizeExpense) : [];
  const parentHistory = Array.isArray(meta.history) ? meta.history.map(normalizeSnapshot) : [];
  const oldSnapshots = oldHistory.docs.map(item => normalizeSnapshot({ ...item.data(), yearMonth: item.data().yearMonth ?? item.id }));
  const archiveIds = new Set(currentArchives.docs.map(item => item.id));
  const sets = [
    ...(currentExpenses.empty ? legacyExpenses : []).map(item => ({ ref: doc(expensesPath(db, code), String(item.id)), data: item })),
    ...[...parentHistory, ...oldSnapshots].filter(item => item.yearMonth && !archiveIds.has(item.yearMonth))
      .map(item => ({ ref: doc(archivedMonthsPath(db, code), item.yearMonth), data: item })),
  ];
  for (let offset = 0; offset < sets.length; offset += 450) {
    const batch = writeBatch(db);
    sets.slice(offset, offset + 450).forEach(write => batch.set(write.ref, firestoreSafe(write.data)));
    await batch.commit();
  }
  if (meta.expenses !== undefined || meta.history !== undefined) await updateDoc(parentRef, { expenses: deleteField(), history: deleteField() });
  for (let offset = 0; offset < oldHistory.docs.length; offset += 450) {
    const batch = writeBatch(db);
    oldHistory.docs.slice(offset, offset + 450).forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}

async function readHousehold(db: Firestore, code: string): Promise<HouseholdData | null> {
  const [meta, expenseSnap, historySnap] = await Promise.all([
    getDoc(doc(db, "households", code)),
    getDocs(expensesPath(db, code)),
    getDocs(archivedMonthsPath(db, code)),
  ]);
  if (!meta.exists()) return null;
  const data = dataFromDocs(
    meta.data(),
    expenseSnap.docs.map(item => item.data()),
    historySnap.docs.map(item => item.data())
  );
  return data;
}

/** Generates a human-readable 6-char code (no O/0/I/1 confusion). */
export function generateHouseholdCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export class HouseholdCodeCollisionError extends Error {
  constructor() {
    super("That household code is already in use. Please try again.");
    this.name = "HouseholdCodeCollisionError";
  }
}

/** Atomically reserves a code and creates the parent and invite documents. */
export async function createHousehold(code: string, config: HouseholdConfig): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");

  const householdRef = doc(db, "households", code);
  const inviteRef = doc(db, "householdInvites", code);
  await runTransaction(db, async transaction => {
    // Invite documents are intentionally readable by an authenticated user so
    // a code can be claimed without attempting a forbidden household read.
    const invite = await transaction.get(inviteRef);
    if (invite.exists()) throw new HouseholdCodeCollisionError();
    transaction.set(householdRef, firestoreSafe({
      config,
      actualIncome: null,
      memberUids: [user.uid],
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    }));
    transaction.set(inviteRef, {
      householdCode: code,
      active: true,
      updatedAt: serverTimestamp(),
    });
  });
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
    await migrateLegacyData(db, cleanCode);
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
  ensureAnonymousAuth().then(async user => {
    if (!user || cancelled) return;
    await migrateLegacyData(db, code);
    if (cancelled) return;
    let meta: DocumentData | null = null;
    let expenses: Expense[] = [];
    let history: MonthSnapshot[] = [];
    const ready = { meta: false, expenses: false, history: false };
    const emit = () => {
      if (!meta || !ready.meta || !ready.expenses || !ready.history) return;
      const data = dataFromDocs(meta, expenses, history);
      onData(data);
    };

    unsubscribes = [
      onSnapshot(doc(db, "households", code), { includeMetadataChanges: true }, snap => {
        if (!snap.metadata.fromCache) ready.meta = true;
        if (!snap.exists()) {
          if (!snap.metadata.fromCache) onDeleted();
          return;
        }
        meta = snap.data();
        emit();
      }, onError),
      onSnapshot(expensesPath(db, code), { includeMetadataChanges: true }, snap => {
        if (!snap.metadata.fromCache) ready.expenses = true;
        expenses = snap.docs.map(item => item.data() as Expense);
        emit();
      }, onError),
      onSnapshot(archivedMonthsPath(db, code), { includeMetadataChanges: true }, snap => {
        if (!snap.metadata.fromCache) ready.history = true;
        history = snap.docs.map(item => item.data() as MonthSnapshot);
        emit();
      }, onError),
    ];
  }).catch(error => { console.error("Firebase subscription setup failed", error); onError(error as Error); });

  return () => {
    cancelled = true;
    unsubscribes.forEach(unsubscribe => unsubscribe());
  };
}

export async function pushHousehold(
  code: string,
  data: Pick<HouseholdData, "config" | "actualIncome">
): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");

  const householdRef = doc(db, "households", code);

  // Subcollection rules require an existing member-owned parent. New households
  // establish that small parent before writing any child records.
  if (!(await getDoc(householdRef)).exists()) {
    await setDoc(householdRef, firestoreSafe({
      config: data.config,
      actualIncome: data.actualIncome,
      memberUids: [user.uid],
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    }));
  }

  const batch = writeBatch(db);
  // The household document stays small; high-growth records live separately.
  batch.set(householdRef, firestoreSafe({
    config: data.config,
    actualIncome: data.actualIncome,
    memberUids: arrayUnion(user.uid),
    updatedAt: serverTimestamp(),
    schemaVersion: 2,
  }), { merge: true });
  batch.set(doc(db, "householdInvites", code), {
    householdCode: code,
    active: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
}

/** Writes one expense directly; Firestore, not React or localStorage, is authoritative. */
export async function setExpense(code: string, expense: Expense): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");
  await setDoc(doc(expensesPath(db, code), String(expense.id)), normalizeExpense(expense));
}

export async function deleteExpense(code: string, expenseId: number): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");
  await deleteDoc(doc(expensesPath(db, code), String(expenseId)));
}

export type RestoreData = Pick<HouseholdData, "config" | "expenses" | "history" | "actualIncome">;

/** Replaces Firebase data from a backup. Listeners remain the only mechanism
 * that updates React/localStorage after the commits succeed. */
export async function restoreHousehold(code: string, input: RestoreData): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");
  if (!input.config || !Array.isArray(input.expenses) || !Array.isArray(input.history)) throw new Error("Invalid backup data.");
  const expenses = input.expenses.map(normalizeExpense);
  const history = input.history.map(normalizeSnapshot);
  if (expenses.some(item => !Number.isFinite(item.id) || !Number.isFinite(item.amount) || !item.description || !item.date)) throw new Error("The backup contains an invalid expense.");
  if (history.some(item => !item.yearMonth || !item.config)) throw new Error("The backup contains an invalid archived month.");
  if (new Set(expenses.map(item => item.id)).size !== expenses.length || new Set(history.map(item => item.yearMonth)).size !== history.length) {
    throw new Error("The backup contains duplicate expense or archived-month identifiers.");
  }
  const [existingExpenses, existingArchives] = await Promise.all([getDocs(expensesPath(db, code)), getDocs(archivedMonthsPath(db, code))]);
  const desiredExpenses = new Map(expenses.map(item => [String(item.id), item]));
  const desiredArchives = new Map(history.map(item => [item.yearMonth, item]));
  const operations = [
    ...existingExpenses.docs.map(item => ({ ref: item.ref, data: desiredExpenses.get(item.id) ?? null })),
    ...existingArchives.docs.map(item => ({ ref: item.ref, data: desiredArchives.get(item.id) ?? null })),
    ...expenses.filter(item => !existingExpenses.docs.some(existing => existing.id === String(item.id)))
      .map(item => ({ ref: doc(expensesPath(db, code), String(item.id)), data: item })),
    ...history.filter(item => !existingArchives.docs.some(existing => existing.id === item.yearMonth))
      .map(item => ({ ref: doc(archivedMonthsPath(db, code), item.yearMonth), data: item })),
  ];
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = writeBatch(db);
    operations.slice(offset, offset + 450).forEach(operation => operation.data
      ? batch.set(operation.ref, firestoreSafe(operation.data)) : batch.delete(operation.ref));
    await batch.commit();
  }
  await updateDoc(doc(db, "households", code), firestoreSafe({
    config: input.config, actualIncome: typeof input.actualIncome === "number" ? input.actualIncome : null,
    updatedAt: serverTimestamp(), schemaVersion: 2,
  }));
}

/** Archives the current month and replaces active expenses with next month's recurring records. */
export async function archiveMonth(code: string, snapshot: MonthSnapshot, recurring: Expense[]): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");

  const active = await getDocs(expensesPath(db, code));
  const writes = [
    ...active.docs.map(item => ({ ref: item.ref, value: null as Expense | null })),
    ...recurring.map(item => ({ ref: doc(expensesPath(db, code), String(item.id)), value: item })),
  ];
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = writeBatch(db);
    if (offset === 0) {
      batch.set(doc(archivedMonthsPath(db, code), snapshot.yearMonth), normalizeSnapshot(snapshot));
      batch.update(doc(db, "households", code), { actualIncome: null, updatedAt: serverTimestamp() });
    }
    for (const write of writes.slice(offset, offset + 450)) {
      if (write.value) batch.set(write.ref, normalizeExpense(write.value));
      else batch.delete(write.ref);
    }
    await batch.commit();
  }
  // An expense-free month still needs its archive and income reset committed.
  if (writes.length === 0) {
    const batch = writeBatch(db);
    batch.set(doc(archivedMonthsPath(db, code), snapshot.yearMonth), normalizeSnapshot(snapshot));
    batch.update(doc(db, "households", code), { actualIncome: null, updatedAt: serverTimestamp() });
    await batch.commit();
  }
}

/** Permanently removes the household and all client-owned subcollection data. */
export async function deleteHousehold(code: string): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");

  const [expenseSnap, historySnap, legacyHistorySnap] = await Promise.all([
    getDocs(expensesPath(db, code)),
    getDocs(archivedMonthsPath(db, code)),
    getDocs(legacyHistoryPath(db, code)),
  ]);
  const refs = [...expenseSnap.docs, ...historySnap.docs, ...legacyHistorySnap.docs].map(item => item.ref);
  // Firestore batches allow at most 500 writes. Leave room for parent + invite.
  for (let offset = 0; offset < refs.length; offset += 450) {
    const batch = writeBatch(db);
    refs.slice(offset, offset + 450).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  // Delete the invite while the parent still exists. Invite deletion rules use
  // the parent membership, so deleting both in one atomic batch can make that
  // authorization lookup observe a missing parent and reject the whole batch.
  await deleteDoc(doc(db, "householdInvites", code));
  await deleteDoc(doc(db, "households", code));
}
