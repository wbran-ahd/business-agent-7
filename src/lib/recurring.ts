/**
 * Recurring (monthly) rules → real ledger entries.
 *
 * Pure and dependency-light so the same record shape is produced for the
 * voice path, the manual path and the monthly materialiser, and so the
 * script-based checks can exercise it without React.
 */
import { getCurrentMonthKey, monthOf, nextId, type Entry, type EntryType } from "./khata";

export const RECURRING_INCOME_CATEGORY = "ماہانہ آمدنی";
export const RECURRING_EXPENSE_CATEGORY = "ماہانہ خرچہ";

/** Builds one ledger entry for a monthly rule. Income is the default. */
export function recurringRuleToEntry(
  label: string,
  amount: number,
  kind: EntryType = "income",
  now: Date = new Date(),
): Entry {
  return {
    id: nextId(),
    amount,
    detail: label,
    category: kind === "income" ? RECURRING_INCOME_CATEGORY : RECURRING_EXPENSE_CATEGORY,
    icon: kind === "income" ? "fa-money-bill-wave" : "fa-file-invoice-dollar",
    monthKey: getCurrentMonthKey(),
    date: now.toLocaleDateString("ur-PK"),
    time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
    timestamp: now.getTime(),
  };
}

/**
 * Identity of one monthly rule, used to remember that the month already got it.
 * Kind is part of the key so the same label may exist as income and expense.
 */
export function recurringRuleKey(
  label: string,
  amount: number,
  kind: EntryType = "income",
): string {
  // Defensive: rules arrive from localStorage/Firestore, so a malformed row must
  // not throw from inside an effect (it used to call `.trim()` on undefined).
  return `${kind}|${String(label ?? "").trim()}|${amount}`;
}

/** A month already holds this rule when label and amount both match. */
export function monthHasRule(
  list: Entry[],
  rule: { label: string; amount: number },
  monthKey: string,
): boolean {
  return list.some(
    (entry) =>
      monthOf(entry) === monthKey &&
      entry.detail === rule.label &&
      entry.amount === rule.amount,
  );
}
