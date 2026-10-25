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
import {
  accountBalances,
  buildDaybook,
  dayRange,
  totalBalance,
} from "../src/lib/daybook";
import {
  balanceLabel,
  emptyPartyBook,
  makeParty,
  makePartyTxn,
  normalizePhone,
  outstandingTotals,
  partyBalance,
  partyBookFromJson,
  partyBookToJson,
  partySummary,
  reminderText,
  whatsappUrl,
  type PartyBook,
  type PartyTxn,
} from "../src/lib/parties";
import { hashPin, validPin } from "../src/lib/staff-lock";
import { clampTtsRate, defaultPrefs, type Budget } from "../src/lib/khata";
import {
  activeBudgetAlerts,
  budgetStatus,
  monthlyCategoryTotals,
  purchaseInsights,
  repeatItems,
} from "../src/lib/insights";
import {
  backupDue,
  defaultBackupState,
  markBackedUp,
  snoozeBackup,
} from "../src/lib/backup-reminder";
import { budgetNoticeText, nextBudgetNotice } from "../src/lib/budget-notices";
import {
  BRAND,
  shareMetaTags,
  sharePreview,
  supportUrl,
  whatsappShareUrl,
} from "../src/lib/brand";
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL_SECONDS,
  finishOnboarding,
  gotoStep,
  loadOnboarding,
  persistOnboarding,
  secondsSpent,
  shouldShowOnboarding,
  skipOnboarding,
  startOnboarding,
} from "../src/lib/onboarding";

import {
  TELEMETRY_LIMIT,
  buildFieldReport,
  clearEvents,
  loadEvents,
  recordEvent,
  sanitiseProps,
  summarise,
} from "../src/lib/telemetry";
import {
  accountTotals,
  buildReport,
  buildXlsx,
  categoryTotals,
  crc32,
  reportHtml,
  sheetXml,
  type ReportCell,
} from "../src/lib/export-report";

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
  // 8 columns since the Account column was added (cash vs bank tracking).
  check("header parses to 8 columns", (parseCsv(csv)[0] ?? []).length === 8);
  check("data rows parse to 8 columns", (parseCsv(csv)[1] ?? []).length === 8);
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
/* 9. Shop: parties, daybook, accounts                                 */
/* ------------------------------------------------------------------ */
section("parties — balances, phones and reminders");
{
  const book = emptyPartyBook();
  const customer = makeParty({ name: "علی", phone: "0300-1234567", kind: "customer" }, 1);
  const supplier = makeParty(
    { name: "حاجی ٹریڈرز", phone: "+92 300 7654321", kind: "supplier" },
    2,
  );
  book.parties.push(customer, supplier);
  check("phone normalised from 03xx", customer.phone === "923001234567", customer.phone);
  check("phone normalised from +92", supplier.phone === "923007654321", supplier.phone);
  check("unusable phone rejected", normalizePhone("12345") === "");
  check("short names normalised", makeParty({ name: "  بلال  ", kind: "customer" }, 3).name === "بلال");

  book.txns.push(
    makePartyTxn(1, { kind: "charge", amount: 5000 }, 10),
    makePartyTxn(1, { kind: "payment", amount: 2000 }, 11),
    makePartyTxn(2, { kind: "charge", amount: 9000 }, 12),
  );
  check("customer balance = charges − payments", partyBalance(book, 1) === 3000);
  check("supplier balance = purchases", partyBalance(book, 2) === 9000);
  const outstanding = outstandingTotals(book);
  check("receivable totals customers", outstanding.receivable === 3000, String(outstanding.receivable));
  check("payable totals suppliers", outstanding.payable === 9000, String(outstanding.payable));
  const summary = partySummary(book, 1);
  check(
    "summary keeps both directions",
    summary.count === 2 && summary.charges === 5000 && summary.payments === 2000,
  );
  check(
    "balance label differs per party kind",
    balanceLabel(3000, "customer") === "باقی (دینا ہے)" &&
      balanceLabel(3000, "supplier") === "واجب الادا",
  );
  const text = reminderText(customer, 3000, "17-10-2026");
  check("reminder names the party and amount", text.includes("علی") && text.includes("3000"));
  const url = whatsappUrl(customer.phone, text);
  check(
    "whatsapp link targets the normalised number",
    url.startsWith("https://wa.me/923001234567?text="),
    url.slice(0, 60),
  );
  check("whatsapp link is escaped", !url.includes("\n") && url.includes("%0A"));
  check(
    "json backup round-trips",
    partyBookFromJson(partyBookToJson(book)).parties.length === book.parties.length,
  );
  let threw = false;
  try {
    partyBookFromJson("{oops");
  } catch {
    threw = true;
  }
  check("broken json is rejected", threw);
}

