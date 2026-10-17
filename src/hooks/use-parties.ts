/**
 * `useParties` — the customer/supplier ledger.
 *
 * Mirrors `useKhata`: one small API, validation in one place, and every change
 * persisted to localStorage. Errors come back as a string (null = ok) so the UI
 * can show them inline without exceptions crossing component boundaries.
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
  type PartyBook,
  type PartyKind,
  type PartyTxnKind,
} from "@/lib/parties";
import { validateAmount, type AccountKind } from "@/lib/khata";
import { useCallback, useEffect, useMemo, useState } from "react";

export type PartyDraft = { name: string; phone: string; note: string; kind: PartyKind };
export type TxnDraft = { kind: PartyTxnKind; amount: string; note: string; account: AccountKind };

export function useParties() {
  const [book, setBook] = useState<PartyBook>(() => loadPartyBook());

  useEffect(() => {
    persistPartyBook(book);
  }, [book]);

  const addParty = useCallback((draft: PartyDraft): string | null => {
    const name = draft.name.trim();
    if (name.length < 2) return "نام کم از کم دو حروف کا ہونا چاہیے۔";
    const phone = normalizePhone(draft.phone);
    if (draft.phone.trim() !== "" && phone === "") return "فون نمبر درست نہیں (مثلاً 03001234567)۔";
    setBook((current) => ({
      ...current,
      parties: [...current.parties, makeParty({ ...draft, name, phone })],
    }));
    return null;
  }, []);

  const updateParty = useCallback((id: number, draft: PartyDraft) => {
    setBook((current) => ({
      ...current,
      parties: current.parties.map((party) =>
        party.id === id
          ? {
              ...party,
              name: draft.name.trim(),
              phone: normalizePhone(draft.phone),
              kind: draft.kind,
              note: draft.note.trim() || undefined,
            }
          : party,
      ),
    }));
  }, []);

  const removeParty = useCallback((id: number) => {
    setBook((current) => ({
      parties: current.parties.filter((party) => party.id !== id),
      txns: current.txns.filter((txn) => txn.partyId !== id),
    }));
  }, []);

  const addTxn = useCallback(
    (partyId: number, draft: TxnDraft): string | null => {
      const amount = validateAmount(Number.parseFloat(draft.amount));
      if (!amount.ok) return amount.message;
      setBook((current) => {
        if (!current.parties.some((party) => party.id === partyId)) return current;
        return {
          ...current,
          txns: [
            ...current.txns,
            makePartyTxn(partyId, {
              kind: draft.kind,
              amount: amount.value,
              note: draft.note,
              account: draft.account,
            }),
          ],
        };
      });
      return null;
    },
    [],
  );

  const removeTxn = useCallback((id: number) => {
    setBook((current) => ({ ...current, txns: current.txns.filter((txn) => txn.id !== id) }));
  }, []);

  const exportJson = useCallback(() => partyBookToJson(book), [book]);

  const importJson = useCallback((text: string): string | null => {
    try {
      const parsed = partyBookFromJson(text);
      if (parsed.parties.length === 0 && parsed.txns.length === 0) {
        return "فائل میں کوئی گاہک یا انٹری نہیں ملی۔";
      }
      setBook(parsed);
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
