/**
 * Product analytics — optional, PostHog-compatible.
 *
 * The project already has a privacy-first local buffer in `telemetry.ts`
 * (`recordEvent` / `track`). This module is the *remote* counterpart and stays
 * completely silent unless the owner adds `VITE_POSTHOG_KEY`:
 *
 *   • no key → every function is a no-op and no script is downloaded;
 *   • SDK is loaded with a dynamic `import()`, so the boot bundle is unchanged;
 *   • only the six declared events are sent (`autocapture` off, session
 *     recording off);
 *   • amounts and free-text fields are stripped before sending.
 *
 * Naming note: `telemetry.ts` also exports a local `track`. Import this one as
 * `import { track as trackRemote }` in code that needs both.
 */

import { PII_KEYS } from "@/lib/sentry";

export const ANALYTICS_EVENTS = {
  APP_OPENED: "app_opened",
  SIGNED_UP: "signed_up",
  FIRST_ENTRY: "first_entry_created",
  VOICE_ENTRY: "voice_entry_used",
  AI_TAPPED: "ai_advice_tapped",
  DAY7_RETURN: "day7_return",
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** Minimal PostHog surface we use — keeps the SDK out of the boot bundle. */
export type PostHogSdk = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
};

export type PostHogLoader = () => Promise<PostHogSdk>;

export type AnalyticsInitOptions = {
  /** Overrides `VITE_POSTHOG_KEY` (used by tests). */
  key?: string;
  /** Overrides `VITE_POSTHOG_HOST` (used by tests). */
  host?: string;
  /** Overrides the dynamic import (used by tests). */
  loader?: PostHogLoader;
};

/** US cloud is the default; the EU host is `https://eu.i.posthog.com`. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const STRING_LIMIT = 64;

/** Identity fields are never sent, even as event properties. */
const IDENTITY_KEYS = ["email", "name", "phone", "username", "displayName"] as const;

function envValue(name: string): string | undefined {
  const bag = import.meta.env as Record<string, unknown> | undefined;
  const raw = bag?.[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

/**
 * Keeps only flat primitives and drops known PII keys.
 *
 * Nested objects are dropped on purpose: a property bag that contains an entry
 * object must not be able to smuggle its `detail` or `amount` out.
 */
export function scrubAnalyticsProperties(
  properties?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!properties) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(properties)) {
    const key = rawKey.replace(/[^\w.:-]/g, "").slice(0, 32);
    if (!key) continue;
    if ((PII_KEYS as readonly string[]).includes(key)) continue;
    if ((IDENTITY_KEYS as readonly string[]).includes(key)) continue;
    if (typeof value === "string") {
      if (value) clean[key] = value.slice(0, STRING_LIMIT);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === "boolean") {
      clean[key] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

let sdk: PostHogSdk | null = null;
let loading = false;

const defaultLoader: PostHogLoader = () =>
  import("posthog-js").then((mod) => (mod.default ?? mod) as unknown as PostHogSdk);

/**
 * Starts analytics when a project key is configured.
 *
 * @returns `true` when initialisation was scheduled (or already done),
 *          `false` when there is no key and nothing happened.
 */
export function initAnalytics(options: AnalyticsInitOptions = {}): boolean {
  const key = options.key ?? envValue("VITE_POSTHOG_KEY");
  if (!key) return false;
  if (sdk || loading) return true;

  loading = true;
  const host = options.host ?? envValue("VITE_POSTHOG_HOST") ?? DEFAULT_POSTHOG_HOST;
  const loader = options.loader ?? defaultLoader;

  void loader()
    .then((mod) => {
      mod.init(key, {
        api_host: host,
        person_profiles: "identified_only",
        capture_pageview: false, // only the six declared events
        autocapture: false,
        disable_session_recording: true, // a ledger screen must never be recorded
      });
      sdk = mod;
    })
    .catch(() => {
      // Analytics must never break the app.
    })
    .finally(() => {
      loading = false;
    });

  return true;
}

/** True once the SDK is actually initialised (not merely scheduled). */
export function isAnalyticsReady(): boolean {
  return sdk !== null;
}

/** Sends one declared event. No-op without a key or before the SDK loads. */
export function track(event: AnalyticsEvent, properties?: Record<string, unknown>): boolean {
  if (!sdk) return false;
  try {
    sdk.capture(event, scrubAnalyticsProperties(properties));
    return true;
  } catch {
    return false;
  }
}

/** Links events to a Firebase uid. Never sends a name, email or phone. */
export function identifyUser(uid: string, properties?: Record<string, unknown>): boolean {
  if (!sdk || !uid) return false;
  try {
    sdk.identify(uid, scrubAnalyticsProperties(properties));
    return true;
  } catch {
    return false;
  }
}
