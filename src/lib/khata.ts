/**
 * صوتی بقیہ — shared domain logic.
 *
 * Pure helpers for month math, running balances, category detection and CSV
 * import/export. Kept free of React so the UI layer stays thin.
 */

export type EntryType = "income" | "expense";

export type Entry = {
  id: number;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
};

export type UndoEntry = { type: EntryType; record: Entry };

export type DataState = {
  income: Entry[];
  expense: Entry[];
  undoStack: UndoEntry[];
};

export type DialogState =
  | "IDLE"
  | "WAITING_INCOME_DETAIL"
  | "WAITING_EXPENSE_DETAIL"
  | "WAITING_CONFIRM";

export type Budget = { category: string; limit: number };

export type RecurringEntry = {
  id: string;
  label: string;
  amount: number;
  enabled: boolean;
};

export type DigitStyle = "ur" | "latin";

export type MonthTotals = {
  carryForward: number;
  directIncome: number;
  totalIncome: number;
  totalExpense: number;
  balance: number;
};

export type CategoryBreakdown = {
  category: string;
  icon: string;
  amount: number;
  share: number;
};

export type AiInsight = {
  title: string;
  spoken: string;
  insight: string;
  topCategory: string;
  riskLevel: "low" | "medium" | "high";
};

/* ------------------------------------------------------------------ */
/* Storage keys                                                        */
/* ------------------------------------------------------------------ */
export const STORAGE_KEY = "nabeelUltimateMasterRecord";
export const API_KEY_STORAGE = "nabeelGeminiApiKey";
export const PREF_STORAGE_KEY = "sautiBaqayaPrefs";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */
export const MONTH_NAMES: Record<string, string> = {
  "01": "جنوری",
  "02": "فروری",
  "03": "مارچ",
  "04": "اپریل",
  "05": "مئی",
  "06": "جون",
  "07": "جولائی",
  "08": "اگست",
  "09": "ستمبر",
  "10": "اکتوبر",
  "11": "نومبر",
  "12": "دسمبر",
};

/** Known spend/income categories, in the order they are offered in the UI. */
export const CATEGORY_CATALOG: { name: string; icon: string }[] = [
  { name: "سفر", icon: "fa-gas-pump" },
  { name: "کھانا", icon: "fa-utensils" },
  { name: "یوٹیلیٹی بل", icon: "fa-bolt" },
  { name: "ادھار کھاتہ", icon: "fa-hand-holding-usd" },
  { name: "دوکان", icon: "fa-store" },
  { name: "عام", icon: "fa-receipt" },
];

