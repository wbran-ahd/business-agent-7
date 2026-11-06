/**
 * گاہک وار ادھار کھاتہ — per-party ledger (customers and suppliers).
 *
 * Same pattern as `khata.ts`: the money math is pure and deterministic (covered
 * by `scripts/verify-khata.ts`), and persistence is a thin localStorage layer
 * that the hook owns.
 *
 * Sign convention
 * ---------------
 *   charge   — udhaar diya (customer) / maal khareeda on credit (supplier)
 *   payment  — wasooli (customer) / adaigi (supplier)
 *   balance  — charges − payments
 *
 * A positive customer balance means the customer owes the shop; a positive
 * supplier balance means the shop owes the supplier. Only `payment` moves cash,
 * which is what the daybook counts.
 */
import { nextId, type AccountKind } from "./khata";

export type PartyKind = "customer" | "supplier";
export type PartyTxnKind = "charge" | "payment";

export type Party = {
  id: number;
  name: string;
  /** Normalised to `92…`; empty when the shop never stored a number. */
  phone: string;
  kind: PartyKind;
  note?: string;
  createdAt: number;
};

export type PartyTxn = {
  id: number;
  partyId: number;
  kind: PartyTxnKind;
  amount: number;
  note: string;
  account: AccountKind;
  timestamp: number;
  /** Display only (Urdu); never parsed. */
  date: string;
  /** Display only (Urdu); never parsed. */
  time: string;
  /**
   * Stage 4C-C: the customer/supplier classification of the party at the time
   * this entry was made.
   *
   * It is optional on purpose: every transaction written before this stage has
   * no such field, and a backup or cloud document from an older device keeps
   * working (`partyKindForTxn` falls back to the party row when it exists). It
   * exists so a historical entry is still interpretable — and therefore still
   * counted correctly as a receipt or a supplier payment — after its party has
   * been deleted. No migration is needed: the field is filled in for new
   * entries and, locally, for the entries of a party that is being deleted.
   */
  partyKind?: PartyKind;
};

export type PartyBook = { parties: Party[]; txns: PartyTxn[] };

export const PARTY_STORAGE_KEY = "sautiPartyBook";

export function emptyPartyBook(): PartyBook {
  return { parties: [], txns: [] };
}

/* ------------------------------------------------------------------ */
/* Display labels                                                      */
/* ------------------------------------------------------------------ */
export function partyKindLabel(kind: PartyKind): string {
  return kind === "customer" ? "گاہک" : "سپلائر";
}

/** “ادھار دیا”, “وصولی”, … — depends on both the party and the entry kind. */
export function partyTxnLabel(kind: PartyTxnKind, partyKind: PartyKind): string {
  if (partyKind === "customer") return kind === "charge" ? "ادھار دیا" : "وصولی";
  return kind === "charge" ? "مال (ادھار)" : "ادائیگی";
}

