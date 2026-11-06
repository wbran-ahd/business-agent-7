import type { Entry, EntryType, AccountKind } from "@/lib/khata";

/**
 * Tombstone fields added by stage 4A (Option A: soft delete inside the record).
 *
 * They stay optional on purpose: documents written before this stage have none
 * of them and must keep working without a migration.
 */
export type TombstoneFields = {
  /** `true` = the user deleted this record on some device. */
  deleted?: boolean;
  /** Epoch ms of the deletion. */
  deletedAt?: number;
  /** Deterministic id of the deletion event (`<deletedAt>-<localId>`). */
  deletedEventId?: string;
  /** The record version (`updatedAt`) this device knew when it deleted. */
  deletedVersion?: number;
  /** Opaque per-device id that originated the deletion. */
  deletedBy?: string;
};

/**
 * Cloud record as it exists in Firestore (`users/{uid}/records/{localId}`).
 *
 * `updatedAt` is optional because documents written before this stage do not
 * have it; every reader falls back to `timestamp` so no migration is required.
 */
export type CloudRow = {
  localId: number;
  kind: EntryType;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
  updatedAt?: number;
  account?: AccountKind;
} & TombstoneFields;

/**
 * The single mapping from a local ledger entry to its cloud document.
 *
 * Used by the upload path and by the deletion queue, so a tombstone is built
 * from exactly the same field set as a normal write.
 */
export function recordFromEntry(entry: Entry, kind: EntryType): CloudRow {
  return {
    localId: entry.id,
    kind,
    amount: entry.amount,
    detail: entry.detail || "",
    category: entry.category || "عام",
    icon: entry.icon || "fa-tag",
    monthKey: entry.monthKey,
    date: entry.date,
    time: entry.time,
    timestamp: entry.timestamp,
    updatedAt: localUpdatedAt(entry),
    account: entry.account === "bank" ? "bank" : "cash",
  };
}

export type ValidatedCloudRow = {
  id: number;
  kind: EntryType;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
  /** Always present after validation; falls back to `timestamp`. */
  updatedAt: number;
  account: AccountKind;
  /** `true` when the cloud document is a tombstone. */
  deleted: boolean;
  /** Deletion time when `deleted`; `0` for an active record. */
  deletedAt: number;
};

export type ValidationOutcome =
  | { ok: true; row: ValidatedCloudRow }
  | { ok: false; reason: string; index: number };

export type MergeResult = {
  income: Entry[];
  expense: Entry[];
  added: number;
  kept: number;
  conflicts: number;
  invalid: number;
  /** Cloud-only rows skipped because this device deleted them. */
  skippedDeleted: number;
  /** Local records removed because the cloud copy is a tombstone. */
  tombstoned: number;
  /** Every id the payload marked as deleted, so the caller can remember it. */
  tombstoneIds: number[];
};

export interface MergeOptions {
  maxAmount: number;
}

const DEFAULT_MAX_AMOUNT = 1_000_000_000;

/**
 * How far ahead of the local clock an `updatedAt` may be before it is treated
 * as clock skew. Device clocks drift and phones get set wrongly; without this
 * guard a device whose clock is a week fast would win every future conflict.
 *
 * A skewed value is not discarded, it simply stops granting that device an
 * advantage: it is compared as "just now".
 */
export const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Edit time used for conflict decisions.
 *
 * An implausible future value (clock set wrongly) becomes `0`, i.e. it loses
 * against any cloud copy instead of overwriting it. A device with a broken
 * clock can still create records that exist nowhere else — nothing to compare
 * — but it cannot claim to be newer than data another device wrote.
 */
export function effectiveUpdatedAt(value: number, now = Date.now()): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value > now + FUTURE_SKEW_MS) return 0;
  return value;
}

/** Edit time of a local record; legacy records fall back to `timestamp`. */
export function localUpdatedAt(entry: Entry): number {
  return typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
    ? entry.updatedAt
    : entry.timestamp;
}