section("daybook — opening, movements, cash/bank split");
{
  const range = dayRange("2026-10-17");
  const entry = (
    id: number,
    amount: number,
    timestamp: number,
    account: Entry["account"],
  ): Entry => ({
    id,
    amount,
    detail: "تفصیل",
    category: "عام",
    icon: "fa-tag",
    monthKey: "2026-10",
    date: "",
    time: "",
    timestamp,
    account,
  });

  const data: DataState = {
    income: [
      entry(1, 1000, range.start - 86_400_000, "cash"),
      entry(2, 500, range.start + 3_600_000, "bank"),
    ],
    expense: [entry(3, 300, range.start + 7_200_000, "cash")],
    undoStack: [],
  };

  const book: PartyBook = {
    parties: [
      { id: 7, name: "علی", phone: "", kind: "customer", createdAt: 0 },
      { id: 8, name: "سپلائر", phone: "", kind: "supplier", createdAt: 0 },
    ],
    txns: [
      { id: 20, partyId: 7, kind: "payment", amount: 800, note: "", account: "cash", timestamp: range.start + 10_800_000, date: "", time: "" },
      { id: 21, partyId: 8, kind: "payment", amount: 400, note: "", account: "bank", timestamp: range.start + 12_600_000, date: "", time: "" },
    ],
  };

  const day = buildDaybook(data, book, "2026-10-17");
  check("opening cash carries yesterday", day.cashOpening === 1000, String(day.cashOpening));
  check(
    "closing cash = opening + in − out",
    day.cashClosing === 1000 + 800 - 300,
    String(day.cashClosing),
  );
  check("cash inflow counts the customer payment", day.totalIn === 500 + 800, String(day.totalIn));
  check("cash outflow counts the supplier payment", day.totalOut === 300 + 400, String(day.totalOut));
  const bnk = day.accounts.find((a) => a.account === "bank");
  check(
    "bank is tracked separately",
    bnk?.inflow === 500 && bnk?.opening === 0 && bnk?.closing === 100,
  );
  check("the day lists every movement", day.rows.length === 4, String(day.rows.length));

  const creditOnly: PartyBook = {
    parties: book.parties,
    txns: [
      {
        id: 30,
        partyId: 7,
        kind: "charge" as PartyTxn["kind"],
        amount: 5000,
        note: "",
        account: "cash",
        timestamp: range.start + 1000,
        date: "",
        time: "",
      },
    ],
  };
  const creditDay = buildDaybook(
    { income: [], expense: [], undoStack: [] },
    creditOnly,
    "2026-10-17",
  );
  check(
    "credit sale moves no cash that day",
    creditDay.totalIn === 0 && creditDay.totalOut === 0 && creditDay.rows.length === 0,
  );

  const balances = accountBalances(data, book);
  const cash = balances.find((a) => a.account === "cash");
  check(
    "all-time cash balance",
    cash?.balance === 1000 + 800 - 300,
    String(cash?.balance),
  );
  check(
    "account balances sum to the total",
    totalBalance(balances) === 1000 + 500 - 300 + 800 - 400,
    String(totalBalance(balances)),
  );
}

