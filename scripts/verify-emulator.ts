/**
 * Firebase Emulator integration tests (stage 4).
 *
 * Run with:
 *   firebase emulators:exec --only firestore,auth --project demo-sauti-test \
 *     "bun scripts/verify-emulator.ts"
 *
 * What is really being tested (a live Firestore emulator loading this
 * repository's own `firestore.rules`):
 *
 *  - UID isolation: a second signed-in user, and an unauthenticated client,
 *    must not be able to read, write or delete another user's documents;
 *  - payload validation by the rules (bad amount, bad monthKey, oversized
 *    detail, unknown kind, unknown collection);
 *  - the real upload/download decision functions (`planUpload`,
 *    `validateCloudRows`, `mergeCloudRows`) against documents that actually
 *    exist in the emulator: idempotent retry, stale-device reconnection, clock
 *    skew, missing-from-this-device, duplicate payload rows;
 *  - party and party-transaction rules and stored data, including the known
 *    orphan-transaction gap after a party deletion, which this script records
 *    instead of hiding;
 *  - sync/settings documents.
 *
 * Two app instances are signed into the *same* account so they share one uid —
 * that is what "two devices of one user" means in Firestore terms. A third
 * account is used only to prove isolation.
 *
 * SAFETY: the project id is `demo-sauti-test`, which Firebase reserves for
 * emulator-only use, and every client below is explicitly connected to the
 * emulator hosts. The script refuses to run at all when the emulator env vars
 * are missing, so it can never reach a production project.
 *
 * Stage 4A adds section H: tombstone creation and persistence, the durable
 * pending-deletion queue (success, real rejection, retry, restart), deletion
 * reaching a second device, a stale device that cannot resurrect a tombstone,
 * invalid tombstone payloads, cross-user denial, unrelated records staying
 * untouched, and totals with tombstones excluded. The queue lives in
 * localStorage in the app, so each simulated device gets its own store here.
 *
 * NOT tested here: live Firestore, UI behaviour, and the React hooks
 * themselves (the hooks only call the functions exercised below).
 */

import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  type Firestore,
} from "firebase/firestore";
import {
  mergeCloudRows,
  planUpload,
  recordFromEntry,
  validateCloudRows,
  type CloudRow,
  type ValidationOutcome,
  type ValidatedCloudRow,
} from "../src/hooks/use-merge-logic";
import {
  enqueuePendingDeletion,
  loadPendingDeletions,
  savePendingDeletions,
  syncPendingDeletions,
  type DeletionSyncOutcome,
} from "../src/lib/deletion-sync";
import { loadDeletedIds } from "../src/lib/sync-safety";
import type { Entry } from "../src/lib/khata";
import { makeParty, makePartyTxn, partyForCloud } from "../src/lib/parties";
import {
  classifyPartyDoc,
  decidePartySnapshot,
  dropStalePartyUpserts,
  enqueuePartyOps,
  flushPendingPartyOps,
  loadDeadPartyOps,
  loadPendingPartyOps,
  loadTombstonedPartyIds,
  MAX_PARTY_OP_ATTEMPTS,
  partyDeleteOp,
  partyTxnForCloud,
  partyTxnUpsertOp,
  partyUpsertOp,
  pendingPartyOpsById,
  rememberTombstonedPartyIds,
  savePendingPartyOps,
  splitImportableParties,
  type PartyFlushOutcome,
} from "../src/lib/party-sync";

/* ------------------------------------------------------------------ */
/* Safety gate — never run against a production project                */
/* ------------------------------------------------------------------ */

const PROJECT_ID = "demo-sauti-test";
const FS_HOSTPORT = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "";

if (!FS_HOSTPORT || !AUTH_HOST) {
  console.error(
    "SAFETY: emulator host env vars are missing — refusing to run. " +
      "Start this script through `firebase emulators:exec`.",
  );
  process.exit(2);
}

const [FS_HOST, FS_PORT_TEXT] = FS_HOSTPORT.split(":");
const FS_PORT = Number(FS_PORT_TEXT);

if (!FS_HOST || !Number.isFinite(FS_PORT)) {
  console.error(`SAFETY: unusable FIRESTORE_EMULATOR_HOST "${FS_HOSTPORT}".`);
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Tiny assertion harness                                              */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function expectDenied(
  label: string,
  run: () => Promise<unknown>,
): Promise<void> {
  const denied = await isDenied(run);
  check(label, denied.ok, denied.detail);
}

async function isDenied(
  run: () => Promise<unknown>,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    await run();
    return { ok: false, detail: "operation succeeded but must be denied" };
  } catch (error) {
    const code = (error as { code?: string }).code ?? String(error);
    return {
      ok: code.includes("permission-denied"),
      detail: `unexpected rejection: ${code}`,
    };
  }
}

async function expectDeniedReturn(
  run: () => Promise<unknown>,
): Promise<boolean> {
  return (await isDenied(run)).ok;
}

/* ------------------------------------------------------------------ */
/* Device helper — one Firebase app per simulated device               */
/* ------------------------------------------------------------------ */

type Device = {
  name: string;
  app: FirebaseApp;
  uid: string;
  db: Firestore;
};

async function boot(name: string): Promise<{ app: FirebaseApp; db: Firestore }> {
  const app = initializeApp(
    { apiKey: "fake-api-key", projectId: PROJECT_ID, authDomain: "localhost" },
    name,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, FS_HOST, FS_PORT);
  return { app, db };
}

function recordRef(device: Device, localId: number) {
  return doc(device.db, "users", device.uid, "records", String(localId));
}

/* ------------------------------------------------------------------ */
/* Device-local storage (the app uses real localStorage)               */
/* ------------------------------------------------------------------ */

/* Each simulated device gets its own store, so "device A deleted it" and
   "device B has not heard yet" stay separate facts, exactly like two phones.
   The deletion queue and the deletion markers are read through this store. */
const deviceStores = new Map<string, Map<string, string>>();
let activeStore: Map<string, string> | null = null;