export function validateCloudRows(
  rows: CloudRow[],
  options?: MergeOptions,
): ValidationOutcome[] {
  const limit = options?.maxAmount ?? DEFAULT_MAX_AMOUNT;
  return rows.map((raw, index) => {
    if (
      typeof raw.localId !== "number" ||
      !Number.isFinite(raw.localId) ||
      raw.localId < 0
    ) {
      return { ok: false, reason: `Invalid cloud id at index ${index}`, index };
    }

    if (raw.kind !== "income" && raw.kind !== "expense") {
      return { ok: false, reason: `Invalid cloud kind at index ${index}`, index };
    }

    if (
      typeof raw.amount !== "number" ||
      !Number.isFinite(raw.amount) ||
      raw.amount <= 0
    ) {
      return { ok: false, reason: `Invalid cloud amount at index ${index}`, index };
    }

    if (raw.amount > limit) {
      return {
        ok: false,
        reason: `Unreasonably large cloud amount at index ${index}`,
        index,
      };
    }

    const monthKey = String(raw.monthKey ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return {
        ok: false,
        reason: `Invalid cloud monthKey at index ${index}`,
        index,
      };
    }

    if (
      typeof raw.timestamp !== "number" ||
      !Number.isFinite(raw.timestamp)
    ) {
      return {
        ok: false,
        reason: `Invalid cloud timestamp at index ${index}`,
        index,
      };
    }

    /* Tombstones. An active record needs none of these fields, so documents
       written before stage 4A stay valid; a document that claims to be deleted
       must describe that deletion completely, otherwise the download refuses
       the whole payload instead of guessing. */
    if (raw.deleted !== undefined && typeof raw.deleted !== "boolean") {
      return {
        ok: false,
        reason: `Invalid cloud deleted flag at index ${index}`,
        index,
      };
    }

    if (raw.deleted === true) {
      if (typeof raw.deletedAt !== "number" || !Number.isFinite(raw.deletedAt)) {
        return {
          ok: false,
          reason: `Tombstone without deletedAt at index ${index}`,
          index,
        };
      }
      if (
        raw.deletedEventId !== undefined &&
        (typeof raw.deletedEventId !== "string" || raw.deletedEventId.length > 128)
      ) {
        return {
          ok: false,
          reason: `Invalid cloud deletedEventId at index ${index}`,
          index,
        };
      }
      if (
        raw.deletedVersion !== undefined &&
        (typeof raw.deletedVersion !== "number" || !Number.isFinite(raw.deletedVersion))
      ) {
        return {
          ok: false,
          reason: `Invalid cloud deletedVersion at index ${index}`,
          index,
        };
      }
      if (
        raw.deletedBy !== undefined &&
        (typeof raw.deletedBy !== "string" || raw.deletedBy.length > 128)
      ) {
        return {
          ok: false,
          reason: `Invalid cloud deletedBy at index ${index}`,
          index,
        };
      }
    }

    return {
      ok: true,
      row: normalizeCloudRow(raw),
    };
  });
}

function normalizeCloudRow(row: CloudRow): ValidatedCloudRow {
  return {
    id: row.localId,
    kind: row.kind,
    amount: row.amount,
    detail: row.detail ?? "",
    category: row.category ?? "",
    icon: row.icon ?? "fa-tag",
    monthKey: row.monthKey ?? "",
    date: row.date ?? "",
    time: row.time ?? "",
    timestamp: row.timestamp ?? 0,
    updatedAt:
      typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
        ? row.updatedAt
        : (row.timestamp ?? 0),
    account: normalizeAccount(row.account),
    deleted: row.deleted === true,
    deletedAt:
      row.deleted === true && typeof row.deletedAt === "number" && Number.isFinite(row.deletedAt)
        ? row.deletedAt
        : 0,
  };
}

function normalizeAccount(value: unknown): AccountKind {
  return value === "bank" ? "bank" : "cash";
}

/** Every field that identifies the *content* of a record. Ids are separate. */
export function rowSignature(row: {
  kind: EntryType;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
  account?: AccountKind;
}): string {
  return [
    row.kind,
    row.amount,
    row.detail ?? "",
    row.category ?? "",
    row.icon ?? "",
    row.monthKey ?? "",
    row.date ?? "",
    row.time ?? "",
    row.timestamp,
    normalizeAccount(row.account),
  ].join("\u0001");
}

