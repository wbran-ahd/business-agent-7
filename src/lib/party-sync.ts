/**
 * Party sync — durable, retryable cloud writes for the customer/supplier book.
 *
 * What was wrong before stage 4B
 * ------------------------------
 * `use-parties` called `setDoc`/`deleteDoc` fire-and-forget:
 *
 *   deleteDoc(...).catch((err) => logError(...));
 *
 * Firestore keeps a write in memory while the device is offline, but this app
 * does not enable offline persistence, so a reload throws that write away. The
 * document then stays in the cloud and the next snapshot puts the deleted party
 * (or transaction) straight back — with nothing on screen to say why. The same
 * happened for every party write made before a session existed (`uid` empty) and
 * for every rejected write (rules/validation), which only reached the console.
 *
 * What this module does
 * ---------------------
 * Every party/txn change is written to a small device-local queue **first**, and
 * only removed once Firestore confirmed it. A failed or never-sent operation is
 * therefore retried on the next mount, the next snapshot and the next change,
 * and an operation that cannot be stored at all is reported to the caller
 * instead of being swallowed.
 *
 * Stage 4C-A: party deletion is a tombstone, not a document delete.
 * ---------------------------------------------------------------
 * A `delete` op for `parties` is delivered as a **soft delete**: the cloud
 * document is read, its own fields are kept verbatim and `deleted`, `deletedAt`
 * and `deletedBy` are added. Nothing is removed from Firestore, so:
 *
 *  - another device sees the tombstone on its next snapshot and drops the party;
 *  - the deletion reaches devices that were offline when it happened;
 *  - the party's transactions stay stored (they are financial history);
 *  - a replay of the same op writes the same `deletedAt`, so duplicate delivery
 *    is idempotent (`applied`, then `alreadyDeleted`).
 *
 * A delete for a cloud document that never existed needs no write at all: it is
 * reported as `missing`, exactly like the record queue in `deletion-sync`.
 *
 * Resurrection guards on the client: `sauti_party_tombstones` remembers every
 * party this device deleted (even after a restart or while offline), the
 * snapshot decision function refuses tombstoned/malformed documents, and the
 * queue refuses an upsert for a party that is known to be deleted.
 *
 * Stage 4C-B: party writes carry a version, and an older write never wins.
 * ----------------------------------------------------------------------
 * Every party upsert now stores `updatedAt` — the epoch ms of the local edit,
 * which is the same `at` the queue already used, so the public `Party` type and
 * the backup format stay unchanged. Before a queued upsert is delivered the
 * cloud document is read and compared: a cloud copy that is clearly newer (by
 * more than `PARTY_CLOCK_SKEW_MS`, so one fast clock cannot freeze every other
 * device) wins, and the stale operation is set aside instead of overwriting it.
 *
 * That comparison is read-then-write, **not** a transaction: two devices writing
 * the same party inside the same window can still interleave and the last write
 * then wins. Atomic compare-and-set needs a Firestore transaction plus a rules
 * change, which is a separate decision (documented in the stage report).
 *
 * Nothing that can never be delivered is dropped silently any more: rejected,
 * stale, resurrecting and overflowed operations move to
 * `sauti_party_ops_dead`, where they can be inspected, and an operation is only
 * given up on after `MAX_PARTY_OP_ATTEMPTS` failed deliveries.
 */
import { deviceId } from "@/lib/deletion-sync";
import { logEvent } from "@/lib/logger";
import type { Party, PartyTxn } from "@/lib/parties";

const PENDING_KEY = "sauti_pending_party_ops";
/** Device-local tombstone list for parties (never travels to the cloud). */
const TOMBSTONE_KEY = "sauti_party_tombstones";
/**
 * Operations that can never be delivered (rejected, stale, resurrecting or
 * overflowed). Kept on the device so a lost write stays inspectable instead of
 * vanishing without a trace — stage 4C-B.
 */
const DEAD_KEY = "sauti_party_ops_dead";

export const MAX_TRACKED_PARTY_TOMBSTONES = 1000;

/** Bounded for the same reason as the deletion queue, with reporting on trim. */
export const MAX_PENDING_PARTY_OPS = 500;

/** Failed deliveries an operation survives before it is set aside. */
export const MAX_PARTY_OP_ATTEMPTS = 8;

