/**
 * Multi-device cloud-sync safety verification (stage 3).
 *
 * Run with:  bun scripts/verify-sync-safety.ts
 *
 * What is really being tested: `planUpload` (what an upload may write),
 * `mergeCloudRows`/`validateCloudRows` (what a download may apply) and the
 * `khataReducer` path that installs the merged ledger. Those three functions
 * are the whole decision surface of sync; the hooks around them only call
 * Firestore. Two devices are simulated by two record lists plus one shared
 * "cloud" map, and every scenario from the stage-3 checklist is reproduced.
 *
 * NOT tested here: live Firestore, security rules evaluation, real network
 * failures. Those need the Firebase emulator or a live project and are listed
 * as untested in the report.
 */
import { readFileSync } from "node:fs";
import { khataReducer } from "../src/hooks/use-khata";
import {
  effectiveUpdatedAt,
  mergeCloudRows,
  planUpload,
  validateCloudRows,
  type CloudRow,
  type ValidatedCloudRow,
} from "../src/hooks/use-merge-logic";
import { canUseCloud, clearDeletedIds, clearPreDownloadBackup, loadDeletedIds, loadPreDownloadBackup, MAX_TRACKED_DELETIONS, rememberDeletedIds, savePreDownloadBackup } from "../src/lib/sync-safety";
import {
  buildTombstoneDocument,
  enqueuePendingDeletion,
  loadPendingDeletions,
  MAX_PENDING_DELETIONS,
  savePendingDeletions,
  syncPendingDeletions,
  type PendingDeletion,
} from "../src/lib/deletion-sync";
import {
  classifyPartyDoc,
  comparePartyWrite,
  decidePartySnapshot,
  deletedPartyIds,
  dropStalePartyUpserts,
  enqueuePartyOps,
  flushPendingPartyOps,
  loadDeadPartyOps,
  loadPendingPartyOps,
  loadTombstonedPartyIds,
  MAX_DEAD_PARTY_OPS,
  MAX_PARTY_OP_ATTEMPTS,
  MAX_PENDING_PARTY_OPS,
  PARTY_CLOCK_SKEW_MS,
  partiesMarkedDeletedInBackup,
  partyDeleteOp,
  partyDocVersion,
  partyFromCloudDoc,
  partyOpKey,
  partyTombstoneDocument,
  partyTxnDeleteOp,
  partyTxnForCloud,
  partyTxnUpsertOp,
  partyUpsertOp,
  pendingPartyOpsById,
  rememberTombstonedPartyIds,
  retirePendingPartyOps,
  savePendingPartyOps,
  splitImportableParties,
  type PendingPartyOp,
} from "../src/lib/party-sync";
import { makeParty, makePartyTxn, type Party } from "../src/lib/parties";
import type { Entry, EntryType } from "../src/lib/khata";

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

/** Bun has no `window`/`localStorage`; this is the browser store stand-in. */
type StorageShim = { store: Map<string, string> };
let shim: StorageShim | null = null;

function installStorage(): StorageShim {
  if (shim) return shim;
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  const scope = globalThis as Record<string, unknown>;
  scope.window = globalThis;
  scope.localStorage = fake;
  shim = { store };
  return shim;
}

const NOW = Date.now();

type Device = {
  name: string;
  income: Entry[];
  expense: Entry[];
  /** Ids deleted on this device; the cloud copy is kept (no cloud deletion). */
  deleted: number[];
};

function makeDevice(name: string): Device {
  return { name, income: [], expense: [], deleted: [] };
}

function entry(
  id: number,
  amount: number,
  updatedAt: number,
  extra: Partial<Entry> = {},
): Entry {
  return {
    id,
    amount,
    detail: `record ${id}`,
    category: "عام",
    icon: "fa-receipt",
    monthKey: "2026-10",
    date: "10/10/2026",
    time: "10:00",
    timestamp: updatedAt,
    updatedAt,
    account: "cash",
    ...extra,
  };
}

function list(device: Device, kind: EntryType): Entry[] {
  return kind === "income" ? device.income : device.expense;
}

function add(
  device: Device,
  kind: EntryType,
  id: number,
  amount: number,
  updatedAt = NOW,
): Entry {
  const record = entry(id, amount, updatedAt);
  if (kind === "income") device.income.push(record);
  else device.expense.push(record);
  return record;
}

function edit(device: Device, kind: EntryType, id: number, amount: number, updatedAt: number) {
  const target = list(device, kind).find((e) => e.id === id);
  if (!target) throw new Error(`edit: ${id} not on ${device.name}`);
  target.amount = amount;
  target.updatedAt = updatedAt;
}

function remove(device: Device, kind: EntryType, id: number) {
  if (kind === "income") device.income = device.income.filter((e) => e.id !== id);
  else device.expense = device.expense.filter((e) => e.id !== id);
  device.deleted.push(id);
}

function toRow(record: Entry, kind: EntryType): CloudRow {
  return {
    localId: record.id,
    kind,
    amount: record.amount,
    detail: record.detail,
    category: record.category,
    icon: record.icon,
    monthKey: record.monthKey,
    date: record.date,
    time: record.time,
    timestamp: record.timestamp,
    updatedAt: record.updatedAt ?? record.timestamp,
    account: record.account ?? "cash",
  };
}

/** Cloud rows → the validated shape the merge consumes. */
function asValidated(rows: CloudRow[]): ValidatedCloudRow[] {
  return validateCloudRows(rows)
    .filter((outcome): outcome is { ok: true; row: ValidatedCloudRow } => outcome.ok)
    .map((outcome) => outcome.row);
}

function localRows(device: Device): CloudRow[] {
  return [
    ...device.income.map((e) => toRow(e, "income")),
    ...device.expense.map((e) => toRow(e, "expense")),
  ];
}

type Cloud = Map<number, CloudRow>;

/** Simulated upload: exactly what `useSync.upload` does, minus the network. */
function upload(device: Device, cloud: Cloud, failAfter?: number) {
  const plan = planUpload(localRows(device), [...cloud.values()], NOW);
  let written = 0;
  for (const row of plan.writes) {
    if (failAfter !== undefined && written >= failAfter) {
      return { ok: false as const, written, plan };
    }
    cloud.set(row.localId, row);
    written += 1;
  }
  return { ok: true as const, written, plan };
}

/** Simulated download: validate → merge → install via the real reducer. */
function download(device: Device, cloud: Cloud) {
  const outcomes = validateCloudRows([...cloud.values()]);
  const invalid = outcomes.filter((o) => !o.ok).length;
  if (invalid > 0) {
    return { ok: false as const, invalid, device };
  }
  const rows: ValidatedCloudRow[] = outcomes.flatMap((o) => (o.ok ? [o.row] : []));
  const merged = mergeCloudRows(device.income, device.expense, rows, device.deleted);
  const next = khataReducer(
    { income: device.income, expense: device.expense, undoStack: [] },
    { kind: "replaceAll", income: merged.income, expense: merged.expense },
  );
  device.income = next.income;
  device.expense = next.expense;
  return { ok: true as const, merge: merged, device };
}

function total(device: Device, kind: EntryType): number {
  return list(device, kind).reduce((sum, e) => sum + e.amount, 0);
}

function ids(records: Entry[]): string {
  return records.map((e) => e.id).sort((a, b) => a - b).join(",");
}

/* ------------------------------------------------------------------ */
/* 1. A single record reaches the cloud                                */
/* ------------------------------------------------------------------ */
section("device A adds a record");
{
  const a = makeDevice("A");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000);

  const result = upload(a, cloud);
  check("upload writes the new record", result.ok && result.written === 1, `${result.written}`);
  check("cloud holds it", cloud.size === 1 && cloud.get(101)?.amount === 5000);
}

/* ------------------------------------------------------------------ */
/* 2. Two devices, different records — nothing is lost                 */
/* ------------------------------------------------------------------ */
section("device B adds a different record");
{
  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();

  add(a, "income", 101, 5000, NOW - 30_000);
  add(a, "expense", 201, 1000, NOW - 29_000);
  upload(a, cloud);

  add(b, "income", 102, 3000, NOW);
  add(b, "expense", 202, 500, NOW);
  const result = upload(b, cloud);

  check("B does not delete A's documents", cloud.size === 4, `${cloud.size}`);
  check("B only writes its own new rows", result.written === 2, `${result.written}`);

  download(a, cloud);
  download(b, cloud);
  check("A sees all four records", a.income.length === 2 && a.expense.length === 2);
  check(
    "income totals match on A",
    total(a, "income") === 8000,
    `${total(a, "income")}`,
  );
  check(
    "expense totals match on A",
    total(a, "expense") === 1500,
    `${total(a, "expense")}`,
  );
  check("B totals match", total(b, "income") === 8000 && total(b, "expense") === 1500);
  check("both devices ended up with the same ids", ids(a.income) === ids(b.income));
}

/* ------------------------------------------------------------------ */
/* 3. Upload order does not matter                                     */
/* ------------------------------------------------------------------ */
section("upload order: B first, then A");
{
  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 30_000);
  add(b, "income", 102, 3000, NOW);

  upload(b, cloud);
  upload(a, cloud);
  download(a, cloud);
  download(b, cloud);

  check("cloud keeps both records", cloud.size === 2);
  check("A keeps both records", ids(a.income) === "101,102", ids(a.income));
  check("B keeps both records", ids(b.income) === "101,102", ids(b.income));
  check("income total is 8000", total(a, "income") === 8000);
}

