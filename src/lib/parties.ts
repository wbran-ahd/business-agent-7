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

/** Total the shop still has to collect (customers) / pay (suppliers). */
export function outstandingTotals(book: PartyBook): {
  receivable: number;
  payable: number;
} {
  let receivable = 0;
  let payable = 0;
  const kinds = new Map(book.parties.map((party) => [party.id, party.kind]));
  const totals = new Map<number, number>();
  for (const txn of book.txns) {
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
    (row.kind === "charge" || row.kind === "payment")
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

export function makePartyTxn(
  partyId: number,
  input: { kind: PartyTxnKind; amount: number; note?: string; account?: AccountKind },
  id = nextId(),
): PartyTxn {
  const now = new Date();
  return {
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
