/**
 * `useSync` — cloud backup, settings and sync tracking via Firebase Firestore.
 *
 * Uses /users/{userId}/records subcollection, /users/{userId}/settings/current,
 * and /users/{userId}/sync/state for version tracking.
 */
import { useAuth } from "@/hooks/use-auth";
import { auth, db } from "@/lib/firebase";
import { handleFirestoreError, OperationType } from "@/lib/firestore-errors";
import {
  MAX_RECORDS,
  normalizeAccount,
  type AccountKind,
  type Budget,
  type DataState,
  type Entry,
  type EntryType,
  type RecurringEntry,
} from "@/lib/khata";
import { logError, logEvent } from "@/lib/logger";
import { t } from "@/lib/i18n";
import { AI_DAILY_LIMIT } from "@/lib/ai-limit";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Rows per Firestore batch write — Firestore maximum is 500 ops per batch. */
const SYNC_CHUNK = 250;

type CloudRow = {
  localId: number;
  kind: EntryType;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
  account?: AccountKind;
};

function toRecord(entry: Entry, kind: EntryType): CloudRow {
  return {
    localId: entry.id,
    kind,
    amount: entry.amount,
    detail: entry.detail || "",
    category: entry.category || "عام",
    icon: entry.icon || "fa-tag",
    monthKey: entry.monthKey,
    date: entry.date,
    time: entry.time,
    timestamp: entry.timestamp,
    account: normalizeAccount(entry.account),
  };
}

function toEntries(rows: CloudRow[], kind: EntryType): Entry[] {
  return rows
    .filter((row) => row.kind === kind)
    .map((row) => ({
      id: row.localId,
      amount: row.amount,
      detail: row.detail,
      category: row.category,
      icon: row.icon,
      monthKey: row.monthKey,
      date: row.date,
      time: row.time,
      timestamp: row.timestamp,
      account: normalizeAccount(row.account),
    }));
}