/**
 * Picks the copy that survives a same-id conflict.
 *
 * Order of evidence:
 * 1. `updatedAt` (actual last edit) on both sides, with future clock skew
 *    clamped out;
 * 2. `timestamp` (transaction time) only when neither side has an edit time;
 * 3. identical edit times but different content → the cloud copy wins, so both
 *    devices converge on one value on the next download instead of flip-flopping.
 *
 * A record is never dropped: one of the two versions is always returned, and
 * the losing local version is still recoverable from the pre-download backup.
 */
export function cloudWinner(local: Entry, cloud: ValidatedCloudRow): Entry {
  const now = Date.now();
  const cloudTime = effectiveUpdatedAt(cloud.updatedAt, now);
  const localTime = effectiveUpdatedAt(localUpdatedAt(local), now);

  // Equal edit times (or a neutralised skewed clock) resolve to the cloud copy,
  // so two devices that see the same data end up with the same value.
  if (cloudTime < localTime) return local;
  return entryFromCloud(local.id, cloud);
}

function entryFromCloud(id: number, cloud: ValidatedCloudRow): Entry {
  return {
    id,
    amount: cloud.amount,
    detail: cloud.detail,
    category: cloud.category,
    icon: cloud.icon,
    monthKey: cloud.monthKey,
    date: cloud.date,
    time: cloud.time,
    timestamp: cloud.timestamp,
    updatedAt: cloud.updatedAt,
    account: cloud.account,
  };
}

/**
 * Merges cloud rows into the local ledger without ever dropping a record.
 *
 * The previous implementation removed every id that existed on both sides with
 * a different amount/category/timestamp from *both* result lists, so a record
 * that existed locally and in the cloud simply vanished when the merged ledger
 * replaced the local one. Conflict ids are now resolved with `cloudWinner`
 * instead of being discarded.
 *
 * Guarantees:
 * - every local record appears in the result exactly once;
 * - cloud-only records are appended once (duplicate ids in the payload are
 *   ignored, so a repeated row cannot double-count money);
 * - ids this device deleted (`deletedIds`) are not resurrected;
 * - a record is only replaced by its cloud copy when that copy is newer;
 * - a tombstone never becomes an active record and always removes the local
 *   copy of its id (deletion wins, deterministically — see stage 4A report).
 */
export function mergeCloudRows(
  localIncome: Entry[],
  localExpense: Entry[],
  validated: ValidatedCloudRow[],
  deletedIds?: Iterable<number>,
): MergeResult {
  /* Tombstones are pulled out first: they are instructions, not records. The
     same id may appear twice in a malformed payload, so the newest (or the
     one that is actually a tombstone) wins. */
  const tombstoneIds: number[] = [];
  const cloudById = new Map<number, ValidatedCloudRow>();
  for (const row of validated) {
    if (row.deleted) {
      tombstoneIds.push(row.id);
      cloudById.set(row.id, row);
      continue;
    }
    /* A tombstone for the same id, already seen, outranks this active copy. */
    if (!cloudById.has(row.id)) cloudById.set(row.id, row);
  }

  const deleted = new Set<number>(deletedIds ?? []);
  for (const id of tombstoneIds) deleted.add(id);

  const localIds = new Set<number>();
  for (const entry of localIncome) localIds.add(entry.id);
  for (const entry of localExpense) localIds.add(entry.id);

  let added = 0;
  let kept = 0;
  let conflicts = 0;
  let tombstoned = 0;

  /** Keeps the local record unless the cloud copy is genuinely newer. */
  const resolve = (local: Entry, kind: EntryType): Entry | null => {
    const cloud = cloudById.get(local.id);
    /* Deletion wins over any local copy, whatever its edit time says: a stale
       device must never bring a deleted record back. */
    if (cloud?.deleted) {
      tombstoned += 1;
      return null;
    }
    kept += 1;
    if (!cloud) return local;

    if (
      rowSignature({ ...local, kind }) ===
      rowSignature({
        kind: cloud.kind,
        amount: cloud.amount,
        detail: cloud.detail,
        category: cloud.category,
        icon: cloud.icon,
        monthKey: cloud.monthKey,
        date: cloud.date,
        time: cloud.time,
        timestamp: cloud.timestamp,
        account: cloud.account,
      })
    ) {
      return local;
    }

    conflicts += 1;
    return cloudWinner(local, cloud);
  };

  const mergedIncome = localIncome
    .map((entry) => resolve(entry, "income"))
    .filter((entry): entry is Entry => entry !== null);
  const mergedExpense = localExpense
    .map((entry) => resolve(entry, "expense"))
    .filter((entry): entry is Entry => entry !== null);

  const appended = new Set<number>(localIds);
  let skippedDeleted = 0;

  for (const cloud of cloudById.values()) {
    if (appended.has(cloud.id)) continue;
    if (deleted.has(cloud.id)) {
      skippedDeleted += 1;
      continue;
    }

    appended.add(cloud.id);
    added += 1;
    const entry = entryFromCloud(cloud.id, cloud);

    if (cloud.kind === "income") {
      mergedIncome.push(entry);
    } else {
      mergedExpense.push(entry);
    }
  }

  return {
    income: mergedIncome,
    expense: mergedExpense,
    added,
    kept,
    conflicts,
    invalid: 0,
    skippedDeleted,
    tombstoned,
    tombstoneIds,
  };
}