/** What a positive balance means for this party. */
export function balanceLabel(balance: number, kind: PartyKind): string {
  if (balance > 0) return kind === "customer" ? "باقی (دینا ہے)" : "واجب الادا";
  if (balance < 0) return "ایڈوانس";
  return "حساب صاف";
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */
export function partyTxns(book: PartyBook, partyId: number): PartyTxn[] {
  return book.txns
    .filter((txn) => txn.partyId === partyId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

export type PartySummary = {
  charges: number;
  payments: number;
  balance: number;
  count: number;
  lastAt: number | null;
};

export function partySummary(book: PartyBook, partyId: number): PartySummary {
  let charges = 0;
  let payments = 0;
  let count = 0;
  let lastAt: number | null = null;
  for (const txn of book.txns) {
    if (txn.partyId !== partyId) continue;
    count += 1;
    if (txn.kind === "charge") charges += txn.amount;
    else payments += txn.amount;
    if (lastAt === null || txn.timestamp > lastAt) lastAt = txn.timestamp;
  }
  return { charges, payments, balance: charges - payments, count, lastAt };
}

export function partyBalance(book: PartyBook, partyId: number): number {
  return partySummary(book, partyId).balance;
}

/**
 * The kind that governs one transaction: the party's current kind when the
 * party still exists (an edit wins, exactly as before this stage), otherwise
 * the kind stored on the transaction itself (stage 4C-C). `undefined` means a
 * legacy entry whose party is gone — nothing can interpret it safely, so it is
 * never guessed (and therefore never treated as a customer receivable).
 */
export function partyKindForTxn(
  txn: PartyTxn,
  kinds?: Map<number, PartyKind>,
): PartyKind | undefined {
  const fromBook = kinds?.get(txn.partyId);
  if (fromBook) return fromBook;
  return txn.partyKind === "customer" || txn.partyKind === "supplier"
    ? txn.partyKind
    : undefined;
}

/**
 * Total the shop still has to collect (customers) / pay (suppliers) for the
 * parties that still exist.
 *
 * Stage 4C-C: a transaction whose party has been deleted is **not** part of this
 * figure. It used to be, and because the deleted party was not in `book.parties`
 * a deleted supplier's debt fell into the `receivable` bucket — the shop's own
 * payable counted as money a customer owed. Such transactions are still money
 * the shop owes or is owed; `deletedPartyTotals` reports them separately so the
 * figure is preserved instead of silently disappearing.
 */
export function outstandingTotals(book: PartyBook): {
  receivable: number;
  payable: number;
} {
  let receivable = 0;
  let payable = 0;
  const kinds = new Map(book.parties.map((party) => [party.id, party.kind]));
  const totals = new Map<number, number>();
  for (const txn of book.txns) {
    if (!kinds.has(txn.partyId)) continue;
    const current = totals.get(txn.partyId) ?? 0;
    totals.set(txn.partyId, current + (txn.kind === "charge" ? txn.amount : -txn.amount));
  }
  for (const [partyId, balance] of totals) {
    if (balance <= 0) continue;
    if (kinds.get(partyId) === "supplier") payable += balance;
    else receivable += balance;
  }
  return { receivable, payable };
}

export type DeletedPartyTotals = {
  /** Still owed to the shop by deleted customers. */
  receivable: number;
  /** Still owed by the shop to deleted suppliers. */
  payable: number;
  /** Legacy entries whose party is gone and whose kind is unknown — never guessed. */
  unclassified: number;
  /** Deleted party ids that still have financial history in the book. */
  parties: number;
  /** How many entries those balances are made of. */
  txns: number;
};

/**
 * Outstanding money attached to **deleted** parties (stage 4C-C).
 *
 * Party deletion is not a settlement: the debt survives the row. This keeps it
 * visible to the accounting layer, separately from the active-party summary, so
 * deleting a party never cancels what it owes or is owed and never mixes it into
 * the active totals. It is deliberately not shown in the UI in this stage.
 */
export function deletedPartyTotals(book: PartyBook): DeletedPartyTotals {
  const active = new Set(book.parties.map((party) => party.id));
  const totals = new Map<number, number>();
  const kinds = new Map<number, PartyKind>();
  let txns = 0;
  for (const txn of book.txns) {
    if (active.has(txn.partyId)) continue;
    txns += 1;
    const current = totals.get(txn.partyId) ?? 0;
    totals.set(txn.partyId, current + (txn.kind === "charge" ? txn.amount : -txn.amount));
    const kind = partyKindForTxn(txn);
    if (kind) kinds.set(txn.partyId, kind);
  }
  let receivable = 0;
  let payable = 0;
  let unclassified = 0;
  for (const [partyId, balance] of totals) {
    if (balance <= 0) continue;
    const kind = kinds.get(partyId);
    if (kind === "supplier") payable += balance;
    else if (kind === "customer") receivable += balance;
    else unclassified += balance;
  }
  return { receivable, payable, unclassified, parties: totals.size, txns };
}

/* ------------------------------------------------------------------ */
/* Phone & WhatsApp                                                    */
/* ------------------------------------------------------------------ */
/**
 * Pakistani numbers, however the shop typed them: `0300 1234567`,
 * `+92 300 123 4567`, `923001234567`. Returns `""` when unusable.
 */
export function normalizePhone(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (digits.startsWith("92")) return digits.length >= 12 ? digits : "";
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    return rest.length >= 10 ? `92${rest}` : "";
  }
  if (digits.startsWith("3") && digits.length >= 10) return `92${digits}`;
  return digits.length >= 10 ? digits : "";
}

export function displayPhone(phone: string): string {
  return phone.startsWith("92") && phone.length >= 12
    ? `0${phone.slice(2, 5)}-${phone.slice(5)}`
    : phone;
}

export function whatsappUrl(phone: string, text: string): string {
  const normalized = normalizePhone(phone);
  const base = normalized ? `https://wa.me/${normalized}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** Ready-to-send Urdu reminder for a party that still owes money. */
export function reminderText(
  party: Party,
  balance: number,
  dateLabel: string = new Date().toLocaleDateString("ur-PK"),
): string {
  if (party.kind === "customer") {
    return [
      `السلام علیکم ${party.name} صاحب،`,
      `صوتی بقیہ کھاتے کے مطابق آپ کا بقایا Rs. ${Math.round(balance)} ہے۔`,
      "براہِ کرم ادائیگی کر دیجیے۔ شکریہ!",
      `📅 ${dateLabel}`,
    ].join("\n");
  }
  return [
    `السلام علیکم ${party.name} صاحب،`,
    `ہمارے کھاتے کے مطابق آپ کو Rs. ${Math.round(balance)} ادا کرنے ہیں۔`,
    "تفصیل کے لیے رابطہ کریں — صوتی بقیہ",
    `📅 ${dateLabel}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */
function isParty(value: unknown): value is Party {
  const row = value as Partial<Party>;
  return (
    typeof row?.id === "number" &&
    typeof row?.name === "string" &&
    (row.kind === "customer" || row.kind === "supplier")
  );
}

function isTxn(value: unknown): value is PartyTxn {
  const row = value as Partial<PartyTxn>;
  return (
    typeof row?.id === "number" &&
    typeof row?.partyId === "number" &&
    typeof row?.amount === "number" &&
    (row.kind === "charge" || row.kind === "payment") &&
    /* Stage 4C-C: optional (older backups have none); when present it must be a
       real classification, otherwise the entry is dropped like any other
       malformed row. */
    (row.partyKind === undefined ||
      row.partyKind === "customer" ||
      row.partyKind === "supplier")
  );
}

export function loadPartyBook(): PartyBook {
  try {
    const raw = localStorage.getItem(PARTY_STORAGE_KEY);
    if (!raw) return emptyPartyBook();
    const parsed = JSON.parse(raw) as Partial<PartyBook>;
    return {
      parties: Array.isArray(parsed.parties) ? parsed.parties.filter(isParty) : [],
      txns: Array.isArray(parsed.txns) ? parsed.txns.filter(isTxn) : [],
    };
  } catch {
    return emptyPartyBook();
  }
}

export function persistPartyBook(book: PartyBook) {
  try {
    localStorage.setItem(PARTY_STORAGE_KEY, JSON.stringify(book));
  } catch {
    /* quota exceeded — the app keeps working in memory */
  }
}

/* ------------------------------------------------------------------ */
/* Mutations (pure — the hook wraps them in React state)               */
/* ------------------------------------------------------------------ */
export function makeParty(
  input: { name: string; phone?: string; kind: PartyKind; note?: string },
  id = nextId(),
): Party {
  return {
    id,
    name: input.name.trim(),
    phone: normalizePhone(input.phone ?? ""),
    kind: input.kind,
    note: input.note?.trim() || undefined,
    createdAt: Date.now(),
  };
}

/**
 * The shape actually handed to `setDoc`.
 *
 * `makeParty` leaves `note: undefined` when the shop stored no note, and
 * Firestore rejects `undefined` field values outright (`invalid-argument`).
 * Every noteless party therefore threw inside its own `.catch(...)` and never
 * reached the cloud while looking like a successful save locally — confirmed
 * against the emulator. Dropping the key is exactly what the rules expect:
 * `note` is optional there, and the reader reconstructs it as `undefined`.
 */
export function partyForCloud(party: Party): Omit<Party, "note"> | Party {
  const { note, ...rest } = party;
  return note ? { ...rest, note } : rest;
}

export function makePartyTxn(
  partyId: number,
  input: {
    kind: PartyTxnKind;
    amount: number;
    note?: string;
    account?: AccountKind;
    /** Stage 4C-C: keeps the entry interpretable after the party is deleted. */
    partyKind?: PartyKind;
  },
  id = nextId(),
): PartyTxn {
  const now = new Date();
  const txn: PartyTxn = {
    id,
    partyId,
    kind: input.kind,
    amount: input.amount,
    note: input.note?.trim() ?? "",
    account: input.account ?? "cash",
    timestamp: now.getTime(),
    date: now.toLocaleDateString("ur-PK"),
    time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
  };
  if (input.partyKind === "customer" || input.partyKind === "supplier") {
    txn.partyKind = input.partyKind;
  }
  return txn;
}

/**
 * Can this party receive a new entry? (stage 4C-C)
 *
 * A deleted party never can. The book may have already dropped the row, and
 * even while a stale copy is still in memory a remembered tombstone wins — the
 * window between a deletion and the next cloud snapshot must not be usable.
 */
export function partyAcceptsNewTxn(
  parties: Party[],
  partyId: number,
  deletedIds: Iterable<number> = [],
): boolean {
  if (!parties.some((party) => party.id === partyId)) return false;
  for (const id of deletedIds) {
    if (id === partyId) return false;
  }
  return true;
}

/**
 * Fills in `partyKind` for a deleted party's entries (stage 4C-C).
 *
 * The party row is the last thing that knows whether its history was a customer
 * receivable or a supplier payable, so the kind is copied onto the entries right
 * before the party disappears. Entries that already carry a kind are untouched,
 * which keeps the operation idempotent and non-destructive.
 */
export function stampPartyKind(
  txns: PartyTxn[],
  partyId: number,
  kind: PartyKind,
): PartyTxn[] {
  return txns.map((txn) =>
    txn.partyId === partyId && txn.partyKind === undefined ? { ...txn, partyKind: kind } : txn,
  );
}

/** JSON backup of the party book (separate from the ledger CSV). */
export function partyBookToJson(book: PartyBook): string {
  return `${JSON.stringify({ version: 1, ...book }, null, 2)}\n`;
}

export function partyBookFromJson(text: string): PartyBook {
  const parsed = JSON.parse(text) as Partial<PartyBook>;
  return {
    parties: Array.isArray(parsed.parties) ? parsed.parties.filter(isParty) : [],
    txns: Array.isArray(parsed.txns) ? parsed.txns.filter(isTxn) : [],
  };
}
