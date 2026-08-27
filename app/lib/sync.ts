import {
  arrayUnion,
  collection,
  deleteDoc,
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

function dataFromDocs(meta: DocumentData, expenseDocs: DocumentData[], historyDocs: DocumentData[]): HouseholdData {
  const expenses = expenseDocs as Expense[];
  const history = historyDocs as MonthSnapshot[];
  return {
    config: meta.config,
    expenses,
    history,
    actualIncome: meta.actualIncome ?? null,
    memberUids: meta.memberUids,
    updatedAt: typeof meta.updatedAt?.toMillis === "function" ? meta.updatedAt.toMillis() : (meta.updatedAt ?? 0),
  };
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
    transaction.set(householdRef, {
      config,
      actualIncome: null,
      memberUids: [user.uid],
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    });
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
  });

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
    await setDoc(householdRef, {
      config: data.config,
      actualIncome: data.actualIncome,
      memberUids: [user.uid],
      updatedAt: serverTimestamp(),
      schemaVersion: 2,
    });
  }

  const batch = writeBatch(db);
  // The household document stays small; high-growth records live separately.
  batch.set(householdRef, {
    config: data.config,
    actualIncome: data.actualIncome,
    memberUids: arrayUnion(user.uid),
    updatedAt: serverTimestamp(),
    schemaVersion: 2,
  }, { merge: true });
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
  await setDoc(doc(expensesPath(db, code), String(expense.id)), expense);
}

export async function deleteExpense(code: string, expenseId: number): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db) throw new Error("Firebase is not configured.");
  if (!user) throw new Error("Could not authenticate with Firebase.");
  await deleteDoc(doc(expensesPath(db, code), String(expenseId)));
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
      batch.set(doc(archivedMonthsPath(db, code), snapshot.yearMonth), snapshot);
      batch.update(doc(db, "households", code), { actualIncome: null, updatedAt: serverTimestamp() });
    }
    for (const write of writes.slice(offset, offset + 450)) {
      if (write.value) batch.set(write.ref, write.value);
      else batch.delete(write.ref);
    }
    await batch.commit();
  }
  // An expense-free month still needs its archive and income reset committed.
  if (writes.length === 0) {
    const batch = writeBatch(db);
    batch.set(doc(archivedMonthsPath(db, code), snapshot.yearMonth), snapshot);
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

  const [expenseSnap, historySnap] = await Promise.all([
    getDocs(expensesPath(db, code)),
    getDocs(archivedMonthsPath(db, code)),
  ]);
  const refs = [...expenseSnap.docs, ...historySnap.docs].map(item => item.ref);
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
