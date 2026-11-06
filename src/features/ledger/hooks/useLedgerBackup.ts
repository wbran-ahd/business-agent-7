/**
 * The three local backup paths: CSV download, WhatsApp summary and file import.
 *
 * Formats, storage keys and the 2 MB import guard are unchanged — only the
 * ownership moved out of the page component.
 */
import { useCallback, useState } from "react";
import type { ChangeEvent } from "react";
import { logError } from "@/lib/logger";
import {
  buildCsv,
  dedupeEntries,
  entriesFromCsv,
  formatMonthName,
  sanitizeImportedEntries,
  type DataState,
  type Entry,
  type MonthTotals,
} from "@/lib/khata";
import { track } from "@/lib/telemetry";

export type UseLedgerBackupOptions = {
  data: DataState;
  activeMonth: string;
  totals: MonthTotals;
  merge: (income: Entry[], expense: Entry[]) => void;
  /** Records a successful export so the weekly reminder resets. */
  onBackedUp: () => void;
};

export function useLedgerBackup({
  data,
  activeMonth,
  totals,
  merge,
  onBackedUp,
}: UseLedgerBackupOptions) {
  const [importMsg, setImportMsg] = useState("");

  const resetImportMsg = useCallback(() => setImportMsg(""), []);

  function exportData() {
    const blob = new Blob([buildCsv(data)], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sauti_baqaya_ultimate_report.csv";
    a.click();
    window.URL.revokeObjectURL(url);
    onBackedUp();
    track("export_csv");
  }

  function shareWhatsApp() {
    const monthName = formatMonthName(activeMonth);
    let msg = `*📒 صوتی بقیہ - الٹیمیٹ پورٹ رپورٹ (${monthName})*\n`;
    msg += `-----------------------------------\n`;
    if (totals.carryForward > 0) {
      msg += `📌 پچھلا بقایا کیش: Rs. ${totals.carryForward}\n`;
    }
    msg += `💰 کل رقم: Rs. ${totals.totalIncome}\n`;
    msg += `💸 کل خرچہ: Rs. ${totals.totalExpense}\n`;
    msg += `💵 موجودہ بقایا: Rs. ${totals.balance}\n`;
    track("share_whatsapp", { source: "ledger" });
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // A 500 MB stray download must never reach FileReader.
    if (file.size > 2 * 1024 * 1024) {
      setImportMsg("فائل 2 MB سے بڑی ہے — چھوٹی CSV/JSON فائل منتخب کریں۔");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        // Every row is validated before the ledger is touched, so a malformed
        // file cannot leave the totals half-imported. Rejected rows are logged
        // and skipped; the success message keeps counting only real entries.
        if (file.name.toLowerCase().endsWith(".json")) {
          const parsed = JSON.parse(text) as Partial<{
            income: unknown;
            expense: unknown;
          }>;
          const incomeRows = sanitizeImportedEntries(parsed?.income, data.income);
          const expenseRows = sanitizeImportedEntries(parsed?.expense, [
            ...data.income,
            ...data.expense,
          ]);
          const rejected = incomeRows.rejected + expenseRows.rejected;
          if (rejected > 0) {
            logError("import", "JSON rows rejected during import", `${rejected}`);
          }

          const income = dedupeEntries(data.income, incomeRows.entries);
          const expense = dedupeEntries(data.expense, expenseRows.entries);
          merge(income, expense);
          setImportMsg(`JSON سے ${income.length + expense.length} نئی انٹریز درج ہو گئیں۔`);
        } else {
          const { income: rawIncome, expense: rawExpense } = entriesFromCsv(text);
          const income = dedupeEntries(data.income, rawIncome);
          const expense = dedupeEntries(data.expense, rawExpense);
          merge(income, expense);
          setImportMsg(`CSV سے ${income.length + expense.length} نئی انٹریز درج ہو گئیں۔`);
        }
      } catch (error) {
        logError("import", "file could not be read", error);
        setImportMsg("فائل پڑھی نہیں جا سکی — براہِ کرم درست CSV/JSON فائل منتخب کریں۔");
      }
    };
    reader.readAsText(file);
  }

  return {
    importMsg,
    resetImportMsg,
    exportData,
    shareWhatsApp,
    handleImportFile,
  };
}
