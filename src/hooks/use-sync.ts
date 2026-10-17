/**
 * `useSync` — cloud backup, settings and AI status.
 *
 * Wraps the Convex surface so the UI only ever sees a small, plain API plus a
 * status string. Notably the upload is version-checked: if the server has moved
 * past the version the client last downloaded, the caller is told to download
 * first instead of silently overwriting newer rows.
 *
 * Uploads are chunked (`SYNC_CHUNK` rows per mutation) and only prune the cloud
 * ledger after every chunk has landed, so an interrupted upload can never
 * delete rows that were not sent yet.
 */
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
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
import { useMutation, useQuery } from "convex/react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Rows per `upsertRecords` mutation — keeps every call small and fast. */
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

type SyncResult = { conflict: boolean; version: number; synced: number };
type PruneResult = { conflict: boolean; version: number; pruned: number };

function toRecord(entry: Entry, kind: EntryType): CloudRow {
  return {
    localId: entry.id,
    kind,
    amount: entry.amount,
    detail: entry.detail,
    category: entry.category,
    icon: entry.icon,
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
  const { isAuthenticated, signOut } = useAuth();
  const cloud = useQuery(api.sync.listRecords, isAuthenticated ? {} : "skip");
  const settings = useQuery(api.sync.getSettings, isAuthenticated ? {} : "skip");
  const aiStatus = useQuery(api.sync.aiStatus);

  const upsertRecords = useMutation(api.sync.upsertRecords);
  const pruneRecords = useMutation(api.sync.pruneRecords);
  const saveSettingsMutation = useMutation(api.sync.saveSettings);
  const setGeminiKeyMutation = useMutation(api.sync.setGeminiKey);
  const applyRecurringNow = useMutation(api.sync.applyRecurringNow);

  /* Settings are edited locally (draft) and fall back to the server copy until
     the user touches them — no effect has to copy server state into state. */
  const [budgetDraft, setBudgetDraft] = useState<Budget[] | null>(null);
  const [recurringDraft, setRecurringDraft] = useState<RecurringEntry[] | null>(
    null,
  );
  const [keySaved, setKeySaved] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [capWarning, setCapWarning] = useState(false);

  const budgets = useMemo(
    () => budgetDraft ?? settings?.budgets ?? [],
    [budgetDraft, settings],
  );
  const recurring = useMemo(
    () => recurringDraft ?? settings?.recurring ?? [],
    [recurringDraft, settings],
  );
  const hasCloudKey = keySaved || Boolean(settings?.hasGeminiKey);

  const setBudgets: Dispatch<SetStateAction<Budget[]>> = useCallback(
    (value) =>
      setBudgetDraft((prev) => {
        const current = prev ?? settings?.budgets ?? [];
        return typeof value === "function" ? value(current) : value;
      }),
    [settings],
  );

  const setRecurring: Dispatch<SetStateAction<RecurringEntry[]>> = useCallback(
    (value) =>
      setRecurringDraft((prev) => {
        const current = prev ?? settings?.recurring ?? [];
        return typeof value === "function" ? value(current) : value;
      }),
    [settings],
  );

  /* Materialise recurring entries as soon as we know who the user is, so the
     current month is correct without waiting for the daily cron. */
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    applyRecurringNow({})
      .then((result) => {
        if (!cancelled && result.applied > 0) {
          logEvent("sync", "info", "recurring entries materialised", {
            count: result.applied,
          });
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
      /* Newest entries win: `slice(-MAX_RECORDS)` keeps the tail of the ledger
         (the old `slice(0, …)` silently dropped everything recorded after the
         first 1000 rows). */
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

      let version = cloud?.version ?? 0;
      let synced = 0;

      for (let offset = 0; offset < records.length; offset += SYNC_CHUNK) {
        const chunk = records.slice(offset, offset + SYNC_CHUNK);
        const done = Math.min(offset + SYNC_CHUNK, records.length);
        setStatus(`سینک ہو رہا ہے… (${done}/${records.length})`);
        const result = (await upsertRecords({
          records: chunk,
          baseVersion: version,
        })) as SyncResult;
        if (result.conflict) {
          setStatus(
            `کلاؤڈ پر نیا ڈیٹا موجود ہے (ورژن ${result.version}) — پہلے ڈاؤن لوڈ کریں۔`,
          );
          return false;
        }
        version = result.version;
        synced += result.synced;
      }

      /* Prune only after every chunk landed, so a failed upload leaves the
         previous cloud backup untouched. */
      const pruned = (await pruneRecords({
        keepLocalIds: records.map((record) => record.localId),
        baseVersion: version,
      })) as PruneResult;
      if (pruned.conflict) {
        setStatus(
          `کلاؤڈ پر نیا ڈیٹا موجود ہے (ورژن ${pruned.version}) — پہلے ڈاؤن لوڈ کریں۔`,
        );
        return false;
      }

      setStatus(
        capped
          ? `${synced} انٹریز کلاؤڈ پر محفوظ ہو گئیں۔ نوٹ: ہر قسم کی صرف تازہ ترین ${MAX_RECORDS} انٹریز سینک ہوتی ہیں، باقی ڈیوائس پر محفوظ ہیں۔`
          : `${synced} انٹریز کلاؤڈ پر محفوظ ہو گئیں۔`,
      );
      return true;
    } catch (error) {
      logError("sync", "upload failed", error);
      setStatus(error instanceof Error ? error.message : "سینک ناکام ہو گیا۔");
      return false;
    } finally {
      setBusy(false);
    }
  }, [cloud, data.expense, data.income, pruneRecords, upsertRecords]);

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
        setKeySaved(true);
        setStatus("اے آئی کی سرور پر محفوظ ہو گئی (AES-GCM انکرپٹڈ)۔");
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
