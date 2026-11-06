/**
 * Deletion sync — stage 4A (Option A: soft-delete tombstone fields).
 *
 * What problem this solves
 * ------------------------
 * A deletion used to be purely device-local (`sauti_deleted_ids`). The cloud
 * document stayed active, so any other device — or the same device after
 * clearing its storage — pulled the record straight back. Deleting on one
 * phone could therefore never delete on another.
 *
 * How it works now (and why this cannot lose money)
 * ------------------------------------------------
 * 1. `removeEntry`/`undo` enqueue a **pending deletion** with a full snapshot
 *    of the record. It lives in localStorage, so it survives a restart, a
 *    reload and an offline session.
 * 2. The next Cloud Upload replays that queue. For each entry the cloud
 *    document is turned into a **tombstone**: the record's own data is kept
 *    intact and `deleted: true` plus the deletion metadata is added. Nothing is
 *    ever removed from Firestore.
 * 3. A failed write keeps the entry in the queue and is reported, so a
 *    deletion is never dropped on the floor.
 *
 * A deletion whose record never reached the cloud needs no document: records
 * only travel through Firestore, so a document that does not exist cannot exist
 * on another device. Such entries are reported as `missing` and cleared.
 * 4. Tombstones are permanent by design: uploads never overwrite them and
 *    downloads never turn them back into records. That is what stops a stale
 *    device from resurrecting deleted data.
 *
 * Deliberate limitation (documented, not hidden): deletion always wins. If a
 * second device edits the record while this device deletes it, the deletion
 * still wins. Resurrecting a tombstone would need an explicit restore feature
 * and a rules change, neither of which exists in stage 4A.
 */
import type { CloudRow } from "@/hooks/use-merge-logic";
import { recordFromEntry } from "@/hooks/use-merge-logic";
import type { Entry, EntryType } from "@/lib/khata";

const PENDING_KEY = "sauti_pending_deletions";
const DEVICE_KEY = "sauti_device_id";

/**
 * How many undelivered deletions the device keeps.
 *
 * Stage 4B raised this from 500 to 1000: the queue is the only record of a
 * deletion until it reaches Firestore, so a small cap can drop an event and let
 * the record come back on another device. 1000 entries is far more than any
 * realistic offline session, and an overflow is now reported instead of being
 * trimmed silently (see `savePendingDeletions`).
 */
export const MAX_PENDING_DELETIONS = 1000;

export type PendingDeletion = {
  localId: number;
  /** Epoch ms of the deletion on the device that performed it. */
  deletedAt: number;
  /** Deterministic id of the deletion event: `<deletedAt>-<localId>`. */
  deletedEventId: string;
  /** Opaque device id that originated the deletion. */
  deletedBy: string;
  /** The record version this device knew when the record was deleted. */
  deletedVersion: number;
  /**
   * Full record snapshot, kept as evidence of what was deleted on this device.
   *
   * It is optional on read because `savePendingDeletions` strips it when
   * localStorage is out of quota: a tombstone is always built from the cloud
   * document, so the snapshot is never required to deliver the event.
   */
  record?: CloudRow;
};

/** Result of a queue write — callers must report `dropped` / `persisted` false. */
export type PendingDeletionSave = {
  /** Entries actually written to localStorage. */
  stored: number;
  /** Entries that had to be trimmed because the cap was reached. */
  dropped: number;
  /** `false` = nothing could be stored; the event exists in memory only. */
  persisted: boolean;
};

