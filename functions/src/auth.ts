/**
 * User-facing callables: `activate` (voucher → licence) and `checkStatus`.
 *
 * Every one of them runs three gates before touching Firestore: an
 * authenticated uid, a rate-limit window, and full input validation. The
 * licensing documents are written here only, through the Admin SDK, so the
 * client can never edit them even though its own rules are strict.
 */
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { requestIp, writeAudit } from "./audit";
import { ACTIVATION_PEPPER, REGION } from "./config";
import { hashCode, signToken } from "./crypto";
import { checkRateLimit, POLICIES, rateLimitSubject } from "./rateLimit";
import type {
  ActivateResult,
  CheckStatusResult,
  CodeDoc,
  LicenseDoc,
  StatusReason,
} from "./types";
import { validateActivateInput, validateCheckStatusInput } from "./validation";

export function requireAuth(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "پہلے سائن اِن کریں۔");
  }
  return uid;
}

function db(): Firestore {
  return getFirestore();
}

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ */
/* activate                                                            */
/* ------------------------------------------------------------------ */

export const activate = onCall(
  { region: REGION, secrets: [ACTIVATION_PEPPER] },
  async (request): Promise<ActivateResult> => {
    const uid = requireAuth(request);
    const input = validateActivateInput(request.data);
    const ip = requestIp(request);
    const pepper = ACTIVATION_PEPPER.value();
    const now = Date.now();

    await checkRateLimit(db(), POLICIES.activate, rateLimitSubject(uid, ip));

    const hash = hashCode(input.code, pepper);
    const found = await db()
      .collection("codes")
      .where("code_hash", "==", hash)
      .limit(1)
      .get();

    if (found.empty) {
      await writeAudit(db(), {
        action: "activate",
        ok: false,
        actorUid: uid,
        actorRole: "user",
        actorIp: ip,
        detail: "code not found",
      });
      throw new HttpsError("not-found", "یہ کوڈ درست نہیں ہے۔");
    }

    const codeRef = found.docs[0]!.ref;
    const codeId = found.docs[0]!.id;
    const licenseRef = db().collection("licenses").doc(uid);

    const outcome = await db().runTransaction(async (tx) => {
      const [codeSnap, licenseSnap] = await Promise.all([
        tx.get(codeRef),
        tx.get(licenseRef),
      ]);
      const code = codeSnap.data() as CodeDoc;
      const previous = licenseSnap.data() as LicenseDoc | undefined;

      if (code.revoked) {
        return {
          ok: false as const,
          error: new HttpsError(
            "permission-denied",
            "یہ کوڈ منسوخ کر دیا گیا ہے۔",
          ),
        };
      }
      if (code.code_expires_at !== null && code.code_expires_at <= now) {
        return {
          ok: false as const,
          error: new HttpsError(
            "failed-precondition",
            "کوڈ کی میعاد ختم ہو چکی ہے۔",
          ),
        };
      }
      if (code.used_by_uid !== null && code.used_by_uid !== uid) {
        return {
          ok: false as const,
          error: new HttpsError(
            "failed-precondition",
            "یہ کوڈ پہلے استعمال ہو چکا ہے۔ ایکٹیویشن ری سیٹ کروائیں۔",
          ),
        };
      }
      const deviceKnown = code.device_ids.includes(input.deviceId);
      if (!deviceKnown && code.device_ids.length >= code.max_devices) {
        return {
          ok: false as const,
          error: new HttpsError(
            "resource-exhausted",
            `اس کوڈ پر زیادہ سے زیادہ ${code.max_devices} ڈیوپل/فارمیٹ جائز ہیں۔`,
          ),
        };
      }
      if (previous && !previous.revoked && previous.code_id !== codeId) {
        return {
          ok: false as const,
          error: new HttpsError(
            "failed-precondition",
            "اس ڈیوپل پر پہلے سے ایکٹیو لائسنس ہے۔",
          ),
        };
      }

      // Bug 2 guard: `license_expires_at` is computed here and the voucher's
      // `code_expires_at` is never written, so the two windows stay separate.
      const licenseExpiresAt =
        code.license_days === null ? null : now + code.license_days * DAY_MS;

      const license: LicenseDoc = {
        uid,
        code_id: codeId,
        plan: code.plan,
        features: Array.isArray(code.features) ? code.features : [],
        activated_at: previous?.activated_at ?? now,
        license_expires_at: licenseExpiresAt,
        revoked: false,
        revoked_at: null,
        revoked_reason: null,
        last_check: previous?.last_check ?? null,
        updated_at: now,
      };
      tx.set(licenseRef, license);

      const deviceIds = deviceKnown
        ? code.device_ids
        : [...code.device_ids, input.deviceId];
      tx.update(codeRef, {
        device_ids: deviceIds,
        used_by_uid: uid,
        updated_at: now,
      });

      return {
        ok: true as const,
        plan: license.plan,
        features: license.features,
        expiresAt: licenseExpiresAt,
        codeExpiresAt: code.code_expires_at,
        activatedAt: license.activated_at,
        codeId,
      } as const;
    });

    if (!outcome.ok) {
      await writeAudit(db(), {
        action: "activate",
        ok: false,
        actorUid: uid,
        actorRole: "user",
        actorIp: ip,
        codeId,
        detail: outcome.error.message,
      });
      throw outcome.error;
    }

    await writeAudit(db(), {
      action: "activate",
      ok: true,
      actorUid: uid,
      actorRole: "user",
      actorIp: ip,
      codeId,
      targetUid: uid,
      detail: `plan=${outcome.plan} devices=${input.deviceId}`,
    });

    return {
      active: true,
      plan: outcome.plan,
      features: outcome.features,
      expiresAt: outcome.expiresAt,
      codeExpiresAt: outcome.codeExpiresAt,
      activatedAt: outcome.activatedAt,
      codeId: outcome.codeId,
      token: signToken(uid, outcome.expiresAt, pepper),
    };
  },
);

/* ------------------------------------------------------------------ */
/* checkStatus                                                         */
/* ------------------------------------------------------------------ */

export const checkStatus = onCall(
  { region: REGION },
  async (request): Promise<CheckStatusResult> => {
    const uid = requireAuth(request);
    validateCheckStatusInput(request.data);
    const ip = requestIp(request);
    const now = Date.now();

    await checkRateLimit(db(), POLICIES.status, rateLimitSubject(uid, ip));

    const ref = db().collection("licenses").doc(uid);
    const snap = await ref.get();
    const raw = snap.exists ? (snap.data() as Partial<LicenseDoc>) : undefined;

    // Legacy/absent documents must still answer: never return `undefined`.
    const plan = typeof raw?.plan === "string" ? raw.plan : "";
    const features = Array.isArray(raw?.features)
      ? raw.features.filter((f): f is string => typeof f === "string")
      : [];
    const expiresAt =
      typeof raw?.license_expires_at === "number"
        ? raw.license_expires_at
        : null;
    const revoked = raw?.revoked === true;

    let reason: StatusReason = "ok";
    if (!raw) reason = "no_license";
    else if (revoked) reason = "revoked";
    else if (expiresAt !== null && expiresAt <= now) reason = "expired";

    if (raw) {
      try {
        await ref.set({ last_check: now, updated_at: now }, { merge: true });
      } catch {
        // Offline/permission blip — the answer itself is unaffected.
      }
    }

    return {
      active: reason === "ok",
      plan,
      features,
      expiresAt,
      revoked,
      expired: reason === "expired",
      reason,
      checkedAt: now,
    };
  },
);