/* ------------------------------------------------------------------ */
/* 4. Simultaneous uploads                                             */
/* ------------------------------------------------------------------ */
section("two devices upload at the same moment");
{
  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 1);
  add(b, "income", 102, 3000, NOW - 1);

  // Both read the same (empty) cloud state before either write lands.
  const planA = planUpload(localRows(a), [...cloud.values()], NOW);
  const planB = planUpload(localRows(b), [...cloud.values()], NOW);
  for (const row of [...planA.writes, ...planB.writes]) cloud.set(row.localId, row);

  check("no unique record is lost", cloud.size === 2, `${cloud.size}`);
  download(a, cloud);
  download(b, cloud);
  check("both devices converge", ids(a.income) === "101,102" && ids(b.income) === "101,102");
  check("income total is 8000 on both", total(a, "income") === 8000 && total(b, "income") === 8000);
}

/* ------------------------------------------------------------------ */
/* 5. Same upload twice → idempotent                                   */
/* ------------------------------------------------------------------ */
section("the same upload runs twice");
{
  const a = makeDevice("A");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 10_000);
  add(a, "expense", 201, 700, NOW - 10_000);

  upload(a, cloud);
  const second = upload(a, cloud);

  check("second run writes nothing", second.written === 0, `${second.written}`);
  check("second run reports both rows as already in sync", second.plan.unchanged === 2);
  check("cloud still has exactly two documents", cloud.size === 2);
  check("no duplicate ids", ids(a.income) === "101");
}

/* ------------------------------------------------------------------ */
/* 6. Offline device                                                   */
/* ------------------------------------------------------------------ */
section("a device stays offline");
{
  const a = makeDevice("A");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 60_000);
  upload(a, cloud);

  add(a, "income", 102, 3000, NOW);
  add(a, "expense", 201, 500, NOW);
  // Offline: no upload call at all.
  check("offline records stay on the device", a.income.length === 2 && a.expense.length === 1);
  check("nothing reached the cloud while offline", cloud.size === 1);

  const resumed = upload(a, cloud);
  check("reconnect uploads only the new rows", resumed.written === 2, `${resumed.written}`);
  check("cloud is complete after reconnect", cloud.size === 3);
}

/* ------------------------------------------------------------------ */
/* 7. Deletion must not delete cloud data                              */
/* ------------------------------------------------------------------ */
section("a device deletes a record");
{
  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 50_000);
  add(a, "income", 102, 3000, NOW - 50_000);
  upload(a, cloud);
  download(b, cloud);

  remove(a, "income", 102);
  const result = upload(a, cloud);

  check("upload does not delete the cloud document", cloud.has(102));
  check("cloud document count is unchanged", cloud.size === 2, `${cloud.size}`);
  check("the absent record is reported, not silently dropped", result.plan.cloudOnly === 1);
  check("device A really removed it locally", a.income.every((e) => e.id !== 102));

  // The other device must keep its copy: it may still be needed there.
  download(b, cloud);
  check("device B keeps the record", b.income.some((e) => e.id === 102));

  // ...but device A must not resurrect its own deletion.
  download(a, cloud);
  check("device A does not resurrect the deleted record", a.income.every((e) => e.id !== 102), ids(a.income));
  check("device A keeps the untouched record", a.income.some((e) => e.id === 101));
}

/* ------------------------------------------------------------------ */
/* 8. Unrelated device uploads after a deletion                        */
/* ------------------------------------------------------------------ */
section("an unrelated device uploads after a deletion");
{
  const a = makeDevice("A");
  const c = makeDevice("C");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 90_000);
  add(a, "income", 102, 3000, NOW - 90_000);
  upload(a, cloud);
  remove(a, "income", 102);
  upload(a, cloud);

  add(c, "income", 103, 900, NOW - 10_000);
  upload(c, cloud);

  check("deleted record is not recreated", cloud.has(102));
  check("unrelated record is not deleted", cloud.has(101) && cloud.has(103));
  check("cloud has all three documents", cloud.size === 3, `${cloud.size}`);
}

/* ------------------------------------------------------------------ */
/* 9. Same id, two edits                                               */
/* ------------------------------------------------------------------ */
section("same id, two different versions");
{
  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 100_000);
  upload(a, cloud);
  download(b, cloud);

  // B edits later than A.
  edit(b, "income", 101, 7000, NOW - 10_000);
  upload(b, cloud);

  // A still holds the old value and uploads again.
  const staleResult = upload(a, cloud);
  check("stale upload does not overwrite the newer cloud value", cloud.get(101)?.amount === 7000);
  check("the skip is reported", staleResult.plan.cloudNewer === 1);

  download(a, cloud);
  check("A picks up the newer value", a.income.find((e) => e.id === 101)?.amount === 7000);
  check("the record still exists exactly once", a.income.filter((e) => e.id === 101).length === 1);
}

/* ------------------------------------------------------------------ */
/* 10. Incorrect device clock                                          */
/* ------------------------------------------------------------------ */
section("a device clock is wrong");
{
  const skewed = NOW + 7 * 24 * 60 * 60 * 1000;
  check("skewed edit time is neutralised", effectiveUpdatedAt(skewed, NOW) === 0);

  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 1000);
  upload(a, cloud);
  download(b, cloud);

  edit(b, "income", 101, 8000, NOW - 500);
  upload(b, cloud);

  // A's clock jumps a week ahead; its content is older.
  a.income[0].amount = 1000;
  a.income[0].updatedAt = skewed;
  upload(a, cloud);

  check("future clock cannot overwrite cloud data", cloud.get(101)?.amount === 8000, `${cloud.get(101)?.amount}`);
  download(a, cloud);
  check("the correct value reaches the wrong-clock device", a.income[0].amount === 8000);
}

/* ------------------------------------------------------------------ */
/* 11. Malformed cloud payload                                         */
/* ------------------------------------------------------------------ */
section("cloud payload is malformed");
{
  const a = makeDevice("A");
  add(a, "income", 101, 5000, NOW - 1000);
  add(a, "expense", 201, 700, NOW - 1000);

  const badCloud: Cloud = new Map([
    [101, toRow(a.income[0], "income")],
    [999, { ...toRow(entry(999, 5, NOW), "income"), amount: Number.NaN }],
  ]);
  const before = { income: total(a, "income"), expense: total(a, "expense") };
  const result = download(a, badCloud);

  check("download is refused", result.ok === false);
  check("local ledger is untouched", total(a, "income") === before.income && total(a, "expense") === before.expense);
  check("no partial restore happened", a.income.length === 1 && a.expense.length === 1);
}

/* ------------------------------------------------------------------ */
/* 12. Partial batch failure + retry                                   */
/* ------------------------------------------------------------------ */
section("upload fails halfway through");
{
  const a = makeDevice("A");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 5000);
  add(a, "income", 102, 3000, NOW - 5000);
  add(a, "income", 103, 2000, NOW - 5000);

  const failed = upload(a, cloud, 1);
  check("failure is reported", failed.ok === false);
  check("the written part is accounted for", failed.written === 1, `${failed.written}`);
  check("local records are still all present", a.income.length === 3);

  const retry = upload(a, cloud);
  check("retry completes the upload", retry.written === 2, `${retry.written}`);
  check("cloud ends with exactly three records", cloud.size === 3);
  check("no duplicates after retry", new Set([...cloud.keys()]).size === 3);
}

/* ------------------------------------------------------------------ */
/* 13. Identity mismatch                                                */
/* ------------------------------------------------------------------ */
section("authenticated uid differs from the app user");
{
  check("matching uid is allowed", canUseCloud({ isAuthenticated: true, sessionUid: "u1", userUid: "u1" }));
  check("different uid is rejected", !canUseCloud({ isAuthenticated: true, sessionUid: "u1", userUid: "u2" }));
  check("missing session is rejected", !canUseCloud({ isAuthenticated: true, sessionUid: null, userUid: "u1" }));
  check("signed-out state is rejected", !canUseCloud({ isAuthenticated: false, sessionUid: "u1", userUid: "u1" }));
  check("empty uid is rejected", !canUseCloud({ isAuthenticated: true, sessionUid: "", userUid: "" }));
}

/* ------------------------------------------------------------------ */
/* 14. Old device reconnects                                           */
/* ------------------------------------------------------------------ */
section("an old device reconnects after new cloud data");
{
  const old = makeDevice("old");
  const fresh = makeDevice("fresh");
  const cloud: Cloud = new Map();
  add(old, "income", 101, 5000, NOW - 200_000);
  upload(old, cloud);

  add(fresh, "income", 102, 3000, NOW - 1000);
  add(fresh, "expense", 201, 500, NOW - 1000);
  upload(fresh, cloud);

  upload(old, cloud);
  check("old device did not erase newer cloud records", cloud.size === 3, `${cloud.size}`);
  check("newer records are still intact", cloud.get(102)?.amount === 3000 && cloud.get(201)?.amount === 500);

  download(old, cloud);
  check("old device received everything", old.income.length === 2 && old.expense.length === 1);
  check("old device income total is 8000", total(old, "income") === 8000, `${total(old, "income")}`);
}