section("csv — the Account column");
{
  const range = dayRange("2026-10-17");
  const data: DataState = {
    income: [
      {
        id: 1,
        amount: 1500,
        detail: "ویٹس ایپ",
        category: "تنخواہ",
        icon: "fa-money-bill-wave",
        monthKey: "2026-10",
        date: "",
        time: "",
        timestamp: range.start,
        account: "bank",
      },
    ],
    expense: [],
    undoStack: [],
  };
  const csv = buildCsv(data);
  check("header ends with Account", csv.split("\n")[0].trim().endsWith("Account"));
  check(
    "account survives the round trip",
    entriesFromCsv(csv).income[0]?.account === "bank",
    String(entriesFromCsv(csv).income[0]?.account),
  );
  const legacy =
    "Month,Type,Category,Date,Time,Amount,Detail\n2026-10,Income,تنخواہ,,,1000,ڈیوٹی\n";
  check("csv without an account column means cash", entriesFromCsv(legacy).income[0]?.account === "cash");
}

section("staff lock — pin rules and hashing");
{
  check("4 to 8 digits accepted", validPin("1234") && validPin("12345678"));
  check("too short or letters rejected", !validPin("123") && !validPin("12ab"));
  const hashA = await hashPin("1234", "a1b2");
  const hashB = await hashPin("1234", "a1b2");
  const hashC = await hashPin("1234", "ffff");
  check("same salt and pin hash alike", hashA === hashB);
  check("a different salt changes the hash", hashA !== hashC);
  check("the hash does not contain the pin", !hashA.includes("1234"));
  check("sha-256 hex length", hashA.length === 64, String(hashA.length));
}

/* ------------------------------------------------------------------ */
/* 10. Phase 3: Roman Urdu, insights, budgets, backups                 */
/* ------------------------------------------------------------------ */
section("parseAmount — Roman Urdu, dialect and fractions");
{
  const cases: [string, number | null][] = [
    ["paanch sau", 500],
    ["paanch sau rupay", 500],
    ["5 hundred", 500],
    ["1.5 hazar", 1500],
    ["1.5 hazaar ka saman", 1500],
    ["dhai hazaar", 2500],
    ["dedh sau", 150],
    ["sadhe teen sau", 350],
    ["2 lakh", 200000],
    ["teen sau pachas", 350],
    ["ek sau", 100],
    ["ik sau panch", 105],
    ["5k", 5000],
    ["do hazaar", 2000],
    ["pachas", 50],
    ["koi amount nahi", null],
    ["500 ka 5 hazaar", 500],
  ];
  for (const [input, expected] of cases) {
    const actual = parseAmount(input);
    check(`parseAmount("${input}")`, actual === expected, `got ${actual}, want ${expected}`);
  }
}

section("detectCategory — Roman Urdu keywords");
{
  check("petrol → سفر", detectCategory("petrol dala").name === "سفر");
  check("chai → کھانا", detectCategory("chai pi").name === "کھانا");
  check("bijli bill → یوٹیلیٹی بل", detectCategory("bijli bill").name === "یوٹیلیٹی بل");
  check("udhar → ادھار کھاتہ", detectCategory("udhar diya").name === "ادھار کھاتہ");
  check("dukan → دوکان", detectCategory("dukan ka samaan").name === "دوکان");
  check(
    "word boundaries protect ordinary words",
    detectCategory("garib aadmi").name === "عام",
    detectCategory("garib aadmi").name,
  );
}

