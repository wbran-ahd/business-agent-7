/**
 * PIN lock & سیلز مین موڈ — local, offline, owner-controlled.
 *
 * The PIN never leaves the device: a random salt plus a SHA-256 hash are stored
 * in localStorage, and the hash is only ever used for local comparison. This is
 * a shop-floor convenience lock (it stops a helper from opening settings or
 * deleting entries), not a replacement for the account password — the honest
 * wording is used in the UI too.
 */
export type StaffMode = "owner" | "staff";

type LockRecord = {
  version: 1;
  salt: string;
  hash: string;
  mode: StaffMode;
};

export const STAFF_LOCK_STORAGE_KEY = "sautiStaffLock";

/** 4–8 digits: long enough to be useful, short enough to type on a keypad. */
export function validPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin ?? "");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Salted SHA-256 of the PIN. Exported so the verification script can prove it. */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

function readRecord(): LockRecord | null {
  try {
    const raw = localStorage.getItem(STAFF_LOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockRecord>;
    if (typeof parsed?.salt !== "string" || typeof parsed?.hash !== "string") return null;
    return {
      version: 1,
      salt: parsed.salt,
      hash: parsed.hash,
      mode: parsed.mode === "staff" ? "staff" : "owner",
    };
  } catch {
    return null;
  }
}

function writeRecord(record: LockRecord | null) {
  try {
    if (record === null) localStorage.removeItem(STAFF_LOCK_STORAGE_KEY);
    else localStorage.setItem(STAFF_LOCK_STORAGE_KEY, JSON.stringify(record));
  } catch {
    /* ignore — the lock simply is not persisted */
  }
}

export function lockState(): { hasPin: boolean; mode: StaffMode } {
  const record = readRecord();
  return { hasPin: record !== null, mode: record?.mode ?? "owner" };
}

/** Sets (or replaces) the PIN and returns to owner mode. */
export async function createPin(pin: string): Promise<boolean> {
  if (!validPin(pin)) return false;
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  writeRecord({ version: 1, salt, hash, mode: "owner" });
  return true;
}

export async function checkPin(pin: string): Promise<boolean> {
  const record = readRecord();
  if (!record || !validPin(pin)) return false;
  return (await hashPin(pin, record.salt)) === record.hash;
}

export function setStaffMode(mode: StaffMode) {
  const record = readRecord();
  if (!record) return;
  writeRecord({ ...record, mode });
}

export function removePin() {
  writeRecord(null);
}
