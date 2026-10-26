/**
 * Verification for the phase-0 scaffolding.
 *
 * Run with:  bun scripts/verify-scaffolding.ts
 *
 * This project has no Vitest/Jest and no DOM environment, so a `*.test.ts` file
 * sitting in src/ would never be executed — it would look like coverage while
 * testing nothing. The suite therefore lives with the other runnable
 * verification (`verify-khata.ts`) and is wired into `bun run test`.
 *
 * Every check drives the real exported functions. The SDKs are replaced with
 * fakes through the injectable `loader` option, so no network is touched and
 * the assertions describe what Sentry/PostHog would actually receive.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ANALYTICS_EVENTS,
  DEFAULT_POSTHOG_HOST,
  identifyUser,
  initAnalytics,
  isAnalyticsReady,
  scrubAnalyticsProperties,
  track,
  type PostHogSdk,
} from "../src/lib/analytics";
import { shouldLoad, shouldShow } from "../src/lib/feature-flags";
import {
  captureError,
  initSentry,
  isSentryReady,
  scrubSentryEvent,
  stripUrlDetails,
  type SentrySdk,
} from "../src/lib/sentry";
import {
  DEFAULT_MODE,
  getFeatures,
  hasFeature,
  isSegmentMode,
  parseMode,
  readUserMode,
} from "../src/lib/mode";
import { useMode } from "../src/hooks/use-mode";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    return;
  }
  failures.push(detail ? `${name} (${detail})` : name);
}

function equal(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? undefined : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/** Lets the scheduled dynamic import resolve before the next assertion. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/* ------------------------------------------------------------------ */
/* Sentry                                                              */
/* ------------------------------------------------------------------ */

let sentryInitOptions: Record<string, unknown> | null = null;
const sentryCaptured: Array<{ error: unknown; context?: Record<string, unknown> }> = [];

const fakeSentry: SentrySdk = {
  init(options) {
    sentryInitOptions = options;
  },
  captureException(error, context) {
    sentryCaptured.push({ error, context });
  },
  browserTracingIntegration: () => ({ name: "browserTracing" }),
};

async function verifySentry(): Promise<void> {
  equal("Sentry: no DSN means no initialisation", initSentry({ dsn: "" }), false);
  equal("Sentry: reporting is a no-op before init", captureError(new Error("early")), false);
  equal("Sentry: not ready without a DSN", isSentryReady(), false);

  const dsn = "https://key@o1.ingest.sentry.io/1";
  equal("Sentry: a DSN schedules initialisation", initSentry({ dsn, loader: async () => fakeSentry }), true);
  equal("Sentry: a second call does not start twice", initSentry({ dsn, loader: async () => fakeSentry }), true);

  await tick();
  equal("Sentry: SDK is ready after loading", isSentryReady(), true);
  check("Sentry: init received the tracing integration", Array.isArray(sentryInitOptions?.integrations) && (sentryInitOptions?.integrations as unknown[]).length === 1);
  check("Sentry: traces are sampled at 10%", sentryInitOptions?.tracesSampleRate === 0.1);
  check("Sentry: an environment is always set", typeof sentryInitOptions?.environment === "string" && sentryInitOptions.environment.length > 0);

  const beforeSend = sentryInitOptions?.beforeSend as (event: unknown) => Record<string, unknown>;
  check("Sentry: beforeSend is wired", typeof beforeSend === "function");

  const event = {
    message: "ledger failed",
    extra: { description: "چائے", detail: "دکان", amount: 500, entry: { a: 1 }, screen: "home" },
    user: { id: "uid-1", email: "a@b.c", username: "ali", ip_address: "1.2.3.4" },
    request: { url: "https://app.example/dashboard?detail=secret#x" },
    breadcrumbs: [{ message: "click", data: { detail: "chai", amount: 500, action: "save" } }],
  };
  const scrubbed = beforeSend(event) as typeof event;
  equal("Sentry: ledger fields are removed from extra", Object.keys(scrubbed.extra).sort(), ["screen"]);
  equal("Sentry: identity is removed from user", scrubbed.user, { id: "uid-1" });
  equal("Sentry: URL loses query and hash", scrubbed.request.url, "https://app.example/dashboard");
  equal("Sentry: breadcrumb data is scrubbed", scrubbed.breadcrumbs[0]?.data, { action: "save" });
  check("Sentry: the original event is not mutated", event.extra.description === "چائے");

  equal("Sentry: stripUrlDetails drops the query", stripUrlDetails("https://x/y?a=1"), "https://x/y");
  equal("Sentry: stripUrlDetails drops the hash", stripUrlDetails("https://x/y#z"), "https://x/y");
  equal(
    "Sentry: scrub keeps harmless fields",
    scrubSentryEvent({ extra: { screen: "home", amount: 10 } }).extra,
    { screen: "home" },
  );

  equal(
    "Sentry: capture forwards the error",
    captureError(new Error("boom"), { detail: "چائے", amount: 500, screen: "home" }),
    true,
  );
  equal("Sentry: capture scrubs context", sentryCaptured[sentryCaptured.length - 1]?.context, { extra: { screen: "home" } });
  check(
    "Sentry: capture passes the original error object",
    sentryCaptured[sentryCaptured.length - 1]?.error instanceof Error && (sentryCaptured[sentryCaptured.length - 1]?.error as Error).message === "boom",
  );
}

