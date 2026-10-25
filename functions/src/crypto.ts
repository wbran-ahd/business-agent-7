/**
 * Voucher code generation, hashing and the activation token.
 *
 * The plain code exists in exactly two places: the response of `createCodes`
 * (shown once, printed by the admin) and the QR the user scans. Firestore only
 * ever sees `code_hash` and `code_masked`.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/** No `0/O`, `1/I/L` or `U` — a human must be able to copy this off paper. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const PREFIX = "SAUTI";
const GROUPS = 3;
const GROUP_SIZE = 4;

const TOKEN_VERSION = "v1";

/** Uppercase and drop every non-alphanumeric character before hashing. */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** `SAUTI-XXXX-XXXX-XXXX` — one voucher, freshly random. */
export function generateVoucherCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let chunk = "";
    for (let i = 0; i < GROUP_SIZE; i += 1) {
      chunk += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(chunk);
  }
  return [PREFIX, ...groups].join("-");
}

/** `SAUTI-****-****-K3M9` — safe to render in the admin panel. */
export function maskCode(raw: string): string {
  const normalized = normalizeCode(raw);
  const last4 = normalized.slice(-4);
  return `${PREFIX}-${"*".repeat(GROUP_SIZE)}-${"*".repeat(GROUP_SIZE)}-${last4}`;
}

/**
 * Peppered HMAC-SHA256 of the normalised code.
 *
 * The pepper (`ACTIVATION_PEPPER`, a Secret Manager secret) lives only in the
 * function, so a leaked Firestore export never lets anyone recompute voucher
 * hashes.
 */
export function hashCode(code: string, pepper: string): string {
  if (!pepper) throw new Error("ACTIVATION_PEPPER is not set");
  return createHmac("sha256", pepper).update(normalizeCode(code)).digest("hex");
}

/** `v1.<uid>.<expiresAt|0>.<hmac>` — proves which licence this is. */
export function signToken(
  uid: string,
  expiresAt: number | null,
  pepper: string,
): string {
  if (!pepper) throw new Error("ACTIVATION_PEPPER is not set");
  const payload = `${uid}.${expiresAt ?? 0}`;
  const signature = createHmac("sha256", pepper)
    .update(payload)
    .digest("base64url")
    .slice(0, 32);
  return `${TOKEN_VERSION}.${payload}.${signature}`;
}

/** Constant-time check of a token issued by `signToken`. */
export function verifyToken(token: string, pepper: string): boolean {
  if (!pepper) throw new Error("ACTIVATION_PEPPER is not set");
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return false;
  const [, uid, expiresAt, signature] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (!/^\d+$/.test(expiresAt)) return false;
  const expected = createHmac("sha256", pepper)
    .update(`${uid}.${expiresAt}`)
    .digest("base64url")
    .slice(0, 32);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
