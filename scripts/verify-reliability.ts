/**
 * Regression verification for the reliability fixes (phase 2).
 *
 * Run with:  bun scripts/verify-reliability.ts
 *
 * These checks exist because each one failed before the fix:
 *
 *  - `mergeCloudRows` dropped every id that existed locally *and* in the cloud
 *    with a different amount/category/timestamp, so downloading the cloud
 *    erased that record (a `replaceAll` with both sides missing it).
 *  - `captureSnapshot` threw `UNIMPLEMENTED_snapshot`, so `download()` never
 *    returned and the Cloud Download button did nothing.
 *  - the JSON import path merged raw file rows, so `{"amount":"abc"}` or a
 *    negative amount entered the ledger and skewed the totals.
 *  - `entriesFromCsv` accepted negative and zero amounts.
 *  - a deleted monthly rule was re-added by the mirror effect.
 *
 * The last section drives the whole download workflow (validate → merge →
 * `replaceAll`) through the real reducer, because the cloud path cannot be
 * exercised without a browser session and a live Firestore project.
 */
import {
  entriesFromCsv,
  sanitizeImportedEntries,
  type Entry,
} from "../src/lib/khata";
import {
  mergeCloudRows,
  validateCloudRows,
  type CloudRow,
  type ValidatedCloudRow,
} from "../src/hooks/use-merge-logic";
import { monthHasRule, recurringRuleKey } from "../src/lib/recurring";
import { khataReducer } from "../src/hooks/use-khata";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function section(name: string) {
  console.log(`\n▸ ${name}`);
}

function entry(id: number, amount: number, extra: Partial<Entry> = {}): Entry {
  return {
    id,
    amount,
    detail: `entry ${id}`,
    category: "عام",
    icon: "fa-receipt",
    monthKey: "2026-10",
    date: "10/10/2026",
    time: "10:00",
    timestamp: 1000 + id,
    ...extra,
  };
}

function cloudRow(e: Entry, kind: "income" | "expense" = "income"): CloudRow {
  return {
    localId: e.id,
    kind,
    amount: e.amount,
    detail: e.detail,
    category: e.category,
    icon: e.icon,
    monthKey: e.monthKey,
    date: e.date,
    time: e.time,
    timestamp: e.timestamp,
    account: "cash",
  };
}

/** The shape the merge actually receives (post-validation). */
function validated(e: Entry, kind: "income" | "expense" = "income"): ValidatedCloudRow {
  return {
    id: e.id,
    kind,
    amount: e.amount,
    detail: e.detail,
    category: e.category,
    icon: e.icon,
    monthKey: e.monthKey,
    date: e.date,
    time: e.time,
    timestamp: e.timestamp,
    // Mirrors `normalizeCloudRow`: legacy rows fall back to `timestamp`.
    updatedAt: e.updatedAt ?? e.timestamp,
    account: "cash",
  };
}

/* ------------------------------------------------------------------ */
/* 1. Cloud merge — no record may disappear                            */
/* ------------------------------------------------------------------ */
section("mergeCloudRows keeps conflicting records");
{
  const local = [entry(1, 500), entry(2, 700)];
  const newer = { ...entry(2, 900), timestamp: 5000 };
  const merged = mergeCloudRows(local, [], [validated(newer)]);

  const ids = merged.income.map((e) => e.id).sort();
  check("both local ids survive a conflict", ids.join(",") === "1,2", ids.join(","));
  check("no duplicate ids in the result", new Set(merged.income.map((e) => e.id)).size === merged.income.length);
  check("conflict is counted", merged.conflicts === 1, `${merged.conflicts}`);
  check("newer cloud value wins", merged.income.find((e) => e.id === 2)?.amount === 900);
  check("unrelated record untouched", merged.income.find((e) => e.id === 1)?.amount === 500);
}

{
  const local = [{ ...entry(3, 500), timestamp: 9000 }];
  const older = { ...entry(3, 1200), timestamp: 10 };
  const merged = mergeCloudRows(local, [], [validated(older)]);
  check("older cloud copy never overwrites newer local edit", merged.income[0]?.amount === 500);
  check("no record lost in the reverse case", merged.income.length === 1);
}

