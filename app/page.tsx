"use client";

import { useEffect, useRef, useState } from "react";
import {
  load, save,
  KEY_CONFIG, KEY_EXPENSES, KEY_HISTORY, KEY_MONTH, KEY_ACTUAL_INCOME,
  KEY_HOUSEHOLD, KEY_HOUSEHOLDS_LIST, loadHousehold, migrateLegacyHouseholdCache,
  removeHouseholdCache, saveHousehold,
} from "./lib/storage";
import type { HouseholdConfig, Expense, MonthSnapshot, HouseholdEntry } from "./lib/types";
import { getYM } from "./lib/utils";
import { isFirebaseConfigured } from "./lib/firebase";
import { createHousehold, deleteHousehold, subscribeToHousehold, pushHousehold, type SetupResult } from "./lib/sync";
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
  const [syncRetry,     setSyncRetry]     = useState(0);
  const [remoteReady,   setRemoteReady]   = useState(false);

  const setupInProgress = useRef(false);

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

    if (oldCode) migrateLegacyHouseholdCache(oldCode);

    setHouseholds(finalList);

    // Daily-use shortcut: reopen the last household automatically. The household
    // picker is still available from the header/settings when you need it.
    const lastEntry = oldCode ? finalList.find(h => h.code === oldCode) : undefined;
    if (lastEntry) {
      setHouseholdCode(lastEntry.code);
      setConfig(loadHousehold<HouseholdConfig | null>(lastEntry.code, KEY_CONFIG, oldConfig));
      setExpenses(loadHousehold<Expense[]>(lastEntry.code, KEY_EXPENSES, []));
      setHistory(loadHousehold<MonthSnapshot[]>(lastEntry.code, KEY_HISTORY, []));
      setActualIncome(loadHousehold<number | null>(lastEntry.code, KEY_ACTUAL_INCOME, null));
      setMode("app");
    }

    setHydrated(true);

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  // ── Firestore subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!hydrated || !householdCode || !isFirebaseConfigured()) return;
    setRemoteReady(false);
    const unsub = subscribeToHousehold(
      householdCode,
      (remote) => {
        setRemoteReady(true);
        setSyncError("");
        setConfig(current => JSON.stringify(current) === JSON.stringify(remote.config) ? current : remote.config);
        setExpenses(current => JSON.stringify(current) === JSON.stringify(remote.expenses) ? current : remote.expenses);
        setHistory(current => JSON.stringify(current) === JSON.stringify(remote.history) ? current : remote.history);
        setActualIncome(remote.actualIncome);
        saveHousehold(householdCode, KEY_CONFIG,        remote.config);
        saveHousehold(householdCode, KEY_EXPENSES,      remote.expenses);
        saveHousehold(householdCode, KEY_HISTORY,       remote.history);
        saveHousehold(householdCode, KEY_ACTUAL_INCOME, remote.actualIncome);
      },
      () => {
        clearLocalHousehold(householdCode);
        alert("This household was deleted from another device.");
      },
      error => setSyncError(error.message || "Household sync failed.")
    );
    return unsub;
  }, [hydrated, householdCode, syncRetry]);

  // ── Push metadata to Firestore (debounced, only after server hydration) ───
  useEffect(() => {
    if (!remoteReady || !hydrated || !householdCode || !config || mode !== "app" || !isFirebaseConfigured()) return;
    const timer = setTimeout(() => {
      pushHousehold(householdCode, { config, actualIncome })
        .then(() => setSyncError(""))
        .catch(error => setSyncError(error instanceof Error ? error.message : "Could not save to Firebase."));
    }, 1500);
    return () => clearTimeout(timer);
  }, [config, actualIncome, householdCode, hydrated, mode, remoteReady]);

  // ── Persist to localStorage ────────────────────────────────────────────────
  useEffect(() => {
    if (hydrated && householdCode && mode === "app") saveHousehold(householdCode, KEY_EXPENSES, expenses);
  }, [expenses, hydrated, householdCode, mode]);
  useEffect(() => {
    if (hydrated && householdCode && mode === "app") saveHousehold(householdCode, KEY_HISTORY, history);
  }, [history, hydrated, householdCode, mode]);
  useEffect(() => {
    if (hydrated && householdCode && mode === "app") saveHousehold(householdCode, KEY_ACTUAL_INCOME, actualIncome);
  }, [actualIncome, hydrated, householdCode, mode]);
  useEffect(() => {
    if (hydrated && householdCode && config && mode === "app") saveHousehold(householdCode, KEY_CONFIG, config);
  }, [config, hydrated, householdCode, mode]);
  useEffect(() => {
    if (!hydrated || !householdCode || !config || mode !== "app") return;
    setHouseholds(current => {
      const entry = current.find(item => item.code === householdCode);
      if (!entry || entry.name === config.name) return current;
      const updated = current.map(item => item.code === householdCode ? { ...item, name: config.name } : item);
      save(KEY_HOUSEHOLDS_LIST, updated);
      return updated;
    });
  }, [config, householdCode, hydrated, mode]);

  // ── Navigation helpers ─────────────────────────────────────────────────────
  function goHome() {
    setMode("home");
    setHouseholdCode(null);
    setConfig(null);
    setExpenses([]);
    setHistory([]);
    setActualIncome(null);
    setRemoteReady(false);
    setTab("dash");
  }

  function selectHousehold(entry: HouseholdEntry) {
    setRemoteReady(false);
    setHouseholdCode(entry.code);
    save(KEY_HOUSEHOLD, entry.code);
    setSyncError("");
    setConfig(loadHousehold<HouseholdConfig | null>(entry.code, KEY_CONFIG, null));
    setExpenses(loadHousehold<Expense[]>(entry.code, KEY_EXPENSES, []));
    setHistory(loadHousehold<MonthSnapshot[]>(entry.code, KEY_HISTORY, []));
    setActualIncome(loadHousehold<number | null>(entry.code, KEY_ACTUAL_INCOME, null));

    // Handle month rollover for the selected household
    const prev  = loadHousehold<string>(entry.code, KEY_MONTH, "");
    const today = getYM();
    if (prev && prev !== today) {
      saveHousehold(entry.code, KEY_MONTH, today);
    }

    setTab("dash");
    setMode("app");
  }

  async function handleSetupComplete(result: SetupResult) {
    // Async button handlers can be invoked more than once before React paints a
    // disabled state. Guard the operation here too, at the data boundary.
    if (setupInProgress.current) return;
    setupInProgress.current = true;
    try {
      const code = result.code;
      const name = result.type === "create" ? result.config.name : result.data.config.name;
      const entry: HouseholdEntry = { code, name };

      if (result.type === "create") {
        if (isFirebaseConfigured()) {
          await createHousehold(code, result.config);
        }
        setConfig(result.config);
        setExpenses([]);
        setHistory([]);
        setActualIncome(null);
      } else {
        setConfig(result.data.config);
        setExpenses(result.data.expenses);
        setHistory(result.data.history);
        setActualIncome(result.data.actualIncome);
        saveHousehold(code, KEY_CONFIG,        result.data.config);
        saveHousehold(code, KEY_EXPENSES,      result.data.expenses);
        saveHousehold(code, KEY_HISTORY,       result.data.history);
        saveHousehold(code, KEY_ACTUAL_INCOME, result.data.actualIncome);
      }

      // Only expose and persist the household after its initial remote write has
      // succeeded. A failed request can then be retried without a ghost entry.
      const updatedList = [...households.filter(h => h.code !== code), entry];
      setHouseholds(updatedList);
      save(KEY_HOUSEHOLDS_LIST, updatedList);
      save(KEY_HOUSEHOLD, code);
      setHouseholdCode(code);
      setRemoteReady(false);
      saveHousehold(code, KEY_CONFIG, result.type === "create" ? result.config : result.data.config);
      saveHousehold(code, KEY_EXPENSES, result.type === "create" ? [] : result.data.expenses);
      saveHousehold(code, KEY_HISTORY, result.type === "create" ? [] : result.data.history);
      saveHousehold(code, KEY_ACTUAL_INCOME, result.type === "create" ? null : result.data.actualIncome);
      saveHousehold(code, KEY_MONTH, getYM());
      setTab("dash");
      setMode("app");
    } finally {
      setupInProgress.current = false;
    }
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
    if (load<string | null>(KEY_HOUSEHOLD, null) === code) save(KEY_HOUSEHOLD, null);
    removeHouseholdCache(code);
    setConfig(null);
    setExpenses([]);
    setHistory([]);
    setActualIncome(null);
    setHouseholdCode(null);
    setRemoteReady(false);
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
  if (!config || (isFirebaseConfigured() && !remoteReady)) {
    return (
      <div className="app-shell">
        <div className="phone-frame" style={{ paddingTop: 100, textAlign: "center" }}>
          {syncError ? (
            <>
              <h2>Couldn&apos;t load this household</h2>
              <p className="form-error" role="alert">{syncError}</p>
              <button className="primary-action full" onClick={() => { setSyncError(""); setSyncRetry(value => value + 1); }}>
                Try again
              </button>
              <button className="text-button" style={{ marginTop: 16 }} onClick={goHome}>Back to households</button>
            </>
          ) : <p className="subtle">Loading household&#x2026;</p>}
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
            householdCode={householdCode!}
            onSyncError={setSyncError}
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