function fakeStorage(store: Map<string, string>) {
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function selectDeviceStorage(name: string): Map<string, string> {
  let store = deviceStores.get(name);
  if (!store) {
    store = new Map<string, string>();
    deviceStores.set(name, store);
  }
  activeStore = store;
  const scope = globalThis as Record<string, unknown>;
  scope.window = globalThis;
  scope.localStorage = fakeStorage(store);
  return store;
}

selectDeviceStorage("unused");

/** Storage as it would be after an app restart: same bytes, no memory. */
function restartDevice(name: string): void {
  const store = deviceStores.get(name) ?? new Map<string, string>();
  deviceStores.set(name, new Map(store));
  selectDeviceStorage(name);
}

const storageKeys = (): string[] =>
  activeStore ? Array.from(activeStore.keys()).sort() : [];

function makeRow(
  localId: number,
  kind: "income" | "expense",
  amount: number,
  updatedAt: number,
): CloudRow {
  return {
    localId,
    kind,
    amount,
    detail: "عمومی خریداری",
    category: "فروخت",
    icon: "fa-tag",
    monthKey: "2026-10",
    date: "30/10/2026",
    time: "12:00",
    timestamp: updatedAt,
    updatedAt,
    account: "cash",
  };
}

function toEntry(row: CloudRow): Entry {
  return {
    id: row.localId,
    amount: row.amount,
    detail: row.detail,
    category: row.category,
    icon: row.icon,
    monthKey: row.monthKey,
    date: row.date,
    time: row.time,
    timestamp: row.timestamp,
    updatedAt: row.updatedAt,
    account: row.account,
  };
}

function rowsOf(outcomes: ValidationOutcome[]): ValidatedCloudRow[] {
  return outcomes
    .filter((outcome): outcome is { ok: true; row: ValidatedCloudRow } => outcome.ok)
    .map((outcome) => outcome.row);
}

async function readRows(device: Device): Promise<CloudRow[]> {
  const snapshot = await getDocs(
    collection(device.db, "users", device.uid, "records"),
  );
  const rows: CloudRow[] = [];
  snapshot.forEach((snap) => {
    rows.push(snap.data() as CloudRow);
  });
  return rows;
}

/**
 * Mirrors `use-sync.upload`: deliver the queued deletions first (as
 * tombstones), then plan and write the records. Same order, same functions.
 */
async function runUpload(
  device: Device,
  local: CloudRow[],
  storage?: string,
): Promise<{
  planned: number;
  cloudNewer: number;
  unchanged: number;
  cloudOnly: number;
  tombstoned: number;
  deletions: DeletionSyncOutcome | null;
}> {
  if (storage) selectDeviceStorage(storage);
  const cloud = await readRows(device);

  let deletions: DeletionSyncOutcome | null = null;
  const queued = loadPendingDeletions();
  if (queued.length > 0) {
    deletions = await syncPendingDeletions({
      pending: queued,
      cloudRows: cloud,
      write: async (row) => {
        await setDoc(recordRef(device, row.localId), row);
      },
    });
    savePendingDeletions(deletions.remaining);
  }

  const byId = new Map<string, CloudRow>();
  for (const row of cloud) byId.set(String(row.localId), row);
  for (const row of deletions?.tombstones ?? []) byId.set(String(row.localId), row);

  const plan = planUpload(local, Array.from(byId.values()));
  for (const row of plan.writes) {
    await setDoc(recordRef(device, row.localId), row);
  }
  return {
    planned: plan.writes.length,
    cloudNewer: plan.cloudNewer,
    unchanged: plan.unchanged,
    cloudOnly: plan.cloudOnly,
    tombstoned: plan.tombstoned,
    deletions,
  };
}

/**
 * Mirrors `use-sync.download`: validate the payload, then merge it. Deletion
 * markers default to this device's own storage and tombstone ids are
 * remembered locally, exactly like the app does.
 */
function runDownload(
  local: CloudRow[],
  cloud: CloudRow[],
  deletedIds?: number[],
  storage?: string,
) {
  if (storage) selectDeviceStorage(storage);
  const markers = deletedIds ?? loadDeletedIds();
  const validated = rowsOf(validateCloudRows(cloud));
  const merged = mergeCloudRows(
    local.filter((row) => row.kind === "income").map(toEntry),
    local.filter((row) => row.kind === "expense").map(toEntry),
    validated,
    markers,
  );
  if (merged.tombstoneIds.length > 0) {
    const markers = new Set(loadDeletedIds());
    for (const id of merged.tombstoneIds) markers.add(id);
    localStorage.setItem("sauti_deleted_ids", JSON.stringify(Array.from(markers)));
  }
  return merged;
}

/**
 * Mirrors the delivery effect in `use-parties`: send the queued party/txn
 * operations with the real Firestore client, keep whatever failed.
 */
async function runPartyFlush(device: Device): Promise<PartyFlushOutcome> {
  const ops = loadPendingPartyOps();
  if (ops.length === 0) {
    return {
      applied: 0,
      alreadyDeleted: 0,
      missing: 0,
      failed: 0,
      stale: 0,
      resurrectBlocked: 0,
      abandoned: 0,
      deferred: 0,
      failures: [],
      retired: [],
      remaining: [],
    };
  }
  const outcome = await flushPendingPartyOps({
    ops,
    uid: device.uid,
    read: async (target, id) => {
      const snap = await getDoc(doc(device.db, "users", device.uid, target, String(id)));
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    },
    write: async (target, id, data) => {
      await setDoc(doc(device.db, "users", device.uid, target, String(id)), data);
    },
    remove: async (target, id) => {
      await deleteDoc(doc(device.db, "users", device.uid, target, String(id)));
    },
  });
  savePendingPartyOps(outcome.remaining);
  return outcome;
}

const sum = (rows: CloudRow[], kind: "income" | "expense"): number =>
  rows.filter((row) => row.kind === kind).reduce((total, row) => total + row.amount, 0);

const sumEntries = (entries: Entry[]): number =>
  entries.reduce((total, entry) => total + entry.amount, 0);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const OWNER_EMAIL = "sauti-owner@test.local";
const OTHER_EMAIL = "sauti-other@test.local";
const PASSWORD = "test-password-1";

async function main(): Promise<void> {
  console.log(
    `Emulator target: firestore=${FS_HOSTPORT} auth=${AUTH_HOST} project=${PROJECT_ID}`,
  );

  /* Two devices of the same user, one device of a different user, one
     unauthenticated client. */
  const owner1 = await boot("owner-1");
  const ownerCredential = await createUserWithEmailAndPassword(
    getAuth(owner1.app),
    OWNER_EMAIL,
    PASSWORD,
  );
  const deviceA: Device = {
    name: "device-A",
    app: owner1.app,
    uid: ownerCredential.user.uid,
    db: owner1.db,
  };

  const owner2 = await boot("owner-2");
  await signInWithEmailAndPassword(getAuth(owner2.app), OWNER_EMAIL, PASSWORD);
  const deviceA2: Device = {
    name: "device-A-second",
    app: owner2.app,
    uid: getAuth(owner2.app).currentUser?.uid ?? "",
    db: owner2.db,
  };

  const other = await boot("other-user");
  await createUserWithEmailAndPassword(getAuth(other.app), OTHER_EMAIL, PASSWORD);
  const deviceB: Device = {
    name: "device-B-other-user",
    app: other.app,
    uid: getAuth(other.app).currentUser?.uid ?? "",
    db: other.db,
  };

  // Deliberately never signed in: this client has no identity at all.
  const anon = await boot("anon");

  section("A. Authentication & identity");
  check("device A signed in", deviceA.uid.length > 0, deviceA.uid);
  check(
    "the second device of the same user shares the same uid",
    deviceA2.uid === deviceA.uid,
    `${deviceA.uid} vs ${deviceA2.uid}`,
  );
  check(
    "the other user has a different uid",
    deviceB.uid.length > 0 && deviceB.uid !== deviceA.uid,
    `${deviceA.uid} vs ${deviceB.uid}`,
  );

  section("B. Security rules — UID isolation");
  const rowA = makeRow(910001, "income", 5000, Date.now());
  await setDoc(recordRef(deviceA, rowA.localId), rowA);
  const stored = await getDoc(recordRef(deviceA, rowA.localId));
  check(
    "A can create its own record and it is really stored",
    stored.exists() && stored.data()?.amount === 5000,
    JSON.stringify(stored.data() ?? null),
  );

  const sameUidRead = await getDoc(
    doc(deviceA2.db, "users", deviceA.uid, "records", "910001"),
  );
  check(
    "the same user's second device can read the record",
    sameUidRead.exists() && sameUidRead.data()?.amount === 5000,
  );

  await expectDenied("another user cannot read A's record", () =>
    getDoc(doc(deviceB.db, "users", deviceA.uid, "records", "910001")),
  );
  await expectDenied("another user cannot overwrite A's record", () =>
    setDoc(
      doc(deviceB.db, "users", deviceA.uid, "records", "910001"),
      makeRow(910001, "income", 1, Date.now()),
    ),
  );
  await expectDenied("another user cannot delete A's record", () =>
    deleteDoc(doc(deviceB.db, "users", deviceA.uid, "records", "910001")),
  );
  const afterAttempt = await getDoc(recordRef(deviceA, 910001));
  check(
    "A's record survived the rejected delete attempt",
    afterAttempt.exists() && afterAttempt.data()?.amount === 5000,
  );

  await expectDenied("unauthenticated client cannot write", () =>
    setDoc(doc(anon.db, "users", deviceA.uid, "records", "910002"), rowA),
  );
  await expectDenied("unauthenticated client cannot read", () =>
    getDoc(doc(anon.db, "users", deviceA.uid, "records", "910001")),
  );
  await expectDenied("another user cannot read A's profile doc", () =>
    getDoc(doc(deviceB.db, "users", deviceA.uid)),
  );
  await expectDenied("unknown collection under the user path is denied", () =>
    getDocs(collection(deviceA.db, "users", deviceA.uid, "randomCollection")),
  );

  section("C. Security rules — payload validation");
  await expectDenied("amount as a string is rejected", () =>
    setDoc(recordRef(deviceA, 910003), { ...rowA, localId: 910003, amount: "5000" }),
  );
  await expectDenied("monthKey that is not YYYY-MM is rejected (2026)", () =>
    setDoc(recordRef(deviceA, 910004), { ...rowA, localId: 910004, monthKey: "2026" }),
  );
  await expectDenied("monthKey with a one-digit month is rejected (2026-1)", () =>
    setDoc(recordRef(deviceA, 910011), { ...rowA, localId: 910011, monthKey: "2026-1" }),
  );
  await expectDenied("monthKey without a separator is rejected (202610)", () =>
    setDoc(recordRef(deviceA, 910012), { ...rowA, localId: 910012, monthKey: "202610" }),
  );
  await setDoc(recordRef(deviceA, 910013), { ...rowA, localId: 910013, monthKey: "2026-05" });
  check(
    "a proper YYYY-MM monthKey is still accepted",
    (await getDoc(recordRef(deviceA, 910013))).exists(),
  );
  await expectDenied("detail longer than 500 chars is rejected", () =>
    setDoc(recordRef(deviceA, 910005), {
      ...rowA,
      localId: 910005,
      detail: "x".repeat(501),
    }),
  );
  await expectDenied("kind outside income/expense is rejected", () =>
    setDoc(recordRef(deviceA, 910006), { ...rowA, localId: 910006, kind: "loan" }),
  );
  let extraFieldAccepted = false;
  try {
    await setDoc(recordRef(deviceA, 910007), {
      ...rowA,
      localId: 910007,
      uid: deviceB.uid,
    });
    extraFieldAccepted = true;
  } catch {
    extraFieldAccepted = false;
  }
  check(
    "extra body fields are tolerated (no hasOnly in the rules) — the path decides ownership",
    extraFieldAccepted,
  );
  const foreignBodyStillDenied = await expectDeniedReturn(() =>
    getDoc(doc(deviceB.db, "users", deviceA.uid, "records", "910007")),
  );
  check(
    "a body field claiming another uid grants no access",
    foreignBodyStillDenied,
  );

  const rejectedAbsent = await getDoc(recordRef(deviceA, 910003));
  check("rejected payloads were never stored", !rejectedAbsent.exists());

  // Clean up every security-test record so the multi-device counts below start
  // from an empty cloud for this user.
  for (const id of [910001, 910004, 910007, 910013]) {
    await deleteDoc(recordRef(deviceA, id));
  }
  check(
    "cleanup: security-test records removed",
    (await readRows(deviceA)).length === 0,
    `docs=${(await readRows(deviceA)).length}`,
  );

  section("D. Records — two devices, one user (upload / download)");
  const t0 = Date.now() - 60_000;
  const aRows: CloudRow[] = [
    makeRow(920001, "income", 5000, t0),
    makeRow(920002, "expense", 1000, t0 + 1),
  ];
  const first = await runUpload(deviceA, aRows);
  check("device A uploaded both records", first.planned === 2, JSON.stringify(first));

  const retry = await runUpload(deviceA, aRows);
  check(
    "repeating the upload rewrites nothing (idempotent)",
    retry.planned === 0 && retry.unchanged === 2,
    JSON.stringify(retry),
  );
  const afterRetry = await readRows(deviceA);
  check("no duplicate documents after the retry", afterRetry.length === 2);
  check(
    "stored totals equal what A sent",
    sum(afterRetry, "income") === 5000 && sum(afterRetry, "expense") === 1000,
    `income=${sum(afterRetry, "income")} expense=${sum(afterRetry, "expense")}`,
  );

  const bRows: CloudRow[] = [
    makeRow(920003, "income", 3000, t0 + 10),
    makeRow(920004, "expense", 500, t0 + 11),
  ];
  const second = await runUpload(deviceA2, bRows);
  check("the second device uploaded its own records", second.planned === 2, JSON.stringify(second));

  const cloudRows = await readRows(deviceA);
  check(
    "the cloud now holds four records for this user",
    cloudRows.length === 4,
    `docs=${cloudRows.length}`,
  );

  const downloadA = runDownload(aRows, cloudRows, []);
  check(
    "download on device A adds the second device's records exactly once",
    downloadA.added === 2 && downloadA.kept === 2,
    `added=${downloadA.added} kept=${downloadA.kept}`,
  );
  const incomeA = sumEntries(downloadA.income);
  const expenseA = sumEntries(downloadA.expense);
  check(
    "financial totals after merge: income 8000 / expense 1500",
    incomeA === 8000 && expenseA === 1500,
    `income=${incomeA} expense=${expenseA}`,
  );

  const downloadB = runDownload(bRows, cloudRows, []);
  const incomeB = sumEntries(downloadB.income);
  const expenseB = sumEntries(downloadB.expense);
  check(
    "both devices converge on identical totals",
    incomeB === 8000 && expenseB === 1500 && incomeB === incomeA && expenseB === expenseA,
    `income=${incomeB} expense=${expenseB}`,
  );
  check(
    "the net balance survives the round trip (8000 - 1500 = 6500)",
    incomeA - expenseA === 6500 && incomeB - expenseB === 6500,
    `A=${incomeA - expenseA} B=${incomeB - expenseB}`,
  );

  section("E. Records — stale device, clock skew, deletion, duplicates");

  const newer = makeRow(920001, "income", 7777, t0 + 5_000);
  await setDoc(recordRef(deviceA, newer.localId), newer);
  const staleCopy = makeRow(920001, "income", 4500, t0);
  const stalePlan = planUpload([staleCopy], await readRows(deviceA));
  check(
    "an old device cannot roll back the newer cloud edit",
    stalePlan.writes.length === 0 && stalePlan.cloudNewer === 1,
    JSON.stringify({ writes: stalePlan.writes.length, cloudNewer: stalePlan.cloudNewer }),
  );
  const afterStale = await getDoc(recordRef(deviceA, 920001));
  check(
    "the newer value is still stored after the old device ran its upload",
    afterStale.data()?.amount === 7777,
    `amount=${String(afterStale.data()?.amount)}`,
  );

  await setDoc(recordRef(deviceA, 920006), makeRow(920006, "income", 1111, t0 + 100));
  const skewedLocal = makeRow(
    920006,
    "income",
    2222,
    Date.now() + 10 * 24 * 60 * 60 * 1000,
  );
  const skewPlan = planUpload([skewedLocal], await readRows(deviceA));
  const skewWrite = skewPlan.writes.some((row) => row.localId === 920006);
  check(
    "a clock set far in the future cannot overwrite the cloud copy",
    !skewWrite && skewPlan.cloudNewer === 1,
    JSON.stringify({ wrote: skewWrite, cloudNewer: skewPlan.cloudNewer }),
  );
  const afterSkew = await getDoc(recordRef(deviceA, 920006));
  check(
    "cloud value unchanged after the skewed device's upload",
    afterSkew.data()?.amount === 1111,
    `amount=${String(afterSkew.data()?.amount)}`,
  );

  const beforeCount = (await readRows(deviceA)).length;
  const withoutDeleted = aRows.filter((row) => row.localId !== 920002);
  const noDeletePlan = planUpload(withoutDeleted, await readRows(deviceA));
  for (const row of noDeletePlan.writes) {
    await setDoc(recordRef(deviceA, row.localId), row);
  }
  const afterCount = (await readRows(deviceA)).length;
  check(
    "a record missing from this device is never deleted from the cloud",
    afterCount === beforeCount && noDeletePlan.cloudOnly >= 1,
    `before=${beforeCount} after=${afterCount} cloudOnly=${noDeletePlan.cloudOnly}`,
  );

  const cloudNow = await readRows(deviceA);
  const validated = validateCloudRows(cloudNow);
  check(
    "every stored document passes the download validator",
    validated.every((outcome) => outcome.ok),
    validated
      .filter((outcome) => !outcome.ok)
      .map((outcome) => (outcome.ok ? "" : outcome.reason))
      .join("; "),
  );

  const localAfterDelete = cloudNow.filter((row) => row.localId !== 920002);
  const withDeletion = runDownload(localAfterDelete, cloudNow, [920002]);
  check(
    "a locally deleted record is not resurrected by the next download",
    withDeletion.income.some((entry) => entry.id === 920001) &&
      !withDeletion.expense.some((entry) => entry.id === 920002) &&
      withDeletion.skippedDeleted === 1,
    `skippedDeleted=${withDeletion.skippedDeleted}`,
  );
  const deletedStillInCloud = await getDoc(recordRef(deviceA, 920002));
  check(
    "a plain upload never deletes a cloud document (deletions travel as tombstones)",
    deletedStillInCloud.exists() && deletedStillInCloud.data()?.deleted !== true,
  );

  const otherDeviceStillSeesIt = await getDoc(
    doc(deviceA2.db, "users", deviceA.uid, "records", "920002"),
  );
  check(
    "the document is still active for the other device until a tombstone is written",
    otherDeviceStillSeesIt.exists() && otherDeviceStillSeesIt.data()?.deleted !== true,
  );

  const duplicated = rowsOf(validateCloudRows([...cloudNow, ...cloudNow]));
  const deduped = mergeCloudRows([], [], duplicated, []);
  check(
    "duplicate rows inside one payload are counted once",
    deduped.added === cloudNow.length,
    `added=${deduped.added} expected=${cloudNow.length}`,
  );

  const rest = await readRows(deviceA);
  check(
    "active totals still add up after every scenario (income 11888 / expense 1500)",
    sum(rest, "income") === 7777 + 3000 + 1111 && sum(rest, "expense") === 1500,
    `income=${sum(rest, "income")} expense=${sum(rest, "expense")}`,
  );

  section("H. Tombstones — deletion sync, retry, stale devices (stage 4A)");
  /* Device A performs every deletion; device A2 is the same user's second
     device with its own device storage. Both see one emulator account. */
  selectDeviceStorage("A");
  const hBase = Date.now() - 120_000;
  const hRows: CloudRow[] = [
    makeRow(930001, "income", 4000, hBase),
    makeRow(930002, "expense", 1200, hBase + 1),
    makeRow(930003, "income", 2000, hBase + 2),
    makeRow(930004, "expense", 300, hBase + 3),
  ];
  const rowOf = (id: number): CloudRow => hRows.find((row) => row.localId === id) as CloudRow;

  const hUpload = await runUpload(deviceA, hRows, "A");
  check("four records uploaded for the tombstone scenarios", hUpload.planned === 4, JSON.stringify(hUpload));

  const legacyBefore = (await getDoc(recordRef(deviceA, 930001))).data() ?? {};
  check(
    "(14) a record written without tombstone fields stays a plain active record",
    !("deleted" in legacyBefore) && legacyBefore.amount === 4000,
    JSON.stringify(Object.keys(legacyBefore)),
  );
  check(
    "(14) such a document still passes the download validator as active",
    validateCloudRows([legacyBefore as CloudRow])[0].ok === true &&
      (validateCloudRows([legacyBefore as CloudRow])[0] as { ok: true; row: ValidatedCloudRow }).row
        .deleted === false,
  );

  const cloudBeforeTombstone = await readRows(deviceA);
  const bBefore = runDownload(hRows, cloudBeforeTombstone, [], "A2");
  check(
    "the second device holds all four records before the deletion",
    bBefore.kept === 4 &&
      bBefore.income.filter((entry) => entry.id >= 930000 && entry.id < 930010).length === 2 &&
      bBefore.expense.filter((entry) => entry.id >= 930000 && entry.id < 930010).length === 2,
    `kept=${bBefore.kept}`,
  );

  /* (1) tombstone creation through the real queue + upload path */
  selectDeviceStorage("A");
  const queuedA = enqueuePendingDeletion(toEntry(rowOf(930002)), "expense");
  check(
    "(1) the deletion is queued locally before any network call",
    queuedA.localId === 930002 && loadPendingDeletions().length === 1,
  );

  const ledgerAfterDelete = hRows.filter((row) => row.localId !== 930002);
  const deleteUpload = await runUpload(deviceA, ledgerAfterDelete, "A");
  const tombData = (await getDoc(recordRef(deviceA, 930002))).data() ?? {};
  check(
    "(1) the deleted record became a tombstone in Firestore",
    tombData.deleted === true &&
      typeof tombData.deletedAt === "number" &&
      typeof tombData.deletedEventId === "string" &&
      typeof tombData.deletedBy === "string" &&
      typeof tombData.deletedVersion === "number",
    JSON.stringify(tombData),
  );
  check(
    "(1) the tombstone keeps the record's own values (nothing overwritten)",
    tombData.amount === 1200 && tombData.kind === "expense" && tombData.localId === 930002,
    `amount=${String(tombData.amount)}`,
  );
  check(
    "(3) the queue is empty after a successful delivery",
    deleteUpload.deletions?.applied === 1 && loadPendingDeletions().length === 0,
    JSON.stringify({ applied: deleteUpload.deletions?.applied, queue: loadPendingDeletions().length }),
  );

  /* (5) the same event replayed, and (2) persistence of the tombstone */
  let replayWrites = 0;
  const replay = await syncPendingDeletions({
    pending: [queuedA],
    cloudRows: await readRows(deviceA),
    write: async () => {
      replayWrites += 1;
    },
  });
  check(
    "(5) replaying one deletion event again is idempotent",
    replay.alreadyDeleted === 1 && replayWrites === 0 && replay.remaining.length === 0 && replay.failed === 0,
    JSON.stringify({ already: replay.alreadyDeleted, writes: replayWrites }),
  );
  const tombAgain = (await getDoc(recordRef(deviceA, 930002))).data() ?? {};
  check(
    "(2) the tombstone persists unchanged after the retry",
    tombAgain.deleted === true && tombAgain.deletedAt === tombData.deletedAt,
  );

  /* (4) a rejected write keeps the event, (13) a restart keeps it too */
  selectDeviceStorage("A");
  enqueuePendingDeletion(toEntry(rowOf(930004)), "expense");
  const failing = await syncPendingDeletions({
    pending: loadPendingDeletions(),
    cloudRows: await readRows(deviceA),
    /* A real rejection from the emulator: this client writes into the other
       user's records path, which the rules deny. */
    write: async (row) => {
      await setDoc(doc(deviceB.db, "users", deviceA.uid, "records", String(row.localId)), row);
    },
  });
  check(
    "(4) a rejected deletion write stays pending and is reported with a reason",
    failing.failed === 1 &&
      failing.remaining.length === 1 &&
      failing.failures[0].localId === 930004 &&
      failing.failures[0].reason.length > 0,
    JSON.stringify({ failed: failing.failed, reason: failing.failures[0]?.reason.slice(0, 60) }),
  );
  savePendingDeletions(failing.remaining);
  check(
    "(4) the unsent deletion is still in device storage",
    loadPendingDeletions().length === 1 && loadPendingDeletions()[0].localId === 930004,
  );

  restartDevice("A");
  check(
    "(13) an app restart preserves the pending deletion event",
    loadPendingDeletions().length === 1 && loadPendingDeletions()[0].localId === 930004,
    `keys=${storageKeys().join(",")}`,
  );
  const retried = await runUpload(
    deviceA,
    hRows.filter((row) => row.localId !== 930002 && row.localId !== 930004),
    "A",
  );
  check(
    "(3) the retry after restart delivers the previously failed deletion",
    retried.deletions?.applied === 1 && loadPendingDeletions().length === 0,
    JSON.stringify({ applied: retried.deletions?.applied, queue: loadPendingDeletions().length }),
  );
  check(
    "(3) the retried record is now a tombstone",
    (await getDoc(recordRef(deviceA, 930004))).data()?.deleted === true,
  );

  /* (6) deletion reaching the second device, and (12) totals */
  const cloudAfterTombstones = await readRows(deviceA);
  const bAfter = runDownload(hRows, cloudAfterTombstones, undefined, "A2");
  const hOnly = (entries: Entry[]) => entries.filter((entry) => entry.id >= 930000 && entry.id < 930010);
  check(
    "(6) the second device drops both deleted records on download",
    !bAfter.expense.some((entry) => entry.id === 930002) &&
      !bAfter.expense.some((entry) => entry.id === 930004) &&
      bAfter.tombstoned === 2,
    JSON.stringify({ tombstoned: bAfter.tombstoned, expense: bAfter.expense.map((entry) => entry.id) }),
  );
  check(
    "(12) totals for this ledger exclude tombstoned money: income 6000 / expense 0 / balance 6000",
    sumEntries(hOnly(bAfter.income)) === 6000 &&
      sumEntries(hOnly(bAfter.expense)) === 0 &&
      sumEntries(hOnly(bAfter.income)) - sumEntries(hOnly(bAfter.expense)) === 6000,
    `income=${sumEntries(hOnly(bAfter.income))} expense=${sumEntries(hOnly(bAfter.expense))}`,
  );

  /* (15) a repeated download must not bring anything back */
  const bRowsAfter = [
    ...bAfter.income.map((entry) => recordFromEntry(entry, "income")),
    ...bAfter.expense.map((entry) => recordFromEntry(entry, "expense")),
  ];
  const bAgain = runDownload(bRowsAfter, cloudAfterTombstones, undefined, "A2");
  check(
    "(15) a repeated download does not resurrect the deleted records",
    !bAgain.expense.some((entry) => entry.id === 930002) &&
      !bAgain.expense.some((entry) => entry.id === 930004) &&
      bAgain.tombstoned === 0 &&
      hOnly(bAgain.income).length === 2,
    JSON.stringify({ tombstoned: bAgain.tombstoned, income: hOnly(bAgain.income).length }),
  );

  /* (7) a stale device holding the old record still active */
  const staleTombstonePlan = await runUpload(deviceA2, [rowOf(930002)], "A2");
  check(
    "(7) a stale active upload cannot overwrite the tombstone",
    staleTombstonePlan.planned === 0 && staleTombstonePlan.tombstoned === 1,
    JSON.stringify({ planned: staleTombstonePlan.planned, tombstoned: staleTombstonePlan.tombstoned }),
  );
  const stillTombstone = (await getDoc(recordRef(deviceA, 930002))).data() ?? {};
  check(
    "(7) the cloud copy is still deleted and unchanged",
    stillTombstone.deleted === true && stillTombstone.amount === 1200,
  );

  /* (8) invalid tombstone payloads are rejected by the rules */
  const goodTombstone: CloudRow = {
    ...makeRow(930010, "income", 100, hBase),
    deleted: true,
    deletedAt: Date.now(),
    deletedEventId: "event-930010",
    deletedBy: "d-test",
    deletedVersion: hBase,
  };
  await expectDenied("(8) a non-boolean deleted flag is rejected", () =>
    setDoc(recordRef(deviceA, 930010), { ...goodTombstone, deleted: "yes" }),
  );
  await expectDenied("(8) deleted:true without deletedAt is rejected", () => {
    const withoutDeletedAt: CloudRow = { ...goodTombstone };
    delete withoutDeletedAt.deletedAt;
    return setDoc(recordRef(deviceA, 930010), withoutDeletedAt);
  });
  await expectDenied("(8) a string deletedAt is rejected", () =>
    setDoc(recordRef(deviceA, 930010), { ...goodTombstone, deletedAt: "now" }),
  );
  await expectDenied("(8) an oversized deletedEventId is rejected", () =>
    setDoc(recordRef(deviceA, 930010), { ...goodTombstone, deletedEventId: "x".repeat(129) }),
  );
  await setDoc(recordRef(deviceA, 930010), goodTombstone);
  check(
    "(8) a well-formed tombstone is accepted",
    (await getDoc(recordRef(deviceA, 930010))).data()?.deleted === true,
  );

  await expectDenied("a tombstone cannot be turned back into an active record", () =>
    setDoc(recordRef(deviceA, 930010), makeRow(930010, "income", 100, hBase)),
  );
  check(
    "the resurrection attempt left the tombstone intact",
    (await getDoc(recordRef(deviceA, 930010))).data()?.deleted === true,
  );

  /* (9) another user cannot tombstone A's records */
  await expectDenied("(9) another user cannot write a tombstone into A's records", () =>
    setDoc(doc(deviceB.db, "users", deviceA.uid, "records", "930003"), {
      ...makeRow(930003, "income", 2000, hBase + 2),
      deleted: true,
      deletedAt: Date.now(),
      deletedEventId: "other-user",
    }),
  );
  check(
    "(9) A's record is still active after the rejected deletion",
    (await getDoc(recordRef(deviceA, 930003))).data()?.deleted !== true,
  );

  /* (11) unrelated records are untouched by the tombstones */
  const legacyAfter = (await getDoc(recordRef(deviceA, 930001))).data() ?? {};
  check(
    "(11) an unrelated record is unchanged by the deletions",
    JSON.stringify(legacyAfter) === JSON.stringify(legacyBefore),
    JSON.stringify(legacyAfter),
  );
  await setDoc(recordRef(deviceA, 930001), {
    ...makeRow(930001, "income", 4500, hBase + 500),
    updatedAt: hBase + 500,
  });
  check(
    "(14) an existing record can still be updated after stage 4A",
    (await getDoc(recordRef(deviceA, 930001))).data()?.amount === 4500,
  );

  /* (12) cloud-side totals with tombstones excluded */
  const finalCloud = await readRows(deviceA);
  const activeCloud = finalCloud.filter(
    (row) => row.deleted !== true && row.localId >= 930000 && row.localId < 930010,
  );
  check(
    "(12) cloud totals exclude tombstones: income 6500 / expense 0 / balance 6500",
    sum(activeCloud, "income") === 6500 &&
      sum(activeCloud, "expense") === 0 &&
      sum(activeCloud, "income") - sum(activeCloud, "expense") === 6500,
    `income=${sum(activeCloud, "income")} expense=${sum(activeCloud, "expense")}`,
  );

  section("F. Parties — storage, rules and relationships");
  const party = makeParty({
    name: "الیکٹرک شاپ",
    phone: "03001234567",
    kind: "customer",
  });
  const partyRef = doc(deviceA.db, "users", deviceA.uid, "parties", String(party.id));
  await setDoc(partyRef, partyForCloud(party));
  const partySnap = await getDoc(partyRef);
  check(
    "party with an empty note is stored (undefined-field write bug fixed)",
    partySnap.exists() &&
      partySnap.data()?.id === party.id &&
      !("note" in (partySnap.data() ?? {})),
    JSON.stringify(partySnap.data() ?? null),
  );

  await expectDenied("another user cannot read A's party", () =>
    getDoc(doc(deviceB.db, "users", deviceA.uid, "parties", String(party.id))),
  );
  await expectDenied("another user cannot delete A's party", () =>
    deleteDoc(doc(deviceB.db, "users", deviceA.uid, "parties", String(party.id))),
  );
  await expectDenied("another user cannot create a party inside A's path", () =>
    setDoc(
      doc(deviceB.db, "users", deviceA.uid, "parties", "999999999"),
      partyForCloud({ ...party, id: 999999999 }),
    ),
  );

  const renamed = { ...party, name: "الیکٹرک شاپ (نیا نام)" };
  await setDoc(partyRef, partyForCloud(renamed));
  check(
    "party update keeping createdAt is accepted",
    (await getDoc(partyRef)).data()?.name === "الیکٹرک شاپ (نیا نام)",
  );
  await expectDenied("party update rewriting createdAt is rejected", () =>
    setDoc(partyRef, partyForCloud({ ...renamed, createdAt: Date.now() })),
  );
  await expectDenied("party with a one-character name is rejected", () =>
    setDoc(
      doc(deviceA.db, "users", deviceA.uid, "parties", String(party.id + 1)),
      partyForCloud({ ...party, id: party.id + 1, name: "ع" }),
    ),
  );

  const txn = makePartyTxn(party.id, { kind: "charge", amount: 2500, note: " ادھار" });
  const txnRef = doc(deviceA.db, "users", deviceA.uid, "partyTxns", String(txn.id));
  await setDoc(txnRef, txn);
  check("party transaction is stored", (await getDoc(txnRef)).exists());

  await setDoc(txnRef, txn);
  const txnList = await getDocs(collection(deviceA.db, "users", deviceA.uid, "partyTxns"));
  check(
    "rewriting the same transaction id never creates a duplicate",
    txnList.size === 1,
    `docs=${txnList.size}`,
  );

  await expectDenied("transaction update that moves timestamp is rejected", () =>
    setDoc(txnRef, { ...txn, timestamp: txn.timestamp + 1000 }),
  );
  await setDoc(txnRef, { ...txn, note: "ادھار (ترمیم)" });
  const updatedTxn = await getDoc(txnRef);
  check(
    "transaction update keeping its timestamp is accepted (history preserved)",
    updatedTxn.data()?.note === "ادھار (ترمیم)" &&
      updatedTxn.data()?.timestamp === txn.timestamp,
  );

  const txn2 = makePartyTxn(party.id, { kind: "payment", amount: 500, account: "bank" });
  await setDoc(
    doc(deviceA.db, "users", deviceA.uid, "partyTxns", String(txn2.id)),
    txn2,
  );
  const balanceRows = await getDocs(
    collection(deviceA.db, "users", deviceA.uid, "partyTxns"),
  );
  let charge = 0;
  let payment = 0;
  balanceRows.forEach((snap) => {
    const data = snap.data() as { kind: string; amount: number };
    if (data.kind === "charge") charge += data.amount;
    if (data.kind === "payment") payment += data.amount;
  });
  check(
    "party dues are computed from stored data (2500 - 500 = 2000)",
    charge - payment === 2000 && charge === 2500 && payment === 500,
    `charge=${charge} payment=${payment}`,
  );

  /* Stage 4C-C: the entry carries the party's customer/supplier classification
     so the history stays readable after the party is deleted. Proving the rules
     accept the extra field is exactly why no rules change is needed. */
  const classified = makePartyTxn(
    party.id,
    { kind: "payment", amount: 100, partyKind: "supplier" },
    943_100,
  );
  const classifiedRef = doc(deviceA.db, "users", deviceA.uid, "partyTxns", String(classified.id));
  await setDoc(classifiedRef, partyTxnForCloud(classified));
  check(
    "(4C-C) a transaction carrying its party classification is accepted by the rules",
    (await getDoc(classifiedRef)).data()?.partyKind === "supplier",
    JSON.stringify((await getDoc(classifiedRef)).data() ?? null),
  );
  await deleteDoc(classifiedRef);

  /* Stage 4C-D: the owner-side hard-delete rule is gone. Deletion is the
     in-place tombstone the app already writes, so neither the party document
     nor the evidence of when it was deleted can be erased. */
  await expectDenied("the rules refuse a hard delete of a party (stage 4C-D)", () =>
    deleteDoc(partyRef),
  );
  check("the party document survives the refused hard delete", (await getDoc(partyRef)).exists());
  await setDoc(partyRef, {
    ...partyForCloud(renamed),
    deleted: true,
    deletedAt: Date.now(),
    deletedBy: "d-test",
  });
  check(
    "the app's own deletion — an in-place tombstone — is accepted",
    (await getDoc(partyRef)).data()?.deleted === true,
  );
  const txnsLeft = await getDocs(
    collection(deviceA.db, "users", deviceA.uid, "partyTxns"),
  );
  check(
    "the party's transactions survive its deletion (kept as history, not orphans by accident)",
    txnsLeft.size === 2,
    `remaining=${txnsLeft.size}`,
  );

  await expectDenied("another user cannot delete A's transaction", () =>
    deleteDoc(doc(deviceB.db, "users", deviceA.uid, "partyTxns", String(txn.id))),
  );
  await deleteDoc(txnRef);
  check(
    "A's own transaction deletion is effective",
    !(await getDoc(txnRef)).exists(),
  );

  section("G. Sync / settings documents");
  const syncRef = doc(deviceA.db, "users", deviceA.uid, "sync", "state");
  await setDoc(syncRef, { version: 2, updatedAt: Date.now() });
  check("sync state document is writable and readable", (await getDoc(syncRef)).exists());
  await expectDenied("sync state without a numeric version is rejected", () =>
    setDoc(doc(deviceB.db, "users", deviceB.uid, "sync", "state"), {
      version: "two",
      updatedAt: Date.now(),
    }),
  );
  await setDoc(doc(deviceA.db, "users", deviceA.uid, "settings", "current"), {
    budgets: [],
    recurring: [],
    updatedAt: Date.now(),
  });
  check(
    "settings document with extra updatedAt field is accepted",
    (
      await getDoc(doc(deviceA.db, "users", deviceA.uid, "settings", "current"))
    ).exists(),
  );

  section("I. Parties — durable retry, offline edits, imports (stage 4B)");

  /** Party document of the owner account. */
  const partyDoc = (id: number) =>
    doc(deviceA.db, "users", deviceA.uid, "parties", String(id));
  const txnDoc = (id: number) =>
    doc(deviceA.db, "users", deviceA.uid, "partyTxns", String(id));
  const txnCountOf = async (ids: number[]) => {
    const snap = await getDocs(
      collection(deviceA.db, "users", deviceA.uid, "partyTxns"),
    );
    let found = 0;
    snap.forEach((row) => {
      if (ids.includes((row.data() as { id: number }).id)) found += 1;
    });
    return found;
  };

  /* (9) an offline party edit survives a restart and reaches the cloud */
  selectDeviceStorage("party-device-A");
  savePendingPartyOps([]);
  const shop = makeParty(
    { name: "پنجاب ٹریڈرز", phone: "03001112223", kind: "customer" },
    941001,
  );
  enqueuePartyOps([partyUpsertOp(shop, Date.now(), deviceA.uid)]);
  const createdParty = await runPartyFlush(deviceA);
  check(
    "(9) a queued party reaches the cloud and leaves the queue",
    createdParty.applied === 1 &&
      loadPendingPartyOps().length === 0 &&
      (await getDoc(partyDoc(941001))).exists(),
    JSON.stringify({ applied: createdParty.applied }),
  );

  const editedOffline = { ...shop, name: "پنجاب ٹریڈرز (نیا نام)" };
  enqueuePartyOps([partyUpsertOp(editedOffline, Date.now() + 1_000, deviceA.uid)]);
  const cloudBeforeRetry = await getDoc(partyDoc(941001));
  check(
    "(9) while offline the edit is queued, not sent (cloud still holds the old name)",
    loadPendingPartyOps().length === 1 &&
      cloudBeforeRetry.data()?.name === "پنجاب ٹریڈرز" &&
      pendingPartyOpsById().get("parties:941001")?.kind === "upsert",
    JSON.stringify({ name: cloudBeforeRetry.data()?.name ?? null }),
  );
  check(
    "(9) the pending edit outranks the stale cloud copy (snapshot guard)",
    pendingPartyOpsById().has("parties:941001"),
  );

  restartDevice("party-device-A");
  check(
    "(18) pending party changes survive an app restart",
    loadPendingPartyOps().length === 1,
    `${loadPendingPartyOps().length}`,
  );
  const retriedEdit = await runPartyFlush(deviceA);
  check(
    "(9) reconnecting after the restart delivers the offline edit",
    retriedEdit.applied === 1 &&
      (await getDoc(partyDoc(941001))).data()?.name === "پنجاب ٹریڈرز (نیا نام)" &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({ applied: retriedEdit.applied }),
  );

  /* (10) a failed party deletion is never silently treated as done */
  selectDeviceStorage("party-device-A2");
  savePendingPartyOps([]);
  const doomed = makeParty({ name: "خالد جنرل اسٹور", kind: "supplier" }, 941002);
  enqueuePartyOps([partyUpsertOp(doomed, Date.now(), deviceA.uid)]);
  await runPartyFlush(deviceA);
  check("(10) the party to delete exists in the cloud", (await getDoc(partyDoc(941002))).exists());

  enqueuePartyOps([partyDeleteOp(941002, Date.now() + 500, deviceA.uid)]);
  const rejected = await (async () => {
    const ops = loadPendingPartyOps();
    const outcome = await flushPendingPartyOps({
      ops,
      uid: deviceA.uid,
      // Deliberately sent by the other user's client: the rules refuse it.
      read: async (target, id) => {
        const snap = await getDoc(
          doc(deviceB.db, "users", deviceA.uid, target, String(id)),
        );
        return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      },
      write: async () => {
        throw new Error("unexpected upsert");
      },
      remove: async (target, id) => {
        await deleteDoc(doc(deviceB.db, "users", deviceA.uid, target, String(id)));
      },
    });
    savePendingPartyOps(outcome.remaining);
    return outcome;
  })();
  check(
    "(10) a rejected deletion is reported and stays queued",
    rejected.failed === 1 && rejected.remaining.length === 1 && loadPendingPartyOps().length === 1,
    JSON.stringify({ failed: rejected.failed, reason: rejected.failures[0]?.reason ?? "" }),
  );
  check(
    "(10) the party is still in the cloud (a failed attempt deletes nothing)",
    (await getDoc(partyDoc(941002))).exists(),
  );
  const retriedDelete = await runPartyFlush(deviceA);
  const retriedDoc = await getDoc(partyDoc(941002));
  check(
    "(10) retrying the deletion completes it as a tombstone and clears the queue",
    retriedDelete.applied === 1 &&
      retriedDoc.exists() &&
      retriedDoc.data()?.deleted === true &&
      typeof retriedDoc.data()?.deletedAt === "number" &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      applied: retriedDelete.applied,
      deleted: retriedDoc.data()?.deleted,
      queue: loadPendingPartyOps().length,
    }),
  );

  /* (11) deleting a party never removes money-bearing rows in the cloud */
  const withTxns = makeParty({ name: "الیکٹرک پوائنٹ", kind: "customer" }, 941003);
  const chargeTxn = makePartyTxn(
    941003,
    { kind: "charge", amount: 2500, note: "ادھار" },
    941031,
  );
  const paymentTxn = makePartyTxn(941003, { kind: "payment", amount: 500 }, 941032);
  enqueuePartyOps([
    partyUpsertOp(withTxns, Date.now(), deviceA.uid),
    partyTxnUpsertOp(chargeTxn, Date.now(), deviceA.uid),
    partyTxnUpsertOp(paymentTxn, Date.now(), deviceA.uid),
  ]);
  const storedParty = await runPartyFlush(deviceA);
  check(
    "(11) party and its two transactions are stored",
    storedParty.applied === 3 && (await txnCountOf([941031, 941032])) === 2,
    JSON.stringify({ applied: storedParty.applied }),
  );
  enqueuePartyOps([partyDeleteOp(941003, Date.now() + 500, deviceA.uid)]);
  const deletedWithTxns = await runPartyFlush(deviceA);
  const tombstonedWithTxns = await getDoc(partyDoc(941003));
  check(
    "(11) the party document becomes a tombstone instead of being deleted",
    deletedWithTxns.applied === 1 &&
      tombstonedWithTxns.exists() &&
      tombstonedWithTxns.data()?.deleted === true &&
      tombstonedWithTxns.data()?.name === "الیکٹرک پوائنٹ",
    JSON.stringify({ applied: deletedWithTxns.applied, doc: tombstonedWithTxns.data() ?? null }),
  );
  check(
    "(11) the deleted party's transactions remain stored (financial history)",
    (await txnCountOf([941031, 941032])) === 2,
    `stored=${await txnCountOf([941031, 941032])}`,
  );
  check(
    "(11) no money-bearing row was deleted by the party removal",
    (await getDoc(txnDoc(941031))).data()?.amount === 2500 &&
      (await getDoc(txnDoc(941032))).data()?.amount === 500,
  );

  /* (12) a repeated import never duplicates rows */
  const importParty = makeParty({ name: "نور جنرل", kind: "customer" }, 941004);
  const importTxn = makePartyTxn(941004, { kind: "charge", amount: 700 }, 941033);
  const importOps = () => [
    partyUpsertOp(importParty, Date.now(), deviceA.uid),
    partyTxnUpsertOp(importTxn, Date.now(), deviceA.uid),
  ];
  enqueuePartyOps(importOps());
  const firstImport = await runPartyFlush(deviceA);
  enqueuePartyOps(importOps());
  const secondImport = await runPartyFlush(deviceA);
  const partiesAfterImport = await getDocs(
    collection(deviceA.db, "users", deviceA.uid, "parties"),
  );
  let importPartyRows = 0;
  partiesAfterImport.forEach((row) => {
    if ((row.data() as { id: number }).id === 941004) importPartyRows += 1;
  });
  check(
    "(12) importing the same file twice creates no duplicates",
    firstImport.applied === 2 &&
      secondImport.applied === 2 &&
      importPartyRows === 1 &&
      (await txnCountOf([941033])) === 1,
    JSON.stringify({ partyRows: importPartyRows }),
  );

  /* (13) remains a known limitation: an import stamps its own time, so a
     backup restored later still outranks a cloud edit made before it. A queued
     *edit* is protected instead — see section K. */
  enqueuePartyOps([
    partyUpsertOp({ ...importParty, name: "نور جنرل (تازہ نام)" }, Date.now() + 1_000, deviceA.uid),
  ]);
  await runPartyFlush(deviceA);
  enqueuePartyOps([partyUpsertOp({ ...importParty }, Date.now() + 2_000, deviceA.uid)]);
  await runPartyFlush(deviceA);
  check(
    "KNOWN GAP (imports carry no content version): a backup restored later still overwrites the newer cloud party",
    (await getDoc(partyDoc(941004))).data()?.name === "نور جنرل",
    String((await getDoc(partyDoc(941004))).data()?.name ?? ""),
  );

  /* (17) a partial delivery reports exact counts */
  selectDeviceStorage("party-device-A");
  savePendingPartyOps([]);
  const goodOne = makeParty({ name: "درست گاہک", kind: "customer" }, 941005);
  const invalidOne = makeParty({ name: "x", kind: "customer" }, 941006);
  const goodTwo = makeParty({ name: "دوسرا درست", kind: "customer" }, 941007);
  enqueuePartyOps([
    partyUpsertOp(goodOne, Date.now(), deviceA.uid),
    partyUpsertOp(invalidOne, Date.now(), deviceA.uid),
    partyUpsertOp(goodTwo, Date.now(), deviceA.uid),
  ]);
  const partialParty = await runPartyFlush(deviceA);
  check(
    "(17) a partial party sync reports applied/failed/remaining exactly",
    partialParty.applied === 2 &&
      partialParty.failed === 1 &&
      partialParty.remaining.length === 1 &&
      partialParty.remaining[0].id === 941006 &&
      loadPendingPartyOps().length === 1,
    JSON.stringify({
      applied: partialParty.applied,
      failed: partialParty.failed,
      remaining: partialParty.remaining.map((op) => op.id),
    }),
  );
  check(
    "(17) the two valid parties exist and the invalid one does not",
    (await getDoc(partyDoc(941005))).exists() &&
      !(await getDoc(partyDoc(941006))).exists() &&
      (await getDoc(partyDoc(941007))).exists(),
  );
  enqueuePartyOps([
    partyUpsertOp({ ...invalidOne, name: "درست نام" }, Date.now() + 1_000, deviceA.uid),
  ]);
  const corrected = await runPartyFlush(deviceA);
  check(
    "(17) retrying after the correction succeeds and empties the queue",
    corrected.applied === 1 &&
      (await getDoc(partyDoc(941006))).exists() &&
      loadPendingPartyOps().length === 0,
  );

  /* (19) a legacy party document (no note) is still readable */
  await setDoc(partyDoc(941008), {
    id: 941008,
    name: "پرانا سپلائر",
    phone: "",
    kind: "supplier",
    createdAt: Date.now(),
  });
  check(
    "(19) a legacy party without optional fields stays readable",
    (await getDoc(partyDoc(941008))).data()?.name === "پرانا سپلائر" &&
      !("note" in ((await getDoc(partyDoc(941008))).data() ?? {})),
  );

  /* (15) unsupported field types are still refused */
  const sampleRow = makeRow(941009, "expense", 1500, Date.now());
  await expectDenied("(15) a record whose amount is a string is rejected", () =>
    setDoc(recordRef(deviceA, 941009), {
      ...sampleRow,
      amount: "1500",
    } as unknown as CloudRow),
  );
  await expectDenied("(15) a record with an unknown kind is rejected", () =>
    setDoc(recordRef(deviceA, 941009), {
      ...sampleRow,
      kind: "transfer",
    } as unknown as CloudRow),
  );
  check(
    "(15) nothing was written by the rejected payloads",
    !(await getDoc(recordRef(deviceA, 941009))).exists(),
  );

  /* (16) a refused cloud read never triggers a write */
  const rowsBeforeRefusedRead = (await readRows(deviceA)).length;
  let refusedRead = false;
  try {
    await readRows({ ...deviceB, uid: deviceA.uid });
  } catch {
    refusedRead = true;
  }
  check("(16) a cross-uid read is refused", refusedRead);
  check(
    "(16) the refused read leaves the owner's records untouched",
    (await readRows(deviceA)).length === rowsBeforeRefusedRead,
    `${rowsBeforeRefusedRead}`,
  );

  /* Rules evidence for the proposed `allow delete: if false` change: today an
     owner can hard-delete a tombstone and create an active record again. */
  const tombstoneRow = {
    ...makeRow(941010, "income", 5000, Date.now() - 10_000),
    deleted: true,
    deletedAt: Date.now() - 5_000,
    deletedEventId: `${Date.now() - 5_000}-941010`,
    deletedVersion: Date.now() - 10_000,
    deletedBy: "d-test",
  };
  await setDoc(recordRef(deviceA, 941010), tombstoneRow);
  const tombstoneStored = await getDoc(recordRef(deviceA, 941010));
  check(
    "(rules) a tombstone is accepted and stored",
    tombstoneStored.data()?.deleted === true,
  );
  await expectDenied("(rules) a tombstone cannot be turned active by an update", () =>
    setDoc(recordRef(deviceA, 941010), makeRow(941010, "income", 5000, Date.now())),
  );
  await deleteDoc(recordRef(deviceA, 941010));
  const afterDelete = await getDoc(recordRef(deviceA, 941010));
  check(
    "KNOWN GAP (proposed: deny delete on records): the owner can hard-delete the tombstone",
    !afterDelete.exists(),
  );
  await setDoc(recordRef(deviceA, 941010), makeRow(941010, "income", 5000, Date.now()));
  const resurrected = await getDoc(recordRef(deviceA, 941010));
  check(
    "KNOWN GAP: after delete + create the record is active again (deletion lost)",
    resurrected.data()?.deleted === undefined && resurrected.data()?.amount === 5000,
  );
  await deleteDoc(recordRef(deviceA, 941010));
  check(
    "(rules) the evidence row was removed again (emulator only)",
    !(await getDoc(recordRef(deviceA, 941010))).exists(),
  );

  section("J. Party tombstones — durable, cross-device, non-resurrectable (stage 4C-A)");

  /* Every document below lives under `users/{uid}/parties/{id}` — the path is
     unchanged. `runPartyFlush` uses the app's own delivery code, so a delete
     here is exactly what the app sends. */
  selectDeviceStorage("party-device-A");
  savePendingPartyOps([]);
  /* Baseline: nothing in this section writes to `records`. */
  const ledgerBeforeTombstones = await readRows(deviceA);
  const ledgerSignature = (rows: CloudRow[]) =>
    JSON.stringify(rows.map((row) => [row.localId, row.kind, row.amount, row.updatedAt]));

  /* --- (A1) deletion creates a tombstone, not a document delete ------- */
  const tombstoneParty = makeParty(
    { name: "راشد اسٹور", phone: "03007778889", kind: "customer" },
    942001,
  );
  enqueuePartyOps([partyUpsertOp(tombstoneParty, Date.now(), deviceA.uid)]);
  const createdForTombstone = await runPartyFlush(deviceA);
  check(
    "(A1) the party is in the cloud before it is deleted",
    createdForTombstone.applied === 1 && (await getDoc(partyDoc(942001))).exists(),
    JSON.stringify({ applied: createdForTombstone.applied }),
  );

  rememberTombstonedPartyIds([942001]); // what `removeParty` does first
  const deleteAt = Date.now() + 1_000;
  enqueuePartyOps([partyDeleteOp(942001, deleteAt, deviceA.uid)]);
  const tombstoned = await runPartyFlush(deviceA);
  const tombstoneDoc = await getDoc(partyDoc(942001));
  check(
    "(A1) the party document becomes a tombstone instead of being deleted",
    tombstoned.applied === 1 &&
      tombstoneDoc.exists() &&
      tombstoneDoc.data()?.deleted === true &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      applied: tombstoned.applied,
      exists: tombstoneDoc.exists(),
      deleted: tombstoneDoc.data()?.deleted,
    }),
  );
  check(
    "(A1) the tombstone keeps the party's own data and adds the markers",
    tombstoneDoc.data()?.name === "راشد اسٹور" &&
      tombstoneDoc.data()?.phone === tombstoneParty.phone &&
      tombstoneDoc.data()?.kind === "customer" &&
      tombstoneDoc.data()?.createdAt === tombstoneParty.createdAt &&
      tombstoneDoc.data()?.deletedAt === deleteAt &&
      typeof tombstoneDoc.data()?.deletedBy === "string" &&
      tombstoneDoc.data()?.deletedBy.length > 0,
    JSON.stringify(tombstoneDoc.data() ?? null),
  );
  check(
    "(A1) no hard delete was issued for the party",
    classifyPartyDoc(tombstoneDoc.data()) === "deleted",
    classifyPartyDoc(tombstoneDoc.data()),
  );

  /* --- (A2) the right uid writes it, others cannot touch it ----------- */
  check(
    "(A2) the owner's uid is the one that holds the tombstone path",
    tombstoneDoc.ref.path === `users/${deviceA.uid}/parties/942001`,
    tombstoneDoc.ref.path,
  );
  await expectDenied("(A2) another user cannot read A's tombstoned party", () =>
    getDoc(doc(deviceB.db, "users", deviceA.uid, "parties", "942001")),
  );
  await expectDenied("(A2) another user cannot alter A's tombstoned party", () =>
    setDoc(
      doc(deviceB.db, "users", deviceA.uid, "parties", "942001"),
      partyForCloud(tombstoneParty),
    ),
  );
  await expectDenied("(A2) another user cannot delete A's tombstoned party", () =>
    deleteDoc(doc(deviceB.db, "users", deviceA.uid, "parties", "942001")),
  );
  check(
    "(A2) A's tombstone is still intact after the refused attempts",
    (await getDoc(partyDoc(942001))).data()?.deleted === true,
  );

  const foreignUidDelete = await flushPendingPartyOps({
    ops: [partyDeleteOp(942001, Date.now() + 2_000, deviceB.uid)],
    uid: deviceA.uid,
    read: async () => {
      throw new Error("must not be read for a foreign uid");
    },
    write: async () => {
      throw new Error("must not be written for a foreign uid");
    },
    remove: async () => {
      throw new Error("must not be removed for a foreign uid");
    },
  });
  savePendingPartyOps(foreignUidDelete.remaining);
  check(
    "(A2) a queued deletion that belongs to another uid is deferred, never written",
    foreignUidDelete.deferred === 1 &&
      foreignUidDelete.applied === 0 &&
      foreignUidDelete.remaining.length === 1 &&
      (await getDoc(partyDoc(942001))).data()?.deletedAt === deleteAt,
    JSON.stringify({ deferred: foreignUidDelete.deferred }),
  );
  savePendingPartyOps([]);

  /* --- (A3) invalid tombstone fields are refused by the rules --------- */
  const activeTombstoneTarget = makeParty({ name: "سمیت ٹریڈرز", kind: "supplier" }, 942002);
  await setDoc(partyDoc(942002), partyForCloud(activeTombstoneTarget));
  await expectDenied("(A3) deleted as a string is rejected", () =>
    setDoc(partyDoc(942002), { ...partyForCloud(activeTombstoneTarget), deleted: "yes" }),
  );
  await expectDenied("(A3) a tombstone without deletedAt is rejected", () =>
    setDoc(partyDoc(942002), { ...partyForCloud(activeTombstoneTarget), deleted: true }),
  );
  await expectDenied("(A3) a non-numeric deletedAt is rejected", () =>
    setDoc(partyDoc(942002), {
      ...partyForCloud(activeTombstoneTarget),
      deleted: true,
      deletedAt: "yesterday",
    }),
  );
  await expectDenied("(A3) a deletedAt of zero is rejected", () =>
    setDoc(partyDoc(942002), {
      ...partyForCloud(activeTombstoneTarget),
      deleted: true,
      deletedAt: 0,
    }),
  );
  await expectDenied("(A3) an oversized deletedBy is rejected", () =>
    setDoc(partyDoc(942002), {
      ...partyForCloud(activeTombstoneTarget),
      deleted: true,
      deletedAt: Date.now(),
      deletedBy: "x".repeat(129),
    }),
  );
  const afterInvalid = await getDoc(partyDoc(942002));
  check(
    "(A3) the rejected payloads left the party untouched and active",
    afterInvalid.data()?.deleted === undefined && afterInvalid.data()?.name === "سمیت ٹریڈرز",
    JSON.stringify(afterInvalid.data() ?? null),
  );
  check(
    "(A3) the client classifies the refused payload as invalid too",
    classifyPartyDoc({ ...partyForCloud(activeTombstoneTarget), deleted: "yes" }) === "invalid" &&
      classifyPartyDoc({ ...partyForCloud(activeTombstoneTarget), deleted: true }) === "invalid",
  );

  await expectDenied("(A3) a create with deletedAt of zero is rejected", () =>
    setDoc(partyDoc(942010), {
      ...partyForCloud(makeParty({ name: "نئی دکان", kind: "customer" }, 942010)),
      deleted: true,
      deletedAt: 0,
    }),
  );
  await setDoc(partyDoc(942010), {
    ...partyForCloud(makeParty({ name: "نئی دکان", kind: "customer" }, 942010)),
    deleted: true,
    deletedAt: Date.now(),
    deletedBy: "d-test",
  });
  check(
    "(A3) a party created and deleted before it ever synced is stored as a tombstone",
    classifyPartyDoc((await getDoc(partyDoc(942010))).data()) === "deleted",
    classifyPartyDoc((await getDoc(partyDoc(942010))).data()),
  );

  /* --- (A4) a tombstone cannot be turned back into an active party ---- */
  await expectDenied("(A4) an ordinary update cannot resurrect the tombstone", () =>
    setDoc(partyDoc(942001), partyForCloud(tombstoneParty)),
  );
  await expectDenied("(A4) a merge update cannot clear the deletion flag", () =>
    setDoc(partyDoc(942001), { deleted: false }, { merge: true }),
  );
  await expectDenied("(A4) an update dropping the markers is rejected", () =>
    setDoc(partyDoc(942001), {
      ...partyForCloud(tombstoneParty),
      name: "راشد اسٹور (نیا نام)",
    }),
  );
  check(
    "(A4) the tombstone survived every resurrection attempt",
    (await getDoc(partyDoc(942001))).data()?.deleted === true,
  );

  /* --- (A5) a stale queued upsert is refused by the rules ------------ */
  enqueuePartyOps([partyUpsertOp(tombstoneParty, Date.now() + 3_000, deviceA.uid)]);
  check(
    "(A5) the queue refuses an upsert for a party this device deleted",
    loadPendingPartyOps().length === 0,
    JSON.stringify(loadPendingPartyOps().map((op) => `${op.target}:${op.id}`)),
  );
  /* Simulate an op that was queued *before* the deletion was remembered:
     it must be refused by the rules and stay queued, never succeed. */
  savePendingPartyOps([
    partyUpsertOp({ ...tombstoneParty, name: "اسٹور (واپس)" }, Date.now() + 4_000, deviceA.uid),
  ]);
  const staleUpsert = await runPartyFlush(deviceA);
  /* Stage 4C-B changed this on purpose: the client now reads the cloud copy and
     refuses the write itself, so the doomed upsert no longer has to bounce off
     the rules and loop for ever. The party still cannot be reactivated. */
  check(
    "(A5) a stale upsert cannot reactivate the tombstone (blocked before any write)",
    staleUpsert.applied === 0 &&
      staleUpsert.resurrectBlocked === 1 &&
      staleUpsert.failed === 0 &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      applied: staleUpsert.applied,
      blocked: staleUpsert.resurrectBlocked,
      failed: staleUpsert.failed,
      queue: loadPendingPartyOps().length,
    }),
  );
  check(
    "(A5) the cloud copy is unchanged after the refused upsert",
    (await getDoc(partyDoc(942001))).data()?.deleted === true &&
      (await getDoc(partyDoc(942001))).data()?.name === "راشد اسٹور",
  );
  check(
    "(A5) the undeliverable edit left the queue with an inspectable reason",
    loadDeadPartyOps().some(
      (entry) => entry.op.id === 942001 && entry.reason === "tombstoned",
    ),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );
  const droppedStale = dropStalePartyUpserts([942001]);
  check(
    "(A5) the tombstone sweep now finds nothing left to drop (no loop)",
    droppedStale === 0 && loadPendingPartyOps().length === 0,
    JSON.stringify({ dropped: droppedStale, queue: loadPendingPartyOps().length }),
  );

  /* --- (A6) duplicate delivery is idempotent ------------------------- */
  enqueuePartyOps([partyDeleteOp(942001, deleteAt, deviceA.uid)]);
  const replayed = await runPartyFlush(deviceA);
  check(
    "(A6) replaying the same deletion writes nothing and reports it as already deleted",
    replayed.applied === 0 &&
      replayed.alreadyDeleted === 1 &&
      replayed.failed === 0 &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      applied: replayed.applied,
      alreadyDeleted: replayed.alreadyDeleted,
      failed: replayed.failed,
    }),
  );
  check(
    "(A6) the stored deletion time did not change on the replay",
    (await getDoc(partyDoc(942001))).data()?.deletedAt === deleteAt,
    String((await getDoc(partyDoc(942001))).data()?.deletedAt),
  );

  /* --- (A7) a pending deletion survives a restart -------------------- */
  const restartParty = makeParty({ name: "ریسٹارٹ ٹیسٹ", kind: "customer" }, 942005);
  enqueuePartyOps([partyUpsertOp(restartParty, Date.now(), deviceA.uid)]);
  await runPartyFlush(deviceA);
  enqueuePartyOps([partyDeleteOp(942005, Date.now() + 700, deviceA.uid)]);
  rememberTombstonedPartyIds([942005]);
  restartDevice("party-device-A");
  check(
    "(A7) a pending deletion survives an application restart",
    loadPendingPartyOps().length === 1 &&
      loadPendingPartyOps()[0].id === 942005 &&
      loadPendingPartyOps()[0].kind === "delete",
    JSON.stringify(loadPendingPartyOps()),
  );
  check(
    "(A7) the remembered deletion survives the restart too",
    loadTombstonedPartyIds().includes(942005),
    JSON.stringify(loadTombstonedPartyIds()),
  );
  const afterRestart = await runPartyFlush(deviceA);
  check(
    "(A7) the restarted device delivers the tombstone",
    afterRestart.applied === 1 &&
      classifyPartyDoc((await getDoc(partyDoc(942005))).data()) === "deleted",
    JSON.stringify({ applied: afterRestart.applied }),
  );

  /* --- (A8) a remote snapshot cannot resurrect a pending deletion ----- */
  const pendingDeleteParty = makeParty({ name: "آف لائن حذف", kind: "supplier" }, 942006);
  enqueuePartyOps([partyUpsertOp(pendingDeleteParty, Date.now(), deviceA.uid)]);
  await runPartyFlush(deviceA);
  enqueuePartyOps([partyDeleteOp(942006, Date.now() + 900, deviceA.uid)]);
  const pendingCloudDoc = (await getDoc(partyDoc(942006))).data();
  check(
    "(A8) the cloud still holds the active copy while the deletion is queued",
    pendingCloudDoc?.deleted === undefined,
    JSON.stringify(pendingCloudDoc ?? null),
  );
  check(
    "(A8) the snapshot would not resurrect it — the pending deletion outranks the cloud",
    decidePartySnapshot(pendingCloudDoc, pendingPartyOpsById(), []) === "pending-local-change",
    decidePartySnapshot(pendingCloudDoc, pendingPartyOpsById(), []),
  );
  const deliveredPending = await runPartyFlush(deviceA);
  check(
    "(A8) once delivered, the same snapshot document becomes a tombstone",
    deliveredPending.applied === 1 &&
      decidePartySnapshot(
        (await getDoc(partyDoc(942006))).data(),
        pendingPartyOpsById(),
        [],
      ) === "tombstone",
    decidePartySnapshot((await getDoc(partyDoc(942006))).data(), pendingPartyOpsById(), []),
  );

  /* --- (A9) another device of the same user sees the deletion -------- */
  const onDeviceA2 = (await getDoc(doc(deviceA2.db, "users", deviceA2.uid, "parties", "942001"))).data();
  check(
    "(A9) a second device of the same user receives the tombstone",
    onDeviceA2?.deleted === true && onDeviceA2?.name === "راشد اسٹور",
    JSON.stringify(onDeviceA2 ?? null),
  );
  check(
    "(A9) that device's snapshot decision drops the party instead of showing it",
    decidePartySnapshot(onDeviceA2, new Map(), []) === "tombstone",
    decidePartySnapshot(onDeviceA2, new Map(), []),
  );
  const a2PendingTombstone = (await getDoc(partyDoc(942002))).data();
  check(
    "(A9) a still-active party from the same account is applied normally",
    decidePartySnapshot(a2PendingTombstone, new Map(), loadTombstonedPartyIds()) === "apply",
    decidePartySnapshot(a2PendingTombstone, new Map(), loadTombstonedPartyIds()),
  );

  /* --- (A10) historical transactions are never deleted --------------- */
  const historyParty = makeParty({ name: "تاریخی گاہک", kind: "customer" }, 942004);
  const historyCharge = makePartyTxn(942004, { kind: "charge", amount: 3000 }, 942031);
  const historyPayment = makePartyTxn(942004, { kind: "payment", amount: 750 }, 942032);
  enqueuePartyOps([
    partyUpsertOp(historyParty, Date.now(), deviceA.uid),
    partyTxnUpsertOp(historyCharge, Date.now(), deviceA.uid),
    partyTxnUpsertOp(historyPayment, Date.now(), deviceA.uid),
  ]);
  const historyStored = await runPartyFlush(deviceA);
  const txnsBeforeDeletion = await txnCountOf([942031, 942032]);
  check(
    "(A10) the party and its two transactions are stored",
    historyStored.applied === 3 && txnsBeforeDeletion === 2,
    JSON.stringify({ applied: historyStored.applied, txns: txnsBeforeDeletion }),
  );
  rememberTombstonedPartyIds([942004]);
  enqueuePartyOps([partyDeleteOp(942004, Date.now() + 1_100, deviceA.uid)]);
  const historyDeleted = await runPartyFlush(deviceA);
  const txnsAfterDeletion = await txnCountOf([942031, 942032]);
  check(
    "(A10) the party is tombstoned and its transactions are still stored",
    historyDeleted.applied === 1 &&
      classifyPartyDoc((await getDoc(partyDoc(942004))).data()) === "deleted" &&
      txnsAfterDeletion === 2,
    JSON.stringify({ applied: historyDeleted.applied, txns: txnsAfterDeletion }),
  );
  check(
    "(A10) the stored amounts are unchanged (3000 charge, 750 payment)",
    (await getDoc(txnDoc(942031))).data()?.amount === 3000 &&
      (await getDoc(txnDoc(942032))).data()?.amount === 750,
  );
  const partyCharges =
    (await getDoc(txnDoc(942031))).data()?.amount - (await getDoc(txnDoc(942032))).data()?.amount;
  check(
    "(A10) the party balance computed from the stored rows is unchanged (2250)",
    partyCharges === 2250,
    `${partyCharges}`,
  );
  check(
    "(A10) the deletion never issued a write against partyTxns",
    txnsBeforeDeletion === txnsAfterDeletion,
    `${txnsBeforeDeletion} -> ${txnsAfterDeletion}`,
  );

  /* --- (A11) an import cannot reactivate a tombstoned party ---------- */
  const importCandidate = makeParty({ name: "بیک اپ سے واپس", kind: "customer" }, 942007);
  const restoredBook = splitImportableParties(
    [tombstoneParty, importCandidate],
    loadTombstonedPartyIds(),
  );
  check(
    "(A11) an import drops the deleted party and keeps the rest",
    restoredBook.active.length === 1 &&
      restoredBook.active[0].id === 942007 &&
      restoredBook.blocked.includes(942001),
    JSON.stringify({
      active: restoredBook.active.map((party) => party.id),
      blocked: restoredBook.blocked,
    }),
  );
  enqueuePartyOps([
    ...restoredBook.active.map((party) => partyUpsertOp(party, Date.now(), deviceA.uid)),
    partyUpsertOp(tombstoneParty, Date.now(), deviceA.uid),
  ]);
  const importFlush = await runPartyFlush(deviceA);
  check(
    "(A11) the import only queues the still-active party",
    importFlush.applied === 1 && loadPendingPartyOps().length === 0,
    JSON.stringify({ applied: importFlush.applied, queue: loadPendingPartyOps().length }),
  );
  check(
    "(A11) the tombstoned party is still a tombstone after the import",
    (await getDoc(partyDoc(942001))).data()?.deleted === true,
  );
  check(
    "(A11) the imported party exists once",
    (await getDoc(partyDoc(942007))).data()?.name === "بیک اپ سے واپس",
  );

  /* --- (A12) a party whose cloud document never existed -------------- */
  const neverUploaded = makeParty({ name: "کبھی اپ لوڈ نہیں", kind: "supplier" }, 942008);
  enqueuePartyOps([partyDeleteOp(neverUploaded.id, Date.now(), deviceA.uid)]);
  const neverUploadedFlush = await runPartyFlush(deviceA);
  check(
    "(A12) a deletion with no cloud document is reported as missing, not as success",
    neverUploadedFlush.missing === 1 &&
      neverUploadedFlush.applied === 0 &&
      !(await getDoc(partyDoc(942008))).exists() &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      missing: neverUploadedFlush.missing,
      applied: neverUploadedFlush.applied,
      queue: loadPendingPartyOps().length,
    }),
  );

  /* --- (A13) the ledger around parties is untouched ------------------ */
  const ledgerAfterTombstones = await readRows(deviceA);
  check(
    "(A13) party tombstones changed no ledger record, amount or total",
    ledgerSignature(ledgerAfterTombstones) === ledgerSignature(ledgerBeforeTombstones),
    `rows ${ledgerBeforeTombstones.length} -> ${ledgerAfterTombstones.length}`,
  );
  check(
    "(A13) the party book's own transactions still add up (3000 - 750 = 2250)",
    (await getDoc(txnDoc(942031))).data()?.amount - (await getDoc(txnDoc(942032))).data()?.amount ===
      2250,
  );

  /* --- (A14) the rules refuse a hard delete (stage 4C-D) ------------- */
  /* 4C-A left `allow delete` in place and named the follow-up task. Stage
     4C-D is that task: the delete rule is gone, so the tombstone can no
     longer be erased and the party re-created as active. */
  await expectDenied("(A14) the owner can no longer hard-delete a party document", () =>
    deleteDoc(partyDoc(942001)),
  );
  check(
    "(A14) the tombstone is still there after the refused delete",
    classifyPartyDoc((await getDoc(partyDoc(942001))).data()) === "deleted",
    classifyPartyDoc((await getDoc(partyDoc(942001))).data()),
  );
  await expectDenied("(A14) re-creating the party over its tombstone is refused", () =>
    setDoc(partyDoc(942001), partyForCloud(tombstoneParty)),
  );
  check(
    "(A14) the party is still deleted — the resurrection attempt changed nothing",
    classifyPartyDoc((await getDoc(partyDoc(942001))).data()) === "deleted",
    classifyPartyDoc((await getDoc(partyDoc(942001))).data()),
  );
  const intactTombstone = (await getDoc(partyDoc(942001))).data() as Record<string, unknown>;
  await expectDenied("(A14) a stale client cannot rewrite when the party was deleted", () =>
    setDoc(partyDoc(942001), {
      ...intactTombstone,
      deletedAt: (intactTombstone.deletedAt as number) + 60_000,
    }),
  );
  check(
    "(A14) a stale client cannot rewrite when the party was deleted",
    (await getDoc(partyDoc(942001))).data()?.deletedAt === intactTombstone.deletedAt,
    `${String((await getDoc(partyDoc(942001))).data()?.deletedAt)} vs ${String(intactTombstone.deletedAt)}`,
  );
  await setDoc(partyDoc(942001), intactTombstone);
  check(
    "(A14) re-writing the very same tombstone is still allowed (idempotent)",
    (await getDoc(partyDoc(942001))).data()?.deleted === true,
  );
  check(
    "(A14) the tombstone kept its identity and history verbatim",
    (await getDoc(partyDoc(942001))).data()?.name === tombstoneParty.name &&
      (await getDoc(partyDoc(942001))).data()?.createdAt === tombstoneParty.createdAt,
  );

  /* ================================================================ */
  /* K. Party versioning and stale-write protection (stage 4C-B)      */
  /*                                                                */
  /* Emulator only: this proves what the clients+rules do together     */
  /* against a real Firestore API. It is not a production test.        */
  /* ================================================================ */
  section("K. Parties — versioned writes, stale protection, bounded retry (stage 4C-B)");

  const kStore = selectDeviceStorage("party-4c-b");
  kStore.delete("sauti_party_ops_dead");
  kStore.delete("sauti_party_tombstones");
  savePendingPartyOps([]);

  const versionedParty = makeParty(
    { name: "ورژن دکان", phone: "03001234000", kind: "customer" },
    943001,
  );
  const firstVersionAt = Date.now();
  enqueuePartyOps([partyUpsertOp(versionedParty, firstVersionAt, deviceA.uid)]);
  const versionedFlush = await runPartyFlush(deviceA);
  const versionedDoc = await getDoc(partyDoc(943001));
  check(
    "(K1) a party write stores its version and still passes the current rules",
    versionedFlush.applied === 1 && versionedDoc.data()?.updatedAt === firstVersionAt,
    JSON.stringify({ applied: versionedFlush.applied, updatedAt: versionedDoc.data()?.updatedAt ?? null }),
  );
  check(
    "(K2) the version field changed nothing else in the document",
    versionedDoc.data()?.name === "ورژن دکان" &&
      versionedDoc.data()?.kind === "customer" &&
      versionedDoc.data()?.phone === "923001234000" &&
      typeof versionedDoc.data()?.createdAt === "number" &&
      classifyPartyDoc(versionedDoc.data()) === "active",
    JSON.stringify(versionedDoc.data() ?? null),
  );

  /* A second client of the same account sees a newer cloud copy and must not
     overwrite it with an edit it made earlier. */
  selectDeviceStorage("party-4c-b-other");
  savePendingPartyOps([]);
  const newerCloudAt = firstVersionAt + 10 * 60 * 1000;
  await setDoc(partyDoc(943001), {
    ...(partyForCloud(versionedParty) as Record<string, unknown>),
    name: "نیا کلاؤڈ نام",
    updatedAt: newerCloudAt,
  });
  enqueuePartyOps([
    partyUpsertOp({ ...versionedParty, name: "پرانا نام" }, firstVersionAt, deviceA.uid),
  ]);
  const stalePartyFlush = await runPartyFlush(deviceA);
  const kAfterStale = await getDoc(partyDoc(943001));
  check(
    "(K3) an older queued edit does not overwrite the newer cloud party",
    stalePartyFlush.applied === 0 &&
      stalePartyFlush.stale === 1 &&
      kAfterStale.data()?.name === "نیا کلاؤڈ نام" &&
      kAfterStale.data()?.updatedAt === newerCloudAt &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      applied: stalePartyFlush.applied,
      stale: stalePartyFlush.stale,
      name: kAfterStale.data()?.name ?? null,
      queue: loadPendingPartyOps().length,
    }),
  );
  check(
    "(K4) the skipped edit is set aside with a reason, not silently lost",
    loadDeadPartyOps().some(
      (entry) => entry.op.id === 943001 && entry.reason === "stale",
    ),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );
  check(
    "(K5) the snapshot of that document also defers to the newer cloud copy",
    decidePartySnapshot(
      kAfterStale.data() ?? {},
      pendingPartyOpsById(),
      [],
    ) === "apply",
    decidePartySnapshot(kAfterStale.data() ?? {}, pendingPartyOpsById(), []),
  );

  /* A legacy document (written before this stage) is still updatable. */
  await setDoc(partyDoc(943002), {
    id: 943002,
    name: "پرانا سپلائر",
    phone: "",
    kind: "supplier",
    createdAt: 1,
  });
  enqueuePartyOps([
    partyUpsertOp(
      { id: 943002, name: "بدلا ہوا نام", phone: "", kind: "supplier", createdAt: 1 },
      Date.now(),
      deviceA.uid,
    ),
  ]);
  const legacyPartyFlush = await runPartyFlush(deviceA);
  const updatedLegacy = await getDoc(partyDoc(943002));
  check(
    "(K6) a document without updatedAt is still updated (no migration needed)",
    legacyPartyFlush.applied === 1 &&
      updatedLegacy.data()?.name === "بدلا ہوا نام" &&
      typeof updatedLegacy.data()?.updatedAt === "number" &&
      updatedLegacy.data()?.createdAt === 1,
    JSON.stringify({ applied: legacyPartyFlush.applied, doc: updatedLegacy.data() ?? null }),
  );

  /* A client that has not heard about the tombstone must not resurrect it. */
  enqueuePartyOps([partyDeleteOp(943002, Date.now() + 1_000, deviceA.uid)]);
  await runPartyFlush(deviceA);
  selectDeviceStorage("party-4c-b-fresh");
  savePendingPartyOps([]);
  enqueuePartyOps([
    partyUpsertOp(
      { id: 943002, name: "واپس لایا گیا", phone: "", kind: "supplier", createdAt: 1 },
      Date.now() + 60_000,
      deviceA.uid,
    ),
  ]);
  const resurrectionAttempt = await runPartyFlush(deviceA);
  const afterResurrection = await getDoc(partyDoc(943002));
  check(
    "(K7) an edit from a device that missed the tombstone cannot resurrect the party",
    resurrectionAttempt.applied === 0 &&
      resurrectionAttempt.resurrectBlocked === 1 &&
      afterResurrection.data()?.deleted === true &&
      afterResurrection.data()?.name === "بدلا ہوا نام" &&
      loadPendingPartyOps().length === 0,
    JSON.stringify({
      applied: resurrectionAttempt.applied,
      blocked: resurrectionAttempt.resurrectBlocked,
      deleted: afterResurrection.data()?.deleted ?? null,
    }),
  );

  /* A permanently rejected write is retried a bounded number of times. */
  const retryStore = selectDeviceStorage("party-4c-b-retry");
  retryStore.delete("sauti_party_ops_dead");
  savePendingPartyOps([]);
  enqueuePartyOps([
    partyUpsertOp(
      makeParty({ name: "x", kind: "customer" }, 943004),
      Date.now(),
      deviceA.uid,
    ),
  ]);
  let retryOutcome = await runPartyFlush(deviceA);
  for (let attempt = 2; attempt <= MAX_PARTY_OP_ATTEMPTS; attempt += 1) {
    retryOutcome = await runPartyFlush(deviceA);
  }
  check(
    "(K8) a permanently rejected party write is retried a bounded number of times",
    retryOutcome.abandoned === 1 &&
      retryOutcome.failed === 1 &&
      loadPendingPartyOps().length === 0 &&
      !(await getDoc(partyDoc(943004))).exists(),
    JSON.stringify({
      abandoned: retryOutcome.abandoned,
      failed: retryOutcome.failed,
      queue: loadPendingPartyOps().length,
    }),
  );
  check(
    "(K9) the abandoned write keeps its failure reason for inspection",
    loadDeadPartyOps().some(
      (entry) => entry.op.id === 943004 && /permission[_-]?denied/i.test(entry.reason),
    ),
    JSON.stringify(loadDeadPartyOps().map((entry) => entry.reason)),
  );

  /* Backward compatibility: a client that writes no version at all. */
  await setDoc(partyDoc(943005), {
    ...(partyForCloud(makeParty({ name: "بغیر ورژن", kind: "customer" }, 943005)) as Record<
      string,
      unknown
    >),
  });
  check(
    "(K10) a write from an old client without updatedAt is still accepted",
    (await getDoc(partyDoc(943005))).exists() &&
      !("updatedAt" in ((await getDoc(partyDoc(943005))).data() ?? {})),
  );
  check(
    "(K11) the versioned party writes changed no ledger record or amount",
    ledgerSignature(await readRows(deviceA)) === ledgerSignature(ledgerBeforeTombstones),
  );

  savePendingPartyOps([]);

  /* ================================================================ */
  /* L. Party tombstone & deletion-rule integrity (stage 4C-D)        */
  /*                                                                */
  /* Emulator only: the same clients + rules against a real          */
  /* Firestore API. Not a production test.                          */
  /* ================================================================ */
  section("L. Parties — deletion-rule integrity (stage 4C-D)");

  const dParty = makeParty({ name: "حذف مقنع", phone: "03001234400", kind: "supplier" }, 944001);
  const dPartyRef = doc(deviceA.db, "users", deviceA.uid, "parties", "944001");
  await setDoc(dPartyRef, partyForCloud(dParty));
  const dTxn = makePartyTxn(944001, { kind: "charge", amount: 3000, partyKind: "supplier" }, 944051);
  const dTxnRef = doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944051");
  await setDoc(dTxnRef, partyTxnForCloud(dTxn));
  const dDeletedAt = Date.now();
  await setDoc(dPartyRef, {
    ...partyForCloud(dParty),
    deleted: true,
    deletedAt: dDeletedAt,
    deletedBy: "d-test",
  });
  check(
    "(D1) deleting a party writes an in-place tombstone, not a document delete",
    (await getDoc(dPartyRef)).data()?.deleted === true &&
      (await getDoc(dPartyRef)).data()?.name === dParty.name,
  );
  await expectDenied("(D1) the owner can no longer hard-delete a party document", () =>
    deleteDoc(dPartyRef),
  );
  await expectDenied("(D1) another user cannot hard-delete a party document either", () =>
    deleteDoc(doc(deviceB.db, "users", deviceA.uid, "parties", "944001")),
  );
  await expectDenied("(D1) a client with no identity cannot touch a party document", () =>
    deleteDoc(doc(anon.db, "users", deviceA.uid, "parties", "944001")),
  );
  check(
    "(D1) the tombstone is still there for every device to read",
    classifyPartyDoc((await getDoc(dPartyRef)).data()) === "deleted",
    classifyPartyDoc((await getDoc(dPartyRef)).data()),
  );

  await expectDenied("(D2) an active write over the tombstone is refused", () =>
    setDoc(dPartyRef, partyForCloud(dParty)),
  );
  await expectDenied("(D2) rewriting the deletion time is refused", () =>
    setDoc(dPartyRef, {
      ...partyForCloud(dParty),
      deleted: true,
      deletedAt: dDeletedAt + 60_000,
      deletedBy: "d-stale",
    }),
  );
  await setDoc(dPartyRef, {
    ...partyForCloud(dParty),
    deleted: true,
    deletedAt: dDeletedAt,
    deletedBy: "d-stale",
  });
  check(
    "(D2) an idempotent tombstone re-write from a stale device is still fine",
    (await getDoc(dPartyRef)).data()?.deleted === true &&
      (await getDoc(dPartyRef)).data()?.deletedAt === dDeletedAt,
  );
  await expectDenied("(D2) a tombstone without a deletion time is refused", () =>
    setDoc(dPartyRef, {
      ...partyForCloud(dParty),
      deleted: true,
    } as Record<string, unknown>),
  );

  await expectDenied("(D3) a party with a malformed tombstone field is refused", () =>
    setDoc(
      doc(deviceA.db, "users", deviceA.uid, "parties", "944002"),
      {
        ...partyForCloud(makeParty({ name: "غلط ذيلاق", kind: "customer" }, 944002)),
        deleted: "yes",
      } as Record<string, unknown>,
    ),
  );
  await expectDenied("(D3) a deleted flag without a deletion time is refused", () =>
    setDoc(
      doc(deviceA.db, "users", deviceA.uid, "parties", "944002"),
      {
        ...partyForCloud(makeParty({ name: "غلط ذيلاق", kind: "customer" }, 944002)),
        deleted: true,
      } as Record<string, unknown>,
    ),
  );

  /* The entry keeps living: its own rules never required a party document to
     exist, so a deleted party's history stays in the cloud and stays readable
     through the tombstone's `kind`. This is stage 4C-C behaviour, re-proven
     against the rules after 4C-D changed them. */
  check(
    "(D4) the deleted party's transaction is still stored and unchanged",
    (await getDoc(dTxnRef)).data()?.amount === 3000 &&
      (await getDoc(dTxnRef)).data()?.partyKind === "supplier",
  );
  const dNewTxn = makePartyTxn(944001, { kind: "payment", amount: 500, partyKind: "supplier" }, 944052);
  await setDoc(
    doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944052"),
    partyTxnForCloud(dNewTxn),
  );
  check(
    "(D4) the rules still allow a new entry whose party is a tombstone",
    (await getDoc(doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944052"))).data()
      ?.amount === 500,
  );
  await deleteDoc(dTxnRef);
  check(
    "(D4) an entry can still be deleted by its owner (the removal model is unchanged)",
    !(await getDoc(dTxnRef)).exists(),
  );

  await expectDenied("(D5) another user cannot create a transaction inside A's path", () =>
    setDoc(
      doc(deviceB.db, "users", deviceA.uid, "partyTxns", "944053"),
      partyTxnForCloud(
        makePartyTxn(944001, { kind: "charge", amount: 999, partyKind: "customer" }, 944053),
      ),
    ),
  );
  const dTxn52 = (await getDoc(doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944052")))
    .data() as Record<string, unknown>;
  await expectDenied("(D5) another user cannot alter A's transaction", () =>
    setDoc(
      doc(deviceB.db, "users", deviceA.uid, "partyTxns", "944052"),
      { ...dTxn52, amount: 1 },
    ),
  );
  await expectDenied("(D5) a client with no identity cannot touch A's transactions", () =>
    setDoc(
      doc(anon.db, "users", deviceA.uid, "partyTxns", "944053"),
      partyTxnForCloud(
        makePartyTxn(944001, { kind: "charge", amount: 999, partyKind: "supplier" }, 944053),
      ),
    ),
  );
  check(
    "(D5) the refused writes created nothing and changed nothing",
    !(await getDoc(doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944053"))).exists() &&
      (await getDoc(doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944052"))).data()
        ?.amount === 500,
  );

  const classifiedTxn = makePartyTxn(
    944001,
    { kind: "charge", amount: 10, partyKind: "customer" },
    944054,
  );
  const classifiedTxnRef = doc(
    deviceA.db,
    "users",
    deviceA.uid,
    "partyTxns",
    "944054",
  );
  await expectDenied("(D6) a transaction with an unknown partyKind is refused", () =>
    setDoc(classifiedTxnRef, { ...partyTxnForCloud(classifiedTxn), partyKind: "friend" }),
  );
  await expectDenied("(D6) a non-string partyKind is refused", () =>
    setDoc(classifiedTxnRef, { ...partyTxnForCloud(classifiedTxn), partyKind: 7 }),
  );
  await setDoc(classifiedTxnRef, partyTxnForCloud(classifiedTxn));
  check(
    "(D6) a valid partyKind is still accepted (4C-C behaviour unchanged)",
    (await getDoc(classifiedTxnRef)).data()?.partyKind === "customer",
  );

  /* Residual risk 4, recorded honestly instead of claimed as protection:
     the rules language cannot turn the numeric `partyId` into the parent
     document path, so no `exists()` check on the party is possible without
     changing the document-id scheme (a schema decision). Such a write is
     accepted here — and ignored by every accounting calculation (stage 4C-C:
     only parties present in the book produce receivables/payables). */
  const orphanRef = doc(deviceA.db, "users", deviceA.uid, "partyTxns", "944055");
  await setDoc(
    orphanRef,
    partyTxnForCloud(makePartyTxn(999999999, { kind: "charge", amount: 700 }, 944055)),
  );
  check(
    "(D8) a transaction whose party does not exist is accepted by the rules — the documented residual gap",
    (await getDoc(orphanRef)).data()?.amount === 700,
  );
  check(
    "(D8) it names a party id no book contains, so the accounting layer ignores it",
    (await getDoc(orphanRef)).data()?.partyId === 999999999,
    `${String((await getDoc(orphanRef)).data()?.partyId)}`,
  );
  await deleteDoc(orphanRef);
  check(
    "(D8) the residual-gap evidence row was removed again (emulator only)",
    !(await getDoc(orphanRef)).exists(),
  );

  check(
    "(D7) the party book's own entries still add up after every refused write",
    !(await getDoc(dTxnRef)).exists() &&
      (await getDoc(txnDoc(944052))).data()?.amount === 500 &&
      (await getDoc(txnDoc(944054))).data()?.amount === 10,
  );
  check(
    "(D7) the deletion-rule hardening changed no ledger record or amount",
    ledgerSignature(await readRows(deviceA)) === ledgerSignature(ledgerBeforeTombstones),
  );

  savePendingPartyOps([]);

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  failures.forEach((failure) => console.log(`  ✗ ${failure}`));

  await deleteApp(deviceA.app);
  await deleteApp(deviceA2.app);
  await deleteApp(deviceB.app);
  await deleteApp(anon.app);

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("emulator test run crashed:", error);
  process.exit(1);
});