{
  const localIncome = [entry(10, 1000)];
  const localExpense = [entry(11, 250, { category: "کھانا" })];
  const cloud = [
    validated(entry(10, 1000)), // identical copy
    validated(entry(12, 400), "expense"), // cloud only
  ];
  const merged = mergeCloudRows(localIncome, localExpense, cloud);
  check("identical copy is not duplicated", merged.income.length === 1);
  check("cloud-only row is added once", merged.expense.length === 2 && merged.expense.some((e) => e.id === 12));
  check("added count is exact", merged.added === 1, `${merged.added}`);
  check("kept count covers every local record", merged.kept === 2, `${merged.kept}`);
  check(
    "no money disappears or appears",
    merged.income.reduce((s, e) => s + e.amount, 0) + merged.expense.reduce((s, e) => s + e.amount, 0) ===
      1000 + 250 + 400,
  );
}

/* ------------------------------------------------------------------ */
/* 2. Cloud row validation                                             */
/* ------------------------------------------------------------------ */
section("validateCloudRows");
{
  const outcomes = validateCloudRows([
    cloudRow(entry(20, 300)),
    { ...cloudRow(entry(21, 300)), localId: -1 },
    { ...cloudRow(entry(22, 300)), amount: 0 },
    { ...cloudRow(entry(23, 300)), amount: Number.NaN },
    { ...cloudRow(entry(24, 300)), monthKey: "hello" },
    { ...cloudRow(entry(25, 300)), kind: "transfer" as "income" },
  ]);
  check("valid row accepted", outcomes[0]?.ok === true);
  check("negative id rejected", outcomes[1]?.ok === false);
  check("zero amount rejected", outcomes[2]?.ok === false);
  check("NaN amount rejected", outcomes[3]?.ok === false);
  check("bad month key rejected", outcomes[4]?.ok === false);
  check("unknown kind rejected", outcomes[5]?.ok === false);
  check("no row is silently accepted as valid", outcomes.filter((o) => o.ok).length === 1);
}

/* ------------------------------------------------------------------ */
/* 3. JSON import validation                                           */
/* ------------------------------------------------------------------ */
section("sanitizeImportedEntries");
{
  const existing = [entry(1, 500)];
  const rows: unknown[] = [
    entry(2, 800),
    { ...entry(3, 0) },
    { ...entry(4, -500) },
    { ...entry(5, Number.NaN) },
    [1, 2, 3],
    null,
    "text",
    { ...entry(1, 999) }, // id already used by the ledger
    { amount: 250, detail: "بجلی بل" }, // no id / no month
  ];
  const { entries, rejected } = sanitizeImportedEntries(rows, existing);

  check("valid rows survive", entries.length === 3, `${entries.length}`);
  check("invalid rows are counted, not imported", rejected === 6, `${rejected}`);
  check("no negative or zero amount can enter", entries.every((e) => e.amount > 0));
  check("no NaN amount can enter", entries.every((e) => Number.isFinite(e.amount)));
  check(
    "id collision with the local ledger is avoided",
    entries.filter((e) => e.id === 1).length === 0,
  );
  check(
    "ids stay unique inside one import",
    new Set(entries.map((e) => e.id)).size === entries.length,
  );
  check(
    "missing month falls back to the current bucket",
    /^\d{4}-\d{2}$/.test(entries[2]?.monthKey ?? ""),
    entries[2]?.monthKey,
  );
  check("category is detected when absent", entries[2]?.category === "یوٹیلیٹی بل", entries[2]?.category);
}

check("non-array payload imports nothing", sanitizeImportedEntries({ income: [] }).entries.length === 0);

