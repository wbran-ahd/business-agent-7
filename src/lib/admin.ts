/**
 * Admin-side client: the uid that decides access, the callable wrappers and
 * the small helpers the panel needs.
 *
 * ⚠️ `ADMIN_UID` must always equal the uid in `firestore.rules` (`isAdmin()`)
 * and in `functions/src/config.ts` — three copies of one identity, checked
 * against each other by `scripts/verify-scaffolding.ts`.
 *
 * Everything here is lazy-imported Firebase just like `@/lib/activation`, so
 * importing the module (tests, routes) has no side effects.
 */
import { publicOrigin } from "@/lib/brand";
import { activationErrorMessage, callFunction } from "@/lib/activation";

export const ADMIN_UID = "vDzRVOYUgMNwcvD5oBdPVibDFFq1";

/** The whole admin model: one uid, no claim, no role document. */
export function isAdminUid(uid: string | null | undefined): boolean {
  return typeof uid === "string" && uid.length > 0 && uid === ADMIN_UID;
}

/* ------------------------------------------------------------------ */
/* Shapes (mirrors functions/src/admin.ts responses)                   */
/* ------------------------------------------------------------------ */

export interface IssuedCode {
  code: string;
  codeId: string;
  masked: string;
}

export interface CodeRow {
  id: string;
  masked: string;
  plan: string;
  features: string[];
  device_count: number;
  max_devices: number;
  used_by_uid: string | null;
  license_days: number | null;
  code_expires_at: number | null;
  label: string | null;
  revoked: boolean;
  created_at: number;
}

export interface CreateCodesInput {
  plan: string;
  features: string[];
  licenseDays: number | null;
  maxDevices: number;
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Callables                                                           */
/* ------------------------------------------------------------------ */

export async function adminListCodes(limit = 50): Promise<CodeRow[]> {
  const result = await callFunction<{ count: number; codes: CodeRow[] }>(
    "listCodes",
    { limit },
  );
  return result.codes ?? [];
}

export async function adminCreateCodes(
  input: CreateCodesInput,
): Promise<IssuedCode[]> {
  const result = await callFunction<{ count: number; codes: IssuedCode[] }>(
    "createCodes",
    { count: 1, ...input },
  );
  return result.codes ?? [];
}

export async function adminResetActivation(
  codeId: string,
  reason: string,
): Promise<void> {
  await callFunction("resetActivation", { codeId, reason });
}

export async function adminRevokeCode(codeId: string): Promise<void> {
  await callFunction("revokeCode", { codeId });
}

export async function adminExtendCode(
  codeId: string,
  extendByDays: number,
): Promise<number | null> {
  const result = await callFunction<{
    ok: boolean;
    code_expires_at: number | null;
    extendedLicences: number;
  }>("extendCode", { codeId, extendByDays });
  return result.code_expires_at ?? null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The URL a QR encodes: `/activate?c=SAUTI-…` — what the camera app opens. */
export function activationLink(code: string): string {
  const origin = publicOrigin("");
  return `${origin.replace(/\/+$/, "")}/activate?c=${encodeURIComponent(code)}`;
}

/** Firebase Auth failures → the Urdu line shown under the login form. */
const LOGIN_COPY: Record<string, string> = {
  "auth/invalid-credential": "ای میل یا پاس ورڈ درست نہیں ہے۔",
  "auth/wrong-password": "ای میل یا پاس ورڈ درست نہیں ہے۔",
  "auth/user-not-found": "ای میل یا پاس ورڈ درست نہیں ہے۔",
  "auth/invalid-email": "ای میل درست نہیں ہے۔",
  "auth/too-many-requests": "بہت زیادہ کوششیں — کچھ دیر بعد کوشش کریں۔",
  "auth/network-request-failed": "انٹرنیٹ کنکشن نہیں ہے — دوبارہ کوشش کریں۔",
  "auth/user-disabled": "یہ اکاؤنٹ بند کر دیا گیا ہے۔",
};

export function adminLoginErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    const mapped = LOGIN_COPY[code];
    if (mapped) return mapped;
    // An `auth/*` failure we have no copy for still must not reach the panel
    // as a raw English SDK string.
    if (code.startsWith("auth/")) return "لاگ اِن نہیں ہو سکا — دوبارہ کوشش کریں۔";
  }
  return activationErrorMessage(error);
}
