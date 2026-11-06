/**
 * Every way an entry reaches the ledger, plus the feedback that follows it.
 *
 * The three commit paths (manual notepad, quick add, voice) all resolve to the
 * same validated `addEntry`, and the budget warning is spoken only from an
 * event handler — never from an effect — so it cannot repeat on re-render.
 */
import { useCallback } from "react";
import type { ReactNode } from "react";
import type { AddEntryInput } from "@/hooks/use-khata";
import type { Draft } from "@/features/ledger";
import {
  budgetNoticeText,
  markBudgetNotified,
  nextBudgetNotice,
} from "@/lib/budget-notices";
import { t } from "@/lib/i18n";
import { budgetStatus } from "@/lib/insights";
import {
  detectCategory,
  formatNumber,
  type Budget,
  type DataState,
  type DigitStyle,
  type EntryType,
} from "@/lib/khata";
import { track } from "@/lib/telemetry";

export type UseLedgerEntryActionsOptions = {
  data: DataState;
  activeMonth: string;
  budgets: Budget[];
  digitStyle: DigitStyle;
  addEntry: (input: AddEntryInput) => boolean;
  updateEntry: (type: EntryType, id: number, input: AddEntryInput) => boolean;
  undo: () => void;
  /** Voice announcement channel (the `voice.announce` callback). */
  announce: (node: ReactNode, speechText?: string) => void;
};

/**
 * Single place that turns a *would-be* expense into the one budget sentence the
 * shopkeeper has not heard yet for this month. Returns `null` when nothing new
 * crossed a threshold.
 */
export function useLedgerEntryActions({
  data,
  activeMonth,
  budgets,
  digitStyle,
  addEntry,
  updateEntry,
  undo,
  announce,
}: UseLedgerEntryActionsOptions) {
  const pendingBudgetWarning = useCallback(
    (type: EntryType, amount: number, detail: string): string | null => {
      if (type !== "expense") return null;
      const preview: DataState = {
        ...data,
        expense: [
          ...data.expense,
          {
            id: -1,
            amount,
            detail,
            category: detectCategory(detail).name,
            icon: "fa-receipt",
            monthKey: activeMonth,
            date: "",
            time: "",
            timestamp: Date.now(),
          },
        ],
      };
      const notice = nextBudgetNotice(
        budgetStatus(preview, activeMonth, budgets),
        activeMonth,
      );
      if (!notice) return null;
      markBudgetNotified(notice.key);
      return budgetNoticeText(notice.status, (value) =>
        formatNumber(value, digitStyle),
      );
    },
    [activeMonth, budgets, data, digitStyle],
  );

  /** Shows (and speaks) the confirmation for a committed entry. */
  const announceEntryAdded = useCallback(
    (type: EntryType, amount: number, detail: string) => {
      const confirmation = `${amount} روپے درج ہو گئے۔`;
      const warning = pendingBudgetWarning(type, amount, detail);
      announce(
        <>
          <span className="text-emerald-300 text-sm font-bold">✓ {confirmation}</span>
          {warning && (
            <>
              <br />
              <span className="text-rose-300 text-sm font-bold">⚠ {warning}</span>
            </>
          )}
        </>,
        warning ? `${confirmation} ${warning}` : confirmation,
      );
    },
    [announce, pendingBudgetWarning],
  );

  function speakBudgetWarning(type: EntryType, amount: number, detail: string) {
    const warning = pendingBudgetWarning(type, amount, detail);
    if (!warning) return;
    announce(
      <span className="text-rose-300 text-sm font-bold">⚠ {warning}</span>,
      warning,
    );
  }

  function handleAddManual(type: EntryType, draft: Draft): boolean {
    const detail = draft.detail;
    const ok = addEntry({
      type,
      amount: Number.parseFloat(draft.amount),
      detail,
      category: draft.category,
      account: draft.account,
    });
    if (ok) {
      track("entry_manual", { type, category: draft.category });
      announceEntryAdded(type, Number.parseFloat(draft.amount), detail || draft.category);
    }
    return ok;
  }

  function handleUpdateEntry(type: EntryType, id: number, draft: Draft): boolean {
    return updateEntry(type, id, {
      type,
      amount: Number.parseFloat(draft.amount),
      detail: draft.detail,
      category: draft.category,
      account: draft.account,
    });
  }

  /** The one-tap quick-add button under the mic. */
  function handleQuickCommit(input: AddEntryInput): boolean {
    const ok = addEntry({
      type: input.type,
      amount: input.amount,
      detail: input.detail,
      category: input.category,
      account: input.account,
    });
    if (ok) {
      track("entry_quick", { type: input.type });
      announceEntryAdded(input.type, input.amount, input.detail);
    }
    return ok;
  }

  function handleUndoButton() {
    const removed = data.undoStack.length > 0;
    if (removed) undo();
    const message = removed ? t("undoDone") : t("undoEmpty");
    announce(<span className="text-amber-300 font-bold">{message}</span>, message);
  }

  return {
    handleAddManual,
    handleUpdateEntry,
    handleQuickCommit,
    handleUndoButton,
    speakBudgetWarning,
  };
}
