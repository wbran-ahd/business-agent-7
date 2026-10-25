/**
 * Stable per-browser device id.
 *
 * The voucher allows a small number of devices (`max_devices`), so the id must
 * survive reloads and private-window restarts of the same profile. It is not
 * a secret and not identity — Firebase's uid is that — it only answers "has
 * this browser already consumed a slot on this code?".
 *
 * Shape must satisfy the server rule in `functions/src/validation.ts`:
 * `^[A-Za-z0-9._:-]{8,64}$`.
 */

const STORAGE_KEY = "sauti_device_id";

/** Same pattern the Cloud Functions enforce. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

function randomId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Returns the device id, creating and persisting it on first use. */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
    const id = randomId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    // Storage blocked (private mode / disabled cookies): a session-scoped id
    // still lets activation complete; it just will not be reused later.
    return randomId();
  }
}
