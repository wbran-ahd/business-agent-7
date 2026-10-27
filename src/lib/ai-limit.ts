/**
 * Client-side AI usage constants (audit #8).
 *
 * A magic `25` used to sit inline in `use-sync.ts`; both the settings copy and
 * any future UI read it from here.
 *
 * ⚠️ HONEST LIMIT NOTE: the UI-facing constant is advisory. The real
 * enforcement lives server-side in the Convex `analyze` action, which checks
 * `getAiQuota` before calling Gemini and only decrements the daily allowance
 * through `consumeAiQuota` after a model actually answered. Keep this constant
 * in sync with `src/convex/sync.ts`'s `AI_DAILY_LIMIT`, or wire them through
 * one import.
 */
export const AI_DAILY_LIMIT = 25;
