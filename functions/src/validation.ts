/**
 * Input validation for every callable.
 *
 * Nothing reaches Firestore before it has been checked here: codes, device ids
 * and plans arrive from the wild, and Firestore rules cannot protect a document
 * that only Cloud Functions write.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { CREATE_LIMITS } from "./config";
import type { CodePlanInput } from "./types";

export const CODE_PATTERN = /^SAUTI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
/** 8–64 chars: UUIDs, Android ids, `web-<random>` — no spaces, no slashes. */
export const DEVICE_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
export const PLAN_PATTERN = /^[a-z][a-z0-9_-]{0,15}$/;
export const FEATURE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

function fail(key: string, message: string): never {
  throw new HttpsError("invalid-argument", `${key}: ${message}`);
}

export function asObject(data: unknown, key = "data"): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    fail(key, "object ہونا چاہیے");
  }
  return data as Record<string, unknown>;
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  opts: { min?: number; max: number; pattern?: RegExp },
): string {
  const value = obj[key];
  if (typeof value !== "string") fail(key, "string درکار ہے");
  const trimmed = value.trim();
  if (trimmed.length < (opts.min ?? 1)) fail(key, "بہت چھوٹا ہے");
  if (trimmed.length > opts.max) fail(key, "بہت لمبا ہے");
  if (opts.pattern && !opts.pattern.test(trimmed))
    fail(key, "format درست نہیں");
  return trimmed;
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  opts: { max: number; pattern?: RegExp },
): string | null {
  const value = obj[key];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") fail(key, "string یا null درکار ہے");
  const trimmed = value.trim();
  if (trimmed.length > opts.max) fail(key, "بہت لمبا ہے");
  if (opts.pattern && !opts.pattern.test(trimmed))
    fail(key, "format درست نہیں");
  return trimmed;
}

/** Accepts a whole number, `null`, or `undefined` and normalises to `null`. */
export function nullableInt(
  obj: Record<string, unknown>,
  key: string,
  opts: { min: number; max: number },
): number | null {
  const value = obj[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(key, "number درکار ہے");
  const rounded = Math.trunc(value);
  if (rounded < opts.min) fail(key, `${opts.min} سے کم ہے`);
  if (rounded > opts.max) fail(key, `${opts.max} سے زیادہ ہے`);
  return rounded;
}

export function intInRange(
  obj: Record<string, unknown>,
  key: string,
  opts: { min: number; max: number; fallback?: number },
): number {
  const value = obj[key];
  if (value === null || value === undefined) {
    if (opts.fallback !== undefined) return opts.fallback;
    fail(key, "درکار ہے");
  }
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(key, "number درکار ہے");
  const rounded = Math.trunc(value);
  if (rounded < opts.min || rounded > opts.max) {
    fail(key, `${opts.min}–${opts.max} کے درمیان ہونا چاہیے`);
  }
  return rounded;
}

function optionalBoolean(
  obj: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = obj[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "boolean") fail(key, "boolean درکار ہے");
  return value;
}

/* ------------------------------------------------------------------ */
/* Call-specific payloads                                              */
/* ------------------------------------------------------------------ */

export interface ActivateInput {
  code: string;
  deviceId: string;
}

export function validateActivateInput(data: unknown): ActivateInput {
  const obj = asObject(data);
  return {
    code: requireString(obj, "code", {
      min: 16,
      max: 32,
      pattern: CODE_PATTERN,
    }),
    deviceId: requireString(obj, "deviceId", {
      min: 8,
      max: 64,
      pattern: DEVICE_PATTERN,
    }),
  };
}

export interface CheckStatusInput {
  /** Optional client-side token; ignored for authorisation (uid decides). */
  token: string | null;
}

export function validateCheckStatusInput(data: unknown): CheckStatusInput {
  const obj = asObject(data ?? {});
  return {
    token: optionalString(obj, "token", { max: 256 }),
  };
}

export interface CreateCodesInput extends CodePlanInput {
  count: number;
  codeExpiresAt: number | null;
  label: string | null;
}

export function validateCreateCodesInput(data: unknown): CreateCodesInput {
  const obj = asObject(data);
  const plan = optionalString(obj, "plan", { max: 16, pattern: PLAN_PATTERN });
  const features = optionalFeatures(obj, "features");
  return {
    count: intInRange(obj, "count", {
      min: 1,
      max: CREATE_LIMITS.maxBatch,
      fallback: 1,
    }),
    plan: plan ?? "standard",
    features,
    licenseDays: nullableInt(obj, "licenseDays", {
      min: CREATE_LIMITS.minDays,
      max: CREATE_LIMITS.maxDays,
    }),
    maxDevices: intInRange(obj, "maxDevices", { min: 1, max: 10, fallback: 1 }),
    codeExpiresAt: nullableInt(obj, "codeExpiresAt", {
      min: 0,
      max: 4102444800000, // 2100-01-01 in ms
    }),
    label: optionalString(obj, "label", { max: 60 }),
  };
}

function optionalFeatures(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) fail(key, "array درکار ہے");
  if (value.length > CREATE_LIMITS.maxFeatures) {
    fail(key, `${CREATE_LIMITS.maxFeatures} سے کم features`);
  }
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !FEATURE_PATTERN.test(item)) {
      fail(key, "ہر feature a-z کے حروف، digits یا _ / - ہونا چاہیے");
    }
    seen.add(item);
  }
  return Array.from(seen);
}

export interface CodeIdInput {
  codeId: string;
}

export function validateCodeIdInput(data: unknown): CodeIdInput {
  const obj = asObject(data);
  return {
    codeId: requireString(obj, "codeId", {
      min: 1,
      max: 64,
      pattern: /^[A-Za-z0-9_-]+$/,
    }),
  };
}

export interface ResetInput {
  codeId: string;
  reason: string | null;
}

export function validateResetInput(data: unknown): ResetInput {
  const obj = asObject(data);
  return {
    codeId: requireString(obj, "codeId", {
      min: 1,
      max: 64,
      pattern: /^[A-Za-z0-9_-]+$/,
    }),
    reason: optionalString(obj, "reason", { max: 120 }),
  };
}

export interface ExtendInput {
  codeId: string;
  extendByDays: number | null;
  codeExpiresAt: number | null;
  licenseDays: number | null;
}

export function validateExtendInput(data: unknown): ExtendInput {
  const obj = asObject(data);
  const input: ExtendInput = {
    codeId: requireString(obj, "codeId", {
      min: 1,
      max: 64,
      pattern: /^[A-Za-z0-9_-]+$/,
    }),
    extendByDays: nullableInt(obj, "extendByDays", {
      min: 1,
      max: CREATE_LIMITS.maxDays,
    }),
    codeExpiresAt: nullableInt(obj, "codeExpiresAt", {
      min: 0,
      max: 4102444800000,
    }),
    licenseDays: nullableInt(obj, "licenseDays", {
      min: CREATE_LIMITS.minDays,
      max: CREATE_LIMITS.maxDays,
    }),
  };
  if (
    input.extendByDays === null &&
    input.codeExpiresAt === null &&
    input.licenseDays === null
  ) {
    fail("extendByDays", "کم از کم ایک میعاد کا فیلڈ درکار ہے");
  }
  return input;
}

export interface ListCodesInput {
  limit: number;
  revokedOnly: boolean | undefined;
}

export function validateListCodesInput(data: unknown): ListCodesInput {
  const obj = asObject(data ?? {});
  return {
    limit: intInRange(obj, "limit", { min: 1, max: 200, fallback: 50 }),
    revokedOnly: optionalBoolean(obj, "revokedOnly"),
  };
}
