/**
 * Verification for صوتی بقیہ pure logic.
 *
 * Run with:  bun scripts/verify-khata.ts
 *
 * Exit code 0 means every assertion passed. The interesting part is
 * `referenceCarryForward`: it is the *original* recursive algorithm, kept here
 * as an oracle so the memoised single-pass ledger is proven equivalent on
 * randomly generated ledgers rather than trusted by inspection.
 */
import {
  buildCsv,
  buildLedger,
  detectCategory,
  dedupeEntries,
  entriesFromCsv,
  escapeCsvField,
  extractDetail,
  formatNumber,
  getMonthCarryForward,
  getPreviousMonthKey,
  getTotals,
  hasSpokenDetail,
  monthOf,
  nextId,
  normalizeDigits,
  parseAmount,
  parseCsv,
  sumFor,
  validateAmount,
  type DataState,
  type Entry,
} from "../src/lib/khata";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* 1. Identifiers                                                      */
/* ------------------------------------------------------------------ */
section("nextId — strictly monotonic");
{
  const ids = Array.from({ length: 5000 }, () => nextId());
  check("unique across 5000 rapid calls", new Set(ids).size === ids.length);
  let monotonic = true;
  for (let i = 1; i < ids.length; i += 1) if (ids[i] <= ids[i - 1]) monotonic = false;
  check("strictly increasing", monotonic);
}

/* ------------------------------------------------------------------ */
/* 2. Amount parsing                                                   */
/* ------------------------------------------------------------------ */
section("parseAmount — digits, Eastern digits, Urdu words");
const amountCases: [string, number | null][] = [
  ["500 روپے", 500],
  ["500 روپے ایڈ کر لو", 500],
  ["۵۰۰ روپے", 500],
  ["۵۰۰", 500],
  ["5,000 خرچ", 5000],
  ["چائے پہ 350 لگے", 350],
  ["پانچ سو", 500],
  ["دس ہزار", 10000],
  ["بیس ہزار پانچ سو", 20500],
  ["ایک لاکھ", 100000],
  ["چار کروڑ", 40000000],
  ["سو چالیس", 140],
  ["کوئی رقم نہیں", null],
  ["", null],
];
for (const [input, expected] of amountCases) {
  check(
    `parseAmount(${JSON.stringify(input)}) === ${expected}`,
    parseAmount(input) === expected,
    `got ${parseAmount(input)}`,
  );
}

section("normalizeDigits");
check("Eastern to ASCII", normalizeDigits("۱۲۳۴۵۶۷۸۹۰") === "1234567890");
check("Arabic-Indic to ASCII", normalizeDigits("١٢٣") === "123");

/* ------------------------------------------------------------------ */
/* 3. Validation                                                       */
/* ------------------------------------------------------------------ */
section("validateAmount");
check("accepts a normal amount", validateAmount(150).ok);
check("accepts a numeric string", validateAmount("250").ok);
check("rejects 0", !validateAmount(0).ok);
check("rejects negative", !validateAmount(-5).ok);
check("rejects NaN", !validateAmount(Number.NaN).ok);
check("rejects non-numeric text", !validateAmount("abc").ok);
check("rejects absurd amounts", !validateAmount(999_999_999).ok);
check("rejects undefined", !validateAmount(undefined).ok);

/* ------------------------------------------------------------------ */
/* 4. Voice detail extraction                                          */
/* ------------------------------------------------------------------ */
section("extractDetail / hasSpokenDetail");
check("pure amount has no detail", !hasSpokenDetail("500 روپے ایڈ کر لو", 500));
check("category word counts as detail", hasSpokenDetail("500 چائے", 500));
check("extractDetail strips fillers", extractDetail("500 روپے ایڈ کر لو", 500) === "");
check("extractDetail keeps the description", extractDetail("500 چائے پر", 500).includes("چائے"));

/* ------------------------------------------------------------------ */
/* 5. Categories                                                       */
/* ------------------------------------------------------------------ */
section("detectCategory — deterministic scoring");
check("petrol → سفر", detectCategory("پٹرول بھرایا").name === "سفر");
check("chai → کھانا", detectCategory("چائے خریدی").name === "کھانا");
check("bijli → یوٹیلیٹی بل", detectCategory("بجلی کا بل").name === "یوٹیلیٹی بل");
check("unknown → عام", detectCategory("کچھ بھی").name === "عام");
check("empty string is safe", detectCategory("").name === "عام");
check(
  "two-category tie goes to the earlier rule",
  detectCategory("چائے اور پٹرول دونوں").name === "سفر",
);

/* ------------------------------------------------------------------ */
/* 6. Formatting (deterministic, no ICU dependency)                    */
/* ------------------------------------------------------------------ */
section("formatNumber");
check("latin groups thousands", formatNumber(1234567, "latin") === "1,234,567");
check("latin matches the original ur-PK output", formatNumber(500, "latin") === "500");
check("eastern shapes digits", formatNumber(500, "eastern") === "٥٠٠");
check("non-finite falls back", formatNumber(Number.NaN, "latin") === "0");

/* ------------------------------------------------------------------ */
/* 7. CSV: escaping, round-trip, injection                             */
/* ------------------------------------------------------------------ */
section("CSV — formula injection & round-trip");
check("neutralises = formula", escapeCsvField("=cmd|calc") === "\"'=cmd|calc\"");
check("neutralises + formula", escapeCsvField("+1+1") === "\"'+1+1\"");
check("neutralises @ formula", escapeCsvField("@SUM(A1)") === "\"'@SUM(A1)\"");
check("neutralises - formula", escapeCsvField("-2+2") === "\"'-2+2\"");
check("plain text untouched", escapeCsvField("چائے") === '"چائے"');
check("quotes are doubled", escapeCsvField('a"b') === '"a""b"');

