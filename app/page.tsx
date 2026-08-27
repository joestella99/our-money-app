"use client";

import { useEffect, useRef, useState } from "react";
import {
  load, save,
  KEY_CONFIG, KEY_EXPENSES, KEY_HISTORY, KEY_MONTH, KEY_ACTUAL_INCOME,
  KEY_HOUSEHOLD, KEY_HOUSEHOLDS_LIST,
} from "./lib/storage";
import type { HouseholdConfig, Expense, MonthSnapshot, HouseholdEntry } from "./lib/types";
import { getYM } from "./lib/utils";
import { isFirebaseConfigured } from "./lib/firebase";
import { deleteHousehold, subscribeToHousehold, pushHousehold, type SetupResult } from "./lib/sync";
import { HomeScreen }   from "./components/HomeScreen";
import { SetupScreen }  from "./components/SetupScreen";
import { DashView }     from "./components/DashView";
import { HistoryView }  from "./components/HistoryView";
import { SettingsView } from "./components/SettingsView";
import { TabBar }       from "./components/TabBar";

type AppMode = "home" | "setup" | "app";

export default function HomePage() {
  const [hydrated,      setHydrated]      = useState(false);
  const [mode,          setMode]          = useState<AppMode>("home");
  const [households,    setHouseholds]    = useState<HouseholdEntry[]>([]);
  const [householdCode, setHouseholdCode] = useState<string | null>(null);
  const [config,        setConfig]        = useState<HouseholdConfig | null>(null);
  const [expenses,      setExpenses]      = useState<Expense[]>([]);
  const [history,       setHistory]       = useState<MonthSnapshot[]>([]);
  const [actualIncome,  setActualIncome]  = useState<number | null>(null);
  const [tab,           setTab]           = useState<"dash" | "history" | "settings">("dash");
  const [syncError,     setSyncError]     = useState("");

  const lastFirestoreMs = useRef(0);
  const lastPushMs      = useRef(0);

  // ── Hydrate ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const list      = load<HouseholdEntry[]>(KEY_HOUSEHOLDS_LIST, []);
    const oldCode   = load<string | null>(KEY_HOUSEHOLD, null);
    const oldConfig = load<HouseholdConfig | null>(KEY_CONFIG, null);

    // Migrate legacy single-household data into the list
    let finalList = list;
    if (list.length === 0 && oldCode && oldConfig) {
      finalList = [{ code: oldCode, name: oldConfig.name }];
      save(KEY_HOUSEHOLDS_LIST, finalList);
    }

    setHouseholds(finalList);

    // Daily-use shortcut: reopen the last household automatically. The household
    // picker is still available from the header/settings when you need it.
    const lastEntry = oldCode ? finalList.find(h => h.code === oldCode) : undefined;
    if (lastEntry) {
      setHouseholdCode(lastEntry.code);
      setConfig(oldConfig);
      setExpenses(load<Expense[]>(KEY_EXPENSES, []));
      setHistory(load<MonthSnapshot[]>(KEY_HISTORY, []));
      setActualIncome(load<number | null>(KEY_ACTUAL_INCOME, null));
      setMode("app");
    }

    setHydrated(true);

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  // ── Firestore subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !householdCode || !isFirebaseConfigured()) return;
    const unsub = subscribeToHousehold(
      householdCode,
      (remote) => {
        if (remote.updatedAt <= lastPushMs.current) return;
        lastFirestoreMs.current = Date.now();
        setSyncError("");
        setConfig(remote.config);
        setExpenses(remote.expenses);
        setHistory(remote.history);
        setActualIncome(remote.actualIncome);
        save(KEY_CONFIG,        remote.config);
        save(KEY_EXPENSES,      remote.expenses);
        save(KEY_HISTORY,       remote.history);
        save(KEY_ACTUAL_INCOME, remote.actualIncome);
      },
      () => {
        clearLocalHousehold(householdCode);
        alert("This household was deleted from another device.");
      },
      error => setSyncError(error.message || "Household sync failed.")
    );
    return unsub;
  }, [hydrated, householdCode]);

  // ── Push to Firestore (debounced) ──────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !householdCode || !config || mode !== "app" || !isFirebaseConfigured()) return;
    const timer = setTimeout(() => {
      if (Date.now() - lastFirestoreMs.current < 2000) return;
      lastPushMs.current = Date.now();
      pushHousehold(householdCode, { config, expenses, history, actualIncome })
        .then(() => setSyncError(""))
        .catch(error => setSyncError(error instanceof Error ? error.message : "Could not save to Firebase."));
    }, 1500);
    return () => clearTimeout(timer);
  }, [expenses, config, history, actualIncome, householdCode, hydrated, mode]);

  // ── Persist to localStorage ────────────────────────────────────────────────
  useEffect(() => { if (hydrated) save(KEY_EXPENSES,      expenses);     }, [expenses,     hydrated]);
  useEffect(() => { if (hydrated) save(KEY_ACTUAL_INCOME, actualIncome); }, [actualIncome, hydrated]);
  useEffect(() => { if (hydrated && config) save(KEY_CONFIG, config);    }, [config,       hydrated]);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  function goHome() {
    setMode("home");
    setHouseholdCode(null);
    setConfig(null);
    setExpenses([]);
    setHistory([]);
    setActualIncome(null);
    setTab("dash");
  }

  function selectHousehold(entry: HouseholdEntry) {
    const prevCode = load<string | null>(KEY_HOUSEHOLD, null);
    setHouseholdCode(entry.code);
    save(KEY_HOUSEHOLD, entry.code);

    // Load cached data if available for this household
    if (prevCode === entry.code) {
      setConfig(load<HouseholdConfig | null>(KEY_CONFIG, null));
      setExpenses(load<Expense[]>(KEY_EXPENSES, []));
      setHistory(load<MonthSnapshot[]>(KEY_HISTORY, []));
      setActualIncome(load<number | null>(KEY_ACTUAL_INCOME, null));
    } else {
      setConfig(null);
      setExpenses([]);
      setHistory([]);
      setActualIncome(null);
    }

    // Handle month rollover for the selected household
    const prev  = load<string>(KEY_MONTH, "");
    const today = getYM();
    if (prev && prev !== today) {
      save(KEY_MONTH, today);
    }

    setTab("dash");
    setMode("app");
  }

  async function handleSetupComplete(result: SetupResult) {
    const code = result.code;
    const name = result.type === "create" ? result.config.name : result.data.config.name;
    const entry: HouseholdEntry = { code, name };

    const updatedList = [...households.filter(h => h.code !== code), entry];
    setHouseholds(updatedList);
    save(KEY_HOUSEHOLDS_LIST, updatedList);
    save(KEY_HOUSEHOLD, code);
    setHouseholdCode(code);

    if (result.type === "create") {
      setConfig(result.config);
      setExpenses([]);
      setHistory([]);
      setActualIncome(null);
      if (isFirebaseConfigured()) {
        lastPushMs.current = Date.now();
        await pushHousehold(code, { config: result.config, expenses: [], history: [], actualIncome: null });
      }
    } else {
      setConfig(result.data.config);
      setExpenses(result.data.expenses);
      setHistory(result.data.history);
      setActualIncome(result.data.actualIncome);
      save(KEY_CONFIG,        result.data.config);
      save(KEY_EXPENSES,      result.data.expenses);
      save(KEY_HISTORY,       result.data.history);
      save(KEY_ACTUAL_INCOME, result.data.actualIncome);
    }

    save(KEY_MONTH, getYM());
    setTab("dash");
    setMode("app");
  }

  function removeHousehold(code: string) {
    const updated = households.filter(h => h.code !== code);
    setHouseholds(updated);
    save(KEY_HOUSEHOLDS_LIST, updated);
    if (code === householdCode) goHome();
  }

  function clearLocalHousehold(code: string) {
    setHouseholds(current => {
      const updated = current.filter(h => h.code !== code);
      save(KEY_HOUSEHOLDS_LIST, updated);
      return updated;
    });
    save(KEY_HOUSEHOLD, null);
    localStorage.removeItem(KEY_CONFIG);
    localStorage.removeItem(KEY_EXPENSES);
    localStorage.removeItem(KEY_HISTORY);
    localStorage.removeItem(KEY_MONTH);
    localStorage.removeItem(KEY_ACTUAL_INCOME);
    setConfig(null);
    setExpenses([]);
    setHistory([]);
    setActualIncome(null);
    setHouseholdCode(null);
    setMode("home");
    setTab("dash");
    setSyncError("");
  }

  async function permanentlyDeleteHousehold() {
    if (!householdCode) throw new Error("No household is selected.");
    await deleteHousehold(householdCode);
    clearLocalHousehold(householdCode);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!hydrated) return null;

  if (mode === "home") {
    return (
      <HomeScreen
        households={households}
        onSelect={selectHousehold}
        onCreateNew={() => setMode("setup")}
        onComplete={handleSetupComplete}
        onRemove={removeHousehold}
      />
    );
  }

  if (mode === "setup") {
    return (
      <SetupScreen
        onComplete={handleSetupComplete}
        onBack={households.length > 0 ? goHome : undefined}
      />
    );
  }

  // mode === "app"
  if (!config) {
    return (
      <div className="app-shell">
        <div className="phone-frame" style={{ paddingTop: 100, textAlign: "center" }}>
          <p className="subtle">Loading household&#x2026;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="phone-frame">
        {tab === "dash" && (
          <DashView
            config={config}
            expenses={expenses}
            setExpenses={setExpenses}
            actualIncome={actualIncome}
            onHome={goHome}
          />
        )}
        {tab === "history" && (
          <HistoryView history={history} />
        )}
        {tab === "settings" && (
          <SettingsView
            config={config}
            setConfig={setConfig}
            expenses={expenses}
            setExpenses={setExpenses}
            history={history}
            setHistory={setHistory}
            actualIncome={actualIncome}
            setActualIncome={setActualIncome}
            householdCode={householdCode}
            onDelete={permanentlyDeleteHousehold}
            onHome={goHome}
            syncError={syncError}
          />
        )}
      </div>
      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