section("budget status — warning at 80%, danger at 100%");
{
  const monthKey = "2026-10";
  const db: DataState = {
    income: [],
    expense: [
      {
        id: 1,
        amount: 9000,
        detail: "راشن",
        category: "دوکان",
        icon: "fa-store",
        monthKey,
        date: "",
        time: "",
        timestamp: 1,
      },
    ],
    undoStack: [],
  };
  const [near] = budgetStatus(db, monthKey, [{ category: "دوکان", limit: 10000 }]);
  check("90% of the limit is a warning", near.level === "warning", near.level);
  check("ratio is computed against the limit", near.ratio === 0.9, String(near.ratio));
  const [over] = budgetStatus(db, monthKey, [{ category: "دوکان", limit: 8000 }]);
  check("spending more than the limit is danger", over.level === "danger", over.level);
  check("remaining goes negative when over", over.remaining === -1000, String(over.remaining));
  const [ok] = budgetStatus(db, monthKey, [{ category: "دوکان", limit: 20000 }]);
  check("well under the limit stays ok", ok.level === "ok", ok.level);
  check(
    "only non-ok statuses are alerted",
    activeBudgetAlerts([near, over, ok]).length === 2,
  );
  check(
    "budgets with zero limit are ignored",
    budgetStatus(db, monthKey, [{ category: "دوکان", limit: 0 }]).length === 0,
  );
}

section("purchase insights — top, rising and fast movers");
{
  const monthKey = "2026-10";
  const previous = "2026-09";
  const makeExpense = (id: number, amount: number, category: string, detail: string, mk: string): Entry => ({
    id,
    amount,
    detail,
    category,
    icon: "fa-receipt",
    monthKey: mk,
    date: "",
    time: "",
    timestamp: id,
  });
  const db: DataState = {
    income: [],
    expense: [
      // two months of fuel with a 100% jump
      makeExpense(1, 1000, "سفر", "پٹرول", previous),
      makeExpense(2, 2500, "سفر", "پٹرول", monthKey),
      // a repeated fast mover in the current month
      makeExpense(3, 200, "کھانا", "چائے", monthKey),
      makeExpense(4, 200, "کھانا", "چائے", monthKey),
      makeExpense(5, 200, "کھانا", "چائے", monthKey),
      // the biggest single category this month
      makeExpense(6, 6000, "دوکان", "راشن", monthKey),
    ],
    undoStack: [],
  };

  const totals = monthlyCategoryTotals(db, monthKey);
  check("monthly totals group by category", totals.get("دوکان") === 6000, String(totals.get("دوکان")));
  check("previous month totals stay separate", monthlyCategoryTotals(db, previous).get("سفر") === 1000);

  const repeats = repeatItems(db, monthKey);
  check("repeat items sorted by frequency", repeats[0]?.label === "چائے" && repeats[0].count === 3, JSON.stringify(repeats[0]));

  const budgets: Budget[] = [{ category: "سفر", limit: 2000 }];
  const insights = purchaseInsights(db, monthKey, budgets, {
    format: (value) => String(Math.round(value)),
  });
  const kinds = insights.map((item) => item.kind);
  check("budget insight comes first", kinds[0] === "budget", kinds.join(","));
  check("top category insight is present", insights.some((i) => i.kind === "top" && i.headline.includes("دوکان")));
  check("rising category insight is present", insights.some((i) => i.kind === "rising" && i.headline.includes("150%")));
  check("fast mover insight is present", insights.some((i) => i.kind === "frequent" && i.headline.includes("چائے")));
  check(
    "empty ledger gives no insights",
    purchaseInsights({ income: [], expense: [], undoStack: [] }, monthKey, []).length === 0,
  );
}

section("budget notices — announced once per threshold");
{
  const monthKey = "2026-10";
  const db: DataState = {
    income: [],
    expense: [
      {
        id: 1,
        amount: 9000,
        detail: "راشن",
        category: "دوکان",
        icon: "fa-store",
        monthKey,
        date: "",
        time: "",
        timestamp: 1,
      },
    ],
    undoStack: [],
  };
  const statuses = budgetStatus(db, monthKey, [{ category: "دوکان", limit: 10000 }]);
  const first = nextBudgetNotice(statuses, monthKey, []);
  check("a fresh threshold is announced", first?.status.level === "warning");
  check("the notice key carries month/category/level", first?.key === `2026-10|دوکان|warning`, first?.key);
  check(
    "the same threshold is not repeated",
    nextBudgetNotice(statuses, monthKey, [first?.key ?? ""]) === null,
  );
  check(
    "crossing the limit speaks a different notice",
    nextBudgetNotice(
      budgetStatus(db, monthKey, [{ category: "دوکان", limit: 8000 }]),
      monthKey,
      [first?.key ?? ""],
    )?.status.level === "danger",
  );
  const text = budgetNoticeText(first!.status, (value) => String(Math.round(value)));
  check("the spoken line reports the percentage", text.includes("90"), text);
  check(
    "a healthy month has nothing to say",
    nextBudgetNotice(budgetStatus(db, monthKey, [{ category: "دوکان", limit: 50000 }]), monthKey, []) === null,
  );
}

