/**
 * صوتی بقیہ — shared domain logic.
 *
 * Pure, dependency-free helpers. Everything here is deterministic and covered
 * by `scripts/verify-khata.ts`, which runs with `bun scripts/verify-khata.ts`.
 *
 * Design notes
 * ------------
 * • `Entry.timestamp` (epoch ms) is the single source of truth for ordering and
 *   for the month bucket. `date` / `time` are display-only strings and are never
 *   parsed back, so an Urdu-formatted date can never break sorting.
 * • Identifiers come from {@link nextId}, which is strictly monotonic, so two
 *   records created in the same millisecond still get distinct ids (the old
 *   `Date.now() + index` scheme silently collided).
 * • `getMonthCarryForward` is expressed as a single forward pass
 *   (`buildLedger`) and memoised per `DataState` object instead of recursing.
 */

export type EntryType = "income" | "expense";

export type Entry = {
  /** Strictly monotonic; see {@link nextId}. */
  id: number;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  /** `YYYY-MM`; the bucket a record is counted in. */
  monthKey: string;
  /** Display only (Urdu). Never parsed. */
  date: string;
  /** Display only (Urdu). Never parsed. */
  time: string;
  /** Epoch ms — ordering, sorting and cloud sync all use this. */
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

/** `latin` (`5,000`) is the original look; `eastern` (`۵,۰۰۰`) is opt-in. */
export type DigitStyle = "latin" | "eastern";

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

/** Result type used by the validation helpers (no throwing on bad input). */
export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* Storage keys                                                        */
/* ------------------------------------------------------------------ */
export const STORAGE_KEY = "nabeelUltimateMasterRecord";
export const API_KEY_STORAGE = "nabeelGeminiApiKey";
export const PREF_STORAGE_KEY = "sautiBaqayaPrefs";

/* ------------------------------------------------------------------ */
/* Limits & constants                                                  */
/* ------------------------------------------------------------------ */
/** One crore — anything above this is treated as a typo. */
export const MAX_AMOUNT = 100_000_000;
/** Hard cap so a huge ledger can never blow a single Convex mutation. */
export const MAX_RECORDS = 1000;

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

/** Order matters: earlier rules win ties, exactly like the original app. */
export const CATEGORY_CATALOG: { name: string; icon: string }[] = [
  { name: "سفر", icon: "fa-gas-pump" },
  { name: "کھانا", icon: "fa-utensils" },
  { name: "یوٹیلیٹی بل", icon: "fa-bolt" },
  { name: "ادھار کھاتہ", icon: "fa-hand-holding-usd" },
  { name: "دوکان", icon: "fa-store" },
  { name: "عام", icon: "fa-receipt" },
];

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */
let lastIssuedId = 0;

/**
 * Strictly monotonic id. Two calls in the same millisecond still differ, which
 * `Date.now()` alone does not guarantee.
 */
export function nextId(): number {
  const now = Date.now();
  lastIssuedId = now > lastIssuedId ? now : lastIssuedId + 1;
  return lastIssuedId;
}

/* ------------------------------------------------------------------ */
/* Digit normalisation & amount parsing                                */
/* ------------------------------------------------------------------ */
const EASTERN_TO_ASCII: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Converts Eastern-Arabic (and Arabic-Indic) digits to ASCII. */
export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => EASTERN_TO_ASCII[ch] ?? ch);
}

/** Numerals below 100 — additive when stacked. */
const URDU_SMALL: Record<string, number> = {
  ایک: 1, یک: 1, دو: 2, تین: 3, چار: 4, پانچ: 5,
  چھ: 6, سات: 7, آٹھ: 8, اٹھ: 8, نو: 9, دس: 10,
  گیارہ: 11, بارہ: 12, تیرہ: 13, چودہ: 14, پندرہ: 15,
  سولہ: 16, سترہ: 17, اٹھارہ: 18, انیس: 19, بیس: 20,
  تیس: 30, چالیس: 40, پچاس: 50, ساٹھ: 60, ستر: 70, اسی: 80, نوے: 90,
};

/** Place-value multipliers — these close the current group. */
const URDU_MULTIPLE: Record<string, number> = {
  سو: 100,
  ہزار: 1000,
  ہزارہ: 1000,
  لاکھ: 100_000,
  کروڑ: 10_000_000,
};

