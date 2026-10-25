/**
 * Client-side AI usage constants (audit #8).
 *
 * A magic `25` used to sit inline in `use-sync.ts`; both the settings copy and
 * any future UI read it from here.
 *
 * ⚠️ HONEST LIMIT NOTE: nothing server-side *enforces* this limit yet. The
 * Cloud Functions rate-limit `status` policy (60 / 5 min) is the only real
 * guard. Enforcing a daily quota belongs to the real Gemini integration, not
 * this constant.
 */
export const AI_DAILY_LIMIT = 25;
