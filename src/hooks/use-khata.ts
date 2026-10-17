/**
 * `useKhata` — the ledger.
 *
 * Every change to the records goes through a single reducer instead of a dozen
 * scattered `setDb(...)` call sites, so validation, undo and persistence live
 * in one audited place and behave identically for voice, manual and imported
 * entries.
 */
import {
  CATEGORY_CATALOG,
  clampTtsRate,
  collectMonthKeys,
  detectCategory,
  formatMonthName,
  getCurrentMonthKey,
  getCategoryBreakdown,
  getBudgetAlerts,
  getMonthlySeries,
  getTotals,
  loadPrefs,
  loadData,
  nextId,
  normalizeAccount,
  persistData,
  persistPrefs,
  validateAmount,
  type AccountKind,
  type Budget,
  type DataState,
  type DigitStyle,
  type Entry,
  type EntryType,
  type Prefs,
} from "@/lib/khata";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

export type AddEntryInput = {
  type: EntryType;
  amount: number;
  detail: string;
  category?: string;
  /** Cash by default; voice entries never ask. */
  account?: AccountKind;
};

export type KhataCommand =
  | { kind: "add"; entryType: EntryType; entry: Entry }
  | { kind: "update"; entryType: EntryType; id: number; entry: Entry }
  | { kind: "remove"; entryType: EntryType; id: number }
  | { kind: "undo" }
  | { kind: "replaceAll"; income: Entry[]; expense: Entry[] }
  | { kind: "merge"; income: Entry[]; expense: Entry[] };

function withList(
  state: DataState,
  entryType: EntryType,
  mutate: (list: Entry[]) => Entry[],
): DataState {
  return entryType === "income"
    ? { ...state, income: mutate(state.income) }
    : { ...state, expense: mutate(state.expense) };
}

export function khataReducer(state: DataState, command: KhataCommand): DataState {
  switch (command.kind) {
    case "add":
      return {
        ...withList(state, command.entryType, (list) => [...list, command.entry]),
        undoStack: [...state.undoStack, { type: command.entryType, record: command.entry }],
      };
    case "update":
      return withList(state, command.entryType, (list) =>
        list.map((item) => (item.id === command.id ? command.entry : item)),
      );
    case "remove":
      return {
        ...withList(state, command.entryType, (list) =>
          list.filter((item) => item.id !== command.id),
        ),
        // Dropping it from the stack stops an undo from resurrecting it.
        undoStack: state.undoStack.filter((u) => u.record.id !== command.id),
      };
    case "undo": {
      const last = state.undoStack[state.undoStack.length - 1];
      if (!last) return state;
      return {
        ...withList(state, last.type, (list) =>
          list.filter((item) => item.id !== last.record.id),
        ),
        undoStack: state.undoStack.slice(0, -1),
      };
    }
    case "replaceAll":
      return { income: command.income, expense: command.expense, undoStack: [] };
    case "merge": {
      const withIncome = withList(state, "income", (list) => [...list, ...command.income]);
      return withList(withIncome, "expense", (list) => [...list, ...command.expense]);
    }
    default:
      return state;
  }
}

/** Builds a record; the caller has already validated the amount. */
export function makeRecord(input: AddEntryInput, id = nextId()): Entry {
  const now = new Date();
  const detected = detectCategory(input.detail);
  const category = input.category || detected.name;
  return {
    id,
    amount: input.amount,
    detail: input.detail,
    category,
    icon: CATEGORY_CATALOG.find((c) => c.name === category)?.icon ?? detected.icon,
    monthKey: getCurrentMonthKey(),
    date: now.toLocaleDateString("ur-PK"),
    time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
    timestamp: now.getTime(),
    account: normalizeAccount(input.account),
  };
}

export function useKhata() {
  const [data, dispatch] = useReducer(khataReducer, undefined, loadData);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [activeMonth, setActiveMonth] = useState<string>(() => getCurrentMonthKey());
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    persistData(data);
  }, [data]);
  useEffect(() => {
    persistPrefs(prefs);
  }, [prefs]);

  /** Single entry point for every new record — validates before committing. */
  const addEntry = useCallback((input: AddEntryInput): boolean => {
    const result = validateAmount(input.amount);
    if (!result.ok) {
      setValidationError(result.message);
      return false;
    }
    setValidationError(null);
    dispatch({ kind: "add", entryType: input.type, entry: makeRecord({ ...input, amount: result.value }) });
    return true;
  }, []);

  const updateEntry = useCallback(
    (entryType: EntryType, id: number, input: AddEntryInput): boolean => {
      const result = validateAmount(input.amount);
      if (!result.ok) {
        setValidationError(result.message);
        return false;
      }
      setValidationError(null);
      dispatch({
        kind: "update",
        entryType,
        id,
        entry: makeRecord({ ...input, amount: result.value }, id),
      });
      return true;
    },
    [],
  );

  const removeEntry = useCallback(
    (entryType: EntryType, id: number) => dispatch({ kind: "remove", entryType, id }),
    [],
  );
  const undo = useCallback(() => dispatch({ kind: "undo" }), []);
  const replaceAll = useCallback(
    (income: Entry[], expense: Entry[]) => dispatch({ kind: "replaceAll", income, expense }),
    [],
  );
  const merge = useCallback(
    (income: Entry[], expense: Entry[]) => dispatch({ kind: "merge", income, expense }),
    [],
  );
  const setDigitStyle = useCallback(
    (digitStyle: DigitStyle) => setPrefs((current) => ({ ...current, digitStyle })),
    [],
  );
  /* Voice feedback settings — deliberately part of `Prefs`, so they persist
     with the rest of the display preferences instead of a separate store. */
  const setTtsEnabled = useCallback(
    (ttsEnabled: boolean) => setPrefs((current) => ({ ...current, ttsEnabled })),
    [],
  );
  const setTtsRate = useCallback(
    (ttsRate: number) => setPrefs((current) => ({ ...current, ttsRate: clampTtsRate(ttsRate) })),
    [],
  );

  /* derived ------------------------------------------------------------- */
  const totals = useMemo(() => getTotals(data, activeMonth), [data, activeMonth]);
  const monthOptions = useMemo(() => collectMonthKeys(data), [data]);
  const breakdown = useMemo(() => getCategoryBreakdown(data, activeMonth), [data, activeMonth]);
  const trend = useMemo(() => getMonthlySeries(data, activeMonth, 6), [data, activeMonth]);
  const knownCategories = useMemo(() => {
    const set = new Set<string>(CATEGORY_CATALOG.map((c) => c.name));
    [...data.income, ...data.expense].forEach((e) => set.add(e.category));
    return Array.from(set);
  }, [data]);
  const alertsFor = useCallback(
    (budgets: Budget[]) => getBudgetAlerts(data, activeMonth, budgets),
    [data, activeMonth],
  );

  return {
    data,
    prefs,
    activeMonth,
    setActiveMonth,
    monthName: formatMonthName(activeMonth),
    isCurrentMonth: activeMonth === getCurrentMonthKey(),
    validationError,
    clearValidationError: () => setValidationError(null),
    addEntry,
    updateEntry,
    removeEntry,
    undo,
    replaceAll,
    merge,
    setDigitStyle,
    setTtsEnabled,
    setTtsRate,
    totals,
    monthOptions,
    breakdown,
    trend,
    knownCategories,
    alertsFor,
  };
}