/* ------------------------------------------------------------------ */
/* 14b. Repeating the download never duplicates records                */
/* ------------------------------------------------------------------ */
section("download runs twice");
{
  const a = makeDevice("A");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 5000, NOW - 1000);
  upload(a, cloud);

  const first = download(a, cloud);
  const afterFirst = ids(a.income);
  const second = download(a, cloud);

  check("first download keeps the record once", afterFirst === "101", afterFirst);
  check("first download adds nothing new", first.ok && first.merge.added === 0);
  check("second download still has one copy", ids(a.income) === "101", ids(a.income));
  check("second download reports no conflicts", second.ok && second.merge.conflicts === 0);
  check("totals are not doubled", total(a, "income") === 5000, `${total(a, "income")}`);
}

/* ------------------------------------------------------------------ */
/* 15. Duplicate cloud rows in one payload                             */
/* ------------------------------------------------------------------ */
section("cloud payload repeats a row");
{
  const row = toRow(entry(101, 5000, NOW - 1000), "income");
  const outcomes = validateCloudRows([row, row]);
  const rows = outcomes.flatMap((o) => (o.ok ? [o.row] : []));
  const merged = mergeCloudRows([], [], rows);

  check("repeated row is applied once", merged.income.length === 1, `${merged.income.length}`);
  check("money is not double counted", merged.income[0].amount === 5000);
}

/* ------------------------------------------------------------------ */
/* 16. Financial totals stay consistent                                */
/* ------------------------------------------------------------------ */
section("financial totals after a full round trip");
{
  const a = makeDevice("A");
  const b = makeDevice("B");
  const cloud: Cloud = new Map();
  add(a, "income", 101, 10_000, NOW - 50_000);
  add(a, "expense", 201, 2500, NOW - 50_000);
  upload(a, cloud);
  download(b, cloud);
  add(b, "income", 102, 4000, NOW - 10_000);
  add(b, "expense", 202, 1500, NOW - 10_000);
  upload(b, cloud);
  download(a, cloud);
  download(b, cloud);

  const income = total(a, "income");
  const expense = total(a, "expense");
  check("income totals equal on both devices", income === total(b, "income"), `${income}/${total(b, "income")}`);
  check("expense totals equal on both devices", expense === total(b, "expense"));
  check("income is 14000", income === 14_000, `${income}`);
  check("expense is 4000", expense === 4000, `${expense}`);
  check("net balance is 10000", income - expense === 10_000);
  check("income and expense were not mixed", a.income.every((e) => e.amount === 10_000 || e.amount === 4000));
}

/* ------------------------------------------------------------------ */
/* 17. Different records are never merged by similarity                */
/* ------------------------------------------------------------------ */
section("similar amounts do not merge records");
{
  const a = makeDevice("A");
  add(a, "income", 101, 5000, NOW - 1000);
  add(a, "income", 102, 5000, NOW - 1000);
  const row = toRow(entry(101, 5000, NOW - 1000), "income");
  const merged = mergeCloudRows(a.income, a.expense, [{ ...row, id: 101, updatedAt: NOW }]);

  check("both local records survive", merged.income.length === 2, `${merged.income.length}`);
  check("ids stay distinct", ids(merged.income) === "101,102");
  check("only the matching id is reconciled", merged.income.filter((e) => e.amount === 5000).length === 2);
}

/* ------------------------------------------------------------------ */
/* 18. Deletion markers are durable (stage 4: restart, cap, corruption) */
/* ------------------------------------------------------------------ */
section("deletion markers survive a restart and are stored safely");
{
  /* Bun has no `window`/`localStorage`, so this is a faithful stand-in for the
     browser store the markers really live in. The module keeps no state of its
     own — every read goes back to storage — which is exactly what "survives an
     app restart" has to mean. */
  const store = new Map<string, string>();
  const fake = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  const scope = globalThis as Record<string, unknown>;
  scope.window = globalThis;
  scope.localStorage = fake;

  clearDeletedIds();
  rememberDeletedIds([101, 102]);
  check("markers are recorded", loadDeletedIds().join(",") === "101,102", loadDeletedIds().join(","));
  rememberDeletedIds([102, 103]);
  check("repeating a deletion event is idempotent", loadDeletedIds().join(",") === "101,102,103", loadDeletedIds().join(","));
  rememberDeletedIds([Number.NaN, Infinity]);
  check(
    "non-finite ids are ignored",
    loadDeletedIds().join(",") === "101,102,103",
    loadDeletedIds().join(","),
  );
  check(
    "markers are re-read from storage (nothing kept only in memory)",
    loadDeletedIds().length === 3 && store.has("sauti_deleted_ids"),
    `${loadDeletedIds().length}`,
  );

  rememberDeletedIds(Array.from({ length: 1500 }, (_, index) => 10_000 + index));
  const stored = loadDeletedIds();
  check(
    "the marker list is bounded by MAX_TRACKED_DELETIONS",
    stored.length === MAX_TRACKED_DELETIONS,
    `${stored.length}`,
  );
  check(
    "KNOWN LIMIT: past the cap the oldest markers are dropped (resurrection risk)",
    stored[0] === 10_000 + (1500 - MAX_TRACKED_DELETIONS) &&
      stored[stored.length - 1] === 11_499,
    `first=${stored[0]} last=${stored[stored.length - 1]}`,
  );

  globalThis.localStorage.setItem("sauti_deleted_ids", "{corrupt");
  const degraded = loadDeletedIds();
  check(
    "corrupt storage degrades to an empty list instead of throwing",
    Array.isArray(degraded) && degraded.length === 0,
    `${degraded.length}`,
  );

  clearDeletedIds();
  check("clearing the markers works", loadDeletedIds().length === 0);

  const saved = savePreDownloadBackup<Entry>([{ ...entry(1, 100, NOW) }], [
    { ...entry(2, 50, NOW) },
  ]);
  const backup = loadPreDownloadBackup<Entry>();
  check(
    "pre-download rollback copy round-trips through storage",
    saved && backup !== null && backup.income.length === 1 && backup.expense.length === 1,
    backup === null ? "no backup" : `${backup.income.length}/${backup.expense.length}`,
  );
  clearPreDownloadBackup();
  check("rollback copy can be cleared", loadPreDownloadBackup<Entry>() === null);
}

/* ------------------------------------------------------------------ */
/* 19. Tombstones in the download path (stage 4A)                      */
/* ------------------------------------------------------------------ */
section("tombstones are validated and never become active records");
{
  const legacy = toRow(entry(301, 900, NOW - 20_000), "income");
  const legacyOutcome = validateCloudRows([legacy])[0];
  check(
    "a record without any tombstone field is still valid (no migration)",
    legacyOutcome.ok && legacyOutcome.row.deleted === false,
    legacyOutcome.ok ? "" : legacyOutcome.reason,
  );

  const badFlag = validateCloudRows([{ ...legacy, deleted: "yes" } as unknown as CloudRow])[0];
  check("a non-boolean `deleted` is rejected", !badFlag.ok);

  const noDeletedAt = validateCloudRows([{ ...legacy, deleted: true }])[0];
  check("`deleted: true` without deletedAt is rejected", !noDeletedAt.ok);

  const badDeletedAt = validateCloudRows([
    { ...legacy, deleted: true, deletedAt: "now" } as unknown as CloudRow,
  ])[0];
  check("a non-numeric deletedAt is rejected", !badDeletedAt.ok);

  const longEvent = validateCloudRows([
    { ...legacy, deleted: true, deletedAt: NOW, deletedEventId: "x".repeat(129) },
  ])[0];
  check("an oversized deletedEventId is rejected", !longEvent.ok);

  const tombstone: CloudRow = {
    ...toRow(entry(301, 900, NOW - 20_000), "income"),
    deleted: true,
    deletedAt: NOW,
    deletedEventId: `${NOW}-301`,
    deletedVersion: NOW - 20_000,
    deletedBy: "d-test",
  };
  const goodOutcome = validateCloudRows([tombstone])[0];
  check(
    "a well-formed tombstone is valid and flagged as deleted",
    goodOutcome.ok && goodOutcome.row.deleted === true && goodOutcome.row.deletedAt === NOW,
    goodOutcome.ok ? "" : goodOutcome.reason,
  );

  const localIncome = [entry(301, 900, NOW - 20_000), entry(302, 400, NOW - 30_000)];
  const merged = mergeCloudRows(localIncome, [], asValidated([tombstone]));
  check(
    "a cloud tombstone removes the local copy of that record",
    !merged.income.some((item) => item.id === 301) && merged.tombstoned === 1,
    `tombstoned=${merged.tombstoned}`,
  );
  check("the tombstone id is reported so it can be remembered locally", merged.tombstoneIds.join(",") === "301");
  check("unrelated local records are preserved", merged.income.length === 1 && merged.income[0].id === 302);

  const cloudOnlyTombstone = mergeCloudRows([], [], asValidated([tombstone]));
  check(
    "a tombstone is never appended as an active record",
    cloudOnlyTombstone.income.length === 0 && cloudOnlyTombstone.added === 0,
    `added=${cloudOnlyTombstone.added}`,
  );

  const activeCopy: CloudRow = { ...legacy };
  const tombstoneFirst = mergeCloudRows([], [], asValidated([tombstone, activeCopy]));
  const activeFirst = mergeCloudRows([], [], asValidated([activeCopy, tombstone]));
  check(
    "a duplicate active row in the payload cannot undo the tombstone",
    tombstoneFirst.income.length === 0 && activeFirst.income.length === 0,
    `${tombstoneFirst.income.length}/${activeFirst.income.length}`,
  );

  const totals = mergeCloudRows([entry(301, 900, NOW - 20_000)], [], asValidated([tombstone]));
  check(
    "a tombstoned amount is excluded from the financial totals",
    totals.income.length === 0 && totals.expense.length === 0,
  );

  const secondDownload = mergeCloudRows(
    totals.income,
    totals.expense,
    asValidated([tombstone]),
  );
  check(
    "a repeated download does not resurrect the deleted record",
    secondDownload.income.length === 0 && secondDownload.added === 0,
    `added=${secondDownload.added}`,
  );

  /* A stale device holds an older edit of the record. Deletion wins by design. */
  const stale = mergeCloudRows([entry(301, 1234, NOW - 5_000)], [], asValidated([tombstone]));
  check(
    "a stale local edit cannot survive a newer tombstone",
    stale.income.length === 0 && stale.tombstoned === 1,
  );
}