/**
 * Pulls an amount out of spoken Urdu text. Handles ASCII digits, Eastern-Arabic
 * digits, thousands separators and Urdu numeral words such as "دس ہزار پانچ سو".
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  // Drop thousands separators only when they sit between digits, so "5,000"
  // stays one number instead of splitting into "5" and "000".
  const normalized = normalizeDigits(raw).replace(/([0-9])[,،](?=[0-9])/g, "$1");

  const numeric = normalized.match(/\d+(?:\.\d+)?/);
  if (numeric) {
    const value = Number.parseFloat(numeric[0]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }

  const tokens = normalized.split(/[^\u0600-\u06FFa-zA-Z]+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let matched = false;

  for (const token of tokens) {
    const multiple = URDU_MULTIPLE[token];
    if (multiple !== undefined) {
      current = (current || 1) * multiple;
      total += current;
      current = 0;
      matched = true;
      continue;
    }
    const small = URDU_SMALL[token];
    if (small !== undefined) {
      current += small;
      matched = true;
    }
  }

  const value = total + current;
  return matched && value > 0 ? Math.round(value) : null;
}

/** Rejects zero, negative, non-numeric and absurd amounts. */
export function validateAmount(input: unknown): Result<number> {
  const value =
    typeof input === "number" ? input : Number.parseFloat(String(input ?? "").trim());
  if (!Number.isFinite(value)) return { ok: false, message: "رقم درست نہیں ہے۔" };
  if (value <= 0) return { ok: false, message: "رقم صفر سے زیادہ ہونی چاہیے۔" };
  if (value > MAX_AMOUNT) return { ok: false, message: "رقم بہت زیادہ ہے۔" };
  return { ok: true, value: Math.round(value) };
}

/* ------------------------------------------------------------------ */
/* Voice detail extraction                                             */
/* ------------------------------------------------------------------ */
const SPEECH_FILLERS =
  /روپے|روپیہ|روپیا|ruppes|rupees|rs\.?|جمع|کر|کریں|کرو|کرنا|کروانا|دو|دیں|دیا|دیے|دینا|دینے|دے|لیں|لے|لو|لوں|لیے|ایڈ|add|گئے|گئی|تھے|تھی|ہے|ہیں|کا|کے|کی|میں|سے|پہ|پر|وہ|یہ/gi;

/**
 * Strips the amount and common filler words so only the real description is
 * left. Replaces the old `length > 3` guesswork with something explainable.
 */
export function extractDetail(text: string, amount: number): string {
  let cleaned = normalizeDigits(text ?? "");
  cleaned = cleaned.replace(new RegExp(String(amount), "g"), " ");
  cleaned = cleaned.replace(SPEECH_FILLERS, " ");
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * True when the utterance carries a usable description. Three characters is the
 * floor so bare particles ("لو", "دے") are not mistaken for a description.
 */
export function hasSpokenDetail(text: string, amount: number): boolean {
  const detail = extractDetail(text, amount);
  return detail.length >= 3 && /[\u0600-\u06FF]/.test(detail);
}

/* ------------------------------------------------------------------ */
/* Categories (data driven)                                            */
/* ------------------------------------------------------------------ */
export type CategoryRule = { name: string; icon: string; patterns: RegExp[] };

export const CATEGORY_RULES: CategoryRule[] = [
  { name: "سفر", icon: "fa-gas-pump", patterns: [/پٹرول/i, /پیٹرول/i, /سفر/i, /گاڑی/i, /بائیک/i] },
  { name: "کھانا", icon: "fa-utensils", patterns: [/چائے/i, /کھانا/i, /روٹی/i, /پانی/i, /ہوٹل/i, /چہائے/i] },
  { name: "یوٹیلیٹی بل", icon: "fa-bolt", patterns: [/بل/i, /بجلی/i, /گیس/i, /انٹرنیٹ/i, /واٹر/i] },
  { name: "ادھار کھاتہ", icon: "fa-hand-holding-usd", patterns: [/ادھار/i, /قرض/i, /واپسی/i] },
  { name: "دوکان", icon: "fa-store", patterns: [/دوکان/i, /دکان/i, /سامان/i, /مال/i] },
];

/**
 * Scores every rule instead of returning on the first hit, so a sentence that
 * mentions two categories resolves deterministically (most matches wins, ties
 * go to the earlier rule — the original priority order).
 */
export function detectCategory(text: string): { name: string; icon: string } {
  const haystack = text ?? "";
  let bestName = "عام";
  let bestIcon = "fa-receipt";
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(haystack)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestName = rule.name;
      bestIcon = rule.icon;
    }
  }
  return { name: bestName, icon: bestIcon };
}

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
/* Ledger (memoised single pass)                                       */
/* ------------------------------------------------------------------ */
export type LedgerMonth = {
  income: number;
  expense: number;
  opening: number;
  closing: number;
};

export type Ledger = { months: Map<string, LedgerMonth> };

const ledgerCache = new WeakMap<DataState, Ledger>();

/**
 * One forward pass over the records. Memoised on the `DataState` object, so
 * React can call the accessors on every render without re-walking the ledger.
 */