export type UploadPlan = {
  /** Local rows that must be written to Firestore. */
  writes: CloudRow[];
  /** Rows already identical in the cloud — no write needed (idempotent retry). */
  unchanged: number;
  /** Rows where the cloud copy is newer; the local copy is kept, cloud wins. */
  cloudNewer: number;
  /** Cloud-only documents; they are left untouched, never deleted. */
  cloudOnly: number;
  /** Rows not written because the cloud copy is a tombstone (deleted wins). */
  tombstoned: number;
};

/**
 * Decides what an upload may write — the core of "never lose money" uploads.
 *
 * Old behaviour: the whole local snapshot was written and then every cloud
 * document missing from it was deleted. Uploading from a device with fewer
 * records therefore erased records created elsewhere.
 *
 * New behaviour:
 * - nothing is ever deleted, so a cloud-only document is always preserved;
 * - a row identical to the cloud copy is not rewritten (retries are idempotent);
 * - a differing row is only written when this device's copy is at least as new
 *   as the cloud copy, so a stale device cannot roll back another device's edit;
 * - a row whose cloud copy is a tombstone is never written, so an upload can
 *   never resurrect a deleted record;
 * - every "skip" is counted so the UI can report it instead of hiding it.
 */
export function planUpload(
  local: CloudRow[],
  cloud: CloudRow[],
  now = Date.now(),
): UploadPlan {
  const cloudById = new Map<string, CloudRow>();
  for (const row of cloud) {
    cloudById.set(String(row.localId), row);
  }

  const writes: CloudRow[] = [];
  let unchanged = 0;
  let cloudNewer = 0;
  let tombstoned = 0;
  let localMatched = 0;

  for (const localRow of local) {
    const remote = cloudById.get(String(localRow.localId));
    if (!remote) {
      writes.push(localRow);
      continue;
    }
    localMatched += 1;

    if (remote.deleted === true) {
      tombstoned += 1;
      continue;
    }

    if (rowSignature(localRow) === rowSignature(remote)) {
      unchanged += 1;
      continue;
    }

    const remoteTime = effectiveUpdatedAt(
      typeof remote.updatedAt === "number" ? remote.updatedAt : remote.timestamp,
      now,
    );
    const localTime = effectiveUpdatedAt(
      typeof localRow.updatedAt === "number" ? localRow.updatedAt : localRow.timestamp,
      now,
    );

    if (remoteTime >= localTime) {
      cloudNewer += 1;
      continue;
    }

    writes.push(localRow);
  }

  return {
    writes,
    unchanged,
    cloudNewer,
    cloudOnly: Math.max(0, cloudById.size - localMatched),
    tombstoned,
  };
}