/* ------------------------------------------------------------------ */
/* 20. Uploads never overwrite a tombstone                             */
/* ------------------------------------------------------------------ */
section("uploads never resurrect a tombstoned record");
{
  const tombstone: CloudRow = {
    ...toRow(entry(401, 5000, NOW - 60_000), "income"),
    deleted: true,
    deletedAt: NOW - 1_000,
    deletedEventId: `${NOW - 1_000}-401`,
    deletedVersion: NOW - 60_000,
    deletedBy: "d-test",
  };
  const identicalLocal: CloudRow = { ...toRow(entry(401, 5000, NOW - 60_000), "income") };
  const identicalPlan = planUpload([identicalLocal], [tombstone]);
  check(
    "an identical local row is not written over a tombstone",
    identicalPlan.writes.length === 0 && identicalPlan.tombstoned === 1,
    JSON.stringify({ writes: identicalPlan.writes.length, tombstoned: identicalPlan.tombstoned }),
  );

  const newerLocal: CloudRow = {
    ...toRow(entry(401, 8000, NOW), "income"),
    updatedAt: NOW,
  };
  const newerPlan = planUpload([newerLocal], [tombstone]);
  check(
    "even a newer local edit cannot overwrite a tombstone",
    newerPlan.writes.length === 0 && newerPlan.tombstoned === 1,
    JSON.stringify({ writes: newerPlan.writes.length }),
  );

  const other = toRow(entry(402, 700, NOW - 10_000), "expense");
  const mixed = planUpload(
    [newerLocal, { ...other, localId: 402 }],
    [tombstone],
  );
  check(
    "unrelated rows are still uploaded next to a tombstone",
    mixed.writes.length === 1 && mixed.writes[0].localId === 402 && mixed.tombstoned === 1,
    JSON.stringify({ writes: mixed.writes.map((row) => row.localId), tombstoned: mixed.tombstoned }),
  );
}

/* ------------------------------------------------------------------ */
/* 21. Pending deletion queue (durable, retryable, idempotent)         */
/* ------------------------------------------------------------------ */
section("pending deletions are durable and retryable");
{
  installStorage();
  savePendingDeletions([]);

  const record = entry(501, 1500, NOW - 40_000);
  const queued = enqueuePendingDeletion(record, "expense", NOW);
  check(
    "a deletion is queued with a deterministic event id",
    queued.localId === 501 && queued.deletedEventId === `${NOW}-501` && queued.deletedAt === NOW,
    JSON.stringify({ id: queued.deletedEventId }),
  );
  check("the queue survives a reload (restart)", loadPendingDeletions().length === 1);
  check(
    "the queued snapshot keeps the full record (so a tombstone can be built)",
    queued.record.amount === 1500 && queued.record.kind === "expense" && queued.record.monthKey === record.monthKey,
  );

  const again = enqueuePendingDeletion(record, "expense", NOW + 5_000);
  check(
    "deleting the same record twice keeps one event (idempotent)",
    loadPendingDeletions().length === 1 && again.deletedEventId === queued.deletedEventId,
    `${loadPendingDeletions().length}`,
  );

  for (let index = 0; index < MAX_PENDING_DELETIONS + 20; index += 1) {
    enqueuePendingDeletion(entry(10_000 + index, 10, NOW - 1_000), "income", NOW + index);
  }
  check(
    "the queue is capped at MAX_PENDING_DELETIONS",
    loadPendingDeletions().length === MAX_PENDING_DELETIONS,
    `${loadPendingDeletions().length}`,
  );
  savePendingDeletions([]);

  globalThis.localStorage.setItem("sauti_pending_deletions", "{not json");
  check("corrupt queue storage degrades to an empty queue", loadPendingDeletions().length === 0);
  savePendingDeletions([]);

  const tombstoneFrom = buildTombstoneDocument(
    toRow(entry(601, 2500, NOW - 10_000), "income"),
    enqueuePendingDeletion(entry(601, 2500, NOW - 10_000), "income", NOW),
  );
  check(
    "the tombstone keeps the record content and adds deletion metadata",
    tombstoneFrom.amount === 2500 &&
      tombstoneFrom.deleted === true &&
      tombstoneFrom.deletedAt === NOW &&
      tombstoneFrom.deletedEventId === `${NOW}-601` &&
      tombstoneFrom.updatedAt === NOW,
    JSON.stringify({ deletedAt: tombstoneFrom.deletedAt, updatedAt: tombstoneFrom.updatedAt }),
  );
  savePendingDeletions([]);
}

section("deletion sync delivers, retries and never drops an event");
{
  installStorage();
  savePendingDeletions([]);
  const pending = enqueuePendingDeletion(entry(701, 3000, NOW - 20_000), "income", NOW);
  const cloud = [toRow(entry(701, 3000, NOW - 20_000), "income")];

  const written: CloudRow[] = [];
  const okOutcome = await syncPendingDeletions({
    pending: [pending],
    cloudRows: cloud,
    write: async (row) => {
      written.push(row);
    },
  });
  check(
    "a successful delivery writes exactly one tombstone and clears the queue",
    okOutcome.applied === 1 && okOutcome.remaining.length === 0 && written.length === 1 && written[0].deleted === true,
    JSON.stringify({ applied: okOutcome.applied, remaining: okOutcome.remaining.length }),
  );

  const failOutcome = await syncPendingDeletions({
    pending: [pending],
    cloudRows: cloud,
    write: async () => {
      throw new Error("offline");
    },
  });
  check(
    "a failed delivery keeps the event pending and reports it",
    failOutcome.failed === 1 &&
      failOutcome.remaining.length === 1 &&
      failOutcome.failures[0].localId === 701 &&
      failOutcome.failures[0].reason.includes("offline"),
    JSON.stringify({ failed: failOutcome.failed, remaining: failOutcome.remaining.length }),
  );

  const alreadyCloud = [written[0]];
  let wroteAgain = false;
  const repeated = await syncPendingDeletions({
    pending: [pending],
    cloudRows: alreadyCloud,
    write: async () => {
      wroteAgain = true;
    },
  });
  check(
    "replaying the same event is idempotent (already a tombstone)",
    repeated.alreadyDeleted === 1 && repeated.remaining.length === 0 && !wroteAgain,
    JSON.stringify({ already: repeated.alreadyDeleted, wroteAgain }),
  );

  let wroteMissing = false;
  const missing = await syncPendingDeletions({
    pending: [pending],
    cloudRows: [],
    write: async () => {
      wroteMissing = true;
    },
  });
  check(
    "a deletion for a record that never reached the cloud is satisfied without writing",
    missing.missing === 1 && missing.remaining.length === 0 && !wroteMissing,
    JSON.stringify({ missing: missing.missing, wroteMissing }),
  );
  savePendingDeletions([]);
}