section("weekly backup reminder");
{
  const now = Date.UTC(2026, 9, 17);
  const day = 86_400_000;
  const base = defaultBackupState(now);
  check("a fresh install is not nagged", !backupDue(base, now).due);
  check("six days later still quiet", !backupDue(base, now + 6 * day).due);
  const week = backupDue(base, now + 7 * day);
  check("a week later it is due", week.due && week.days === 7, String(week.days));
  const snoozed = snoozeBackup(base, 3, now + 7 * day);
  check("snoozing hides the banner", !backupDue(snoozed, now + 8 * day).due);
  check("and the snooze expires", backupDue(snoozed, now + 11 * day).due);
  const done = markBackedUp(base, now + 9 * day);
  check("a backup resets the clock", !backupDue(done, now + 10 * day).due);
  check("and clears any snooze", done.snoozedUntil === 0);
}

section("voice preferences");
{
  const prefs = defaultPrefs();
  check("voice confirmations are on by default", prefs.ttsEnabled === true);
  check("normal rate by default", prefs.ttsRate === 0.95);
  check("rate is clamped below", clampTtsRate(0.1) === 0.6, String(clampTtsRate(0.1)));
  check("rate is clamped above", clampTtsRate(5) === 1.3, String(clampTtsRate(5)));
  check("junk rate falls back to normal", clampTtsRate("fast") === 0.95);
}

/* ------------------------------------------------------------------ */
/* Phase 4 — brand, tour, telemetry, reports                              */
/* ------------------------------------------------------------------ */

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

section("brand — WhatsApp / Open Graph preview");
{
  const origin = "https://sauti.example";
  const card = sharePreview(origin);
  check("og image is absolute", card.image === `${origin}/og-cover.png`, card.image);
  check("share url ends with a slash", card.url === `${origin}/`, card.url);
  check("title carries the brand", card.title.includes(BRAND.name));
  check("domain is the host only", card.domain === "sauti.example", card.domain);

  const tags = shareMetaTags(origin);
  const byKey = new Map(tags.map((tag) => [tag.key, tag.content]));
  check("og:image is 1200x630 png", byKey.get("og:image")?.endsWith("/og-cover.png") === true);
  check("image dimensions are declared", byKey.get("og:image:width") === "1200" && byKey.get("og:image:height") === "630");
  check("large twitter card", byKey.get("twitter:card") === "summary_large_image");
  check("locale is ur_PK", byKey.get("og:locale") === "ur_PK");

  const bare = sharePreview("");
  check("no origin falls back to a relative image", bare.image === "/og-cover.png", bare.image);

  check(
    "whatsapp share url encodes the text",
    whatsappShareUrl("a b").includes("a%20b"),
  );
  // No support number is configured in the test environment.
  check("unconfigured support opens a generic chat", supportUrl().configured === false);
}

