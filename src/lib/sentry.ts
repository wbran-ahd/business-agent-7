/**
 * Sentry — optional crash reporting.
 *
 * Two hard rules:
 *
 *  1. **Env-gated.** No `VITE_SENTRY_DSN` means this module does nothing at
 *     all: no network, no error, no console noise. The app must behave exactly
 *     the same before the owner creates a Sentry account and after.
 *  2. **PII-free.** A ledger app must never ship a shopkeeper's entry text or
 *     amount to a third party. `scrubSentryEvent` removes those fields before
 *     anything leaves the device.
 *
 * The SDK is loaded with a dynamic `import()` only when a DSN exists, so the
 * initial bundle is byte-for-byte unchanged for everyone who never enables it.
 */

/** Minimal shape we rely on — keeps the SDK out of the boot bundle/type graph. */
export type SentrySdk = {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  browserTracingIntegration: () => unknown;
};

export type SentryLoader = () => Promise<SentrySdk>;

export type SentryInitOptions = {
  /** Overrides `VITE_SENTRY_DSN` (used by tests). */
  dsn?: string;
  environment?: string;
  tracesSampleRate?: number;
  /** Overrides the dynamic import (used by tests). */
  loader?: SentryLoader;
};

/**
 * Field names that may carry user-written ledger text or money.
 * Deleted from `extra`, breadcrumbs and anything else we scrub.
 */
export const PII_KEYS = ["description", "detail", "amount", "entry"] as const;

export type SentryEventLike = {
  extra?: Record<string, unknown>;
  user?: Record<string, unknown>;
  request?: Record<string, unknown>;
  breadcrumbs?: Array<Record<string, unknown>>;
};

function envValue(name: string): string | undefined {
  const bag = import.meta.env as Record<string, unknown> | undefined;
  const raw = bag?.[name];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
}

function scrubRecord(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!source) return source;
  const clean = { ...source };
  for (const key of PII_KEYS) delete clean[key];
  return clean;
}

/** Query strings and hashes can carry a ledger or a search term. */
export function stripUrlDetails(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

/**
 * Returns a cleaned copy of a Sentry event. Exported so the test suite can
 * prove the scrubbing, instead of trusting the `beforeSend` wiring by reading.
 */
export function scrubSentryEvent<T extends SentryEventLike>(event: T): T {
  const clean: SentryEventLike = { ...event };

  if (event.extra) clean.extra = scrubRecord(event.extra);

  if (event.user) {
    const user = { ...event.user };
    delete user.email;
    delete user.username;
    delete user.ip_address;
    clean.user = user;
  }

  if (event.request) {
    const request = { ...event.request };
    if (typeof request.url === "string") request.url = stripUrlDetails(request.url);
    clean.request = request;
  }

  if (event.breadcrumbs) {
    // Breadcrumb data is where form values usually leak in.
    clean.breadcrumbs = event.breadcrumbs.map((crumb) => {
      const next = { ...crumb };
      const data = next.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        next.data = scrubRecord(data as Record<string, unknown>);
      }
      return next;
    });
  }

  return clean as T;
}

let sdk: SentrySdk | null = null;
let loading = false;

const defaultLoader: SentryLoader = () =>
  import("@sentry/react").then((mod) => mod as unknown as SentrySdk);

/**
 * Starts Sentry when a DSN is configured.
 *
 * @returns `true` when initialisation was scheduled (or already done),
 *          `false` when there is no DSN and nothing happened.
 */
export function initSentry(options: SentryInitOptions = {}): boolean {
  const dsn = options.dsn ?? envValue("VITE_SENTRY_DSN");
  if (!dsn) return false;
  if (sdk || loading) return true;

  loading = true;
  const environment = options.environment ?? envValue("MODE") ?? "production";
  const tracesSampleRate = options.tracesSampleRate ?? 0.1;
  const loader = options.loader ?? defaultLoader;

  void loader()
    .then((mod) => {
      mod.init({
        dsn,
        environment,
        tracesSampleRate,
        integrations: [mod.browserTracingIntegration()],
        // Fires for every event, including automatic ones.
        beforeSend: (event: unknown) => scrubSentryEvent(event as SentryEventLike),
      });
      sdk = mod;
    })
    .catch(() => {
      // Reporting must never break the app it is reporting on.
    })
    .finally(() => {
      loading = false;
    });

  return true;
}

/** True once the SDK is actually initialised (not merely scheduled). */
export function isSentryReady(): boolean {
  return sdk !== null;
}

/**
 * Reports a caught error. No-op until the SDK has finished loading, and a
 * no-op forever when no DSN is configured.
 */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): boolean {
  if (!sdk) return false;
  try {
    const extra = scrubRecord(context);
    sdk.captureException(error, extra ? { extra } : undefined);
    return true;
  } catch {
    return false;
  }
}