section("the pending-deletion queue never drops an event silently");
{
  installStorage();
  savePendingDeletions([]);

  const queuedOne = enqueuePendingDeletion(entry(801, 1200, NOW), "income", NOW);
  check(
    "a queued deletion reports that it was stored",
    queuedOne.queue.persisted && queuedOne.queue.stored === 1 && queuedOne.queue.dropped === 0,
    JSON.stringify(queuedOne.queue),
  );

  const many: PendingDeletion[] = Array.from(
    { length: MAX_PENDING_DELETIONS + 5 },
    (_, index) => ({
      localId: 30_000 + index,
      deletedAt: NOW + index,
      deletedEventId: `${NOW + index}-${30_000 + index}`,
      deletedBy: "d-test",
      deletedVersion: NOW,
    }),
  );
  const overflow = savePendingDeletions(many);
  const kept = loadPendingDeletions();
  check(
    "exceeding the cap is reported instead of trimmed silently",
    overflow.dropped === 5 &&
      overflow.stored === MAX_PENDING_DELETIONS &&
      overflow.persisted &&
      kept.length === MAX_PENDING_DELETIONS,
    JSON.stringify({ stored: overflow.stored, dropped: overflow.dropped, kept: kept.length }),
  );
  check(
    "the newest events are the ones kept",
    kept[kept.length - 1].localId === 30_000 + MAX_PENDING_DELETIONS + 4 &&
      kept[0].localId === 30_000 + 5,
    `${kept[0]?.localId}..${kept[kept.length - 1]?.localId}`,
  );

  /* Storage full: the snapshot is stripped and the event still survives. */
  savePendingDeletions([]);
  const one = enqueuePendingDeletion(entry(802, 900, NOW), "expense", NOW);
  const realSetItem = (globalThis.localStorage as Storage).setItem.bind(globalThis.localStorage);
  (globalThis.localStorage as Storage).setItem = ((key: string, value: string) => {
    if (value.includes("\"record\"")) throw new Error("quota exceeded");
    realSetItem(key, value);
  }) as Storage["setItem"];
  const compactSave = savePendingDeletions([{ ...one }]);
  (globalThis.localStorage as Storage).setItem = realSetItem as Storage["setItem"];
  const compacted = loadPendingDeletions();
  check(
    "a full quota stores a compact event instead of losing it",
    compactSave.persisted &&
      compactSave.stored === 1 &&
      compacted.length === 1 &&
      compacted[0].localId === 802 &&
      compacted[0].record === undefined,
    JSON.stringify({ persisted: compactSave.persisted, entry: compacted[0] ?? null }),
  );

  savePendingDeletions([]);
  const blocked = enqueuePendingDeletion(entry(803, 700, NOW), "income", NOW);
  const failingSetItem = (globalThis.localStorage as Storage).setItem;
  (globalThis.localStorage as Storage).setItem = (() => {
    throw new Error("storage disabled");
  }) as Storage["setItem"];
  const failedSave = savePendingDeletions([{ ...blocked }]);
  (globalThis.localStorage as Storage).setItem = failingSetItem;
  check(
    "a queue that cannot be stored at all is reported, not assumed saved",
    failedSave.persisted === false && failedSave.stored === 0 && failedSave.dropped === 1,
    JSON.stringify(failedSave),
  );
  savePendingDeletions([]);
}

section("party changes are queued, retried and never silently lost");
{
  installStorage();
  savePendingPartyOps([]);

  const shop = makeParty(
    { name: "حسن ٹریڈرز", phone: "03001234567", kind: "customer" },
    900,
  );
  enqueuePartyOps([partyUpsertOp(shop, NOW, "uid-a")]);
  check(
    "a party edit is queued durably (survives a reload)",
    loadPendingPartyOps().length === 1 && loadPendingPartyOps()[0].id === 900,
    `${loadPendingPartyOps().length}`,
  );
  check(
    "the queued party payload has no undefined fields",
    !("note" in (loadPendingPartyOps()[0].data ?? {})) &&
      loadPendingPartyOps()[0].data?.name === "حسن ٹریڈرز",
    JSON.stringify(loadPendingPartyOps()[0].data ?? null),
  );

  enqueuePartyOps([partyUpsertOp({ ...shop, name: "حسن ٹریڈرز (نیا)" }, NOW + 1_000, "uid-a")]);
  check(
    "a second edit collapses to the newest one (no duplicate writes)",
    loadPendingPartyOps().length === 1 &&
      loadPendingPartyOps()[0].data?.name === "حسن ٹریڈرز (نیا)",
    `${loadPendingPartyOps().length}`,
  );

  enqueuePartyOps([partyDeleteOp(900, NOW + 2_000, "uid-a")]);
  check(
    "a delete supersedes the pending edit for the same party",
    loadPendingPartyOps().length === 1 && loadPendingPartyOps()[0].kind === "delete",
    JSON.stringify(loadPendingPartyOps()[0] ?? null),
  );

  savePendingPartyOps([]);
  const txn = makePartyTxn(900, { kind: "charge", amount: 2500, note: "ادھار" }, 901);
  enqueuePartyOps([
    partyUpsertOp(shop, NOW, "uid-a"),
    partyTxnUpsertOp(txn, NOW, "uid-a"),
    partyTxnDeleteOp(902, NOW, "uid-a"),
  ]);
  check(
    "parties and transactions queued under the same id stay separate",
    loadPendingPartyOps().length === 3 &&
      partyOpKey({ target: "parties", id: 900 }) !== partyOpKey({ target: "partyTxns", id: 900 }),
    `${loadPendingPartyOps().length}`,
  );

  const written: string[] = [];
  const delivered = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async (target) => {
      /* Stage 4C-B: a party upsert reads the cloud copy before it writes, so
         `null` (a document that does not exist yet) is the expected answer.
         A transaction operation must still not read anything. */
      if (target === "parties") return null;
      throw new Error("read not expected for these operations");
    },
    write: async (target, id, data) => {
      if (target === "partyTxns" && id === 901) throw new Error("permission-denied");
      written.push(`${target}:${id}:${String(data.name ?? data.amount)}`);
    },
    remove: async (target, id) => {
      written.push(`${target}:${id}:delete`);
    },
  });
  check(
    "delivery reports an accurate partial result",
    delivered.applied === 2 && delivered.failed === 1 && delivered.remaining.length === 1,
    JSON.stringify({ applied: delivered.applied, failed: delivered.failed }),
  );
  check(
    "the failed write stays queued with its reason",
    delivered.remaining[0].id === 901 &&
      delivered.failures[0].reason.includes("permission-denied"),
    JSON.stringify(delivered.failures),
  );

  const foreign = await flushPendingPartyOps({
    ops: [{ ...partyDeleteOp(903, NOW, "uid-other") }],
    uid: "uid-a",
    read: async () => {
      throw new Error("must not be called");
    },
    write: async () => {
      throw new Error("must not be called");
    },
    remove: async () => {
      throw new Error("must not be called");
    },
  });
  check(
    "an operation recorded for another uid is deferred, never written",
    foreign.deferred === 1 && foreign.applied === 0 && foreign.remaining.length === 1,
    JSON.stringify({ deferred: foreign.deferred, applied: foreign.applied }),
  );

  const legacyTxn = { ...txn, note: undefined } as unknown as typeof txn;
  const legacyDoc = partyTxnForCloud(legacyTxn);
  check(
    "a legacy transaction without a note is written as an empty string",
    legacyDoc.note === "" && legacyDoc.amount === 2500 && legacyDoc.account === "cash",
    JSON.stringify(legacyDoc),
  );

  savePendingPartyOps([]);
  const tooMany: PendingPartyOp[] = Array.from(
    { length: MAX_PENDING_PARTY_OPS + 3 },
    (_, index) => partyUpsertOp({ ...shop, id: 40_000 + index }, NOW + index),
  );
  const capped = (() => {
    enqueuePartyOps(tooMany);
    return { size: loadPendingPartyOps().length };
  })();
  check(
    "the party queue is bounded",
    capped.size === MAX_PENDING_PARTY_OPS,
    `${capped.size}`,
  );
  savePendingPartyOps([]);
}