section("onboarding — the 60-second tour");
{
  check(
    "step budgets add up to 60 seconds",
    ONBOARDING_TOTAL_SECONDS === 60,
    String(ONBOARDING_TOTAL_SECONDS),
  );
  const store = memoryStorage();
  const fresh = loadOnboarding(store);
  check("a fresh device shows the tour", shouldShowOnboarding(fresh));
  const started = startOnboarding(fresh, 1_000);
  check("starting records the clock", started.startedAt === 1_000);
  persistOnboarding(started, store);
  check("state round-trips through storage", loadOnboarding(store).startedAt === 1_000);
  check("step clamps above the end", gotoStep(started, 99).step === ONBOARDING_STEPS.length - 1);
  check("step clamps below zero", gotoStep(started, -5).step === 0);
  const done = finishOnboarding(started, 46_000);
  check("finishing hides the tour", done.done === true && !shouldShowOnboarding(done));
  check("seconds spent is reported", secondsSpent(done) === 45, String(secondsSpent(done)));
  check("skipping also ends the tour", skipOnboarding(started, 5_000).done === true);
  check("each step has an icon and copy", ONBOARDING_STEPS.every((s) => s.icon && s.title && s.body));
}



section("telemetry — private, capped, exportable");
{
  const clean = sanitiseProps({
    amount: 500,
    detail: "x".repeat(80),
    "bad key!": "ok",
    note: "a\u0000b",
    flag: true,
    drop: null,
  });
  check("strings are truncated", String(clean.detail).length === 40);
  check("control characters are stripped", clean.note === "ab", String(clean.note));
  check("object values are dropped", clean.drop === undefined);
  check("booleans survive", clean.flag === true);
  check("keys are sanitised", clean["badkey"] === "ok");

  const store = memoryStorage();
  for (let i = 0; i < TELEMETRY_LIMIT + 5; i += 1) {
    recordEvent("entry_voice", { type: "expense" }, { store, now: 1_000 + i });
  }
  const events = loadEvents(store);
  check("buffer is capped", events.length === TELEMETRY_LIMIT, String(events.length));
  check("newest event is last", events[events.length - 1]!.at === 1_000 + TELEMETRY_LIMIT + 4);

  recordEvent("export_pdf", { ok: true }, { store, now: 2_000 });
  const summary = summarise(loadEvents(store));
  check(
    "summary counts by name",
    summary.counts.entry_voice === TELEMETRY_LIMIT - 1 && summary.counts.export_pdf === 1,
    JSON.stringify(summary.counts),
  );
  check("summary reports the window", summary.firstAt !== null && summary.lastAt !== null && summary.lastAt > summary.firstAt!);
  check("summary counts distinct days", summary.activeDays >= 1);

  const field = buildFieldReport({
    events: loadEvents(store),
    version: BRAND.version,
    installId: "ins-test",
    now: 5_000,
  });
  check("field report is self-describing", field.app === "sauti-baqaya" && field.version === BRAND.version);
  check("field report carries the summary", field.summary.total === loadEvents(store).length);
  check("field report serialises", JSON.parse(JSON.stringify(field)).installId === "ins-test");

  clearEvents(store);
  check("clearing removes everything", loadEvents(store).length === 0);
}

