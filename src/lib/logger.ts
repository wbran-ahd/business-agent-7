/**
 * Tiny structured logger.
 *
 * The app previously failed silently: a rejected microphone permission or a
 * 4xx from Gemini left no trace. Every non-UI failure is now tagged with a
 * scope so it can be found in the console (and hooked up to a real sink later
 * without touching call sites).
 */

export type LogScope =
  | "voice"
  | "ai"
  | "sync"
  | "storage"
  | "import"
  | "app";

export type LogLevel = "info" | "warn" | "error";

export function logEvent(
  scope: LogScope,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  const prefix = `[sauti-baqaya:${scope}]`;
  const payload = data ? { message, ...data } : { message };
  if (level === "error") console.error(prefix, payload);
  else if (level === "warn") console.warn(prefix, payload);
  else console.info(prefix, payload);
}

/** Convenience wrapper for caught errors. */
export function logError(
  scope: LogScope,
  message: string,
  error: unknown,
): void {
  logEvent(scope, "error", message, {
    reason: error instanceof Error ? error.message : String(error),
  });
}