/** Set-aside operations kept for inspection (oldest are trimmed first). */
export const MAX_DEAD_PARTY_OPS = 200;

/** Field that carries a party document's version (epoch ms of the edit). */
export const PARTY_VERSION_FIELD = "updatedAt";

/**
 * A fast clock must not make every other device look stale: a cloud version
 * only wins when it is newer by more than this window. Same reasoning as
 * `FUTURE_SKEW_MS` in the records lane.
 */
export const PARTY_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type PartySyncTarget = "parties" | "partyTxns";

export type PendingPartyOp = {
  target: PartySyncTarget;
  id: number;
  kind: "upsert" | "delete";
  /** Epoch ms of the local action; the newest op for a document wins. */
  at: number;
  /** Firestore-safe document for an upsert (no `undefined` values). */
  data?: Record<string, unknown>;
  /** UID the op belongs to; empty when no session existed when it was made. */
  uid?: string;
  /** Failed deliveries so far (stage 4C-B); bounds an undeliverable op. */
  attempts?: number;
  /** Last rejection, kept so a stuck operation can be diagnosed. */
  lastError?: string;
};

export type PartyQueueSave = {
  stored: number;
  dropped: number;
  persisted: boolean;
};

function canStore(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function partyOpKey(op: Pick<PendingPartyOp, "target" | "id">): string {
  return `${op.target}:${op.id}`;
}

function isPendingPartyOp(value: unknown): value is PendingPartyOp {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingPartyOp>;
  return (
    (candidate.target === "parties" || candidate.target === "partyTxns") &&
    typeof candidate.id === "number" &&
    Number.isFinite(candidate.id) &&
    (candidate.kind === "upsert" || candidate.kind === "delete") &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at) &&
    (candidate.uid === undefined || typeof candidate.uid === "string") &&
    (candidate.attempts === undefined ||
      (typeof candidate.attempts === "number" && Number.isFinite(candidate.attempts))) &&
    (candidate.lastError === undefined || typeof candidate.lastError === "string")
  );
}

/** Undelivered party operations, oldest first. */
export function loadPendingPartyOps(): PendingPartyOp[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingPartyOp);
  } catch {
    return [];
  }
}

export function savePendingPartyOps(ops: PendingPartyOp[]): PartyQueueSave {
  if (!canStore()) return { stored: 0, dropped: ops.length, persisted: false };

  const merged: PendingPartyOp[] = [];
  const index = new Map<string, number>();
  for (const op of ops) {
    const key = partyOpKey(op);
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, merged.length);
      merged.push(op);
      continue;
    }
    const previous = merged[existing];
    /* Deletion is final for a document: an upsert queued after it (a later
       import, a stale edit) must never revive the queued delete, otherwise an
       old backup file would resurrect a party this device already removed. */
    if (previous.kind === "delete" && op.kind === "upsert") continue;
    /* Two upserts keep the newer one; a delete supersedes a pending upsert. */
    if (op.at >= previous.at) merged[existing] = op;
  }

  const dropped = Math.max(0, merged.length - MAX_PENDING_PARTY_OPS);
  const kept = dropped > 0 ? merged.slice(dropped) : merged;
  if (dropped > 0) {
    /* Stage 4C-B: a trimmed operation is set aside for inspection, never just
       forgotten. The queue itself stays bounded either way. */
    recordDeadPartyOps(
      merged.slice(0, dropped).map((op) => ({ op, reason: "queue-overflow" })),
    );
  }

  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(kept));
    return { stored: kept.length, dropped, persisted: true };
  } catch {
    return { stored: 0, dropped: dropped + kept.length, persisted: false };
  }
}

/** Adds operations to the queue (deduplicated per document). */
export function enqueuePartyOps(ops: PendingPartyOp[]): PartyQueueSave {
  const queued = loadPendingPartyOps();
  if (ops.length === 0) {
    return { stored: queued.length, dropped: 0, persisted: true };
  }
  /* A party that is already deleted (queued delete or remembered tombstone)
     must not be re-created by a stale edit or a restored backup: Firestore
     would reject that write forever and the queue would never drain. */
  const deleted = deletedPartyIds();
  const accepted = ops.filter((op) => {
    if (op.target !== "parties" || op.kind !== "upsert") return true;
    if (!deleted.has(op.id)) return true;
    logEvent("sync", "warn", "refused a party upsert for a deleted party", {
      id: op.id,
    });
    return false;
  });
  if (accepted.length === 0) {
    return { stored: queued.length, dropped: 0, persisted: true };
  }
  const save = savePendingPartyOps([...queued, ...accepted]);
  if (!save.persisted || save.dropped > 0) {
    /* Never silent: a lost party write is a lost balance. */
    logEvent("sync", "error", "party change could not be queued", {
      persisted: save.persisted,
      dropped: save.dropped,
      ops: ops.length,
      sample: ops.slice(0, 5).map((op) => partyOpKey(op)).join(","),
    });
  }
  return save;
}