function canStore(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Stable, opaque, device-local id used as `deletedBy`. */
export function deviceId(): string {
  if (!canStore()) return "device-unknown";
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && existing.length > 0 && existing.length <= 64) return existing;
    const created = `d-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return "device-unknown";
  }
}

function isPendingDeletion(value: unknown): value is PendingDeletion {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingDeletion>;
  const record = candidate.record as Partial<CloudRow> | undefined;
  if (
    typeof candidate.localId !== "number" ||
    !Number.isFinite(candidate.localId) ||
    typeof candidate.deletedAt !== "number" ||
    !Number.isFinite(candidate.deletedAt) ||
    typeof candidate.deletedEventId !== "string" ||
    typeof candidate.deletedBy !== "string"
  ) {
    return false;
  }
  /* The snapshot is optional (a compacted entry has none), but when it is
     present it must describe the same record. */
  if (record === undefined) return true;
  return (
    record.localId === candidate.localId &&
    typeof record.timestamp === "number" &&
    (record.kind === "income" || record.kind === "expense")
  );
}

/**
 * Undelivered deletions, oldest first. Malformed entries are dropped.
 *
 * Reading never trims: trimming only happens on write, where it is counted and
 * reported. A read that silently shortened the queue would hide lost events.
 */
export function loadPendingDeletions(): PendingDeletion[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingDeletion);
  } catch {
    return [];
  }
}

/** Strips the optional record snapshot so a full disk still keeps the event. */
function withoutSnapshot(item: PendingDeletion): PendingDeletion {
  return {
    localId: item.localId,
    deletedAt: item.deletedAt,
    deletedEventId: item.deletedEventId,
    deletedBy: item.deletedBy,
    deletedVersion: item.deletedVersion,
  };
}

/**
 * Replaces the stored queue; used to prune entries once they are delivered.
 *
 * Durable by design (stage 4B):
 * - a repeated event for the same record collapses to the latest one;
 * - reaching the cap is **reported** (`dropped`) instead of being swallowed;
 * - if the quota is full, the record snapshots are stripped and the write is
 *   retried, because a tombstone only needs the cloud document;
 * - `persisted: false` means the caller must tell the user the event could not
 *   be stored — nothing is silently forgotten.
 */
export function savePendingDeletions(pending: PendingDeletion[]): PendingDeletionSave {
  if (!canStore()) {
    return { stored: 0, dropped: pending.length, persisted: false };
  }

  const unique: PendingDeletion[] = [];
  const index = new Map<number, number>();
  for (const item of pending) {
    const existing = index.get(item.localId);
    if (existing === undefined) {
      index.set(item.localId, unique.length);
      unique.push(item);
    } else {
      unique[existing] = item;
    }
  }

  const dropped = Math.max(0, unique.length - MAX_PENDING_DELETIONS);
  const kept = dropped > 0 ? unique.slice(dropped) : unique;

  const attempts = [kept, kept.map(withoutSnapshot)];
  for (const attempt of attempts) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(attempt));
      return { stored: attempt.length, dropped, persisted: true };
    } catch {
      /* quota or disabled storage: retry with the compact form */
    }
  }

  return { stored: 0, dropped: dropped + kept.length, persisted: false };
}

/**
 * Records one deletion.
 *
 * Idempotent: deleting the same record twice keeps the first event instead of
 * stacking a second one, so the queue can never grow from a repeated click.
 */
export type EnqueuedDeletion = PendingDeletion & {
  /** Storage outcome, so the caller can report a loss instead of assuming success. */
  queue: PendingDeletionSave;
};

export function enqueuePendingDeletion(
  entry: Entry,
  kind: EntryType,
  now = Date.now(),
  device = deviceId(),
): EnqueuedDeletion {
  const record = recordFromEntry(entry, kind);
  const existing = loadPendingDeletions().find((item) => item.localId === entry.id);
  if (existing) {
    /* Already queued: keep the first event (an undo/delete pair must not send
       two conflicting deletion times for one record). */
    return {
      ...existing,
      queue: { stored: loadPendingDeletions().length, dropped: 0, persisted: true },
    };
  }

  const pending: PendingDeletion = {
    localId: entry.id,
    deletedAt: now,
    deletedEventId: `${now}-${entry.id}`,
    deletedBy: device,
    deletedVersion: record.updatedAt ?? record.timestamp,
    record,
  };
  const queue = savePendingDeletions([...loadPendingDeletions(), pending]);
  return { ...pending, queue };
}

/** The tombstone document for one deletion. Content is preserved verbatim. */
export function buildTombstoneDocument(
  base: CloudRow,
  pending: PendingDeletion,
): CloudRow {
  return {
    ...base,
    localId: pending.localId,
    deleted: true,
    deletedAt: pending.deletedAt,
    deletedEventId: pending.deletedEventId,
    deletedVersion: pending.deletedVersion,
    deletedBy: pending.deletedBy,
    /* The document's edit time becomes the deletion time, so every existing
       `updatedAt` comparison (`planUpload`, `cloudWinner`) treats the deletion
       as the newest event even before it looks at the `deleted` flag. */
    updatedAt: pending.deletedAt,
  };
}

export type DeletionSyncOutcome = {
  /** Tombstones written by this run. */
  applied: number;
  /** Queue entries whose cloud document was already a tombstone. */
  alreadyDeleted: number;
  /** Queue entries with no cloud document — nothing to mark, already satisfied. */
  missing: number;
  /** Queue entries whose write failed; they stay pending. */
  failed: number;
  failures: { localId: number; reason: string }[];
  /** Queue after this attempt — persist this, never `[]` unless nothing failed. */
  remaining: PendingDeletion[];
  /** Every tombstone this run knows about, so the caller can plan around them. */
  tombstones: CloudRow[];
};

/**
 * Replays the pending-deletion queue against the cloud rows already read.
 *
 * The writer is injected so the app (Firestore) and the emulator tests use the
 * exact same orchestration. A failed write never removes the entry: it is
 * returned in `remaining` and counted in `failed`, which is what makes the
 * workflow retryable instead of silently lossy.
 */
export async function syncPendingDeletions(options: {
  pending: PendingDeletion[];
  cloudRows: CloudRow[];
  write: (row: CloudRow) => Promise<void>;
}): Promise<DeletionSyncOutcome> {
  const { pending, cloudRows, write } = options;
  const cloudById = new Map<number, CloudRow>();
  for (const row of cloudRows) cloudById.set(row.localId, row);

  const outcome: DeletionSyncOutcome = {
    applied: 0,
    alreadyDeleted: 0,
    missing: 0,
    failed: 0,
    failures: [],
    remaining: [],
    tombstones: [],
  };

  for (const item of pending) {
    const cloud = cloudById.get(item.localId);

    if (!cloud) {
      /* Never uploaded, so no other device can hold it: the deletion is already
         true everywhere. Clearing the entry is not data loss. */
      outcome.missing += 1;
      continue;
    }

    if (cloud.deleted === true) {
      outcome.alreadyDeleted += 1;
      outcome.tombstones.push(cloud);
      continue;
    }

    const document = buildTombstoneDocument(cloud, item);
    try {
      await write(document);
      outcome.applied += 1;
      outcome.tombstones.push(document);
      cloudById.set(document.localId, document);
    } catch (error) {
      outcome.failed += 1;
      outcome.failures.push({
        localId: item.localId,
        reason: error instanceof Error ? error.message : String(error),
      });
      outcome.remaining.push(item);
    }
  }

  return outcome;
}