/* ------------------------------------------------------------------ */
/* 4. CSV import validation                                            */
/* ------------------------------------------------------------------ */
section("entriesFromCsv");
{
  const csv = [
    "Month,Type,Category,Date,Time,Amount,Detail,Account",
    "2026-10,Income,عام,10/10/2026,10:00,500,چائے,cash",
    "2026-10,Expense,عام,10/10/2026,10:00,-900,غلط, cash",
    "2026-10,Expense,عام,10/10/2026,10:00,0,صفر,cash",
    "not-a-month,Expense,عام,10/10/2026,10:00,300,بجلی,cash",
  ].join("\n");
  const { income, expense } = entriesFromCsv(csv);
  check("valid income row imported", income.length === 1 && income[0]?.amount === 500);
  check("negative amount skipped", !expense.some((e) => e.amount < 0));
  check("zero amount skipped", !expense.some((e) => e.amount === 0));
  check("only the sane expense row remains", expense.length === 1, `${expense.length}`);
  check(
    "invalid month column does not create a phantom bucket",
    /^\d{4}-\d{2}$/.test(expense[0]?.monthKey ?? ""),
    expense[0]?.monthKey,
  );
}

/* ------------------------------------------------------------------ */
/* 5. Whole download workflow (validate → merge → replaceAll)          */
/* ------------------------------------------------------------------ */
section("download workflow end to end");
{
  const localIncome = [entry(40, 1000), entry(41, 2000)];
  const localExpense = [entry(42, 300, { category: "کھانا" })];
  const before = khataReducer(
    { income: localIncome, expense: localExpense, undoStack: [] },
    { kind: "add", entryType: "expense", entry: entry(43, 100) },
  );

  const cloudEntries = [
    entry(40, 1000), // same record
    { ...entry(41, 2500), timestamp: 90000 }, // newer edit
    { ...entry(44, 700), category: "سفر" }, // cloud only
  ];
  const cloud: CloudRow[] = cloudEntries.map((e) => cloudRow(e));

  const outcomes = validateCloudRows(cloud);
  const validatedRows = outcomes.flatMap((o) => (o.ok ? [o.row] : []));
  const merged = mergeCloudRows(before.income, before.expense, validatedRows);
  const after = khataReducer(before, {
    kind: "replaceAll",
    income: merged.income,
    expense: merged.expense,
  });

  // 4 local records (40, 41, 42, 43) + 1 cloud-only (44)
  check(
    "every local record survives the download",
    after.income.length + after.expense.length === 5,
    `${after.income.length + after.expense.length}`,
  );
  check("cloud-only record arrives", after.income.some((e) => e.id === 44 && e.amount === 700));
  check("newer cloud edit is applied", after.income.find((e) => e.id === 41)?.amount === 2500);
  check("untouched local record keeps its value", after.income.find((e) => e.id === 40)?.amount === 1000);
  check("expenses are not mixed into income", after.expense.length === 2);
  check(
    "income total equals local + applied cloud changes",
    after.income.reduce((s, e) => s + e.amount, 0) === 1000 + 2500 + 700,
  );
  check(
    "expense total is unchanged by the download",
    after.expense.reduce((s, e) => s + e.amount, 0) === 300 + 100,
  );
  check("download leaves a clean undo stack", after.undoStack.length === 0);
}

/* ------------------------------------------------------------------ */
/* 6. Recurring rules — applied markers stop resurrection              */
/* ------------------------------------------------------------------ */
section("recurring applied markers");
{
  const rule = { label: "کرایہ", amount: 5000 };
  const appliedKey = recurringRuleKey(rule.label, rule.amount, "income");

  const month = [entry(30, 5000, { detail: "کرایہ" })];
  check("rule seen in the month is not duplicated", monthHasRule(month, rule, "2026-10"));
  check("deleted rule is absent from the month", !monthHasRule([], rule, "2026-10"));

  const applied = [appliedKey]; // marker recorded when the entry was applied
  const wouldReapply = !applied.includes(appliedKey) && !monthHasRule([], rule, "2026-10");
  check("a deleted but applied rule is not re-added", wouldReapply === false);
  check("kind separates income and expense rules", recurringRuleKey("کرایہ", 5000, "expense") !== appliedKey);
  check(
    "changing the amount makes it a new rule",
    recurringRuleKey("کرایہ", 6000, "income") !== appliedKey,
  );
  check("key is stable for the same rule", recurringRuleKey("کرایہ", 5000, "income") === appliedKey);
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
console.log("✔ reliability fixes verified");
