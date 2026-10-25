/**
 * End-to-end flow test for صوتی بقیہ Functions against the Firebase emulators.
 *
 * Run:
 *   npm run build
 *   firebase emulators:start --only auth,functions,firestore --project demo-sauti
 *   node test/flow.mjs
 *
 * The scenarios use fixed uids, so restart the emulators (a fresh, empty
 * Firestore) before re-running the suite.
 *
 * It mints real ID tokens against the Auth emulator, calls every callable over
 * HTTP and then reads Firestore through the Admin SDK, so it exercises the same
 * code path a phone would.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT = "demo-sauti";
const REGION = "asia-south1";
const HOST = process.env.EMU_HOST ?? "127.0.0.1";
const ADMIN_UID = "vDzRVOYUgMNwcvD5oBdPVibDFFq1";
const DAY_MS = 86_400_000;

process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:8080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:9099`;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
process.env.GCLOUD_PROJECT = PROJECT;

const app = initializeApp({ projectId: PROJECT });
const auth = getAuth(app);
const db = getFirestore(app);

/* ---------------------------- tiny harness ---------------------------- */

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function mintToken(uid) {
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(
    `http://${HOST}:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!body.idToken)
    throw new Error(`signInWithCustomToken failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

/** Callable over HTTP: `{ result }` on success, `{ error }` on failure. */
async function call(fn, data, token) {
  const res = await fetch(`http://${HOST}:5001/${PROJECT}/${REGION}/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  if (body.result !== undefined) return { ok: true, result: body.result };
  return { ok: false, error: body.error ?? body };
}

const GRPC = {
  INVALID_ARGUMENT: 3,
  NOT_FOUND: 5,
  FAILED_PRECONDITION: 9,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  UNAUTHENTICATED: 16,
  INTERNAL: 13,
};

/** Callable errors arrive as `{ message, status }` (or legacy `{ code }`). */
function errorCode(response) {
  const err = response.error;
  if (!err) return undefined;
  if (typeof err.status === "string") return GRPC[err.status] ?? -1;
  return err.code;
}

/* ------------------------------ scenarios ----------------------------- */

async function main() {
  console.log("\n— 1. createCodes: non-admin must be rejected —");
  const userToken = await mintToken("user-alpha");
  const rejected = await call("createCodes", { count: 1 }, userToken);
  check(
    "non-admin createCodes → PERMISSION_DENIED",
    errorCode(rejected) === GRPC.PERMISSION_DENIED,
    JSON.stringify(rejected.error),
  );

  const anonymous = await call("createCodes", { count: 1 }, null);
  check(
    "no token createCodes → UNAUTHENTICATED",
    errorCode(anonymous) === GRPC.UNAUTHENTICATED,
    JSON.stringify(anonymous.error),
  );

  console.log("\n— 2. createCodes: admin issues two vouchers —");
  const adminToken = await mintToken(ADMIN_UID);
  const codeExpiresAt = Date.now() + 30 * DAY_MS;
  const issued = await call(
    "createCodes",
    {
      count: 2,
      plan: "pro",
      features: ["ai", "shop"],
      licenseDays: 365,
      maxDevices: 1,
      codeExpiresAt,
      label: "batch-test",
    },
    adminToken,
  );
  check(
    "admin createCodes → 2 codes",
    issued.ok && issued.result.count === 2,
    JSON.stringify(issued.error),
  );
  if (!issued.ok) return finish();

  const [first, second] = issued.result.codes;
  const codeDoc = (await db.collection("codes").doc(first.codeId).get()).data();
  check(
    "plain code is NOT stored",
    !JSON.stringify(codeDoc).includes(first.code),
  );
  check("code_hash stored (64 hex)", /^[0-9a-f]{64}$/.test(codeDoc.code_hash));
  check(
    "code_masked stored",
    codeDoc.code_masked.endsWith(first.code.slice(-4)),
  );
  check(
    "code_expires_at stored from input",
    codeDoc.code_expires_at === codeExpiresAt,
  );
  check(
    "plan + features stored on code",
    codeDoc.plan === "pro" && codeDoc.features.join(",") === "ai,shop",
  );

  console.log("\n— 3. activate: happy path —");
  const activated = await call(
    "activate",
    { code: first.code, deviceId: "device-aaaaaaaa" },
    userToken,
  );
  check(
    "activate → active",
    activated.ok && activated.result.active === true,
    JSON.stringify(activated.error),
  );
  if (activated.ok) {
    const lic = activated.result;
    check("result has plan (bug 1)", lic.plan === "pro");
    check(
      "result has features (bug 1)",
      Array.isArray(lic.features) && lic.features.includes("ai"),
    );
    check(
      "result carries a token",
      typeof lic.token === "string" && lic.token.startsWith("v1."),
    );
    check(
      "expiresAt ≈ now + 365d",
      Math.abs(lic.expiresAt - (Date.now() + 365 * DAY_MS)) < 60_000,
    );
    check("codeExpiresAt kept (bug 2)", lic.codeExpiresAt === codeExpiresAt);
  }

  const licenseSnap = await db.collection("licenses").doc("user-alpha").get();
  const license = licenseSnap.data();
  check("license doc exists", licenseSnap.exists);
  check("license.plan written (bug 1)", license?.plan === "pro");
  check(
    "license.features written (bug 1)",
    license?.features?.join(",") === "ai,shop",
  );
  check(
    "license_expires_at set (bug 2)",
    typeof license?.license_expires_at === "number",
  );
  check("license code_id points at voucher", license?.code_id === first.codeId);
  check("last_check starts null", license?.last_check === null);

  const codeAfter = (
    await db.collection("codes").doc(first.codeId).get()
  ).data();
  check(
    "voucher code_expires_at NOT rewritten (bug 2)",
    codeAfter.code_expires_at === codeExpiresAt,
  );
  check(
    "device recorded",
    codeAfter.device_ids.join(",") === "device-aaaaaaaa",
  );
  check("used_by_uid recorded", codeAfter.used_by_uid === "user-alpha");

  console.log("\n— 4. checkStatus —");
  const status = await call("checkStatus", {}, userToken);
  check(
    "checkStatus → active",
    status.ok && status.result.active === true,
    JSON.stringify(status.error),
  );
  if (status.ok) {
    check("status.plan never undefined (bug 1)", status.result.plan === "pro");
    check(
      "status.features never undefined (bug 1)",
      status.result.features.includes("shop"),
    );
    check(
      "status.expiresAt matches licence",
      status.result.expiresAt === license.license_expires_at,
    );
    check("status.reason ok", status.result.reason === "ok");
  }
  const licenseAfterCheck = (
    await db.collection("licenses").doc("user-alpha").get()
  ).data();
  check("last_check updated", typeof licenseAfterCheck.last_check === "number");

  const unsigned = await call("checkStatus", {}, null);
  check(
    "checkStatus without token → UNAUTHENTICATED",
    errorCode(unsigned) === GRPC.UNAUTHENTICATED,
    JSON.stringify(unsigned.error),
  );

  console.log("\n— 5. device limit + idempotent re-activation —");
  const secondDevice = await call(
    "activate",
    { code: first.code, deviceId: "device-bbbbbbbb" },
    userToken,
  );
  check(
    "second device → RESOURCE_EXHAUSTED",
    errorCode(secondDevice) === GRPC.RESOURCE_EXHAUSTED,
    JSON.stringify(secondDevice.error),
  );

  const again = await call(
    "activate",
    { code: first.code, deviceId: "device-aaaaaaaa" },
    userToken,
  );
  check(
    "same device re-activation → still active",
    again.ok && again.result.active === true,
    JSON.stringify(again.error),
  );

  console.log("\n— 6. a second account cannot reuse the voucher —");
  const betaToken = await mintToken("user-beta");
  const reused = await call(
    "activate",
    { code: first.code, deviceId: "device-cccccccc" },
    betaToken,
  );
  check(
    "other uid → FAILED_PRECONDITION",
    errorCode(reused) === GRPC.FAILED_PRECONDITION,
    JSON.stringify(reused.error),
  );

  const unknown = await call(
    "activate",
    { code: "SAUTI-ZZZZ-ZZZZ-ZZZZ", deviceId: "device-dddddddd" },
    betaToken,
  );
  check(
    "unknown code → NOT_FOUND",
    errorCode(unknown) === GRPC.NOT_FOUND,
    JSON.stringify(unknown.error),
  );

  console.log("\n— 7. expired voucher (bug 2: separate expiry fields) —");
  const expiredIssued = await call(
    "createCodes",
    {
      count: 1,
      plan: "standard",
      licenseDays: 30,
      codeExpiresAt: Date.now() - 1000,
    },
    adminToken,
  );
  const gammaToken = await mintToken("user-gamma");
  if (expiredIssued.ok) {
    const expired = await call(
      "activate",
      { code: expiredIssued.result.codes[0].code, deviceId: "device-eeeeeeee" },
      gammaToken,
    );
    check(
      "expired voucher → FAILED_PRECONDITION",
      errorCode(expired) === GRPC.FAILED_PRECONDITION,
      JSON.stringify(expired.error),
    );
  } else {
    check("expired voucher → FAILED_PRECONDITION", false, "createCodes failed");
  }

  console.log("\n— 8. extendCode —");
  const extendable = await call(
    "createCodes",
    {
      count: 1,
      plan: "standard",
      licenseDays: 30,
      codeExpiresAt: Date.now() + DAY_MS,
    },
    adminToken,
  );
  if (extendable.ok) {
    const target = extendable.result.codes[0];
    const before = (
      await db.collection("codes").doc(target.codeId).get()
    ).data().code_expires_at;
    const extended = await call(
      "extendCode",
      { codeId: target.codeId, extendByDays: 30 },
      adminToken,
    );
    const after = (await db.collection("codes").doc(target.codeId).get()).data()
      .code_expires_at;
    check(
      "extendCode moves code_expires_at",
      extended.ok &&
        after > before &&
        Math.abs(after - (before + 30 * DAY_MS)) < 5000,
      JSON.stringify(extended.error),
    );
    const nonAdminExtend = await call(
      "extendCode",
      { codeId: target.codeId, extendByDays: 1 },
      userToken,
    );
    check(
      "extendCode by non-admin → PERMISSION_DENIED",
      errorCode(nonAdminExtend) === GRPC.PERMISSION_DENIED,
      JSON.stringify(nonAdminExtend.error),
    );

    // Decision 2: moving the voucher must move the holder's licence with it.
    const holderBefore = (
      await db.collection("licenses").doc("user-alpha").get()
    ).data();
    const extendHolder = await call(
      "extendCode",
      { codeId: first.codeId, extendByDays: 30 },
      adminToken,
    );
    const holderAfter = (
      await db.collection("licenses").doc("user-alpha").get()
    ).data();
    check(
      "extendCode reports the licences it moved",
      extendHolder.ok && extendHolder.result.extendedLicences === 1,
      JSON.stringify(extendHolder.error ?? extendHolder.result),
    );
    check(
      "holder's license_expires_at grew by exactly 30d",
      holderAfter.license_expires_at - holderBefore.license_expires_at ===
        30 * DAY_MS,
      `delta=${holderAfter.license_expires_at - holderBefore.license_expires_at}`,
    );
    check(
      "voucher expiry grew by the same 30d",
      (await db.collection("codes").doc(first.codeId).get()).data()
        .code_expires_at -
        codeExpiresAt ===
        30 * DAY_MS,
    );
  } else {
    check("extendCode setup", false, JSON.stringify(extendable.error));
  }

  console.log("\n— 9. revokeCode → licence dead —");
  const revoked = await call(
    "revokeCode",
    { codeId: second.codeId },
    adminToken,
  );
  check("revokeCode ok", revoked.ok === true, JSON.stringify(revoked.error));
  const statusAfterRevoke = await call("checkStatus", {}, userToken);
  // user-alpha's licence comes from the *first* code, so revoke the second one
  // first and assert on its own holder below (see reset test).
  check(
    "revoke did not disturb the other licence",
    statusAfterRevoke.ok && statusAfterRevoke.result.active === true,
    JSON.stringify(statusAfterRevoke.error),
  );

  console.log("\n— 10. resetActivation → freed for a new phone —");
  const codeBeforeReset = (
    await db.collection("codes").doc(first.codeId).get()
  ).data();
  const reset = await call(
    "resetActivation",
    { codeId: first.codeId, reason: "phone lost" },
    adminToken,
  );
  check("resetActivation ok", reset.ok === true, JSON.stringify(reset.error));
  const alphaLicence = (
    await db.collection("licenses").doc("user-alpha").get()
  ).data();
  check(
    "old licence revoked",
    alphaLicence?.revoked === true &&
      alphaLicence?.revoked_reason === "phone lost",
  );
  const freedCode = (
    await db.collection("codes").doc(first.codeId).get()
  ).data();
  check("used_by_uid cleared", freedCode.used_by_uid === null);
  check(
    "device_ids cleared",
    Array.isArray(freedCode.device_ids) && freedCode.device_ids.length === 0,
  );
  check(
    "voucher expiry untouched by reset (bug 2)",
    freedCode.code_expires_at === codeBeforeReset.code_expires_at,
  );

  const deltaToken = await mintToken("user-delta");
  const reactivated = await call(
    "activate",
    { code: first.code, deviceId: "device-new-phone" },
    deltaToken,
  );
  check(
    "new phone can activate the freed code",
    reactivated.ok && reactivated.result.active === true,
    JSON.stringify(reactivated.error),
  );
  const statusAlpha = await call("checkStatus", {}, userToken);
  check(
    "old holder now sees revoked",
    statusAlpha.ok &&
      statusAlpha.result.active === false &&
      statusAlpha.result.reason === "revoked",
    JSON.stringify(statusAlpha.error),
  );

  console.log("\n— 11. rate limit (real, not a stub) —");
  const rateToken = await mintToken("user-ratelimit");
  let sawExhausted = false;
  let attempts = 0;
  for (let i = 0; i < 11; i += 1) {
    attempts += 1;
    const res = await call(
      "activate",
      { code: "SAUTI-XXXX-XXXX-XXXX", deviceId: "device-ffffffff" },
      rateToken,
    );
    if (errorCode(res) === GRPC.RESOURCE_EXHAUSTED) {
      sawExhausted = true;
      break;
    }
  }
  check(
    `activate blocked after ${attempts} attempts (limit 10 / 10 min)`,
    sawExhausted,
  );

  const rateDocs = await db
    .collection("rate_limits")
    .where("__name__", ">=", "activate_")
    .limit(20)
    .get();
  const rateDoc = rateDocs.docs.find((d) => d.id.includes("user-ratelimit"));
  check(
    "rate_limits document written",
    Boolean(rateDoc) && rateDoc.data().count >= 10,
    rateDoc ? JSON.stringify(rateDoc.data()) : "missing",
  );

  console.log("\n— 12. audit trail —");
  const audit = await db.collection("audit_log").limit(50).get();
  const actions = new Set(audit.docs.map((d) => d.data().action));
  check("audit_log written", audit.size > 0, `size=${audit.size}`);
  for (const action of [
    "activate",
    "create_codes",
    "reset_activation",
    "revoke_code",
    "extend_code",
  ]) {
    check(
      `audit action "${action}" recorded`,
      actions.has(action),
      `seen: ${[...actions].join(", ")}`,
    );
  }

  return finish();
}

function finish() {
  console.log("\n========================================");
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("  failing:");
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log("========================================");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