/** Pending operations keyed by document, for snapshot protection. */
export function pendingPartyOpsById(): Map<string, PendingPartyOp> {
  const map = new Map<string, PendingPartyOp>();
  for (const op of loadPendingPartyOps()) map.set(partyOpKey(op), op);
  return map;
}

/* ------------------------------------------------------------------ */
/* Set-aside operations (stage 4C-B)                                   */
/* ------------------------------------------------------------------ */

export type DeadPartyOp = {
  op: PendingPartyOp;
  /** `stale`, `tombstoned`, `abandoned: …`, `queue-overflow`, … */
  reason: string;
  retiredAt: number;
};

/**
 * Every operation this device gave up on, newest last.
 *
 * This is the safety net for stage 4C-B: an operation that can never be
 * delivered (the cloud copy is newer, the party is a tombstone, the write was
 * rejected too often, or the queue overflowed) leaves the retry queue — so it
 * cannot block the party forever — but it is still readable instead of being
 * silently discarded.
 */
export function loadDeadPartyOps(): DeadPartyOp[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(DEAD_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DeadPartyOp =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as DeadPartyOp).reason === "string" &&
        isPendingPartyOp((entry as DeadPartyOp).op),
    );
  } catch {
    return [];
  }
}

/** Moves operations out of the retry queue into the inspectable set-aside list. */
export function recordDeadPartyOps(
  entries: { op: PendingPartyOp; reason: string }[],
): void {
  if (!canStore() || entries.length === 0) return;
  const byKey = new Map<string, DeadPartyOp>();
  for (const entry of loadDeadPartyOps()) byKey.set(partyOpKey(entry.op), entry);
  const retiredAt = Date.now();
  for (const entry of entries) {
    byKey.set(partyOpKey(entry.op), { op: entry.op, reason: entry.reason, retiredAt });
  }
  const merged = [...byKey.values()];
  const kept = merged.slice(-MAX_DEAD_PARTY_OPS);
  try {
    localStorage.setItem(DEAD_KEY, JSON.stringify(kept));
    if (kept.length < merged.length) {
      logEvent("sync", "error", "set-aside party operations list is full", {
        dropped: merged.length - kept.length,
      });
    }
  } catch {
    /* quota / disabled storage: the sync stays safe, the history is lost */
    logEvent("sync", "error", "a set-aside party operation could not be stored", {
      count: entries.length,
    });
  }
}

/**
 * Removes queued operations by key and records why they will never be sent.
 * Used by the snapshot when the cloud holds a genuinely newer party.
 */
export function retirePendingPartyOps(keys: string[], reason: string): number {
  if (keys.length === 0) return 0;
  const ops = loadPendingPartyOps();
  if (ops.length === 0) return 0;
  const drop = new Set(keys);
  const kept: PendingPartyOp[] = [];
  const removed: PendingPartyOp[] = [];
  for (const op of ops) {
    if (drop.has(partyOpKey(op))) removed.push(op);
    else kept.push(op);
  }
  if (removed.length === 0) return 0;
  savePendingPartyOps(kept);
  recordDeadPartyOps(removed.map((op) => ({ op, reason })));
  logEvent("sync", "warn", "retired queued party operations that cannot be delivered", {
    count: removed.length,
    reason,
  });
  return removed.length;
}

/* ------------------------------------------------------------------ */
/* Party tombstones (stage 4C-A)                                       */
/* ------------------------------------------------------------------ */

/** Every party id this device knows to be deleted: remembered + queued. */
export function deletedPartyIds(): Set<number> {
  const ids = new Set<number>(loadTombstonedPartyIds());
  for (const op of loadPendingPartyOps()) {
    if (op.target === "parties" && op.kind === "delete") ids.add(op.id);
  }
  return ids;
}