/* ------------------------------------------------------------------ */
/* PostHog                                                             */
/* ------------------------------------------------------------------ */

let posthogKey: string | null = null;
let posthogOptions: Record<string, unknown> | null = null;
const posthogCaptured: Array<{ event: string; properties?: Record<string, unknown> }> = [];
const posthogIdentified: Array<{ id: string; properties?: Record<string, unknown> }> = [];

const fakePostHog: PostHogSdk = {
  init(key, options) {
    posthogKey = key;
    posthogOptions = options;
  },
  capture(event, properties) {
    posthogCaptured.push({ event, properties });
  },
  identify(id, properties) {
    posthogIdentified.push({ id, properties });
  },
};

async function verifyAnalytics(): Promise<void> {
  equal("Analytics: no key means no initialisation", initAnalytics({ key: "" }), false);
  equal("Analytics: tracking is a no-op before init", track(ANALYTICS_EVENTS.APP_OPENED), false);
  equal("Analytics: not ready without a key", isAnalyticsReady(), false);

  equal(
    "Analytics: a key schedules initialisation",
    initAnalytics({ key: "phc_test", loader: async () => fakePostHog }),
    true,
  );
  await tick();
  equal("Analytics: SDK is ready after loading", isAnalyticsReady(), true);
  equal("Analytics: the project key is passed through", posthogKey, "phc_test");
  equal("Analytics: the default host is the US cloud", posthogOptions?.api_host, DEFAULT_POSTHOG_HOST);
  equal("Analytics: pageviews are manual", posthogOptions?.capture_pageview, false);
  equal("Analytics: autocapture is off", posthogOptions?.autocapture, false);
  equal("Analytics: session recording is off", posthogOptions?.disable_session_recording, true);

  equal(
    "Analytics: a declared event is sent",
    track(ANALYTICS_EVENTS.VOICE_ENTRY, {
      detail: "چائے",
      amount: 500,
      entry: { amount: 1 },
      screen: "dashboard",
      nested: { amount: 900 },
      ok: true,
      count: 3,
    }),
    true,
  );
  equal("Analytics: only flat, safe properties survive", posthogCaptured[posthogCaptured.length - 1]?.properties, {
    screen: "dashboard",
    ok: true,
    count: 3,
  });
  equal("Analytics: the event name is unchanged", posthogCaptured[posthogCaptured.length - 1]?.event, "voice_entry_used");

  equal("Analytics: identify is sent with a uid only", identifyUser("uid-1", { email: "a@b.c", name: "ali", plan: "free" }), true);
  equal("Analytics: identity fields never leave the device", posthogIdentified[posthogIdentified.length - 1]?.properties, { plan: "free" });
  equal("Analytics: the uid is the distinct id", posthogIdentified[posthogIdentified.length - 1]?.id, "uid-1");
  equal("Analytics: an empty uid is ignored", identifyUser(""), false);

  equal("Analytics: scrub returns undefined for an empty bag", scrubAnalyticsProperties({ amount: 5 }), undefined);
  equal("Analytics: there are exactly six declared events", Object.keys(ANALYTICS_EVENTS).length, 6);
}