section("party tombstones are final, durable and never resurrected (stage 4C-A)");
{
  const store = installStorage();
  savePendingPartyOps([]);
  store.store.delete("sauti_party_tombstones");

  const activeDoc: Record<string, unknown> = {
    id: 910,
    name: "الفا ٹریڈرز",
    phone: "03001112223",
    kind: "customer",
    createdAt: NOW,
  };
  const shop = makeParty({ name: "الفا ٹریڈرز", phone: "03001112223", kind: "customer" }, 910);

  /* --- tombstone field validation ---------------------------------- */
  check(
    "a party written before this stage (no tombstone fields) stays active",
    classifyPartyDoc(activeDoc) === "active",
    classifyPartyDoc(activeDoc),
  );
  check(
    "a complete party tombstone is recognised",
    classifyPartyDoc({ ...activeDoc, deleted: true, deletedAt: NOW, deletedBy: "d-abc" }) === "deleted",
  );
  check(
    "deleted: false is still an active document",
    classifyPartyDoc({ ...activeDoc, deleted: false }) === "active",
  );
  check(
    "a non-boolean deletion flag is rejected",
    classifyPartyDoc({ ...activeDoc, deleted: "yes" }) === "invalid",
    String(classifyPartyDoc({ ...activeDoc, deleted: "yes" })),
  );
  check(
    "a tombstone without deletedAt is rejected",
    classifyPartyDoc({ ...activeDoc, deleted: true }) === "invalid",
  );
  check(
    "a tombstone with a non-numeric deletedAt is rejected",
    classifyPartyDoc({ ...activeDoc, deleted: true, deletedAt: "now" }) === "invalid",
  );
  check(
    "a tombstone with an oversized deletedBy is rejected",
    classifyPartyDoc({ ...activeDoc, deleted: true, deletedAt: NOW, deletedBy: "x".repeat(129) }) === "invalid",
  );
  check(
    "a party document without an id is never applied",
    classifyPartyDoc({ name: "الفا", kind: "customer" }) === "invalid",
  );
  check(
    "a party document with an unknown kind is never applied",
    classifyPartyDoc({ id: 911, name: "الفا", kind: "friend" }) === "invalid",
  );

  /* --- the tombstone keeps the party's own data -------------------- */
  const tombstone = partyTombstoneDocument(activeDoc, NOW + 5_000, "d-abc");
  check(
    "the tombstone keeps every original party field",
    tombstone.id === activeDoc.id &&
      tombstone.name === activeDoc.name &&
      tombstone.phone === activeDoc.phone &&
      tombstone.kind === activeDoc.kind &&
      tombstone.createdAt === activeDoc.createdAt,
    JSON.stringify(tombstone),
  );
  check(
    "the tombstone adds the deletion markers",
    tombstone.deleted === true && tombstone.deletedAt === NOW + 5_000 && tombstone.deletedBy === "d-abc",
    JSON.stringify(tombstone),
  );

  /* --- delivery ------------------------------------------------------ */
  const cloud = new Map<number, Record<string, unknown>>([[910, activeDoc]]);
  const reads: string[] = [];
  const writes: string[] = [];
  const removes: string[] = [];
  const flushOnce = (ops: PendingPartyOp[], uid = "uid-a") =>
    flushPendingPartyOps({
      ops,
      uid,
      read: async (target, id) => {
        reads.push(`${target}:${id}`);
        return cloud.get(id) ?? null;
      },
      write: async (target, id, data) => {
        writes.push(`${target}:${id}`);
        cloud.set(id, data);
      },
      remove: async (target, id) => {
        removes.push(`${target}:${id}`);
        cloud.delete(id);
      },
    });

  const first = await flushOnce([partyDeleteOp(910, NOW + 5_000, "uid-a")]);
  check(
    "a party deletion is delivered as a tombstone, never as a document delete",
    first.applied === 1 &&
      first.failed === 0 &&
      first.remaining.length === 0 &&
      cloud.has(910) &&
      (cloud.get(910) as { deleted?: boolean }).deleted === true &&
      removes.length === 0,
    JSON.stringify({ applied: first.applied, removes }),
  );
  const stored = cloud.get(910) as Record<string, unknown>;
  check(
    "the stored party keeps its content after the deletion",
    stored.name === "الفا ٹریڈرز" && stored.createdAt === NOW,
    JSON.stringify(stored),
  );
  check(
    "the queued deletion time is what gets stored",
    stored.deletedAt === NOW + 5_000,
    String(stored.deletedAt),
  );

  const duplicate = await flushOnce([partyDeleteOp(910, NOW + 5_000, "uid-a")]);
  check(
    "duplicate delivery is idempotent — the second run writes nothing",
    duplicate.applied === 0 &&
      duplicate.alreadyDeleted === 1 &&
      writes.length === 1 &&
      removes.length === 0,
    JSON.stringify({
      applied: duplicate.applied,
      alreadyDeleted: duplicate.alreadyDeleted,
      writes: writes.length,
    }),
  );

  const absent = await flushOnce([partyDeleteOp(999, NOW, "uid-a")]);
  check(
    "a deletion for a party that never reached the cloud is reported as missing, not as success",
    absent.missing === 1 && absent.applied === 0 && !cloud.has(999),
    JSON.stringify({ missing: absent.missing, applied: absent.applied }),
  );

  const rejected = await flushPendingPartyOps({
    ops: [partyDeleteOp(910, NOW + 6_000, "uid-a")],
    uid: "uid-a",
    read: async () => activeDoc,
    write: async () => {
      throw new Error("permission-denied");
    },
    remove: async () => {
      throw new Error("transaction delete must not be used for a party");
    },
  });
  check(
    "a rejected tombstone write stays queued with its reason",
    rejected.failed === 1 &&
      rejected.remaining.length === 1 &&
      rejected.failures[0].reason.includes("permission-denied"),
    JSON.stringify(rejected.failures),
  );
  check(
    "a failed attempt never turns into a success result",
    rejected.applied === 0 && rejected.missing === 0 && rejected.alreadyDeleted === 0,
    JSON.stringify({ applied: rejected.applied }),
  );

  const foreignDelete = await flushOnce([partyDeleteOp(911, NOW, "uid-other")], "uid-a");
  check(
    "a deletion recorded for another uid is deferred and never read or written",
    foreignDelete.deferred === 1 &&
      !reads.includes("parties:911") &&
      foreignDelete.remaining.length === 1,
    JSON.stringify({ deferred: foreignDelete.deferred, reads }),
  );

  const txnDelete = await flushOnce([partyTxnDeleteOp(912, NOW, "uid-a")]);
  check(
    "party transactions keep their existing delete path (unchanged in this stage)",
    txnDelete.applied === 1 && removes.includes("partyTxns:912"),
    JSON.stringify(removes),
  );

  /* --- deletion is final ------------------------------------------- */
  savePendingPartyOps([]);
  store.store.delete("sauti_party_tombstones");
  enqueuePartyOps([partyDeleteOp(910, NOW + 10_000, "uid-a")]);
  check(
    "the pending deletion is visible to the snapshot guard",
    pendingPartyOpsById().get("parties:910")?.kind === "delete",
    JSON.stringify(loadPendingPartyOps().map((op) => partyOpKey(op))),
  );
  check(
    "a remote snapshot cannot resurrect a locally pending deletion",
    decidePartySnapshot(activeDoc, pendingPartyOpsById(), []) === "pending-local-change",
    decidePartySnapshot(activeDoc, pendingPartyOpsById(), []),
  );

  /* Bypasses the queue guard on purpose: the merge itself must hold. */
  savePendingPartyOps([
    ...loadPendingPartyOps(),
    partyUpsertOp({ ...shop, name: "واپس آیا" }, NOW + 11_000, "uid-a"),
  ]);
  check(
    "an upsert merged after a delete can never revive the queued deletion",
    loadPendingPartyOps().length === 1 && loadPendingPartyOps()[0].kind === "delete",
    JSON.stringify(loadPendingPartyOps()[0] ?? null),
  );

  rememberTombstonedPartyIds([910]);
  rememberTombstonedPartyIds([910]);
  check(
    "the deletion is remembered once and survives a reload",
    JSON.stringify(loadTombstonedPartyIds()) === JSON.stringify([910]),
    JSON.stringify(loadTombstonedPartyIds()),
  );
  const refused = enqueuePartyOps([
    partyUpsertOp({ ...shop, name: "پرانی بیک اپ" }, NOW + 12_000, "uid-a"),
  ]);
  check(
    "the queue refuses an upsert for a deleted party (a backup cannot revive it)",
    loadPendingPartyOps().length === 1 &&
      loadPendingPartyOps()[0].kind === "delete" &&
      refused.stored === 1,
    JSON.stringify(loadPendingPartyOps().map((op) => partyOpKey(op))),
  );
  check(
    "the deleted-id set combines remembered tombstones and pending deletions",
    deletedPartyIds().has(910) && deletedPartyIds().size >= 1,
    JSON.stringify(Array.from(deletedPartyIds())),
  );
  check(
    "a tombstone in the snapshot wins even over a pending edit",
    decidePartySnapshot(
      { ...activeDoc, deleted: true, deletedAt: NOW },
      new Map<string, PendingPartyOp>([
        [partyOpKey({ target: "parties", id: 910 }), partyUpsertOp(shop, NOW, "uid-a")],
      ]),
      [],
    ) === "tombstone",
  );
  check(
    "an active cloud copy of a party this device deleted is not applied",
    decidePartySnapshot(activeDoc, new Map<string, PendingPartyOp>(), [910]) === "known-deleted",
  );
  check(
    "a malformed party document is never applied",
    decidePartySnapshot({ id: 910, name: "", kind: "customer" }, new Map(), [911]) === "invalid",
    decidePartySnapshot({ id: 910, name: "", kind: "customer" }, new Map(), [911]),
  );
  check(
    "an ordinary active party is applied",
    decidePartySnapshot(activeDoc, new Map(), []) === "apply",
  );
  check(
    "a legacy party without tombstone fields is applied",
    decidePartySnapshot({ ...activeDoc, id: 913 }, new Map(), [910]) === "apply",
  );

  const restored = splitImportableParties(
    [shop, { ...shop, id: 914, name: "نئی دکان" }],
    [910],
  );
  check(
    "an import keeps the deleted party out of the book and restores the rest",
    restored.active.length === 1 &&
      restored.active[0].id === 914 &&
      restored.blocked.length === 1 &&
      restored.blocked[0] === 910,
    JSON.stringify({ active: restored.active.map((p) => p.id), blocked: restored.blocked }),
  );

  /* --- stale queued edits are dropped when the tombstone arrives ----- */
  savePendingPartyOps([]);
  store.store.delete("sauti_party_tombstones");
  const txn = makePartyTxn(915, { kind: "charge", amount: 700 }, 920);
  enqueuePartyOps([
    partyUpsertOp({ ...shop, id: 915, name: "زیر التوا" }, NOW + 13_000, "uid-a"),
    partyTxnUpsertOp(txn, NOW + 13_000, "uid-a"),
  ]);
  const dropped = dropStalePartyUpserts([915]);
  check(
    "queued edits for a party whose tombstone arrived are dropped and reported",
    dropped === 1 &&
      loadPendingPartyOps().length === 1 &&
      loadPendingPartyOps()[0].target === "partyTxns",
    JSON.stringify({ dropped, queue: loadPendingPartyOps().map((op) => partyOpKey(op)) }),
  );
  check(
    "dropping stale party edits never touches a queued transaction change",
    loadPendingPartyOps()[0].id === 920 && loadPendingPartyOps()[0].target === "partyTxns",
    JSON.stringify(loadPendingPartyOps().map((op) => partyOpKey(op))),
  );

  /* --- stage 4C-C: an entry never outlives its deleted parent in the cloud -- */
  savePendingPartyOps([]);
  store.store.delete("sauti_party_ops_dead");
  const orphan = makePartyTxn(915, { kind: "payment", amount: 300, partyKind: "customer" }, 921);
  rememberTombstonedPartyIds([915]);
  savePendingPartyOps([partyTxnUpsertOp(orphan, NOW + 14_000, "uid-a")]);
  const ghostWrites: string[] = [];
  const quarantined = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async () => {
      throw new Error("a quarantined entry must not touch the cloud");
    },
    write: async (target, id) => {
      ghostWrites.push(`${target}:${id}`);
    },
    remove: async () => {
      throw new Error("a quarantined entry must not be removed");
    },
  });
  check(
    "a queued entry for a deleted party is quarantined, never uploaded",
    quarantined.parentDeleted === 1 &&
      quarantined.applied === 0 &&
      ghostWrites.length === 0 &&
      quarantined.remaining.length === 0,
    JSON.stringify({ parentDeleted: quarantined.parentDeleted, writes: ghostWrites }),
  );
  check(
    "the quarantined operation is retained and reported, not silently lost",
    loadDeadPartyOps().some(
      (entry) =>
        entry.op.target === "partyTxns" &&
        entry.op.id === 921 &&
        entry.reason === "parent-deleted",
    ),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );
  check(
    "the entry that is quarantined still carries its classification",
    (quarantined.retired[0]?.op.data as { partyKind?: string } | undefined)?.partyKind === "customer",
    JSON.stringify(quarantined.retired[0]?.op.data ?? null),
  );

  /* The same party deleted and written in one batch: deletion wins, nothing
     resurrects the parent, and the entry is kept out of the cloud. */
  const liveDoc: Record<string, unknown> = {
    id: 916,
    name: "حذف شدہ گاہک",
    phone: "",
    kind: "customer",
    createdAt: NOW,
  };
  const cloudOne = new Map<number, Record<string, unknown>>([[916, liveDoc]]);
  const batchWrites: string[] = [];
  const entryTxn = makePartyTxn(916, { kind: "charge", amount: 900, partyKind: "customer" }, 922);
  savePendingPartyOps([
    partyDeleteOp(916, NOW + 20_000, "uid-a"),
    partyTxnUpsertOp(entryTxn, NOW + 20_001, "uid-a"),
  ]);
  const batch = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async (_target, id) => cloudOne.get(id) ?? null,
    write: async (target, id, data) => {
      batchWrites.push(`${target}:${id}`);
      cloudOne.set(id, data);
    },
    remove: async () => {
      throw new Error("a party is never document-deleted");
    },
  });
  check(
    "a party deletion and its entry in one batch: the deletion is applied and the entry is held back",
    batch.applied === 1 && batch.parentDeleted === 1 &&
      batchWrites.length === 1 && batchWrites[0] === "parties:916",
    JSON.stringify({ applied: batch.applied, parentDeleted: batch.parentDeleted, writes: batchWrites }),
  );
  check(
    "the parent stays tombstoned — a queued entry cannot resurrect it",
    (cloudOne.get(916) as { deleted?: boolean; deletedAt?: number })?.deleted === true &&
      (cloudOne.get(916) as { deletedAt?: number }).deletedAt === NOW + 20_000,
    JSON.stringify(cloudOne.get(916) ?? null),
  );

  savePendingPartyOps([]);
}

