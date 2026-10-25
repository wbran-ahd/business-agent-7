/**
 * Admin callables: issue vouchers, list them, reset or revoke an activation,
 * extend an expiry.
 *
 * Authorisation is a single hard-coded uid (`ADMIN_UID`), mirrored in
 * `firestore.rules`. There is no role document to forge and no claim to steal.
 */
import {
  getFirestore,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { requestIp, writeAudit } from "./audit";
import { ACTIVATION_PEPPER, ADMIN_UID, REGION } from "./config";
import { generateVoucherCode, hashCode, maskCode } from "./crypto";
import { checkRateLimit, POLICIES, rateLimitSubject } from "./rateLimit";
import { type CollectionReference } from "firebase-admin/firestore";
import type { CodeDoc, IssuedCode, LicenseDoc } from "./types";
import {
  validateCodeIdInput,
  validateCreateCodesInput,
  validateExtendInput,
  validateListCodesInput,
  validateResetInput,
} from "./validation";

const DAY_MS = 86_400_000;

function db(): Firestore {
  return getFirestore();
}

export function requireAdmin(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "پہلے سائن اِن کریں۔");
  }
  if (uid !== ADMIN_UID) {
    throw new HttpsError("permission-denied", "یہ سہولت صرف ایڈمن کے لیے ہے۔");
  }
  return uid;
}

async function gateAdmin(request: CallableRequest<unknown>): Promise<string> {
  const uid = requireAdmin(request);
  await checkRateLimit(
    db(),
    POLICIES.admin,
    rateLimitSubject(uid, requestIp(request)),
  );
  return uid;
}

function codeRef(id: string) {
  return codeCollection().doc(id);
}

/** The Admin SDK types every collection as `DocumentData`; assert ours. */
function codeCollection(): CollectionReference<CodeDoc> {
  return db().collection("codes") as unknown as CollectionReference<CodeDoc>;
}

function licenseCollection(): CollectionReference<LicenseDoc> {
  return db().collection(
    "licenses",
  ) as unknown as CollectionReference<LicenseDoc>;
}

/** Every licence handed out by one voucher — used by reset and revoke. */
async function licenseDocsForCode(tx: Transaction, codeId: string) {
  const snap = await tx.get(licenseCollection().where("code_id", "==", codeId));
  return snap.docs;
}

/* ------------------------------------------------------------------ */
/* createCodes                                                         */
/* ------------------------------------------------------------------ */

export const createCodes = onCall(
  { region: REGION, secrets: [ACTIVATION_PEPPER] },
  async (request) => {
    const actor = await gateAdmin(request);
    const input = validateCreateCodesInput(request.data);
    const pepper = ACTIVATION_PEPPER.value();
    const ip = requestIp(request);
    const now = Date.now();

    const batch = db().batch();
    const issued: IssuedCode[] = [];

    for (let i = 0; i < input.count; i += 1) {
      const code = generateVoucherCode();
      const ref = codeCollection().doc();
      const masked = maskCode(code);
      const doc: CodeDoc = {
        code_hash: hashCode(code, pepper),
        code_masked: masked,
        plan: input.plan,
        features: input.features,
        device_ids: [],
        used_by_uid: null,
        max_devices: input.maxDevices,
        license_days: input.licenseDays,
        code_expires_at: input.codeExpiresAt,
        created_at: now,
        created_by: actor,
        label: input.label,
        revoked: false,
        revoked_at: null,
        updated_at: now,
      };
      batch.set(ref, doc);
      issued.push({ code, codeId: ref.id, masked });
    }

    await batch.commit();

    await writeAudit(db(), {
      action: "create_codes",
      ok: true,
      actorUid: actor,
      actorRole: "admin",
      actorIp: ip,
      detail: `count=${issued.length} plan=${input.plan} days=${input.licenseDays ?? "none"} label=${input.label ?? "-"}`,
    });

    // `codes` are shown exactly once: they are not stored in plaintext.
    return { count: issued.length, codes: issued };
  },
);

/* ------------------------------------------------------------------ */
/* listCodes                                                           */
/* ------------------------------------------------------------------ */

export const listCodes = onCall({ region: REGION }, async (request) => {
  await gateAdmin(request);
  const input = validateListCodesInput(request.data ?? {});
  const snap = await db()
    .collection("codes")
    .orderBy("created_at", "desc")
    .limit(input.limit)
    .get();

  let rows = snap.docs.map((docSnap) => {
    const code = docSnap.data() as CodeDoc;
    return {
      id: docSnap.id,
      masked: code.code_masked,
      plan: code.plan,
      features: code.features ?? [],
      device_count: code.device_ids.length,
      max_devices: code.max_devices,
      used_by_uid: code.used_by_uid,
      license_days: code.license_days,
      code_expires_at: code.code_expires_at,
      label: code.label,
      revoked: code.revoked === true,
      created_at: code.created_at,
    };
  });

  if (input.revokedOnly === true) rows = rows.filter((row) => row.revoked);
  if (input.revokedOnly === false) rows = rows.filter((row) => !row.revoked);

  return { count: rows.length, codes: rows };
});

/* ------------------------------------------------------------------ */
/* resetActivation — free a voucher so a lost phone can be replaced     */
/* ------------------------------------------------------------------ */

