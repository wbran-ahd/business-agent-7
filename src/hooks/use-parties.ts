/**
 * `useParties` — the customer/supplier ledger with offline persistence & Cloud Sync.
 */
import {
  emptyPartyBook,
  loadPartyBook,
  makeParty,
  makePartyTxn,
  normalizePhone,
  partyBookFromJson,
  partyBookToJson,
  persistPartyBook,
  type Party,
  type PartyBook,
  type PartyKind,
  type PartyTxn,
  type PartyTxnKind,
} from "@/lib/parties";
import { validateAmount, type AccountKind } from "@/lib/khata";
import { auth, db } from "@/lib/firebase";
import { handleFirestoreError, OperationType } from "@/lib/firestore-errors";
import { logError } from "@/lib/logger";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";

export type PartyDraft = { name: string; phone: string; note: string; kind: PartyKind };
export type TxnDraft = { kind: PartyTxnKind; amount: string; note: string; account: AccountKind };

export function useParties() {
  const [book, setBook] = useState<PartyBook>(() => loadPartyBook());

  // Local persistence
  useEffect(() => {
    persistPartyBook(book);
  }, [book]);

  // Firestore real-time sync when authenticated
  useEffect(() => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    const partiesCol = collection(db, "users", currentUid, "parties");
    const txnsCol = collection(db, "users", currentUid, "partyTxns");

    const unsubParties = onSnapshot(
      partiesCol,
      (snapshot) => {
        const remoteParties: Party[] = [];
        snapshot.forEach((docSnap) => {
          remoteParties.push(docSnap.data() as Party);
        });
        setBook((current) => {
          const partyMap = new Map<number, Party>();
          current.parties.forEach((p) => partyMap.set(p.id, p));
          remoteParties.forEach((p) => partyMap.set(p.id, p));
          return { ...current, parties: Array.from(partyMap.values()) };
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${currentUid}/parties`);
      },
    );

    const unsubTxns = onSnapshot(
      txnsCol,
      (snapshot) => {
        const remoteTxns: PartyTxn[] = [];
        snapshot.forEach((docSnap) => {
          remoteTxns.push(docSnap.data() as PartyTxn);
        });
        setBook((current) => {
          const txnMap = new Map<number, PartyTxn>();
          current.txns.forEach((t) => txnMap.set(t.id, t));
          remoteTxns.forEach((t) => txnMap.set(t.id, t));
          return { ...current, txns: Array.from(txnMap.values()) };
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `users/${currentUid}/partyTxns`);
      },
    );

    return () => {
      unsubParties();
      unsubTxns();
    };
  }, []);

  const addParty = useCallback((draft: PartyDraft): string | null => {
    const name = draft.name.trim();
    if (name.length < 2) return "نام کم از کم دو حروف کا ہونا چاہیے۔";
    const phone = normalizePhone(draft.phone);
    if (draft.phone.trim() !== "" && phone === "") return "فون نمبر درست نہیں (مثلاً 03001234567)۔";
    
    const newParty = makeParty({ ...draft, name, phone });
    setBook((current) => ({
      ...current,
      parties: [...current.parties, newParty],
    }));

    const uid = auth.currentUser?.uid;
    if (uid) {
      setDoc(doc(db, "users", uid, "parties", String(newParty.id)), newParty).catch((err) =>
        logError("sync", "sync addParty failed", err),
      );
    }
    return null;
  }, []);

  const updateParty = useCallback((id: number, draft: PartyDraft) => {
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

    const uid = auth.currentUser?.uid;
    if (uid && updatedParty) {
      setDoc(doc(db, "users", uid, "parties", String(id)), updatedParty).catch((err) =>
        logError("sync", "sync updateParty failed", err),
      );
    }
  }, []);

  const removeParty = useCallback((id: number) => {
    setBook((current) => ({
      parties: current.parties.filter((party) => party.id !== id),
      txns: current.txns.filter((txn) => txn.partyId !== id),
    }));

    const uid = auth.currentUser?.uid;
    if (uid) {
      deleteDoc(doc(db, "users", uid, "parties", String(id))).catch((err) =>
        logError("sync", "sync removeParty failed", err),
      );
    }
  }, []);

  const addTxn = useCallback(
    (partyId: number, draft: TxnDraft): string | null => {
      const amount = validateAmount(Number.parseFloat(draft.amount));
      if (!amount.ok) return amount.message;
      
      let newTxn: PartyTxn | undefined;
      setBook((current) => {
        if (!current.parties.some((party) => party.id === partyId)) return current;
        newTxn = makePartyTxn(partyId, {
          kind: draft.kind,
          amount: amount.value,
          note: draft.note,
          account: draft.account,
        });
        return {
          ...current,
          txns: [...current.txns, newTxn],
        };
      });

      const uid = auth.currentUser?.uid;
      if (uid && newTxn) {
        setDoc(doc(db, "users", uid, "partyTxns", String(newTxn.id)), newTxn).catch((err) =>
          logError("sync", "sync addTxn failed", err),
        );
      }
      return null;
    },
    [],
  );

  const removeTxn = useCallback((id: number) => {
    setBook((current) => ({ ...current, txns: current.txns.filter((txn) => txn.id !== id) }));

    const uid = auth.currentUser?.uid;
    if (uid) {
      deleteDoc(doc(db, "users", uid, "partyTxns", String(id))).catch((err) =>
        logError("sync", "sync removeTxn failed", err),
      );
    }
  }, []);

  const exportJson = useCallback(() => partyBookToJson(book), [book]);

  const importJson = useCallback((text: string): string | null => {
    try {
      const parsed = partyBookFromJson(text);
      if (parsed.parties.length === 0 && parsed.txns.length === 0) {
        return "فائل میں کوئی گاہک یا انٹری نہیں ملی۔";
      }
      setBook(parsed);

      const uid = auth.currentUser?.uid;
      if (uid) {
        parsed.parties.forEach((p) => {
          setDoc(doc(db, "users", uid, "parties", String(p.id)), p).catch(() => {});
        });
        parsed.txns.forEach((t) => {
          setDoc(doc(db, "users", uid, "partyTxns", String(t.id)), t).catch(() => {});
        });
      }

      return null;
    } catch {
      return "JSON فائل پڑھی نہیں جا سکی۔";
    }
  }, []);

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
