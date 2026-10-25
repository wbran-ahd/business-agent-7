/**
 * Client for the activation Cloud Functions, plus the pure helpers the screen
 * needs (code formatting and error copy).
 *
 * The Firebase runtime is imported *lazily*: `src/lib/firebase.ts` boots the
 * app and pings Firestore the moment it is imported, so a top-level import
 * here would drag all of that into every module that only wants
 * {@link formatCode} — including the verification suite, which must not touch
 * the network.
 */

import type { Functions } from "firebase/functions";

/** Every callable is deployed to this region (see `functions/src/config.ts`). */
export const ACTIVATION_REGION = "asia-south1";

/** `SAUTI-XXXX-XXXX-XXXX` — the only shape the server accepts. */
export const CODE_PATTERN = /^SAUTI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const PREFIX = "SAUTI";

export interface ActivateResult {
  active: true;
  plan: string;
  features: string[];
  expiresAt: number | null;
  codeExpiresAt: number | null;
  activatedAt: number;
  codeId: string;
  token: string;
}

export interface CheckStatusResult {
  active: boolean;
  plan: string;
  features: string[];
  expiresAt: number | null;
  revoked: boolean;
  expired: boolean;
  reason: "ok" | "no_license" | "revoked" | "expired";
  checkedAt: number;
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

let runtimePromise: Promise<Functions> | null = null;

function runtime(): Promise<Functions> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const [{ getFunctions }, { app }] = await Promise.all([
        import("firebase/functions"),
        import("@/lib/firebase"),
      ]);
      return getFunctions(app, ACTIVATION_REGION);
    })();
  }
  return runtimePromise;
}

/** Runs any callable in the activation region and resolves its payload. */
export async function callFunction<T>(name: string, data: unknown = {}): Promise<T> {
  const [{ httpsCallable }, functions] = await Promise.all([
    import("firebase/functions"),
    runtime(),
  ]);
  const response = await httpsCallable<unknown, T>(functions, name)(data);
  return response.data;
}

export async function activateCode(
  code: string,
  deviceId: string,
): Promise<ActivateResult> {
  return callFunction<ActivateResult>("activate", { code, deviceId });
}

export async function checkLicense(): Promise<CheckStatusResult> {
  return callFunction<CheckStatusResult>("checkStatus");
}

/* ------------------------------------------------------------------ */
/* Code formatting                                                     */
/* ------------------------------------------------------------------ */

/**
 * Normalises whatever was typed or scanned into `SAUTI-XXXX-XXXX-XXXX`.
 *
 * Everything non-alphanumeric is dropped first, so a QR payload, a paste with
 * spaces and a lowercase keyboard all land in the same shape. Anything that
 * does not start with `SAUTI` is returned as plain uppercase letters/digits —
 * validation then rejects it with a readable message instead of silently
 * mangling it.
 */
export function formatCode(raw: string): string {
  const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!flat.startsWith(PREFIX)) return flat;
  const body = flat.slice(PREFIX.length, PREFIX.length + 12);
  if (body.length === 0) return PREFIX;
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += 4) groups.push(body.slice(i, i + 4));
  return [PREFIX, ...groups].join("-");
}

/* ------------------------------------------------------------------ */
/* Error copy                                                          */
/* ------------------------------------------------------------------ */

/** Codes whose SDK message is a bare status word — show our own Urdu instead. */
const FRIENDLY: Record<string, string> = {
  "functions/unauthenticated":
    "شناخت دستیاب نہیں — انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔",
  "functions/network-error": "انٹرنیٹ کنکشن نہیں ہے — دوبارہ کوشش کریں۔",
  "functions/deadline-exceeded": "کنکشن میں تاخیر ہوئی — دوبارہ کوشش کریں۔",
  "functions/internal": "سيرور پر مسئلہ ہے — کچھ دیر بعد دوبارہ کوشش کریں۔",
};

/**
 * Turns a callable failure into the line shown under the input.
 *
 * The functions already answer in Urdu ("یہ کوڈ درست نہیں ہے۔"), so that
 * message wins whenever it exists; only the bare SDK statuses are replaced.
 */
export function activationErrorMessage(error: unknown): string {
  const failure = error as { code?: unknown; message?: unknown } | null;
  const code = typeof failure?.code === "string" ? failure.code : "";
  const message =
    typeof failure?.message === "string" ? failure.message.trim() : "";

  const friendly =
    FRIENDLY[code] ??
    FRIENDLY[code.replace(/^firebase-functions\//, "functions/")];
  if (friendly) return friendly;
  if (message) return message;
  return "کوڈ درست نہیں ہو سکا — دوبارہ کوشش کریں۔";
}