section("party writes carry a version and never overwrite newer cloud data (stage 4C-B)");
{
  const storage = installStorage();
  storage.store.delete("sauti_party_ops_dead");
  storage.store.delete("sauti_party_tombstones");
  savePendingPartyOps([]);

  const base = makeParty({ name: "ورژن ٹیسٹ", phone: "03001234567", kind: "customer" }, 930);
  const upsert = partyUpsertOp(base, NOW, "uid-a");
  check(
    "a party upsert carries the edit time as its version",
    upsert.data?.updatedAt === NOW && upsert.data?.name === "ورژن ٹیسٹ",
    JSON.stringify(upsert.data ?? null),
  );
  check(
    "the versioned payload has no undefined field (Firestore-safe)",
    Object.values(upsert.data ?? {}).every((value) => value !== undefined),
    JSON.stringify(upsert.data ?? null),
  );

  const legacyDoc = { id: 930, name: "پرانا گاہک", phone: "", kind: "customer", createdAt: 1 };
  check(
    "a legacy party document has version 0",
    partyDocVersion(legacyDoc) === 0 &&
      partyDocVersion({ ...legacyDoc, updatedAt: "2024" }) === 0 &&
      partyDocVersion({ ...legacyDoc, updatedAt: 0 }) === 0,
    JSON.stringify({ a: partyDocVersion(legacyDoc), b: partyDocVersion({ ...legacyDoc, updatedAt: "2024" }) }),
  );
  check(
    "a legacy party is still overwritten by a current edit (no migration needed)",
    comparePartyWrite(legacyDoc, upsert) === "write",
    comparePartyWrite(legacyDoc, upsert),
  );
  check(
    "a missing cloud document is always written",
    comparePartyWrite(null, upsert) === "write",
  );
  check(
    "a newer cloud party blocks an older queued edit",
    comparePartyWrite({ ...legacyDoc, updatedAt: NOW + PARTY_CLOCK_SKEW_MS + 1_000 }, upsert) === "stale",
  );
  check(
    "a cloud party inside the clock-skew window is not treated as newer",
    comparePartyWrite({ ...legacyDoc, updatedAt: NOW + 1_000 }, upsert) === "write",
  );
  check(
    "a tombstoned cloud party is never overwritten by an edit",
    comparePartyWrite({ ...legacyDoc, deleted: true, deletedAt: NOW - 500 }, upsert) === "tombstoned",
  );

  /* --- delivery: an older queued edit never overwrites a newer copy -- */
  savePendingPartyOps([upsert]);
  const written: string[] = [];
  const staleFlush = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async () => ({
      ...legacyDoc,
      name: "کلاؤڈ کا نیا نام",
      updatedAt: NOW + PARTY_CLOCK_SKEW_MS + 5_000,
    }),
    write: async (_target, id, data) => {
      written.push(`${id}:${String(data.name)}`);
    },
    remove: async () => {
      throw new Error("remove not expected");
    },
  });
  savePendingPartyOps(staleFlush.remaining);
  check(
    "an older queued edit does not overwrite a newer cloud party",
    staleFlush.applied === 0 && staleFlush.stale === 1 && written.length === 0,
    JSON.stringify({ applied: staleFlush.applied, stale: staleFlush.stale, written }),
  );
  check(
    "a stale operation leaves the queue but stays inspectable",
    staleFlush.remaining.length === 0 &&
      loadPendingPartyOps().length === 0 &&
      loadDeadPartyOps().some((entry) => entry.reason === "stale" && entry.op.id === 930),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );

  savePendingPartyOps([upsert]);
  const blockedFlush = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async () => ({ ...legacyDoc, deleted: true, deletedAt: NOW - 500 }),
    write: async () => {
      throw new Error("must not write over a tombstone");
    },
    remove: async () => {
      throw new Error("must not remove");
    },
  });
  savePendingPartyOps(blockedFlush.remaining);
  check(
    "a queued edit cannot resurrect a tombstoned party",
    blockedFlush.applied === 0 &&
      blockedFlush.resurrectBlocked === 1 &&
      blockedFlush.remaining.length === 0 &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({ applied: blockedFlush.applied, blocked: blockedFlush.resurrectBlocked }),
  );
  check(
    "the refused resurrection is reported, not silently dropped",
    loadDeadPartyOps().some((entry) => entry.reason === "tombstoned" && entry.op.id === 930),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );

  savePendingPartyOps([upsert]);
  const freshFlush = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async () => null,
    write: async (_target, id, data) => {
      written.push(`${id}:${String(data.name)}`);
    },
    remove: async () => {
      throw new Error("remove not expected");
    },
  });
  savePendingPartyOps(freshFlush.remaining);
  check(
    "a party that is not in the cloud yet is created normally",
    freshFlush.applied === 1 && freshFlush.stale === 0 && written.length === 1,
    JSON.stringify({ applied: freshFlush.applied, written }),
  );

  /* --- snapshot: a stale pending edit must not hide the cloud copy -- */
  const pendingMap = new Map([[partyOpKey(upsert), upsert]]);
  const cloudNewerDoc = { ...legacyDoc, updatedAt: NOW + PARTY_CLOCK_SKEW_MS + 10_000 };
  check(
    "a stale queued edit does not hide the newer cloud party in a snapshot",
    decidePartySnapshot(cloudNewerDoc, pendingMap, []) === "cloud-newer",
    decidePartySnapshot(cloudNewerDoc, pendingMap, []),
  );
  check(
    "a newer queued edit still wins over the cloud snapshot",
    decidePartySnapshot({ ...legacyDoc, updatedAt: NOW - 60_000 }, pendingMap, []) ===
      "pending-local-change",
  );
  check(
    "a legacy cloud party never outranks a pending edit",
    decidePartySnapshot(legacyDoc, pendingMap, []) === "pending-local-change",
  );
  check(
    "a cloud tombstone still beats a pending edit (deletion wins)",
    decidePartySnapshot({ ...cloudNewerDoc, deleted: true, deletedAt: NOW }, pendingMap, []) ===
      "tombstone",
  );

  const second = partyUpsertOp({ ...base, id: 931 }, NOW, "uid-a");
  savePendingPartyOps([upsert, second]);
  const retired = retirePendingPartyOps([partyOpKey(upsert)], "superseded by a newer cloud party");
  check(
    "retiring a superseded operation keeps the rest of the queue",
    retired === 1 &&
      loadPendingPartyOps().length === 1 &&
      loadPendingPartyOps()[0].id === 931 &&
      loadDeadPartyOps().some((entry) => entry.op.id === 930),
    JSON.stringify({ retired, queue: loadPendingPartyOps().map((op) => partyOpKey(op)) }),
  );

  /* --- import: a row the file marks deleted is never restored -------- */
  const backupWithTombstone = JSON.stringify({
    version: 1,
    parties: [
      { ...legacyDoc, id: 932 },
      { ...legacyDoc, id: 933, deleted: true, deletedAt: 1 },
    ],
    txns: [],
  });
  check(
    "a backup row marked deleted is detected before it is restored",
    partiesMarkedDeletedInBackup(backupWithTombstone).join(",") === "933",
    JSON.stringify(partiesMarkedDeletedInBackup(backupWithTombstone)),
  );
  check(
    "a backup without tombstone markers reports nothing",
    partiesMarkedDeletedInBackup(JSON.stringify({ version: 1, parties: [legacyDoc], txns: [] }))
      .length === 0 &&
      partiesMarkedDeletedInBackup("not json").length === 0,
  );
  rememberTombstonedPartyIds(partiesMarkedDeletedInBackup(backupWithTombstone));
  const importedSplit = splitImportableParties(
    [
      { ...legacyDoc, id: 932 } as unknown as Party,
      { ...legacyDoc, id: 933 } as unknown as Party,
    ],
    deletedPartyIds(),
  );
  check(
    "a deleted row in a backup is never restored as an active party",
    importedSplit.active.length === 1 &&
      importedSplit.active[0].id === 932 &&
      importedSplit.blocked.join(",") === "933",
    JSON.stringify({ active: importedSplit.active.map((p) => p.id), blocked: importedSplit.blocked }),
  );

  /* --- sync metadata never reaches the book / the backup ------------- */
  const stripped = partyFromCloudDoc({
    ...legacyDoc,
    updatedAt: NOW,
    deleted: true,
    deletedAt: NOW,
    deletedBy: "device",
  });
  check(
    "sync metadata never leaks into the book (backup format unchanged)",
    !("updatedAt" in stripped) &&
      !("deleted" in stripped) &&
      !("deletedAt" in stripped) &&
      !("deletedBy" in stripped) &&
      stripped.name === "پرانا گاہک",
    JSON.stringify(stripped),
  );

  /* --- repeated permanent failures are bounded and inspectable ------- */
  savePendingPartyOps([]);
  storage.store.delete("sauti_party_ops_dead");
  const rejects = async (id: number) => {
    const outcome = await flushPendingPartyOps({
      ops: loadPendingPartyOps(),
      uid: "uid-a",
      read: async () => null,
      write: async (_target, targetId) => {
        if (targetId === id) throw new Error("permission-denied");
      },
      remove: async () => {
        throw new Error("remove not expected");
      },
    });
    savePendingPartyOps(outcome.remaining);
    return outcome;
  };

  savePendingPartyOps([partyUpsertOp({ ...base, id: 934, name: "x" }, NOW, "uid-a")]);
  const firstAttempt = await rejects(934);
  check(
    "a failed operation keeps its attempt count and reason in the queue",
    loadPendingPartyOps().length === 1 &&
      loadPendingPartyOps()[0].attempts === 1 &&
      (loadPendingPartyOps()[0].lastError ?? "").includes("permission-denied"),
    JSON.stringify(loadPendingPartyOps()[0] ?? null),
  );
  let lastOutcome = firstAttempt;
  for (let attempt = 2; attempt <= MAX_PARTY_OP_ATTEMPTS; attempt += 1) {
    lastOutcome = await rejects(934);
  }
  check(
    "a permanently rejected operation is retried a bounded number of times",
    lastOutcome.abandoned === 1 &&
      lastOutcome.failed === 1 &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({ abandoned: lastOutcome.abandoned, failed: lastOutcome.failed }),
  );
  check(
    "the abandoned operation stays inspectable with its failure reason",
    loadDeadPartyOps().some(
      (entry) => entry.op.id === 934 && entry.reason.includes("permission-denied"),
    ),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );

  /* --- one failure never blocks unrelated operations ----------------- */
  savePendingPartyOps([
    partyUpsertOp({ ...base, id: 936, name: "x" }, NOW, "uid-a"),
    partyUpsertOp({ ...base, id: 935, name: "درست گاہک" }, NOW, "uid-a"),
  ]);
  const mixed = await flushPendingPartyOps({
    ops: loadPendingPartyOps(),
    uid: "uid-a",
    read: async () => null,
    write: async (_target, id) => {
      if (id === 936) throw new Error("permission-denied");
    },
    remove: async () => {
      throw new Error("remove not expected");
    },
  });
  check(
    "one failing operation does not block the others",
    mixed.applied === 1 &&
      mixed.failed === 1 &&
      mixed.remaining.length === 1 &&
      mixed.remaining[0].id === 936,
    JSON.stringify({ applied: mixed.applied, failed: mixed.failed, remaining: mixed.remaining.map((op) => op.id) }),
  );

  /* --- queue overflow is bounded AND inspectable --------------------- */
  savePendingPartyOps([]);
  storage.store.delete("sauti_party_ops_dead");
  enqueuePartyOps(
    Array.from({ length: MAX_PENDING_PARTY_OPS + 2 }, (_, index) =>
      partyUpsertOp({ ...base, id: 40_100 + index }, NOW + index, "uid-a"),
    ),
  );
  const overflow = loadDeadPartyOps().filter((entry) => entry.reason === "queue-overflow");
  check(
    "the party queue stays bounded",
    loadPendingPartyOps().length === MAX_PENDING_PARTY_OPS,
    `${loadPendingPartyOps().length}`,
  );
  check(
    "operations lost to a queue overflow are set aside, not discarded",
    overflow.length === 2 &&
      overflow
        .map((entry) => entry.op.id)
        .sort((a, b) => a - b)
        .join(",") === "40100,40101",
    JSON.stringify(overflow.map((entry) => entry.op.id)),
  );
  check(
    "the set-aside list itself stays bounded",
    loadDeadPartyOps().length <= MAX_DEAD_PARTY_OPS,
    `${loadDeadPartyOps().length}`,
  );

  savePendingPartyOps([]);

  /* ================================================================ */
  /* Stage 4C-D — the deletion rules themselves                       */
  /* The emulator proves them against a real Firestore API; these     */
  /* checks keep the file honest if it is edited again.               */
  /* ================================================================ */
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const partiesBlock = rules.slice(
    rules.indexOf("match /parties/{partyId}"),
    rules.indexOf("match /partyTxns/{txnId}"),
  );
  const txnsBlock = rules.slice(rules.indexOf("match /partyTxns/{txnId}"));

  check(
    "the rules file was read and contains both party collections",
    partiesBlock.includes("allow create") && txnsBlock.includes("allow create"),
  );
  check(
    "the rules no longer allow anyone to hard-delete a party document",
    !partiesBlock.includes("allow delete"),
    partiesBlock.match(/allow\s+\w+[^;]*/g)?.join(" | ") ?? "",
  );
  check(
    "party reads and writes still require the owner (nothing weakened)",
    (partiesBlock.match(/isOwner\(userId\)/g) ?? []).length >= 3 &&
      !partiesBlock.includes("allow read, write: if true"),
    `${(partiesBlock.match(/isOwner\(userId\)/g) ?? []).length} owner checks`,
  );
  check(
    "a party tombstone cannot be re-dated by a later update",
    partiesBlock.includes("incoming().deletedAt == existing().deletedAt"),
  );
  check(
    "a tombstoned party still cannot be turned active again",
    partiesBlock.includes("isNotResurrectingPartyTombstone()"),
  );
  check(
    "the partyKind classification is validated on every transaction write",
    (txnsBlock.match(/incoming\(\)\.partyKind in \['customer', 'supplier'\]/g) ?? []).length ===
      2,
  );
  check(
    "transactions still validate their shape and stay owner-only",
    txnsBlock.includes("incoming().partyId is number") &&
      (txnsBlock.match(/isOwner\(userId\)/g) ?? []).length >= 3,
  );
  check(
    "the transaction delete rule is deliberately unchanged (the app's removeTxn feature)",
    txnsBlock.includes("allow delete: if isOwner(userId) && isValidId(txnId);"),
  );
  check(
    "the rules still default-deny every other path",
    rules.includes("allow read, write: if false;"),
  );
}

console.log(
  `\n${passed} checks passed, ${failures.length} failed.\n${
    failures.length ? `Failed:\n${failures.map((f) => `  - ${f}`).join("\n")}` : "✔ sync safety verified"
  }`,
);

if (failures.length > 0) process.exit(1);
