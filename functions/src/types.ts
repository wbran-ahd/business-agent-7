/**
 * Document shapes for the licensing collections.
 *
 * Field names stay snake_case (they are written straight into Firestore by
 * Cloud Functions and read by the admin panel), which is why they differ from
 * the camelCase used by the ledger under `users/{uid}`.
 */

/** What `createCodes` puts on a voucher and therefore on the licence. */
export interface CodePlanInput {
  plan: string;
  features: string[];
  licenseDays: number | null;
  maxDevices: number;
}

/**
 * `codes/{codeId}` — the voucher itself.
 *
 * The plain code is never stored: only `code_hash` (HMAC-free SHA-256 with the
 * activation pepper) plus a masked copy so the admin panel can show something
 * recognisable.
 */
export interface CodeDoc {
  code_hash: string;
  code_masked: string;
  plan: string;
  features: string[];
  /** Device ids allowed on this voucher; grows on activation. */
  device_ids: string[];
  /** Null until first activation. */
  used_by_uid: string | null;
  max_devices: number;
  /** Voucher validity — days of licence granted on activation. */
  license_days: number | null;
  /** Voucher's own expiry. Never rewritten by activation. */
  code_expires_at: number | null;
  created_at: number;
  created_by: string;
  label: string | null;
  revoked: boolean;
  revoked_at: number | null;
  updated_at: number;
}

/**
 * `licenses/{uid}` — the user's licence, keyed by uid.
 *
 * `plan` and `features` are copied here at activation (never left undefined)
 * so `checkStatus` can answer without touching the voucher.
 */
export interface LicenseDoc {
  uid: string;
  code_id: string;
  plan: string;
  features: string[];
  activated_at: number;
  /** User's validity window — computed at activation, independent of the voucher. */
  license_expires_at: number | null;
  revoked: boolean;
  revoked_at: number | null;
  revoked_reason: string | null;
  last_check: number | null;
  updated_at: number;
}

export type AuditAction =
  | "activate"
  | "create_codes"
  | "reset_activation"
  | "revoke_code"
  | "extend_code";

export type ActorRole = "admin" | "user";

/** `audit_log/{autoId}` — append-only, admin-readable, never client-writable. */
export interface AuditDoc {
  action: AuditAction;
  ok: boolean;
  actor_uid: string;
  actor_role: ActorRole;
  actor_ip: string | null;
  target_uid: string | null;
  code_id: string | null;
  detail: string;
  at: number;
}

/** `rate_limits/{scope_subject}` — fixed-window counters written by Functions. */
export interface RateLimitDoc {
  window_started_at: number;
  count: number;
  updated_at: number;
}

/** What `activate` answers. */
export interface ActivateResult {
  active: true;
  plan: string;
  features: string[];
  /** Licence expiry (`null` = never). */
  expiresAt: number | null;
  /** Voucher expiry (`null` = never) — kept separate from `expiresAt`. */
  codeExpiresAt: number | null;
  activatedAt: number;
  codeId: string;
  token: string;
}

export type StatusReason = "ok" | "no_license" | "revoked" | "expired";

/** What `checkStatus` answers. `plan`/`features` are never undefined. */
export interface CheckStatusResult {
  active: boolean;
  plan: string;
  features: string[];
  expiresAt: number | null;
  revoked: boolean;
  expired: boolean;
  reason: StatusReason;
  checkedAt: number;
}

/** One voucher as returned by `createCodes` (shown once — the only copy). */
export interface IssuedCode {
  code: string;
  codeId: string;
  masked: string;
}
