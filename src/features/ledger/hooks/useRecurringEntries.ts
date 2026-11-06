/**
 * Mirrors the saved monthly rules into the local ledger.
 *
 * A rule is applied once per calendar month. Two guards make that literal:
 *
 *  1. the month's records are checked (label + amount), as before — this is
 *     what stops a second mirror when the effect re-runs;
 *  2. the rule is recorded in `prefs.appliedRecurring` once applied, so deleting
 *     the generated entry no longer makes it reappear a render later.
 *
 * Nothing is added while signed out, and a rule whose label *or* amount is
 * edited is treated as a new rule (the key changes), exactly as before.
 */
import { useEffect } from "react";
import { getCurrentMonthKey, type DataState, type RecurringEntry } from "@/lib/khata";
import { monthHasRule, recurringRuleKey, recurringRuleToEntry } from "@/lib/recurring";

export type UseRecurringEntriesOptions = {
  isAuthenticated: boolean;
  recurring: RecurringEntry[];
  data: DataState;
  /** Rules already applied per month (`prefs.appliedRecurring`). */
  appliedRecurring: Record<string, string[]>;
  markRecurringApplied: (monthKey: string, keys: string[]) => void;
  merge: (income: DataState["income"], expense: DataState["expense"]) => void;
};

export function useRecurringEntries({
  isAuthenticated,
  recurring,
  data,
  appliedRecurring,
  markRecurringApplied,
  merge,
}: UseRecurringEntriesOptions): void {
  useEffect(() => {
    if (!isAuthenticated || recurring.length === 0) return;
    const monthKey = getCurrentMonthKey();
    const applied = appliedRecurring[monthKey] ?? [];

    const due = recurring.filter((entry) => {
      if (!entry.enabled) return false;
      const kind = entry.kind ?? "income";
      if (applied.includes(recurringRuleKey(entry.label, entry.amount, kind))) {
        return false;
      }
      return !monthHasRule(
        kind === "income" ? data.income : data.expense,
        entry,
        monthKey,
      );
    });
    if (due.length === 0) return;

    merge(
      due
        .filter((entry) => (entry.kind ?? "income") === "income")
        .map((entry) => recurringRuleToEntry(entry.label, entry.amount, "income")),
      due
        .filter((entry) => entry.kind === "expense")
        .map((entry) => recurringRuleToEntry(entry.label, entry.amount, "expense")),
    );

    markRecurringApplied(
      monthKey,
      due.map((entry) =>
        recurringRuleKey(entry.label, entry.amount, entry.kind ?? "income"),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, recurring, data.income, data.expense, appliedRecurring]);
}
