/**
 * `useParties` — the customer/supplier ledger with offline persistence & Cloud Sync.
 *
 * Stage 4B: every cloud write is now queued durably first (see
 * `lib/party-sync`), so an offline deletion or edit is retried instead of being
 * silently dropped — a dropped party deletion used to come straight back on the
 * next snapshot. The real-time listener now also follows the signed-in uid and
 * never overwrites a change this device has not delivered yet.
 *
 * Stage 4C-A: a party deletion is a **tombstone** (`deleted`, `deletedAt`,
 * `deletedBy`) written through the queue, never a document delete. The
 * snapshot, a restored backup and the queue itself all refuse to bring a
 * tombstoned party back; the party's transactions are left untouched because
 * they are financial history.
 */
import {
  emptyPartyBook,
  loadPartyBook,
  makeParty,
  makePartyTxn,
  normalizePhone,
  partyAcceptsNewTxn,
  partyBookFromJson,
  partyBookToJson,
  persistPartyBook,
  stampPartyKind,
  type Party,
  type PartyBook,
  type PartyKind,
  type PartyTxn,
  type PartyTxnKind,
} from "@/lib/parties";
import {
  deletedPartyIds,
  decidePartySnapshot,
  dropStalePartyUpserts,
  enqueuePartyOps,
  flushPendingPartyOps,
  loadPendingPartyOps,
  MAX_PENDING_PARTY_OPS,
  partiesMarkedDeletedInBackup,
  partyDeleteOp,
  partyFromCloudDoc,
  partyOpKey,
  partyTxnDeleteOp,
  partyTxnUpsertOp,
  partyUpsertOp,
  pendingPartyOpsById,
  rememberTombstonedPartyIds,
  retirePendingPartyOps,
  savePendingPartyOps,
  splitImportableParties,
  type PartySnapshotDecision,
  type PendingPartyOp,
} from "@/lib/party-sync";
import { useAuth } from "@/hooks/use-auth";
import { validateAmount, type AccountKind } from "@/lib/khata";
import { auth, db } from "@/lib/firebase";
import { handleFirestoreError, OperationType } from "@/lib/firestore-errors";
import { logError, logEvent } from "@/lib/logger";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type DocumentData,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";

export type PartyDraft = { name: string; phone: string; note: string; kind: PartyKind };
export type TxnDraft = { kind: PartyTxnKind; amount: string; note: string; account: AccountKind };

/**
 * A party as the book (and therefore the backup) stores it: without the sync
 * metadata (`updatedAt`, tombstone markers), so the export format is unchanged.
 */
function bookParty(party: Party): Party {
  return partyFromCloudDoc(party as unknown as Record<string, unknown>);
}