export function useSync(data: DataState) {
  const { user, isAuthenticated } = useAuth();

  const [cloudRecords, setCloudRecords] = useState<CloudRow[]>([]);
  const [cloudVersion, setCloudVersion] = useState(0);
  const [cloudSettings, setCloudSettings] = useState<{
    budgets?: Budget[];
    recurring?: RecurringEntry[];
    geminiKey?: string;
  } | null>(null);

  const [budgetDraft, setBudgetDraft] = useState<Budget[] | null>(null);
  const [recurringDraft, setRecurringDraft] = useState<RecurringEntry[] | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [capWarning, setCapWarning] = useState(false);

  // Firestore real-time listener for records subcollection
  useEffect(() => {
    const currentUid = auth.currentUser?.uid;
    // Only attach remote Firestore listeners if a real Firebase authenticated session exists
    if (!isAuthenticated || !currentUid || currentUid !== user?.uid) {
      return;
    }

    const recordsPath = `users/${currentUid}/records`;
    const recordsCol = collection(db, "users", currentUid, "records");
    const unsubscribeRecords = onSnapshot(
      recordsCol,
      (snapshot) => {
        const rows: CloudRow[] = [];
        snapshot.forEach((docSnap) => {
          rows.push(docSnap.data() as CloudRow);
        });
        setCloudRecords(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, recordsPath);
      },
    );

    const syncPath = `users/${currentUid}/sync/state`;
    const syncDocRef = doc(db, "users", currentUid, "sync", "state");
    const unsubscribeSync = onSnapshot(
      syncDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setCloudVersion(snapshot.data()?.version || 0);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, syncPath);
      },
    );

    const settingsPath = `users/${currentUid}/settings/current`;
    const settingsDocRef = doc(db, "users", currentUid, "settings", "current");
    const unsubscribeSettings = onSnapshot(
      settingsDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setCloudSettings(snapshot.data());
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, settingsPath);
      },
    );

    return () => {
      unsubscribeRecords();
      unsubscribeSync();
      unsubscribeSettings();
      setCloudRecords([]);
      setCloudVersion(0);
      setCloudSettings(null);
    };
  }, [isAuthenticated, user]);

  const localBudgets = useMemo<Budget[]>(() => {
    try {
      const b = localStorage.getItem("sauti_local_budgets");
      return b ? JSON.parse(b) : [];
    } catch {
      return [];
    }
  }, []);

  const localRecurring = useMemo<RecurringEntry[]>(() => {
    try {
      const r = localStorage.getItem("sauti_local_recurring");
      return r ? JSON.parse(r) : [];
    } catch {
      return [];
    }
  }, []);

  const budgets = useMemo(
    () => budgetDraft ?? cloudSettings?.budgets ?? localBudgets,
    [budgetDraft, cloudSettings, localBudgets],
  );

  const recurring = useMemo(
    () => recurringDraft ?? cloudSettings?.recurring ?? localRecurring,
    [recurringDraft, cloudSettings, localRecurring],
  );

  const hasCloudKey =
    keySaved ||
    Boolean(cloudSettings?.geminiKey) ||
    Boolean(typeof window !== "undefined" && localStorage.getItem("sauti_gemini_key"));

  const setBudgets: Dispatch<SetStateAction<Budget[]>> = useCallback(
    (value) =>
      setBudgetDraft((prev) => {
        const current = prev ?? cloudSettings?.budgets ?? localBudgets;
        return typeof value === "function" ? value(current) : value;
      }),
    [cloudSettings, localBudgets],
  );

  const setRecurring: Dispatch<SetStateAction<RecurringEntry[]>> = useCallback(
    (value) =>
      setRecurringDraft((prev) => {
        const current = prev ?? cloudSettings?.recurring ?? localRecurring;
        return typeof value === "function" ? value(current) : value;
      }),
    [cloudSettings, localRecurring],
  );

  const upload = useCallback(async () => {
    const currentUid = auth.currentUser?.uid;
    if (!isAuthenticated || !currentUid || currentUid !== user?.uid) {
      setStatus("کلاؤڈ سینک کے لیے آن لائن شناخت درکار ہے۔ تمام ڈیٹا ڈیوائس پر محفوظ ہے۔");
      return false;
    }

    setBusy(true);
    setStatus("سینک ہو رہا ہے…");
    try {
      const income = data.income.slice(-MAX_RECORDS);
      const expense = data.expense.slice(-MAX_RECORDS);
      const capped =
        income.length < data.income.length || expense.length < data.expense.length;
      setCapWarning(capped);

      const records = [
        ...income.map((entry) => toRecord(entry, "income")),
        ...expense.map((entry) => toRecord(entry, "expense")),
      ];

      if (records.length === 0) {
        setStatus("سینک کے لیے کوئی انٹری موجود نہیں۔");
        return false;
      }

      const newVersion = cloudVersion + 1;
      let synced = 0;

      for (let offset = 0; offset < records.length; offset += SYNC_CHUNK) {
        const chunk = records.slice(offset, offset + SYNC_CHUNK);
        const done = Math.min(offset + SYNC_CHUNK, records.length);
        setStatus(`سینک ہو رہا ہے… (${done}/${records.length})`);

        const batch = writeBatch(db);
        chunk.forEach((rec) => {
          const recRef = doc(db, "users", currentUid, "records", String(rec.localId));
          batch.set(recRef, rec);
        });

        await batch.commit();
        synced += chunk.length;
      }

      // Update sync version
      await setDoc(doc(db, "users", currentUid, "sync", "state"), {
        version: newVersion,
        updatedAt: Date.now(),
      });
      setCloudVersion(newVersion);

      // Prune old removed records
      try {
        const existingDocs = await getDocs(collection(db, "users", currentUid, "records"));
        const currentLocalIds = new Set(records.map((r) => String(r.localId)));
        const pruneBatch = writeBatch(db);
        let pruneCount = 0;

        existingDocs.forEach((docSnap) => {
          if (!currentLocalIds.has(docSnap.id)) {
            pruneBatch.delete(docSnap.ref);
            pruneCount++;
          }
        });

        if (pruneCount > 0) {
          await pruneBatch.commit();
        }
      } catch (err) {
        logError("sync", "prune failed", err);
      }

      setStatus(
        capped
          ? `${synced} انٹریز کلاؤڈ پر محفوظ ہو گئیں۔ نوٹ: ہر قسم کی صرف تازہ ترین ${MAX_RECORDS} انٹریز سینک ہوتی ہیں، باقی ڈیوائس پر محفوظ ہیں۔`
          : `${synced} انٹریز کلاؤڈ پر محفوظ ہو گئیں۔`,
      );
      logEvent("sync", "info", "records synced to firestore", { count: synced });
      return true;
    } catch (error) {
      logError("sync", "upload to Firestore failed", error);
      setStatus(error instanceof Error ? error.message : "سینک ناکام ہو گیا۔");
      return false;
    } finally {
      setBusy(false);
    }
  }, [cloudVersion, data.expense, data.income, isAuthenticated, user]);

  const download = useCallback((): { income: Entry[]; expense: Entry[] } | null => {
    if (!auth.currentUser) {
      setStatus("کلاؤڈ پر کوئی ڈیٹا موجود نہیں ہے۔ تمام ریکارڈز ڈیوائس پر موجود ہیں۔");
      return null;
    }
    if (cloudRecords.length === 0) {
      setStatus("کلاؤڈ پر کوئی ڈیٹا موجود نہیں ہے۔");
      return null;
    }
    const income = toEntries(cloudRecords, "income");
    const expense = toEntries(cloudRecords, "expense");
    setStatus(`کلاؤڈ سے ${income.length + expense.length} انٹریز واپس آ گئیں۔`);
    return { income, expense };
  }, [cloudRecords]);

  const persistSettings = useCallback(async () => {
    // Always persist locally
    try {
      localStorage.setItem("sauti_local_budgets", JSON.stringify(budgets));
      localStorage.setItem("sauti_local_recurring", JSON.stringify(recurring));
    } catch {
      // ignore
    }

    const currentUid = auth.currentUser?.uid;
    if (!isAuthenticated || !currentUid || currentUid !== user?.uid) {
      setStatus("سیٹنگز مقامی طور پر محفوظ ہو گئیں۔");
      return;
    }

    try {
      const settingsRef = doc(db, "users", currentUid, "settings", "current");
      await setDoc(
        settingsRef,
        {
          budgets,
          recurring,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      setStatus("سیٹنگز محفوظ ہو گئیں۔");
    } catch (error) {
      logError("sync", "persistSettings to Firestore failed", error);
      handleFirestoreError(error, OperationType.WRITE, `users/${currentUid}/settings/current`);
    }
  }, [budgets, isAuthenticated, recurring, user]);

  const saveGeminiKey = useCallback(
    async (key: string) => {
      try {
        localStorage.setItem("sauti_gemini_key", key);
        setKeySaved(true);

        const currentUid = auth.currentUser?.uid;
        if (isAuthenticated && currentUid && currentUid === user?.uid) {
          const settingsRef = doc(db, "users", currentUid, "settings", "current");
          await setDoc(settingsRef, { geminiKey: key, updatedAt: Date.now() }, { merge: true });
        }
        setStatus(t("aiKeySaved"));
        return true;
      } catch (error) {
        logError("sync", "saveGeminiKey failed", error);
        setStatus(
          error instanceof Error
            ? error.message
            : t("aiKeySaveFailed"),
        );
        return false;
      }
    },
    [isAuthenticated, user],
  );

  return {
    isAuthenticated,
    cloudVersion,
    cloudCount: cloudRecords.length,
    aiHasKey: hasCloudKey,
    // Audit #8: the display budget was an inline magic number; it now comes
    // from one documented constant. (Note: nothing server-side enforces it yet
    // — see the residual-risk section of the audit report.)
    aiRemaining: AI_DAILY_LIMIT,
    budgets,
    setBudgets,
    recurring,
    setRecurring,
    hasCloudKey,
    capWarning,
    status,
    setStatus,
    busy,
    upload,
    download,
    persistSettings,
    saveGeminiKey,
  };
}
