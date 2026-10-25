/**
 * Real rate limiting — fixed windows in Firestore, not an in-memory no-op.
 *
 * Every limit is enforced by a transaction on `rate_limits/{scope_subject}`,
 * so two concurrent calls cannot both slip past the same window, and a restart
 * of the function (or a second instance) cannot reset the counter.
 *
 * The document id embeds the scope, so an `activate` burst never eats the
 * `status` budget.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { type Firestore } from "firebase-admin/firestore";
import { type RateLimitDoc } from "./types";

export interface RateLimitPolicy {
  /** Scope of the counter (also part of the document id). */
  scope: "activate" | "status" | "admin";
  /** Allowed calls per window. */
  limit: number;
  windowMs: number;
}

export const POLICIES = {
  /** A voucher costs one attempt per code — a 10-minute burst is probing. */
  activate: {
    scope: "activate",
    limit: 10,
    windowMs: 10 * 60_000,
  } as RateLimitPolicy,
  /** Status checks poll the licence; generous but finite. */
  status: {
    scope: "status",
    limit: 60,
    windowMs: 5 * 60_000,
  } as RateLimitPolicy,
  /** Admin panel actions — accidental double-clicks must never hit this. */
  admin: { scope: "admin", limit: 60, windowMs: 60_000 } as RateLimitPolicy,
} as const;

/** uid when there is one, IP otherwise, `anon` if neither is known. */
export function rateLimitSubject(
  uid: string | undefined,
  ip: string | null,
): string {
  if (uid) return `u${uid}`;
  if (ip) return `i${ip.replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}`;
  return "anon";
}

/**
 * Consume one slot from `policy` for `subject`.
 *
 * @throws `resource-exhausted` when the window is already full.
 */
export async function checkRateLimit(
  db: Firestore,
  policy: RateLimitPolicy,
  subject: string,
): Promise<void> {
  const now = Date.now();
  const ref = db
    .collection("rate_limits")
    .doc(`${policy.scope}_${subject}`.slice(0, 500));

  const verdict = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as RateLimitDoc) : null;
    const expired = !data || now - data.window_started_at >= policy.windowMs;

    if (expired) {
      tx.set(ref, {
        window_started_at: now,
        count: 1,
        updated_at: now,
      } satisfies RateLimitDoc);
      return { allowed: true, retryAfterMs: 0 };
    }

    if (data.count >= policy.limit) {
      return {
        allowed: false,
        retryAfterMs: data.window_started_at + policy.windowMs - now,
      };
    }

    tx.update(ref, {
      count: data.count + 1,
      updated_at: now,
    } satisfies Partial<RateLimitDoc>);
    return { allowed: true, retryAfterMs: 0 };
  });

  if (!verdict.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil(verdict.retryAfterMs / 1000));
    throw new HttpsError(
      "resource-exhausted",
      `بہت زیادہ کوششیں۔ ${retryAfterSec} سیکنڈ بعد دوبارہ کوشش کریں۔`,
    );
  }
}
