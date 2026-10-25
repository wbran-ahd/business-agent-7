/**
 * Security-rules enforcement test.
 *
 * Runs against the Firestore emulator's REST API with real ID tokens minted by
 * the Auth emulator, so every request is evaluated by `firestore.rules` exactly
 * as a phone would be. The first assertion is a *baseline*: an unauthenticated
 * write that must be denied — if it ever succeeds, the rest of this file would
 * be measuring nothing.
 *
 * Run after `npm test` (needs an emulator with rules loaded):
 *   node test/rules.mjs
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const PROJECT = "demo-sauti";
const HOST = process.env.EMU_HOST ?? "127.0.0.1";
const ADMIN_UID = "vDzRVOYUgMNwcvD5oBdPVibDFFq1";
const DAY_MS = 86_400_000;

process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:9099`;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT;
process.env.GCLOUD_PROJECT = PROJECT;

const app = initializeApp({ projectId: PROJECT });
const auth = getAuth(app);
const docs = `http://${HOST}:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const fn = (name) => `http://${HOST}:5001/${PROJECT}/asia-south1/${name}`;

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
    throw new Error(`token mint failed: ${JSON.stringify(body)}`);
  return body.idToken;
}

async function call(fnName, data, token) {
  const res = await fetch(fn(fnName), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json();
  return body.result !== undefined
    ? { ok: true, result: body.result }
    : { ok: false, error: body.error ?? body };
}

/** `POST` a document create; `PATCH` an update. Returns the HTTP status. */
async function writeDoc(path, fields, token, method = "POST") {
  const cut = path.lastIndexOf("/");
  const parent = path.slice(0, cut);
  const id = path.slice(cut + 1);
  const url =
    method === "POST"
      ? `${docs}/${parent}?documentId=${id}`
      : `${docs}/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ fields }),
  });
  return res.status;
}

/** Unfiltered collection query — the `list` branch of the rules. */
async function query(collectionId, token) {
  const res = await fetch(`${docs}:runQuery`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId }] },
    }),
  });
  return res.status;
}

/** Plain document read. */
async function readDoc(path, token) {
  const res = await fetch(`${docs}/${path}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.status;
}

const S = (value) => ({ stringValue: value });
const I = (value) => ({ integerValue: String(value) });

// Doc ids are run-scoped so the suite can run more than once against a live
// emulator without tripping ALREADY_EXISTS.
const RUN = Date.now().toString(36).slice(-6);
const docId = (prefix, n) => `${prefix}${RUN}${n}`;

function partyFields(id, kind = "customer", name = "Round Corner") {
  return {
    id: I(id),
    name: S(name),
    phone: S("923001234567"),
    kind: S(kind),
    createdAt: I(Date.now()),
  };
}

function txnFields(id, account = "cash") {
  return {
    id: I(id),
    partyId: I(1),
    kind: S("charge"),
    amount: I(500),
    account: S(account),
    note: S("credit"),
    timestamp: I(Date.now()),
    date: S("١ نومبر"),
    time: S("١١:٠٠"),
  };
}