export function useParties() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [book, setBook] = useState<PartyBook>(() => loadPartyBook());
  /** Bumped after a change so the delivery effect runs again. */
  const [flushTick, setFlushTick] = useState(0);

  // Local persistence
  useEffect(() => {
    persistPartyBook(book);
  }, [book]);

  /* Queue a change and try to deliver it. The local state is already updated by
     the caller, so an offline device keeps working and the cloud catches up. */
  const queueChange = useCallback((ops: PendingPartyOp[]) => {
    enqueuePartyOps(ops);
    setFlushTick((tick) => tick + 1);
  }, []);

  /**
   * Sends every queued operation for one account and keeps whatever failed.
   * A rejected write is never dropped: it stays in the queue for the next run.
   */
  const deliverQueued = useCallback(async (targetUid: string) => {
    const ops = loadPendingPartyOps();
    if (ops.length === 0) return;
    const deletions = ops.filter(
      (op) => op.target === "parties" && op.kind === "delete",
    ).length;
    const outcome = await flushPendingPartyOps({
      ops,
      uid: targetUid,
      read: async (target, id) => {
        const snap = await getDoc(doc(db, "users", targetUid, target, String(id)));
        return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      },
      write: async (target, id, data) => {
        await setDoc(doc(db, "users", targetUid, target, String(id)), data);
      },
      remove: async (target, id) => {
        await deleteDoc(doc(db, "users", targetUid, target, String(id)));
      },
    });
    const save = savePendingPartyOps(outcome.remaining);
    if (!save.persisted) {
      logEvent("sync", "error", "party queue could not be persisted", {
        remaining: outcome.remaining.length,
      });
    }
    if (deletions > 0) {
      logEvent(
        "sync",
        outcome.failed > 0 ? "error" : "info",
        "party deletions delivered",
        {
          queued: deletions,
          applied: outcome.applied,
          alreadyDeleted: outcome.alreadyDeleted,
          missing: outcome.missing,
          failed: outcome.failed,
          deferred: outcome.deferred,
          remaining: outcome.remaining.length,
        },
      );
    }
    if (outcome.failed > 0) {
      logEvent("sync", "error", "party changes could not be delivered (kept for retry)", {
        failed: outcome.failed,
        deferred: outcome.deferred,
        abandoned: outcome.abandoned,
        failures: outcome.failures,
      });
    }
    if (outcome.stale > 0 || outcome.resurrectBlocked > 0) {
      logEvent("sync", "warn", "older party changes were not written over newer cloud data", {
        stale: outcome.stale,
        resurrectBlocked: outcome.resurrectBlocked,
        retired: outcome.retired.map((entry) => entry.key).join(","),
      });
    }
  }, []);

  /* Delivery: runs on mount, when a session appears and after every change. */
  useEffect(() => {
    if (!uid) return;
    void deliverQueued(uid).catch((error) =>
      logError("sync", "party delivery crashed", error),
    );
  }, [uid, flushTick, deliverQueued]);

  // Firestore real-time sync when authenticated
  useEffect(() => {
    if (!uid) return;

    const partiesCol = collection(db, "users", uid, "parties");
    const txnsCol = collection(db, "users", uid, "partyTxns");

    const unsubParties = onSnapshot(
      partiesCol,
      (snapshot) => {
        /* Stage 4C-A: every document is classified before it touches the book.
           A tombstone wins over a pending edit, a pending local change wins
           over an active cloud copy, and a malformed document is never
           applied. The same decision function is exercised by the unit and
           emulator tests. */
        const pending = pendingPartyOpsById();
        const known = deletedPartyIds();
        const entries: {
          id: number;
          data: DocumentData;
          decision: PartySnapshotDecision;
        }[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          entries.push({
            id: typeof (data as { id?: number }).id === "number" ? (data as { id: number }).id : -1,
            data,
            decision: decidePartySnapshot(data, pending, known),
          });
        });

        const tombstoned = entries
          .filter((entry) => entry.decision === "tombstone")
          .map((entry) => entry.id);
        if (tombstoned.length > 0) {
          rememberTombstonedPartyIds(tombstoned);
          dropStalePartyUpserts(tombstoned);
          for (const id of tombstoned) known.add(id);
          logEvent("sync", "info", "party deletion received from the cloud", {
            ids: tombstoned.join(","),
          });
        }
        /* Stage 4C-B: a queued edit older than the cloud copy is stale. It is
           retired (and reported), so it can neither hide the newer party in
           the book nor overwrite it when it is finally delivered. */
        const superseded = entries
          .filter((entry) => entry.decision === "cloud-newer")
          .map((entry) => entry.id);
        if (superseded.length > 0) {
          retirePendingPartyOps(
            superseded.map((id) => partyOpKey({ target: "parties", id })),
            "superseded by a newer cloud party",
          );
          logEvent("sync", "warn", "a queued party edit was superseded by the cloud", {
            ids: superseded.join(","),
          });
        }

        const invalid = entries.filter((entry) => entry.decision === "invalid");
        if (invalid.length > 0) {
          logEvent("sync", "warn", "skipped a malformed party document", {
            count: invalid.length,
            ids: invalid.map((entry) => entry.id).join(","),
          });
        }

        /* Stage 4C-C: a tombstone still carries the party's own `kind`, and
           that is the only way a device that never held the party can keep
           reading its history as a customer receivable or a supplier payable.
           The kind is copied onto entries that do not have one yet; nothing is
           uploaded and no existing value is overwritten. */
        const tombstoneKinds: { id: number; kind: PartyKind }[] = [];
        for (const entry of entries) {
          const kind = (entry.data as { kind?: unknown }).kind;
          if (entry.decision !== "tombstone") continue;
          if (kind === "customer" || kind === "supplier") {
            tombstoneKinds.push({ id: entry.id, kind });
          }
        }

        setBook((current) => {
          const partyMap = new Map<number, Party>();
          current.parties.forEach((p) => partyMap.set(p.id, p));
          for (const entry of entries) {
            if (entry.decision === "tombstone") {
              partyMap.delete(entry.id);
              continue;
            }
            if (entry.decision !== "apply" && entry.decision !== "cloud-newer") continue;
            partyMap.set(entry.id, partyFromCloudDoc(entry.data as Record<string, unknown>));
          }
          let txns = current.txns;
          for (const entry of tombstoneKinds) {
            txns = stampPartyKind(txns, entry.id, entry.kind);
          }
          return { ...current, parties: Array.from(partyMap.values()), txns };
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/parties`);
      },
    );

    const unsubTxns = onSnapshot(
      txnsCol,
      (snapshot) => {
        const remoteTxns: PartyTxn[] = [];
        snapshot.forEach((docSnap) => {
          remoteTxns.push(docSnap.data() as PartyTxn);
        });
        const pending = pendingPartyOpsById();
        setBook((current) => {
          const txnMap = new Map<number, PartyTxn>();
          current.txns.forEach((t) => txnMap.set(t.id, t));
          remoteTxns.forEach((t) => {
            if (pending.has(partyOpKey({ target: "partyTxns", id: t.id }))) return;
            txnMap.set(t.id, t);
          });
          return { ...current, txns: Array.from(txnMap.values()) };
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${uid}/partyTxns`);
      },
    );

    return () => {
      unsubParties();
      unsubTxns();
    };
  }, [uid]);

  const addParty = useCallback(
    (draft: PartyDraft): string | null => {
      const name = draft.name.trim();
      if (name.length < 2) return "نام کم از کم دو حروف کا ہونا چاہیے۔";
      const phone = normalizePhone(draft.phone);
      if (draft.phone.trim() !== "" && phone === "") return "فون نمبر درست نہیں (مثلاً 03001234567)۔";

      const newParty = makeParty({ ...draft, name, phone });
      setBook((current) => ({
        ...current,
        parties: [...current.parties, newParty],
      }));
      queueChange([partyUpsertOp(newParty, Date.now(), uid)]);
      return null;
    },
    [queueChange, uid],
  );

  const updateParty = useCallback(
    (id: number, draft: PartyDraft) => {
      let updatedParty: Party | undefined;
      setBook((current) => {
        const updatedParties = current.parties.map((party) => {
          if (party.id === id) {
            updatedParty = {
              ...party,
              name: draft.name.trim(),
              phone: normalizePhone(draft.phone),
              kind: draft.kind,
              note: draft.note.trim() || undefined,
            };
            return updatedParty;
          }
          return party;
        });
        return { ...current, parties: updatedParties };
      });

      if (updatedParty) queueChange([partyUpsertOp(updatedParty, Date.now(), uid)]);
    },
    [queueChange, uid],
  );

  const removeParty = useCallback(
    (id: number) => {
      setBook((current) => {
        const party = current.parties.find((row) => row.id === id);
        return {
          parties: current.parties.filter((row) => row.id !== id),
          /* Stage 4C-C: the party's history is **kept**. Deleting a party is
             not a settlement and not a write-off — its payments must keep
             moving cash exactly as they did before, and its outstanding debt
             must survive. The only thing that changes is that the party row is
             gone; the entries are stamped with the kind of the party so they
             can still be read without it. */
          txns: party ? stampPartyKind(current.txns, id, party.kind) : current.txns,
        };
      });
      /* Stage 4C-A: remember the deletion *before* the cloud write, so a
         reload, an offline import or a stale snapshot cannot bring the party
         back while the queued tombstone is still waiting to be delivered. */
      rememberTombstonedPartyIds([id]);
      queueChange([partyDeleteOp(id, Date.now(), uid)]);
    },
    [queueChange, uid],
  );

  const addTxn = useCallback(
    (partyId: number, draft: TxnDraft): string | null => {
      const amount = validateAmount(Number.parseFloat(draft.amount));
      if (!amount.ok) return amount.message;

      /* Stage 4C-C: a deleted party can never receive a new entry. The check
         runs against the local book **and** the locally remembered tombstones,
         so an entry cannot be created in the window between a deletion and the
         next snapshot. */
      const party = book.parties.find((row) => row.id === partyId);
      if (!party || !partyAcceptsNewTxn(book.parties, partyId, deletedPartyIds())) {
        return "یہ گاہک/سپلائر حذف ہو چکا ہے، نئی انٹری نہیں ہو سکتی۔";
      }

      /* Created outside the state updater so the function stays pure (React
         runs updaters twice in development). */
      const newTxn = makePartyTxn(partyId, {
        kind: draft.kind,
        amount: amount.value,
        note: draft.note,
        account: draft.account,
        partyKind: party.kind,
      });
      setBook((current) => {
        if (!current.parties.some((row) => row.id === partyId)) return current;
        return {
          ...current,
          txns: [...current.txns, newTxn],
        };
      });

      queueChange([partyTxnUpsertOp(newTxn, Date.now(), uid)]);
      return null;
    },
    [book.parties, queueChange, uid],
  );

  const removeTxn = useCallback(
    (id: number) => {
      setBook((current) => ({ ...current, txns: current.txns.filter((txn) => txn.id !== id) }));
      queueChange([partyTxnDeleteOp(id, Date.now(), uid)]);
    },
    [queueChange, uid],
  );

  const exportJson = useCallback(() => partyBookToJson(book), [book]);

  const importJson = useCallback(
    (text: string): string | null => {
      try {
        const parsed = partyBookFromJson(text);
        if (parsed.parties.length === 0 && parsed.txns.length === 0) {
          return "فائل میں کوئی گاہک یا انٹری نہیں ملی۔";
        }
        /* A restored backup must not resurrect a party this device (or the
           cloud) has deleted: the book only keeps the still-active parties.
           Stage 4C-B: a row the file itself marks `deleted: true` counts as
           deleted even when this device never saw its tombstone. Transactions
           are kept in full — they are financial history. */
        const deletedInFile = partiesMarkedDeletedInBackup(text);
        if (deletedInFile.length > 0) rememberTombstonedPartyIds(deletedInFile);
        const tombstoned = deletedPartyIds();
        const { active, blocked } = splitImportableParties(parsed.parties, tombstoned);
        if (blocked.length > 0) {
          logEvent(
            "import",
            "warn",
            "a backup contains deleted parties; they were not restored",
            { count: blocked.length, markedInFile: deletedInFile.length, ids: blocked.join(",") },
          );
        }
        /* The book keeps the public `Party` shape only, so the exported backup
           stays byte-for-byte the same format as before this stage. */
        const restored = active.map(bookParty);
        /* Stage 4C-C: the entries keep the classification the file records (or
           the one of their party row in the file, including a row that is
           blocked from being restored). Their financial history is preserved
           and stays interpretable without the party. */
        const fileKinds = new Map(parsed.parties.map((party) => [party.id, party.kind]));
        const restoredTxns = parsed.txns.map((txn) => {
          if (txn.partyKind) return txn;
          const kind = fileKinds.get(txn.partyId);
          return kind ? { ...txn, partyKind: kind } : txn;
        });
        setBook({ parties: restored, txns: restoredTxns });

        /* Restored rows are queued like any other change: a rejected write is
           retried and reported instead of vanishing into an empty catch. A
           backup can be far larger than one queue batch, so it is delivered
           batch by batch instead of being truncated by the cap. */
        const now = Date.now();
        /* Entries of a party that stays deleted are kept in the book but never
           re-uploaded: the cloud party is a tombstone and the queue would
           quarantine them anyway. Reported instead of silently skipped. */
        const blockedIds = new Set(blocked);
        const uploadableTxns = restoredTxns.filter((txn) => !blockedIds.has(txn.partyId));
        if (uploadableTxns.length < restoredTxns.length) {
          logEvent(
            "import",
            "warn",
            "entries of a deleted party were kept locally but not re-uploaded",
            { count: restoredTxns.length - uploadableTxns.length },
          );
        }
        const ops: PendingPartyOp[] = [
          ...restored.map((party) => partyUpsertOp(party, now, uid)),
          ...uploadableTxns.map((txn) => partyTxnUpsertOp(txn, now, uid)),
        ];
        void (async () => {
          for (let index = 0; index < ops.length; index += MAX_PENDING_PARTY_OPS) {
            enqueuePartyOps(ops.slice(index, index + MAX_PENDING_PARTY_OPS));
            const targetUid = auth.currentUser?.uid;
            if (!targetUid) return;
            await deliverQueued(targetUid);
            if (loadPendingPartyOps().length > 0) return;
          }
        })().catch((error) => logError("sync", "party import sync failed", error));

        return null;
      } catch {
        return "JSON فائل پڑھی نہیں جا سکی۔";
      }
    },
    [deliverQueued, uid],
  );

  const clearAll = useCallback(() => setBook(emptyPartyBook()), []);

  const parties = useMemo(
    () => [...book.parties].sort((a, b) => a.name.localeCompare(b.name, "ur")),
    [book.parties],
  );

  return {
    book,
    parties,
    addParty,
    updateParty,
    removeParty,
    addTxn,
    removeTxn,
    exportJson,
    importJson,
    clearAll,
  };
}

export type UseParties = ReturnType<typeof useParties>;
