/**
 * At-rest encryption for user-supplied secrets (currently the Gemini key).
 *
 * The key used to sit in `userSettings` as plaintext. It is now AES-GCM
 * encrypted with a key derived from the `SAUTI_KEY_SECRET` environment
 * variable. If that variable is not configured the value is stored as-is and
 * the caller is told via {@link isEncrypted} — never a crash, so an existing
 * deployment keeps working.
 */

const PREFIX = "enc:v1:";
const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(): Promise<CryptoKey | null> {
  const secret = process.env.SAUTI_KEY_SECRET ?? "";
  if (!secret) return null;
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return await crypto.subtle.importKey("raw", material, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export async function encryptSecret(plain: string): Promise<string> {
  try {
    const key = await deriveKey();
    if (!key) return plain;
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plain),
    );
    return `${PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
  } catch {
    return plain;
  }
}

export async function decryptSecret(stored: string): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  try {
    const key = await deriveKey();
    if (!key) return "";
    const [ivPart, cipherPart] = stored.slice(PREFIX.length).split(":");
    if (!ivPart || !cipherPart) return "";
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(ivPart) },
      key,
      fromBase64(cipherPart),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

/** Stable cache key for a request payload. */
export async function hashPayload(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
