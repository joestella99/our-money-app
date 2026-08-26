import {
  arrayUnion,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
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

/** Generates a human-readable 6-char code (no O/0/I/1 confusion). */
export function generateHouseholdCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

/**
 * Join is intentionally two-step: a small invite document is readable by an
 * authenticated device that knows the code, then Firestore rules allow that
 * device to add only its own UID to the household member list.
 */
export async function joinHousehold(code: string): Promise<HouseholdData | null> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db || !user) return null;

  const cleanCode = code.toUpperCase().trim();
  const householdRef = doc(db, "households", cleanCode);
  const inviteRef = doc(db, "householdInvites", cleanCode);

  try {
    const invite = await getDoc(inviteRef);

    if (invite.exists() && invite.data().active !== false) {
      await updateDoc(householdRef, { memberUids: arrayUnion(user.uid) });
    } else {
      // One-time migration path for households created by the old test-mode app.
      // The supplied firestore.rules permits a signed-in device that knows the
      // code to claim a legacy household that has no memberUids field yet.
      await updateDoc(householdRef, { memberUids: arrayUnion(user.uid) });
    }

    const snap = await getDoc(householdRef);
    return snap.exists() ? (snap.data() as HouseholdData) : null;
  } catch (error) {
    console.error("Could not join household", error);
    return null;
  }
}

export function subscribeToHousehold(
  code: string,
  onData: (data: HouseholdData) => void
): () => void {
  const db = getDb();
  if (!db) return () => {};

  let cancelled = false;
  let unsubscribe = () => {};

  ensureAnonymousAuth().then(user => {
    if (!user || cancelled) return;
    unsubscribe = onSnapshot(
      doc(db, "households", code),
      snap => {
        if (snap.exists()) onData(snap.data() as HouseholdData);
      },
      error => console.error("Household sync subscription failed", error)
    );
  });

  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function pushHousehold(
  code: string,
  data: Omit<HouseholdData, "updatedAt" | "memberUids">
): Promise<void> {
  const db = getDb();
  const user = await ensureAnonymousAuth();
  if (!db || !user) return;

  const householdRef = doc(db, "households", code);
  const inviteRef = doc(db, "householdInvites", code);

  // merge + arrayUnion means normal syncs never remove the other phone's UID.
  await setDoc(
    householdRef,
    { ...data, memberUids: arrayUnion(user.uid), updatedAt: Date.now() },
    { merge: true }
  );

  // The invite contains no financial data. It simply proves that a valid code
  // exists so a second authenticated device can join without broad DB reads.
  await setDoc(
    inviteRef,
    { householdCode: code, active: true, updatedAt: Date.now() },
    { merge: true }
  );
}