async function main() {
  const alpha = await mintToken("rules-alpha");
  const beta = await mintToken("rules-beta");
  const admin = await mintToken(ADMIN_UID);

  console.log("\n— baseline: rules are actually enforced on this API —");
  const anon = await writeDoc(
    `users/rules-alpha/parties/${docId("b", 0)}`,
    partyFields(9000),
    null,
  );
  check("unauthenticated party write → 403", anon === 403, `got ${anon}`);
  if (anon !== 403) {
    console.log(
      "  ! REST is not enforcing rules here — remaining checks are meaningless.",
    );
    return finish();
  }

  console.log("\n— parties (bug 4: these rules were missing entirely) —");
  const ownParty = await writeDoc(
    `users/rules-alpha/parties/${docId("p", 1)}`,
    partyFields(9001),
    alpha,
  );
  check(
    "owner can create their party → 200",
    ownParty === 200,
    `got ${ownParty}`,
  );

  const otherParty = await writeDoc(
    `users/rules-beta/parties/${docId("p", 2)}`,
    partyFields(9002),
    alpha,
  );
  check(
    "writing into someone else's party book → 403",
    otherParty === 403,
    `got ${otherParty}`,
  );

  const badKind = await writeDoc(
    `users/rules-alpha/parties/${docId("p", 3)}`,
    partyFields(9003, "enemy"),
    alpha,
  );
  check(
    "invalid kind → 403 (field validation)",
    badKind === 403,
    `got ${badKind}`,
  );

  const shortName = await writeDoc(
    `users/rules-alpha/parties/${docId("p", 4)}`,
    { ...partyFields(9004), name: S("X") },
    alpha,
  );
  check("name under 2 chars → 403", shortName === 403, `got ${shortName}`);

  const ownTxn = await writeDoc(
    `users/rules-alpha/partyTxns/${docId("p", 5)}`,
    txnFields(9005),
    alpha,
  );
  check("owner can create a txn → 200", ownTxn === 200, `got ${ownTxn}`);

  const badTxn = await writeDoc(
    `users/rules-alpha/partyTxns/${docId("p", 6)}`,
    txnFields(9006, "bitcoin"),
    alpha,
  );
  check(
    "invalid account → 403 (field validation)",
    badTxn === 403,
    `got ${badTxn}`,
  );

  const txns = await writeDoc(
    `users/rules-alpha/partyTxns/${docId("p", 7)}`,
    txnFields(9007),
    beta,
  );
  check("cross-user txn write → 403", txns === 403, `got ${txns}`);

  console.log("\n— AI gate (enforcement: no licence, no stored Gemini key) —");
  const settingsPath = (uid) => `users/${uid}/settings/current`;
  // REST needs the explicit `arrayValue` envelope — `[]` cannot be typed.
  const budgetOnly = {
    budgets: { arrayValue: { values: [] } },
    updatedAt: I(Date.now()),
  };

  const betaBudgets = await writeDoc(
    settingsPath("rules-beta"),
    budgetOnly,
    beta,
    "PATCH",
  );
  check(
    "unlicensed budgets still save → 200",
    betaBudgets === 200,
    `got ${betaBudgets}`,
  );

  const betaKey = await writeDoc(
    settingsPath("rules-beta"),
    { ...budgetOnly, geminiKey: S("AIza-should-not-be-stored") },
    beta,
    "PATCH",
  );
  check("unlicensed Gemini key → 403", betaKey === 403, `got ${betaKey}`);

  const issued = await call(
    "createCodes",
    { count: 1, plan: "pro", features: ["ai", "shop"], licenseDays: 365 },
    admin,
  );
  if (!issued.ok) {
    check(
      "admin issues a licence voucher",
      false,
      JSON.stringify(issued.error),
    );
    return finish();
  }
  const activated = await call(
    "activate",
    { code: issued.result.codes[0].code, deviceId: "device-rules-1" },
    alpha,
  );
  check(
    "licensed user activates",
    activated.ok,
    JSON.stringify(activated.error),
  );
  if (!activated.ok) return finish();

  const alphaKey = await writeDoc(
    settingsPath("rules-alpha"),
    { ...budgetOnly, geminiKey: S("AIza-licensed-key") },
    alpha,
    "PATCH",
  );
  check(
    "licensed Gemini key (feature `ai`) → 200",
    alphaKey === 200,
    `got ${alphaKey}`,
  );

  const alphaKeyAgain = await writeDoc(
    settingsPath("rules-alpha"),
    { ...budgetOnly, geminiKey: S("AIza-licensed-key") },
    alpha,
    "PATCH",
  );
  check(
    "same key re-written (update, unchanged) → 200",
    alphaKeyAgain === 200,
    `got ${alphaKeyAgain}`,
  );

  console.log("\n— licensing collections stay server-only —");
  const codesRead = await query("codes", alpha);
  check(
    "non-admin cannot list codes → 403",
    codesRead === 403,
    `got ${codesRead}`,
  );
  const codesReadAdmin = await query("codes", admin);
  check(
    "admin can list codes → 200",
    codesReadAdmin === 200,
    `got ${codesReadAdmin}`,
  );

  const codeWrite = await writeDoc(
    "codes/forbidden",
    { plan: S("pro") },
    admin,
  );
  check(
    "even the admin cannot write codes from a client → 403",
    codeWrite === 403,
    `got ${codeWrite}`,
  );

  const rateRead = await query("rate_limits", admin);
  check(
    "rate limits are server-only → 403",
    rateRead === 403,
    `got ${rateRead}`,
  );

  const auditRead = await query("audit_log", admin);
  check(
    "admin can read the audit trail → 200",
    auditRead === 200,
    `got ${auditRead}`,
  );
  const auditReadUser = await query("audit_log", alpha);
  check(
    "user cannot read the audit trail → 403",
    auditReadUser === 403,
    `got ${auditReadUser}`,
  );

  console.log("\n— licence document visibility —");
  const ownLicence = await readDoc("licenses/rules-alpha", alpha);
  check(
    "owner can read their own licence → 200",
    ownLicence === 200,
    `got ${ownLicence}`,
  );
  const foreignLicence = await readDoc("licenses/rules-alpha", beta);
  check(
    "another user cannot read it → 403",
    foreignLicence === 403,
    `got ${foreignLicence}`,
  );

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