export const resetActivation = onCall({ region: REGION }, async (request) => {
  const actor = await gateAdmin(request);
  const input = validateResetInput(request.data);
  const ip = requestIp(request);
  const now = Date.now();

  const ref = codeRef(input.codeId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "یہ کوڈ موجود نہیں ہے۔");
  }
  const code = snap.data() as CodeDoc;
  const previousHolder = code.used_by_uid;

  const revoked = await db().runTransaction(async (tx) => {
    const licences = await licenseDocsForCode(tx, input.codeId);
    for (const licence of licences) {
      tx.update(licence.ref, {
        revoked: true,
        revoked_at: now,
        revoked_reason: input.reason ?? "reset_activation",
        updated_at: now,
      });
    }
    tx.update(ref, {
      used_by_uid: null,
      device_ids: [],
      updated_at: now,
    });
    return licences.length;
  });

  await writeAudit(db(), {
    action: "reset_activation",
    ok: true,
    actorUid: actor,
    actorRole: "admin",
    actorIp: ip,
    codeId: input.codeId,
    targetUid: previousHolder,
    detail: `revoked_licences=${revoked} reason=${input.reason ?? "reset_activation"}`,
  });

  return {
    ok: true,
    codeId: input.codeId,
    freedFor: previousHolder,
    revokedLicences: revoked,
  };
});

/* ------------------------------------------------------------------ */
/* revokeCode — kill the voucher *and* everything it issued             */
/* ------------------------------------------------------------------ */

export const revokeCode = onCall({ region: REGION }, async (request) => {
  const actor = await gateAdmin(request);
  const { codeId } = validateCodeIdInput(request.data);
  const ip = requestIp(request);
  const now = Date.now();

  const ref = codeRef(codeId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "یہ کوڈ موجود نہیں ہے۔");
  }
  const previousHolder = (snap.data() as CodeDoc).used_by_uid;

  const revoked = await db().runTransaction(async (tx) => {
    const licences = await licenseDocsForCode(tx, codeId);
    for (const licence of licences) {
      tx.update(licence.ref, {
        revoked: true,
        revoked_at: now,
        revoked_reason: "code_revoked",
        updated_at: now,
      });
    }
    tx.update(ref, { revoked: true, revoked_at: now, updated_at: now });
    return licences.length;
  });

  await writeAudit(db(), {
    action: "revoke_code",
    ok: true,
    actorUid: actor,
    actorRole: "admin",
    actorIp: ip,
    codeId,
    targetUid: previousHolder,
    detail: `revoked_licences=${revoked}`,
  });

  return { ok: true, codeId, revokedLicences: revoked };
});

/* ------------------------------------------------------------------ */
/* extendCode — move a voucher's own expiry / re-price its days         */
/* ------------------------------------------------------------------ */

export const extendCode = onCall({ region: REGION }, async (request) => {
  const actor = await gateAdmin(request);
  const input = validateExtendInput(request.data);
  const ip = requestIp(request);
  const now = Date.now();

  const ref = codeRef(input.codeId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "یہ کوڈ موجود نہیں ہے۔");
  }
  const code = snap.data() as CodeDoc;

  let codeExpiresAt = code.code_expires_at;
  if (input.codeExpiresAt !== null) {
    codeExpiresAt = input.codeExpiresAt;
  } else if (input.extendByDays !== null) {
    // Extending an already-expired voucher counts from *now*, never from the
    // old date, so the result is always a live voucher.
    const base =
      codeExpiresAt !== null && codeExpiresAt > now ? codeExpiresAt : now;
    codeExpiresAt = base + input.extendByDays * DAY_MS;
  }

  const licenseDays =
    input.licenseDays !== null ? input.licenseDays : code.license_days;

  const previousExpiry = code.code_expires_at;

  const result = await db().runTransaction(async (tx) => {
    const licences = await licenseDocsForCode(tx, input.codeId);
    // Whatever the voucher gained, its already-issued licences gain too: the
    // holder must not keep running on the old date. Never-expiring licences
    // (`null`) and revoked ones are left alone.
    const delta =
      codeExpiresAt !== null ? codeExpiresAt - (previousExpiry ?? now) : 0;
    let extended = 0;
    if (delta !== 0) {
      for (const licence of licences) {
        const data = licence.data();
        if (data.revoked || data.license_expires_at === null) continue;
        tx.update(licence.ref, {
          license_expires_at: data.license_expires_at + delta,
          updated_at: now,
        });
        extended += 1;
      }
    }
    tx.update(ref, {
      code_expires_at: codeExpiresAt,
      license_days: licenseDays,
      updated_at: now,
    });
    return { extended };
  });

  await writeAudit(db(), {
    action: "extend_code",
    ok: true,
    actorUid: actor,
    actorRole: "admin",
    actorIp: ip,
    codeId: input.codeId,
    detail: `code_expires_at=${codeExpiresAt ?? "none"} license_days=${licenseDays ?? "none"} extended_licences=${result.extended}`,
  });

  return {
    ok: true,
    codeId: input.codeId,
    code_expires_at: codeExpiresAt,
    license_days: licenseDays,
    extendedLicences: result.extended,
  };
});