/** Tombstoned party ids remembered on this device (oldest first, bounded). */
export function loadTombstonedPartyIds(): number[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
      .slice(-MAX_TRACKED_PARTY_TOMBSTONES);
  } catch {
    return [];
  }
}

/**
 * Remembers a party deletion so a restart, an offline import or an active cloud
 * document cannot bring it back. Same shape as `rememberDeletedIds` for the
 * ledger; a storage failure only loses the note, never a record.
 */
export function rememberTombstonedPartyIds(ids: number[]): void {
  if (!canStore() || ids.length === 0) return;
  try {
    const merged = [...loadTombstonedPartyIds()];
    const seen = new Set(merged);
    for (const id of ids) {
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    localStorage.setItem(
      TOMBSTONE_KEY,
      JSON.stringify(merged.slice(-MAX_TRACKED_PARTY_TOMBSTONES)),
    );
  } catch {
    /* quota / disabled storage: the sync stays safe, only the note is lost */
  }
}

export type PartyDocStatus = "active" | "deleted" | "invalid";

/**
 * Validates a party document read from the cloud.
 *
 * - no `deleted` field → `active` (documents written before this stage);
 * - `deleted: true` with a plausible `deletedAt` → `deleted`;
 * - anything else (wrong types, missing identity) → `invalid`, which the
 *   snapshot refuses to apply instead of trusting it.
 */
export function classifyPartyDoc(data: unknown): PartyDocStatus {
  if (!data || typeof data !== "object") return "invalid";
  const doc = data as Record<string, unknown>;
  if (typeof doc.id !== "number" || !Number.isFinite(doc.id)) return "invalid";
  if (typeof doc.name !== "string" || doc.name.trim().length === 0) return "invalid";
  if (doc.kind !== "customer" && doc.kind !== "supplier") return "invalid";
  if (!("deleted" in doc) || doc.deleted === false) return "active";
  if (doc.deleted !== true) return "invalid";
  if (typeof doc.deletedAt !== "number" || !Number.isFinite(doc.deletedAt) || doc.deletedAt <= 0) {
    return "invalid";
  }
  if (
    "deletedBy" in doc &&
    doc.deletedBy !== undefined &&
    (typeof doc.deletedBy !== "string" || doc.deletedBy.length > 128)
  ) {
    return "invalid";
  }
  return "deleted";
}

/**
 * The version stored on a party document, or `0` for documents written before
 * stage 4C-B (and for backups, which carry no version at all).
 */
export function partyDocVersion(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const value = (data as Record<string, unknown>)[PARTY_VERSION_FIELD];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The version a queued operation represents: the moment the edit was made. */
export function partyOpVersion(op: Pick<PendingPartyOp, "at">): number {
  return typeof op.at === "number" && Number.isFinite(op.at) ? op.at : 0;
}

export type PartyWriteDecision =
  /** Safe to write: nothing there, or nothing newer. */
  | "write"
  /** The cloud copy is newer than this operation — writing would lose data. */
  | "stale"
  /** The cloud document is a tombstone — writing would resurrect it. */
  | "tombstoned";

/**
 * Decides whether one queued upsert may overwrite the cloud document.
 *
 * `existing` is what the read returned (`null` when the document is missing).
 * A legacy document has version `0`, so a current edit still wins it — the
 * upgrade path keeps working without a migration.
 */
export function comparePartyWrite(
  existing: Record<string, unknown> | null | undefined,
  op: Pick<PendingPartyOp, "at">,
): PartyWriteDecision {
  if (!existing) return "write";
  if (classifyPartyDoc(existing) === "deleted") return "tombstoned";
  const cloud = partyDocVersion(existing);
  if (cloud > 0 && cloud > partyOpVersion(op) + PARTY_CLOCK_SKEW_MS) return "stale";
  return "write";
}

export type PartySnapshotDecision =
  /** An active cloud party joins the book. */
  | "apply"
  /** This device has an undelivered change for it — the snapshot must not win. */
  | "pending-local-change"
  /** The queued edit is older than the cloud copy: apply the cloud, retire the op. */
  | "cloud-newer"
  /** The cloud document is a tombstone — drop it from the book and remember it. */
  | "tombstone"
  /** Deleted on this device earlier; the cloud copy is stale/active. */
  | "known-deleted"
  /** Malformed document — never applied. */
  | "invalid";

/**
 * The single rule that decides what one snapshot document does to the book.
 * Order matters: a tombstone beats a pending upsert (deletion wins), and a
 * pending change beats an active cloud copy.
 */
export function decidePartySnapshot(
  data: unknown,
  pending: Map<string, PendingPartyOp>,
  tombstonedIds: Iterable<number>,
): PartySnapshotDecision {
  const status = classifyPartyDoc(data);
  if (status === "invalid") return "invalid";
  const id = (data as { id: number }).id;
  if (status === "deleted") return "tombstone";
  const op = pending.get(partyOpKey({ target: "parties", id }));
  if (op) {
    /* Stage 4C-B: a queued edit older than the cloud copy is stale, not
       pending — it must not hide (or later overwrite) the newer party. */
    if (
      op.kind === "upsert" &&
      partyDocVersion(data) > partyOpVersion(op) + PARTY_CLOCK_SKEW_MS
    ) {
      return "cloud-newer";
    }
    return "pending-local-change";
  }
  for (const known of tombstonedIds) {
    if (known === id) return "known-deleted";
  }
  return "apply";
}

/** Splits a restored backup so a deleted party is never restored as active. */
export function splitImportableParties(
  parties: Party[],
  tombstonedIds: Iterable<number>,
): { active: Party[]; blocked: number[] } {
  const deleted = new Set(tombstonedIds);
  const active: Party[] = [];
  const blocked: number[] = [];
  for (const party of parties) {
    if (deleted.has(party.id)) blocked.push(party.id);
    else active.push(party);
  }
  return { active, blocked };
}

/**
 * Drops queued upserts for parties whose tombstone we have just seen. They can
 * never be delivered (the rules refuse to resurrect a tombstone), so keeping
 * them would block the queue forever. Every dropped id is reported.
 */
export function dropStalePartyUpserts(tombstonedIds: number[]): number {
  if (tombstonedIds.length === 0) return 0;
  const deleted = new Set(tombstonedIds);
  const ops = loadPendingPartyOps();
  const kept = ops.filter(
    (op) => !(op.target === "parties" && op.kind === "upsert" && deleted.has(op.id)),
  );
  const dropped = ops.length - kept.length;
  if (dropped > 0) {
    savePendingPartyOps(kept);
    recordDeadPartyOps(
      ops
        .filter((op) => op.target === "parties" && op.kind === "upsert" && deleted.has(op.id))
        .map((op) => ({ op, reason: "tombstoned" })),
    );
    logEvent("sync", "warn", "dropped a queued party edit for a deleted party", {
      dropped,
      ids: tombstonedIds.join(","),
    });
  }
  return dropped;
}

/* ------------------------------------------------------------------ */
/* Firestore-safe payloads                                             */
/* ------------------------------------------------------------------ */

/**
 * Transaction document exactly as Firestore may receive it.
 *
 * Firestore rejects `undefined` field values, and a restored backup may be
 * missing an optional field, so every string field is defaulted here instead of
 * relying on the shape produced by `makePartyTxn`.
 */
export function partyTxnForCloud(txn: PartyTxn): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: txn.id,
    partyId: txn.partyId,
    kind: txn.kind,
    amount: txn.amount,
    note: typeof txn.note === "string" ? txn.note : "",
    account: txn.account === "bank" ? "bank" : "cash",
    timestamp: txn.timestamp,
    date: typeof txn.date === "string" ? txn.date : "",
    time: typeof txn.time === "string" ? txn.time : "",
  };
  /* Stage 4C-C: the customer/supplier classification travels with the entry so
     another device can still read it after the party is tombstoned. It is an
     additive optional field: the rules accept extra fields, and a document
     written by an older app version simply has none. */
  if (txn.partyKind === "customer" || txn.partyKind === "supplier") {
    doc.partyKind = txn.partyKind;
  }
  return doc;
}

