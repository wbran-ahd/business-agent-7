/**
 * `useSync` — cloud backup, settings and AI status.
 *
 * Wraps the Convex surface so the UI only ever sees a small, plain API plus a
 * status string. Notably the upload is version-checked: if the server has moved
 * past the version the client last downloaded, the caller is told to download
 * first instead of silently overwriting newer rows.
 */
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import {
  MAX_RECORDS,
  type Budget,
  type DataState,
  type Entry,
  type EntryType,
  type RecurringEntry,
} from "@/lib/khata";
import { logError, logEvent } from "@/lib/logger";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";

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
};

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
    }));
}

export function useSync(data: DataState) {
  const { isAuthenticated, signOut } = useAuth();
  const cloud = useQuery(api.sync.listRecords, isAuthenticated ? {} : "skip");
  const settings = useQuery(api.sync.getSettings, isAuthenticated ? {} : "skip");
  const aiStatus = useQuery(api.sync.aiStatus);

  const syncRecords = useMutation(api.sync.syncRecords);
  const saveSettingsMutation = useMutation(api.sync.saveSettings);
  const setGeminiKeyMutation = useMutation(api.sync.setGeminiKey);
  const applyRecurringNow = useMutation(api.sync.applyRecurringNow);

  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<RecurringEntry[]>([]);
  const [hasCloudKey, setHasCloudKey] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBudgets(settings.budgets ?? []);
    setRecurring(settings.recurring ?? []);
    setHasCloudKey(Boolean(settings.hasGeminiKey));
  }, [settings]);

  /* Materialise recurring incomes as soon as we know who the user is, so the
     current month is correct without waiting for the daily cron. */
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    applyRecurringNow({})
      .then((result) => {
        if (!cancelled && result.applied > 0) {
          logEvent("sync", "info", "recurring incomes materialised", { count: result.applied });
        }
      })
      .catch((error) => logError("sync", "applyRecurringNow failed", error));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, applyRecurringNow]);

  const upload = useCallback(async () => {
    setBusy(true);
    setStatus("سینک ہو رہا ہے…");
    try {
      const records = [
        ...data.income.slice(0, MAX_RECORDS).map((entry) => ({
          localId: entry.id,
          kind: "income" as const,
          amount: entry.amount,
          detail: entry.detail,
          category: entry.category,
          icon: entry.icon,
          monthKey: entry.monthKey,
          date: entry.date,
          time: entry.time,
          timestamp: entry.timestamp,
        })),
        ...data.expense.slice(0, MAX_RECORDS).map((entry) => ({
          localId: entry.id,
          kind: "expense" as const,
          amount: entry.amount,
          detail: entry.detail,
          category: entry.category,
          icon: entry.icon,
          monthKey: entry.monthKey,
          date: entry.date,
          time: entry.time,
          timestamp: entry.timestamp,
        })),
      ];
      const result = await syncRecords({ records, baseVersion: cloud?.version ?? 0 });
      if (result.conflict) {
        setStatus(`کلاؤڈ پر نیا ڈیٹا موجود ہے (ورژن ${result.version}) — پہلے ڈاؤن لوڈ کریں۔`);
        return false;
      }
      setStatus(`${result.synced} انٹریز کلاؤڈ پر محفوظ ہو گئیں۔`);
      return true;
    } catch (error) {
      logError("sync", "upload failed", error);
      setStatus(error instanceof Error ? error.message : "سینک ناکام ہو گیا۔");
      return false;
    } finally {
      setBusy(false);
    }
  }, [cloud?.version, data.expense, data.income, syncRecords]);

  const download = useCallback((): { income: Entry[]; expense: Entry[] } | null => {
    if (!cloud) {
      setStatus("کلاؤڈ ڈیٹا دستیاب نہیں۔");
      return null;
    }
    const income = toEntries(cloud.records, "income");
    const expense = toEntries(cloud.records, "expense");
    setStatus(`کلاؤڈ سے ${income.length + expense.length} انٹریز واپس آ گئیں۔`);
    return { income, expense };
  }, [cloud]);

  const persistSettings = useCallback(async () => {
    if (!isAuthenticated) {
      setStatus("سیٹنگز محفوظ کرنے کے لیے سائن ان کریں۔");
      return;
    }
    try {
      await saveSettingsMutation({ budgets, recurring });
      setStatus("سیٹنگز محفوظ ہو گئیں۔");
    } catch (error) {
      logError("sync", "saveSettings failed", error);
      setStatus(error instanceof Error ? error.message : "سیٹنگز سیو نہیں ہو سکیں۔");
    }
  }, [budgets, recurring, saveSettingsMutation, isAuthenticated]);

  const saveGeminiKey = useCallback(
    async (key: string) => {
      try {
        await setGeminiKeyMutation({ key });
        setHasCloudKey(true);
        setStatus("اے آئی کی محفوظ ہو گئی (سرور پر)۔");
        return true;
      } catch (error) {
        logError("sync", "setGeminiKey failed", error);
        setStatus(error instanceof Error ? error.message : "کی سیو نہیں ہو سکی۔");
        return false;
      }
    },
    [setGeminiKeyMutation],
  );

  return {
    isAuthenticated,
    signOut,
    cloudVersion: cloud?.version ?? 0,
    cloudCount: cloud?.records.length ?? 0,
    aiHasKey: Boolean(aiStatus?.hasKey),
    aiRemaining: aiStatus?.remaining ?? 0,
    budgets,
    setBudgets,
    recurring,
    setRecurring,
    hasCloudKey,
    status,
    setStatus,
    busy,
    upload,
    download,
    persistSettings,
    saveGeminiKey,
  };
}