export function buildLedger(db: DataState): Ledger {
  const cached = ledgerCache.get(db);
  if (cached) return cached;

  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  db.income.forEach((i) => {
    const key = monthOf(i);
    income.set(key, (income.get(key) ?? 0) + i.amount);
  });
  db.expense.forEach((e) => {
    const key = monthOf(e);
    expense.set(key, (expense.get(key) ?? 0) + e.amount);
  });

  const keys = Array.from(new Set([...income.keys(), ...expense.keys()])).sort();
  const months = new Map<string, LedgerMonth>();
  let opening = 0;
  for (const key of keys) {
    const inc = income.get(key) ?? 0;
    const exp = expense.get(key) ?? 0;
    months.set(key, { income: inc, expense: exp, opening, closing: opening + inc - exp });
    opening += inc - exp;
  }

  const ledger: Ledger = { months };
  ledgerCache.set(db, ledger);
  return ledger;
}

export function sumFor(list: Entry[], mKey: string): number {
  return list
    .filter((item) => monthOf(item) === mKey)
    .reduce((sum, item) => sum + item.amount, 0);
}

/** Amount carried into `mKey` from every earlier month. */
export function getMonthCarryForward(db: DataState, mKey: string): number {
  let carry = 0;
  for (const [key, month] of buildLedger(db).months) {
    if (key < mKey) carry += month.income - month.expense;
  }
  return carry;
}

/** Balance at the very start of `mKey`. */
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
  const ledger = buildLedger(db);
  return lastNMonths(endingMonthKey, span).map((monthKey) => {
    const month = ledger.months.get(monthKey);
    // Mirrors the original series: carry-forward + this month's income.
    return {
      monthKey,
      income: month ? month.opening + month.income : 0,
      expense: month?.expense ?? 0,
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
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/**
 * Deterministic — it never depends on the host's ICU/CLDR data. The default
 * `latin` output is byte-identical to what the original `toLocaleString("ur-PK")`
 * produced in the app's browser, so the preview does not move.
 */
export function formatNumber(value: number, style: DigitStyle): string {
  const latin = Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 3 })
    : "0";
  if (style !== "eastern") return latin;
  return latin.replace(/[0-9]/g, (digit) => EASTERN_DIGITS[Number(digit)] ?? digit);
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
      // The undo stack is intentionally dropped on reload: undoing a record
      // from a previous session would silently delete data the user cannot see.
      undoStack: [],
    };
  } catch {
    return emptyData();
  }
}

export function persistData(db: DataState) {
  try {
    // Only the records are worth persisting; the undo stack is session state.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...db, undoStack: [] }));
  } catch {
    /* quota exceeded — the app keeps working in memory */
  }
}

export type Prefs = {
  digitStyle: DigitStyle;
  /** Recurring incomes already applied, per month key — stops duplicates. */
  appliedRecurring: Record<string, string[]>;
};

export function defaultPrefs(): Prefs {
  return { digitStyle: "latin", appliedRecurring: {} };
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
    // `ur` was the old flag name for the (Latin-digit) default.
    return {
      digitStyle: parsed.digitStyle === "eastern" ? "eastern" : "latin",
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
/* Deduplication                                                       */
/* ------------------------------------------------------------------ */
/** Stable identity for a record across imports and sync. */
export function entryKey(entry: Entry): string {
  return `${monthOf(entry)}|${entry.category}|${entry.amount}|${(entry.detail ?? "").trim()}`;
}

/** Drops incoming records that already exist (same month/category/amount/detail). */
export function dedupeEntries(existing: Entry[], incoming: Entry[]): Entry[] {
  const seen = new Set(existing.map(entryKey));
  const unique: Entry[] = [];
  for (const entry of incoming) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

/* ------------------------------------------------------------------ */
/* CSV backup & restore                                                */
/* ------------------------------------------------------------------ */
/**
 * Quotes a field and neutralises spreadsheet formula injection (`=`, `+`, `-`,
 * `@`) by prefixing an apostrophe.
 */
export function escapeCsvField(value: string): string {
  let cell = value ?? "";
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function buildCsv(db: DataState): string {
  const rows = ["Month,Type,Category,Date,Time,Amount,Detail"];
  const push = (kind: EntryType, list: Entry[]) =>
    list.forEach((item) => {
      rows.push(
        [
          item.monthKey || getCurrentMonthKey(),
          kind === "income" ? "Income" : "Expense",
          escapeCsvField(item.category || kind),
          escapeCsvField(item.date ?? ""),
          escapeCsvField(item.time ?? ""),
          String(item.amount),
          escapeCsvField(item.detail ?? ""),
        ].join(","),
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
    const amount = Number.parseFloat(normalizeDigits(row[iAmount] ?? "").replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amount)) continue;
    const detail = (row[iDetail] ?? "").trim();
    const category = (row[iCat] ?? "").trim() || detectCategory(detail).name;
    const icon =
      CATEGORY_CATALOG.find((c) => c.name === category)?.icon ?? "fa-receipt";
    const timestamp = nextId();
    const entry: Entry = {
      id: timestamp,
      amount,
      detail,
      category,
      icon,
      monthKey: (row[iMonth] ?? "").trim() || getCurrentMonthKey(),
      date: (row[iDate] ?? "").trim() || "",
      time: (row[iTime] ?? "").trim() || "",
      timestamp,
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
