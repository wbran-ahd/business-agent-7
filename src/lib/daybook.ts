/**
 * روزنامچہ — the daily daybook, plus the cash / mobile-wallet / bank split.
 *
 * Everything is derived from two sources that are already persisted:
 *   • ledger entries (`DataState`) — each carries `account`
 *   • party payments (`PartyBook`) — udhaar and its settlement move no cash on
 *     the day of the sale, only when money actually changes hands
 *
 * So the daybook never needs its own storage and can never drift from the books.
 */
import {
  ACCOUNT_CATALOG,
  normalizeAccount,
  type AccountKind,
  type DataState,
  type Entry,
} from "./khata";
import type { PartyBook, PartyTxn } from "./parties";

export const ACCOUNT_IDS: AccountKind[] = ACCOUNT_CATALOG.map((a) => a.id);

export function accountLabel(id: AccountKind): string {
  return ACCOUNT_CATALOG.find((a) => a.id === id)?.label ?? "کیش";
}

export function accountIcon(id: AccountKind): string {
  return ACCOUNT_CATALOG.find((a) => a.id === id)?.icon ?? "fa-money-bill-wave";
}

/** Local (not UTC) `YYYY-MM-DD` — a shop's day ends at local midnight. */
export function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayKey(now: Date = new Date()): string {
  return localDateKey(now.getTime());
}

/** `[start, end)` epoch-ms bounds of a local calendar day. */
export function dayRange(dateKey: string): { start: number; end: number } {
  const [year, month, day] = dateKey.split("-").map((part) => Number.parseInt(part, 10));
  const y = Number.isFinite(year) ? year : new Date().getFullYear();
  const m = Number.isFinite(month) ? month : 1;
  const d = Number.isFinite(day) ? day : 1;
  return {
    start: new Date(y, m - 1, d).getTime(),
    end: new Date(y, m - 1, d + 1).getTime(),
  };
}

export type DaybookRow = {
  id: string;
  direction: "in" | "out";
  source: "ledger" | "party";
  label: string;
  detail: string;
  account: AccountKind;
  amount: number;
  timestamp: number;
};

export type AccountDay = {
  account: AccountKind;
  label: string;
  icon: string;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
};

export type Daybook = {
  date: string;
  rows: DaybookRow[];
  accounts: AccountDay[];
  totalIn: number;
  totalOut: number;
  cashOpening: number;
  cashClosing: number;
};

/**
 * Ledger entry → signed cash movement. `direction` is which way the money went
 * through the chosen account.
 */
function ledgerMovement(entry: Entry, direction: "in" | "out") {
  const account = normalizeAccount(entry.account);
  const sign = direction === "in" ? 1 : -1;
  return { account, sign };
}

/** Only a settlement moves money; a sale on credit does not. */
export function partyCashMovement(
  txn: PartyTxn,
  partyKind: "customer" | "supplier",
): { account: AccountKind; sign: number } | null {
  if (txn.kind !== "payment") return null;
  return {
    account: normalizeAccount(txn.account),
    sign: partyKind === "customer" ? 1 : -1,
  };
}

export function buildDaybook(data: DataState, book: PartyBook, dateKey: string): Daybook {
  const { start, end } = dayRange(dateKey);
  const opening = zeroAccounts();
  const inflow = zeroAccounts();
  const outflow = zeroAccounts();
  const rows: DaybookRow[] = [];

  const ledgerPass = (list: Entry[], direction: "in" | "out") => {
    for (const entry of list) {
      const { account, sign } = ledgerMovement(entry, direction);
      if (entry.timestamp < start) {
        opening[account] += sign * entry.amount;
        continue;
      }
      if (entry.timestamp >= end) continue;
      if (sign > 0) inflow[account] += entry.amount;
      else outflow[account] += entry.amount;
      rows.push({
        id: `ledger-${entry.id}`,
        direction,
        source: "ledger",
        label: entry.category || (direction === "in" ? "آمدنی" : "خرچہ"),
        detail: entry.detail,
        account,
        amount: entry.amount,
        timestamp: entry.timestamp,
      });
    }
  };
  ledgerPass(data.income, "in");
  ledgerPass(data.expense, "out");

  const partyKinds = new Map(book.parties.map((party) => [party.id, party.kind]));
  for (const txn of book.txns) {
    const partyKind = partyKinds.get(txn.partyId);
    if (!partyKind) continue;
    const movement = partyCashMovement(txn, partyKind);
    if (!movement) continue;
    const party = book.parties.find((p) => p.id === txn.partyId);
    const label = partyKind === "customer" ? "گاہک وصولی" : "سپلائر ادائیگی";
    if (txn.timestamp < start) {
      opening[movement.account] += movement.sign * txn.amount;
      continue;
    }
    if (txn.timestamp >= end) continue;
    if (movement.sign > 0) inflow[movement.account] += txn.amount;
    else outflow[movement.account] += txn.amount;
    rows.push({
      id: `party-${txn.id}`,
      direction: movement.sign > 0 ? "in" : "out",
      source: "party",
      label,
      detail: party ? `${party.name}${txn.note ? ` — ${txn.note}` : ""}` : txn.note,
      account: movement.account,
      amount: txn.amount,
      timestamp: txn.timestamp,
    });
  }

  rows.sort((a, b) => a.timestamp - b.timestamp);

  const accounts: AccountDay[] = ACCOUNT_IDS.map((account) => ({
    account,
    label: accountLabel(account),
    icon: accountIcon(account),
    opening: opening[account],
    inflow: inflow[account],
    outflow: outflow[account],
    closing: opening[account] + inflow[account] - outflow[account],
  }));

  return {
    date: dateKey,
    rows,
    accounts,
    totalIn: accounts.reduce((sum, a) => sum + a.inflow, 0),
    totalOut: accounts.reduce((sum, a) => sum + a.outflow, 0),
    cashOpening: accounts.find((a) => a.account === "cash")?.opening ?? 0,
    cashClosing: accounts.find((a) => a.account === "cash")?.closing ?? 0,
  };
}

function zeroAccounts(): Record<AccountKind, number> {
  return { cash: 0, bank: 0 };
}

export type AccountBalance = {
  account: AccountKind;
  label: string;
  icon: string;
  inflow: number;
  outflow: number;
  balance: number;
};

/** All-time balance per account — the cash-in-hand vs bank tracker. */
export function accountBalances(data: DataState, book: PartyBook): AccountBalance[] {
  const inflow = zeroAccounts();
  const outflow = zeroAccounts();

  for (const entry of data.income) inflow[normalizeAccount(entry.account)] += entry.amount;
  for (const entry of data.expense) outflow[normalizeAccount(entry.account)] += entry.amount;

  const kinds = new Map(book.parties.map((party) => [party.id, party.kind]));
  for (const txn of book.txns) {
    const kind = kinds.get(txn.partyId);
    if (!kind) continue;
    const movement = partyCashMovement(txn, kind);
    if (!movement) continue;
    if (movement.sign > 0) inflow[movement.account] += txn.amount;
    else outflow[movement.account] += txn.amount;
  }

  return ACCOUNT_IDS.map((account) => ({
    account,
    label: accountLabel(account),
    icon: accountIcon(account),
    inflow: inflow[account],
    outflow: outflow[account],
    balance: inflow[account] - outflow[account],
  }));
}

export function totalBalance(balances: AccountBalance[]): number {
  return balances.reduce((sum, row) => sum + row.balance, 0);
}