/* ------------------------------------------------------------------ */
/* Segment mode                                                        */
/* ------------------------------------------------------------------ */

function verifyMode(): void {
  const household = getFeatures("household");
  const shop = getFeatures("shop");
  const both = getFeatures("both");

  equal("Mode: the default is both", DEFAULT_MODE, "both");
  equal("Mode: household has no credit book", household.creditBook, false);
  equal("Mode: household has no shop parties", household.parties, false);
  equal("Mode: household has a budget", household.householdBudget, true);
  equal("Mode: shop has no household budget", shop.householdBudget, false);
  equal("Mode: shop has no savings goals", shop.savingsGoals, false);
  equal("Mode: shop has the credit book", shop.creditBook, true);
  check(
    "Mode: both enables every feature",
    Object.values(both).every((value) => value === true),
  );
  equal("Mode: voice entry is shared", household.voiceEntry && shop.voiceEntry, true);
  equal("Mode: hasFeature reads the matrix", hasFeature("shop", "staffAccounts"), true);
  equal("Mode: hasFeature rejects a household shop feature", hasFeature("household", "staffAccounts"), false);

  equal("Mode: parse accepts a known mode", parseMode("shop"), "shop");
  equal("Mode: parse normalises case and space", parseMode(" SHOP "), "shop");
  equal("Mode: parse rejects an unknown value", parseMode("restaurant"), "both");
  equal("Mode: parse rejects undefined", parseMode(undefined), "both");
  equal("Mode: parse rejects a number", parseMode(7), "both");
  equal("Mode: isSegmentMode guards the union", [isSegmentMode("both"), isSegmentMode("x")], [true, false]);

  equal("Flags: a household ledger hides the credit book", shouldShow("creditBook", "household"), false);
  equal("Flags: both mode shows the credit book", shouldShow("creditBook", "both"), true);
  equal("Flags: loading follows the same matrix", shouldLoad("parties", "household"), false);
  equal("Flags: shared features load in every mode", shouldLoad("voiceEntry", "household"), true);
}

async function verifyModeReader(): Promise<void> {
  equal("Reader: a stored shop mode is honoured", await readUserMode("uid", async () => "shop"), "shop");
  equal("Reader: a household mode is honoured", await readUserMode("uid", async () => "household"), "household");
  equal("Reader: a missing field means both", await readUserMode("uid", async () => undefined), "both");
  equal("Reader: garbage means both", await readUserMode("uid", async () => ({ mode: "x" })), "both");

  let called = false;
  const throwing = await readUserMode("uid", async () => {
    called = true;
    throw new Error("offline");
  });
  equal("Reader: a Firestore failure falls back", throwing, "both");
  check("Reader: the failure was actually triggered", called);

  let skipped = false;
  const signedOut = await readUserMode(null, async () => {
    skipped = true;
    return "shop";
  });
  equal("Reader: a signed-out user gets both", signedOut, "both");
  equal("Reader: no lookup happens without a user", skipped, false);
}

/* ------------------------------------------------------------------ */
/* useMode hook                                                        */
/* ------------------------------------------------------------------ */

function Probe({ userId }: { userId: string | null }) {
  const { mode, features, hasFeature: has } = useMode(userId);
  return createElement(
    "span",
    null,
    `${mode}|${features.creditBook}|${features.householdBudget}|${has("staffAccounts")}`,
  );
}

function verifyHook(): void {
  equal(
    "Hook: the first render is both with every feature",
    renderToStaticMarkup(createElement(Probe, { userId: null })),
    "<span>both|true|true|true</span>",
  );
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  await verifySentry();
  await verifyAnalytics();
  verifyMode();
  await verifyModeReader();
  verifyHook();

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.error("\nFailed:");
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
  }
  console.log("✔ scaffolding verified");
}

void main();