/* ------------------------------------------------------------------ */
/* Month math                                                          */
/* ------------------------------------------------------------------ */
export function getCurrentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getPreviousMonthKey(mKey: string): string {
  const parts = mKey.split("-").map(Number);
  let year = parts[0] ?? 0;
  let month = (parts[1] ?? 1) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getNextMonthKey(mKey: string): string {
  const parts = mKey.split("-").map(Number);
  let year = parts[0] ?? 0;
  let month = (parts[1] ?? 1) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function formatMonthName(mKey: string): string {
  const [year, month] = mKey.split("-");
  return `${MONTH_NAMES[month ?? ""] ?? month} ${year}`;
}

/** `n` month keys ending at (and including) `mKey`, oldest first. */
export function lastNMonths(mKey: string, n: number): string[] {
  const out: string[] = [];
  let cursor = mKey;
  for (let i = 0; i < n; i += 1) {
    out.unshift(cursor);
    cursor = getPreviousMonthKey(cursor);
  }
  return out;
}

export function monthOf(entry: { monthKey?: string }): string {
  return entry.monthKey || getCurrentMonthKey();
}

/* ------------------------------------------------------------------ */
/* Totals & carry-forward                                              */
/* ------------------------------------------------------------------ */
export function sumFor(list: Entry[], mKey: string): number {
  return list
    .filter((item) => monthOf(item) === mKey)
    .reduce((sum, item) => sum + item.amount, 0);
}

function getMonthEndingBalance(db: DataState, mKey: string): number {
  return (
    getMonthCarryForward(db, mKey) + sumFor(db.income, mKey) - sumFor(db.expense, mKey)
  );
}

export function getMonthCarryForward(db: DataState, mKey: string): number {
  const prevKey = getPreviousMonthKey(mKey);
  const hasPrevData =
    db.income.some((i) => monthOf(i) === prevKey) ||
    db.expense.some((e) => monthOf(e) === prevKey);
  if (!hasPrevData) {
    const hasOlder =
      db.income.some((i) => monthOf(i) < mKey) ||
      db.expense.some((e) => monthOf(e) < mKey);
    if (!hasOlder) return 0;
  }
  return getMonthEndingBalance(db, prevKey);
}

/** Running balance at the *start* of `mKey` — i.e. what carried in. */
export function getOpeningBalance(db: DataState, mKey: string): number {
  return getMonthCarryForward(db, mKey);
}

export function getTotals(db: DataState, activeMonth: string): MonthTotals {
  const carryForward = getMonthCarryForward(db, activeMonth);
  const directIncome = sumFor(db.income, activeMonth);
  const totalIncome = carryForward + directIncome;
  const totalExpense = sumFor(db.expense, activeMonth);
  return {
    carryForward,
    directIncome,
    totalIncome,
    totalExpense,
    balance: totalIncome - totalExpense,
  };
}

/** Every month key the dataset touches, newest first, plus the current month. */
export function collectMonthKeys(db: DataState): string[] {
  const set = new Set<string>();
  set.add(getCurrentMonthKey());
  db.income.forEach((i) => {
    if (i.monthKey) set.add(i.monthKey);
  });
  db.expense.forEach((e) => {
    if (e.monthKey) set.add(e.monthKey);
  });
  return Array.from(set).sort().reverse();
}

/** Income/expense per month, oldest first, for the trend chart. */
export function getMonthlySeries(
  db: DataState,
  endingMonthKey: string,
  span: number,
): { monthKey: string; income: number; expense: number }[] {
  return lastNMonths(endingMonthKey, span).map((monthKey) => {
    const carry = getMonthCarryForward(db, monthKey);
    return {
      monthKey,
      income: carry + sumFor(db.income, monthKey),
      expense: sumFor(db.expense, monthKey),
    };
  });
}

export function getCategoryBreakdown(
  db: DataState,
  mKey: string,
): CategoryBreakdown[] {
  const totals = new Map<string, number>();
  db.expense
    .filter((e) => monthOf(e) === mKey)
    .forEach((e) => {
      totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    });

  const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  return Array.from(totals.entries())
    .map(([category, amount]) => ({
      category,
      icon: CATEGORY_CATALOG.find((c) => c.name === category)?.icon ?? "fa-receipt",
      amount,
      share: sum > 0 ? Math.round((amount / sum) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function getBudgetAlerts(
  db: DataState,
  mKey: string,
  budgets: Budget[],
): { category: string; spent: number; limit: number; overBy: number }[] {
  return budgets
    .filter((b) => b.limit > 0)
    .map((budget) => {
      const spent = db.expense
        .filter((e) => monthOf(e) === mKey && e.category === budget.category)
        .reduce((s, e) => s + e.amount, 0);
      return {
        category: budget.category,
        spent,
        limit: budget.limit,
        overBy: spent - budget.limit,
      };
    })
    .filter((row) => row.overBy > 0)
    .sort((a, b) => b.overBy - a.overBy);
}

/* ------------------------------------------------------------------ */
/* Category detection                                                  */
/* ------------------------------------------------------------------ */
export function detectCategory(text: string): { name: string; icon: string } {
  if (/پٹرول|پیٹرول|سفر|گاڑی|بائیک/i.test(text)) return { name: "سفر", icon: "fa-gas-pump" };
  if (/چائے|کھانا|روٹی|پانی|ہوٹل/i.test(text)) return { name: "کھانا", icon: "fa-utensils" };
  if (/بل|بجلی|گیس|انٹرنیٹ/i.test(text)) return { name: "یوٹیلیٹی بل", icon: "fa-bolt" };
  if (/ادھار|قرض|واپسی/i.test(text)) return { name: "ادھار کھاتہ", icon: "fa-hand-holding-usd" };
  if (/دوکان|سامان|مال|دکان/i.test(text)) return { name: "دوکان", icon: "fa-store" };
  return { name: "عام", icon: "fa-receipt" };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
/**
 * `ur` keeps the original Eastern-Arabic digits (`۵۰۰`), `latin` switches the
 * whole app to `500`. The default matches the original app exactly.
 */
export function formatNumber(value: number, style: DigitStyle): string {
  if (style === "latin") return value.toLocaleString("en-US");
  return value.toLocaleString("ur-PK");
}

/* ------------------------------------------------------------------ */
/* Local storage                                                       */
/* ------------------------------------------------------------------ */
export function emptyData(): DataState {
  return { income: [], expense: [], undoStack: [] };
}

export function loadData(): DataState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as Partial<DataState>;
    return {
      income: Array.isArray(parsed.income) ? parsed.income : [],
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
    };
  } catch {
    return emptyData();
  }
}

export function persistData(db: DataState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota exceeded — the app keeps working in memory */
  }
}

export type Prefs = {
  /** `ur` (default, Eastern-Arabic digits) or `latin`. */
  digitStyle: DigitStyle;
  /** Recurring incomes already applied, per month key — stops duplicates. */
  appliedRecurring: Record<string, string[]>;
};

export function defaultPrefs(): Prefs {
  return { digitStyle: "ur", appliedRecurring: {} };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const applied =
      parsed.appliedRecurring && typeof parsed.appliedRecurring === "object"
        ? parsed.appliedRecurring
        : {};
    return {
      digitStyle: parsed.digitStyle === "latin" ? "latin" : "ur",
      appliedRecurring: applied,
    };
  } catch {
    return defaultPrefs();
  }
}

export function persistPrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* CSV backup & restore                                                */
/* ------------------------------------------------------------------ */
export function buildCsv(db: DataState): string {
  const rows = ["Month,Type,Category,Date,Time,Amount,Detail"];
  const push = (kind: EntryType, list: Entry[]) =>
    list.forEach((item) => {
      const detail = `"${(item.detail ?? "").replace(/"/g, '""')}"`;
      rows.push(
        `${item.monthKey || getCurrentMonthKey()},${kind === "income" ? "Income" : "Expense"},${item.category || kind},${item.date},${item.time},${item.amount},${detail}`,
      );
    });
  push("income", db.income);
  push("expense", db.expense);
  return `${rows.join("\n")}\n`;
}

/** RFC-4180-ish CSV reader — handles quoted fields with commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function entriesFromCsv(
  text: string,
): { income: Entry[]; expense: Entry[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { income: [], expense: [] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iMonth = idx("month");
  const iType = idx("type");
  const iCat = idx("category");
  const iDate = idx("date");
  const iTime = idx("time");
  const iAmount = idx("amount");
  const iDetail = idx("detail");

  const income: Entry[] = [];
  const expense: Entry[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const amount = Number.parseFloat((row[iAmount] ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amount)) continue;
    const detail = (row[iDetail] ?? "").trim();
    const category = (row[iCat] ?? "").trim() || detectCategory(detail).name;
    const icon =
      CATEGORY_CATALOG.find((c) => c.name === category)?.icon ?? "fa-receipt";
    const now = new Date();
    const entry: Entry = {
      id: now.getTime() + r,
      amount,
      detail,
      category,
      icon,
      monthKey: (row[iMonth] ?? "").trim() || getCurrentMonthKey(),
      date: (row[iDate] ?? "").trim() || now.toLocaleDateString("ur-PK"),
      time: (row[iTime] ?? "").trim() || now.toLocaleTimeString("ur-PK", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: now.getTime() + r,
    };
    const kind = (row[iType] ?? "").trim().toLowerCase();
    if (kind.startsWith("in") || kind.includes("آمدن") || kind.includes("جمع")) {
      income.push(entry);
    } else {
      expense.push(entry);
    }
  }
  return { income, expense };
}