/**
 * A party document from the cloud, reduced to the public `Party` shape.
 *
 * The sync metadata (`updatedAt` and the tombstone markers) is device-facing
 * only: it must never reach the book, because the book is exactly what
 * `exportJson` writes and the backup format must not change in this stage.
 */
export function partyFromCloudDoc(data: Record<string, unknown>): Party {
  const party: Record<string, unknown> = { ...data };
  delete party[PARTY_VERSION_FIELD];
  delete party.deleted;
  delete party.deletedAt;
  delete party.deletedBy;
  return party as unknown as Party;
}

/**
 * Party ids a backup file marks as `deleted: true`.
 *
 * The export format is unchanged in this stage, so a normal file holds active
 * parties only — but a hand-edited or future file may carry the tombstone
 * marker, and such a row must never be restored as an active customer.
 */
export function partiesMarkedDeletedInBackup(text: string): number[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return [];
    const rows = (parsed as { parties?: unknown }).parties;
    if (!Array.isArray(rows)) return [];
    const ids: number[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const entry = row as { id?: unknown; deleted?: unknown };
      if (entry.deleted === true && typeof entry.id === "number" && Number.isFinite(entry.id)) {
        ids.push(entry.id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

/** Ops for one party upsert. */
export function partyUpsertOp(party: Party, at = Date.now(), uid?: string): PendingPartyOp {
  const { note, ...rest } = party;
  return {
    target: "parties",
    id: party.id,
    kind: "upsert",
    at,
    /* Stage 4C-B: the document carries the version of the edit it represents.
       `at` is already the local edit time and stays stable across retries. */
    data: {
      ...rest,
      ...(note ? { note } : {}),
      [PARTY_VERSION_FIELD]: at,
    } as Record<string, unknown>,
    uid,
  };
}

export function partyDeleteOp(id: number, at = Date.now(), uid?: string): PendingPartyOp {
  return { target: "parties", id, kind: "delete", at, uid };
}

export function partyTxnUpsertOp(txn: PartyTxn, at = Date.now(), uid?: string): PendingPartyOp {
  return {
    target: "partyTxns",
    id: txn.id,
    kind: "upsert",
    at,
    data: partyTxnForCloud(txn),
    uid,
  };
}

export function partyTxnDeleteOp(id: number, at = Date.now(), uid?: string): PendingPartyOp {
  return { target: "partyTxns", id, kind: "delete", at, uid };
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export type PartyFlushOutcome = {
  applied: number;
  /** Party deletes whose cloud document was already a tombstone. */
  alreadyDeleted: number;
  /** Party deletes with no cloud document: nothing existed to delete. */
  missing: number;
  failed: number;
  /** Upserts skipped because the cloud copy is newer (stage 4C-B). */
  stale: number;
  /** Upserts skipped because the cloud document is a tombstone. */
  resurrectBlocked: number;
  /**
   * Transaction upserts quarantined because their party is deleted on this
   * device (stage 4C-C). The entry itself is kept in the local book and the
   * operation goes to the set-aside list — never silently dropped.
   */
  parentDeleted: number;
  /** Operations given up on after `MAX_PARTY_OP_ATTEMPTS` failures. */
  abandoned: number;
  /** Ops belonging to a different uid; kept queued, never sent. */
  deferred: number;
  failures: { key: string; reason: string }[];
  /** Operations that will never be delivered (also stored in the dead list). */
  retired: { key: string; op: PendingPartyOp; reason: string }[];
  remaining: PendingPartyOp[];
};

/**
 * The tombstone document for one party: the cloud copy's own fields, unchanged,
 * plus the deletion markers. Content is preserved verbatim so no party data is
 * lost, and `deletedAt` comes from the queued op so a retry writes the same
 * value (idempotent).
 */
export function partyTombstoneDocument(
  existing: Record<string, unknown>,
  deletedAt: number,
  deletedBy: string = deviceId(),
): Record<string, unknown> {
  return { ...existing, deleted: true, deletedAt, deletedBy };
}

/**
 * Delivers queued operations in order.
 *
 * A rejected or failed write stays in `remaining`, so a party deletion can never
 * be lost just because the device was offline when the user tapped delete.
 * Operations recorded for a different account are deferred instead of being
 * written into the current user's documents (UID isolation).
 *
 * A party `delete` is delivered as a tombstone (stage 4C-A):
 *   read the cloud document → missing / already a tombstone / write the
 *   tombstone. The document is never removed, and `applied` only grows when a
 *   write actually succeeded.
 */
export async function flushPendingPartyOps(options: {
  ops: PendingPartyOp[];
  uid: string;
  /** Current cloud document, or `null` when it does not exist. */
  read: (target: PartySyncTarget, id: number) => Promise<Record<string, unknown> | null>;
  write: (target: PartySyncTarget, id: number, data: Record<string, unknown>) => Promise<void>;
  remove: (target: PartySyncTarget, id: number) => Promise<void>;
}): Promise<PartyFlushOutcome> {
  const { ops, uid, read, write, remove } = options;
  const outcome: PartyFlushOutcome = {
    applied: 0,
    alreadyDeleted: 0,
    missing: 0,
    failed: 0,
    stale: 0,
    resurrectBlocked: 0,
    parentDeleted: 0,
    abandoned: 0,
    deferred: 0,
    failures: [],
    retired: [],
    remaining: [],
  };

  /* Parents this device already knows to be deleted (a queued tombstone or one
     received from the cloud). Read once per flush. */
  const deletedParents = deletedPartyIds();

  for (const op of ops) {
    if (op.uid && op.uid !== uid) {
      outcome.deferred += 1;
      outcome.remaining.push(op);
      continue;
    }
    try {
      if (op.kind === "upsert") {
        if (op.target === "partyTxns" && deletedParents.size > 0) {
          /* Stage 4C-C: a queued entry for a deleted party is quarantined here.
             It cannot resurrect anything on its own, but uploading it would
             leave a live row pointing at a party that is gone, and a stale
             device could keep adding such rows forever. The entry stays in the
             local book (history) and the operation is set aside with a reason,
             so the state is reported instead of quietly lost. */
          const parentId = typeof op.data?.partyId === "number" ? op.data.partyId : undefined;
          if (parentId !== undefined && deletedParents.has(parentId)) {
            outcome.parentDeleted += 1;
            outcome.retired.push({ key: partyOpKey(op), op, reason: "parent-deleted" });
            continue;
          }
        }
        if (op.target === "parties") {
          /* Stage 4C-B: the cloud copy is read before it is overwritten. This is
             read-then-write, not a transaction (see the module header), but a
             clearly newer cloud party is never replaced by an older edit. */
          const existing = await read("parties", op.id);
          const decision = comparePartyWrite(existing, op);
          if (decision !== "write") {
            if (decision === "stale") outcome.stale += 1;
            else outcome.resurrectBlocked += 1;
            outcome.retired.push({ key: partyOpKey(op), op, reason: decision });
            continue;
          }
        }
        await write(op.target, op.id, op.data ?? {});
        outcome.applied += 1;
        continue;
      }

      if (op.target === "parties") {
        const existing = await read("parties", op.id);
        if (existing === null) {
          /* Never reached the cloud, so no other device can hold it: nothing to
             tombstone. Reported as `missing`, not as a successful deletion. */
          outcome.missing += 1;
          continue;
        }
        if (classifyPartyDoc(existing) === "deleted") {
          outcome.alreadyDeleted += 1;
          continue;
        }
        await write("parties", op.id, partyTombstoneDocument(existing, op.at));
        outcome.applied += 1;
        continue;
      }

      await remove(op.target, op.id);
      outcome.applied += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const attempts = (op.attempts ?? 0) + 1;
      outcome.failed += 1;
      outcome.failures.push({ key: partyOpKey(op), reason });
      if (attempts >= MAX_PARTY_OP_ATTEMPTS) {
        /* Stage 4C-B: bounded retry. The op leaves the queue — otherwise a
           permanently rejected write would block this party's snapshots for
           ever — but it stays readable in the set-aside list. */
        outcome.abandoned += 1;
        outcome.retired.push({
          key: partyOpKey(op),
          op,
          reason: `abandoned after ${attempts} attempts: ${reason}`,
        });
        continue;
      }
      outcome.remaining.push({ ...op, attempts, lastError: reason.slice(0, 240) });
    }
  }

  if (outcome.retired.length > 0) {
    recordDeadPartyOps(
      outcome.retired.map(({ op, reason }) => ({ op, reason })),
    );
    logEvent("sync", "warn", "party operations were set aside (never silently dropped)", {
      stale: outcome.stale,
      resurrectBlocked: outcome.resurrectBlocked,
      parentDeleted: outcome.parentDeleted,
      abandoned: outcome.abandoned,
      keys: outcome.retired.slice(0, 5).map((entry) => entry.key).join(","),
    });
  }

  return outcome;
}