section("reports — Excel workbook and printable PDF");
{
  const monthKey = "2026-10";
  const previous = "2026-09";
  const at = Date.UTC(2026, 9, 10, 12);
  const row = (
    id: number,
    amount: number,
    detail: string,
    category: string,
    mKey: string,
    account: "cash" | "bank",
    timestamp: number,
  ): Entry => ({
    id,
    amount,
    detail,
    category,
    icon: "fa-receipt",
    monthKey: mKey,
    date: "۱۰ اکتوبر",
    time: "۱۲:۰۰",
    timestamp,
    account,
  });
  const data: DataState = {
    income: [
      row(1, 5000, "دکان کی فروخت", "عام", monthKey, "cash", at),
      row(2, 2000, "آن لائن آرڈر", "عام", monthKey, "bank", at + 1),
      row(3, 1000, "پرانا کھاتہ", "عام", previous, "cash", at - 86_400_000),
    ],
    expense: [
      row(4, 1500, "پٹرول", "سفر", monthKey, "cash", at + 2),
      row(5, 500, "راشن", "کھانا", monthKey, "bank", at + 3),
    ],
    undoStack: [],
  };

  const model = buildReport({ data, monthKey, owner: "نبیل اسٹور", generatedAt: new Date(at) });
  check("carry forward comes from the previous month", model.totals.carryForward === 1000, String(model.totals.carryForward));
  check("total income includes the carry forward", model.totals.totalIncome === 8000, String(model.totals.totalIncome));
  check("balance is income minus expense", model.totals.balance === 6000, String(model.totals.balance));
  check("category shares are percentages", model.categories[0]?.category === "سفر" && model.categories[0]?.share === 75);
  check("the other category is second", model.categories[1]?.category === "کھانا" && model.categories[1]?.share === 25);

  const accounts = accountTotals(data, monthKey);
  const cash = accounts.find((a) => a.id === "cash");
  check("cash account nets income minus expense", cash?.income === 5000 && cash?.expense === 1500 && cash?.net === 3500);
  check("bank nets income minus expense", accounts.find((a) => a.id === "bank")?.net === 1500);
  check("categories sum to the month expense", categoryTotals(data, monthKey).reduce((sum, c) => sum + c.amount, 0) === 2000);

  check("workbook has three named sheets", model.sheets.map((s) => s.name).join(",") === "خلاصہ,آمدنی,خرچہ");

  const cellAmount = (cell: ReportCell | undefined): number => {
    if (cell === undefined) return 0;
    if (typeof cell === "number") return cell;
    if (typeof cell === "object") return Number(cell.value) || 0;
    return 0;
  };
  const incomeSheet = model.sheets.find((sheet) => sheet.name === "آمدنی")!;
  const incomeTotal = incomeSheet.rows[incomeSheet.rows.length - 1]![5];
  const listedIncome = incomeSheet.rows.slice(1, -1).reduce((sum, row) => sum + cellAmount(row[5]), 0);
  check(
    "income sheet adds up to its total (carry-forward included)",
    listedIncome === 8000 && cellAmount(incomeTotal) === 8000,
    `${listedIncome} vs ${cellAmount(incomeTotal)}`,
  );

  const xml = sheetXml({
    name: "test",
    rows: [['<b>" & x'], [42], [{ value: "header", style: "header" }]],
  });
  check("sheet XML escapes text", xml.includes("&lt;b&gt;") && xml.includes("&amp;"));
  check("numbers stay numeric", xml.includes("<v>42</v>"));
  check("header cells carry a style", xml.includes('s="1"'));
  check("sheets are RTL", xml.includes('rightToLeft="1"'));

  const bytes = buildXlsx(model.sheets, new Date(at));
  check("xlsx starts with a zip header", bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstNameLength = view.getUint16(26, true);
  const firstName = new TextDecoder().decode(bytes.slice(30, 30 + firstNameLength));
  check("first archive entry is [Content_Types].xml", firstName === "[Content_Types].xml", firstName);
  const firstSize = view.getUint32(18, true);
  const firstCrc = view.getUint32(14, true);
  const firstData = bytes.slice(30 + firstNameLength, 30 + firstNameLength + firstSize);
  check("stored CRC matches the payload", crc32(firstData) === firstCrc);
  const end = bytes.length - 22;
  check("end-of-central-directory signature", view.getUint32(end, true) === 0x06054b50);
  check("all eight parts are listed", view.getUint16(end + 10, true) === 8, String(view.getUint16(end + 10, true)));

  const html = reportHtml(model, (value) => String(Math.round(value)));
  check("PDF html is RTL Urdu", html.includes('dir="rtl"') && html.includes("ماہانہ رپورٹ"));
  check("PDF html shows the owner and month", html.includes("نبیل اسٹور") && html.includes("اکتوبر 2026"));
  check("PDF html prints the totals", html.includes("8000") && html.includes("2000"));
  check("PDF html escapes user text", reportHtml(
    buildReport({
      data: { ...data, expense: [{ ...data.expense[0]!, detail: "<script>" }] },
      monthKey,
      generatedAt: new Date(at),
    }),
    String,
  ).includes("&lt;script&gt;"));
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