const tricky: Entry[] = [
  {
    id: 1,
    amount: 500,
    detail: 'has "quotes", and a comma, and\na newline',
    category: "کھانا",
    icon: "fa-utensils",
    monthKey: "2026-10",
    date: "10/10/2026",
    time: "10:00",
    timestamp: 1,
  },
  {
    id: 2,
    amount: 1200,
    detail: "=2+2",
    category: "سفر",
    icon: "fa-gas-pump",
    monthKey: "2026-10",
    date: "10/10/2026",
    time: "11:00",
    timestamp: 2,
  },
];
{
  const csv = buildCsv({ income: tricky, expense: [], undoStack: [] });
  check("no raw = at start of a data cell", !/^[^"]*=/m.test(csv.split("\n")[2] ?? ""));
  const parsed = entriesFromCsv(csv);
  const restored = [...parsed.income, ...parsed.expense];
  check("round-trip preserves count", restored.length === tricky.length, `got ${restored.length}`);
  check(
    "round-trip preserves detail with comma/newline",
    restored.some((e) => e.detail === tricky[0].detail),
  );
  check("round-trip preserves amount", restored.some((e) => e.amount === 1200));
  check("rows parse to 7 columns", (parseCsv(csv)[0] ?? []).length === 7);
}

/* ------------------------------------------------------------------ */
/* 8. Deduplication                                                    */
/* ------------------------------------------------------------------ */
section("dedupeEntries");
{
  const existing = [tricky[0]];
  const incoming = [tricky[0], { ...tricky[0], id: 99 }, { ...tricky[1], id: 100 }];
  const unique = dedupeEntries(existing, incoming);
  check("drops exact duplicates", unique.length === 1, `got ${unique.length}`);
  check("keeps genuinely new rows", unique[0]?.amount === 1200);
}

/* ------------------------------------------------------------------ */
/* 9. Ledger — equivalence with the original recursive algorithm       */
/* ------------------------------------------------------------------ */
section("ledger — memoised pass ≡ original recursion");

/** The algorithm the app shipped before the refactor. Kept as an oracle. */
function referenceCarryForward(db: DataState, mKey: string): number {
  const hasData = (key: string) =>
    db.income.some((i) => monthOf(i) === key) || db.expense.some((e) => monthOf(e) === key);
  const ending = (key: string): number =>
    referenceCarryForward(db, key) + sumFor(db.income, key) - sumFor(db.expense, key);
  const prevKey = getPreviousMonthKey(mKey);
  if (!hasData(prevKey)) {
    const older =
      db.income.some((i) => monthOf(i) < mKey) || db.expense.some((e) => monthOf(e) < mKey);
    if (!older) return 0;
  }
  return ending(prevKey);
}

function monthKeyOf(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function randomEntry(monthKey: string, id: number): Entry {
  const categories = ["سفر", "کھانا", "یوٹیلیٹی بل", "دوکان", "عام"];
  return {
    id,
    amount: 1 + Math.floor(Math.random() * 5000),
    detail: "تقریبی",
    category: categories[Math.floor(Math.random() * categories.length)] ?? "عام",
    icon: "fa-receipt",
    monthKey,
    date: "",
    time: "",
    timestamp: id,
  };
}

let seeded = 0x2f6e2b1;
function rand(): number {
  seeded = (seeded * 1664525 + 1013904223) >>> 0;
  return seeded / 0x100000000;
}

let compared = 0;
let mismatches = 0;
for (let trial = 0; trial < 250; trial += 1) {
  const db: DataState = { income: [], expense: [], undoStack: [] };
  const size = 1 + Math.floor(rand() * 40);
  for (let i = 0; i < size; i += 1) {
    const monthKey = monthKeyOf(2024 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 12));
    const entry = randomEntry(monthKey, i + 1);
    if (rand() < 0.5) db.income.push(entry);
    else db.expense.push(entry);
  }
  for (let m = 1; m <= 12; m += 1) {
    for (const y of [2024, 2025, 2026]) {
      const key = monthKeyOf(y, m);
      compared += 1;
      if (getMonthCarryForward(db, key) !== referenceCarryForward(db, key)) mismatches += 1;
    }
  }
  // Spot-check the derived totals too.
  const probe = monthKeyOf(2026, 5);
  const totals = getTotals(db, probe);
  const expectedCarry = referenceCarryForward(db, probe);
  if (totals.carryForward !== expectedCarry) mismatches += 1;
  if (totals.totalIncome !== expectedCarry + sumFor(db.income, probe)) mismatches += 1;
}
check(`carry-forward matches on ${compared}+ probes`, mismatches === 0, `${mismatches} mismatches`);

{
  // Ledger is memoised on the DataState object identity.
  const db: DataState = {
    income: [randomEntry("2026-01", 1)],
    expense: [randomEntry("2026-02", 2)],
    undoStack: [],
  };
  check("buildLedger is memoised on the same object", buildLedger(db) === buildLedger(db));
  const changed: DataState = { ...db, income: [...db.income, randomEntry("2026-03", 3)] };
  check("a new object builds a new ledger", buildLedger(changed) !== buildLedger(db));
  check(
    "new month appears in the new ledger",
    buildLedger(changed).months.has("2026-03"),
  );
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) {
  console.error("\nFailed:");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("✔ صوتی بقیہ logic verified");
