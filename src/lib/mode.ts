/**
 * Segment mode — household, shop, or both.
 *
 * The product serves two kinds of users with one codebase:
 *
 *   • 🏠 household — budget, monthly spending, savings advice
 *   • 🏪 shop      — khata, customers/suppliers, udhaar, staff PIN
 *   • 👥 both      — everything (the default, so today's UI stays as it is)
 *
 * This module is **logic only**. Nothing here renders, styles or renames a
 * single component: a screen decides for itself whether to use a flag, and no
 * screen does yet. Persisting `mode` to Firestore is phase 3.
 *
 * Everything is pure so it can be unit-tested without a browser or a database.
 */

export const SEGMENT_MODES = ["household", "shop", "both"] as const;

export type SegmentMode = (typeof SEGMENT_MODES)[number];

/**
 * `both` is deliberate: it reproduces exactly what the app does today, where
 * every screen is visible. A narrower default would hide features from
 * existing users the moment this module is wired in.
 */
export const DEFAULT_MODE: SegmentMode = "both";

export interface ModeFeatures {
  /* ---- Household ---- */
  householdBudget: boolean;
  monthlyReports: boolean;
  savingsGoals: boolean;

  /* ---- Shop ---- */
  creditBook: boolean; // customer/supplier udhaar ledger
  parties: boolean; // customer & supplier records
  stockReminders: boolean; // low-stock / restock nudges
  staffAccounts: boolean; // staff PIN lock

  /* ---- Shared ---- */
  dailySummary: boolean;
  voiceEntry: boolean;
  aiAdvisor: boolean;
}

export type ModeFeature = keyof ModeFeatures;

const MODE_FEATURES: Record<SegmentMode, Readonly<ModeFeatures>> = {
  household: Object.freeze({
    householdBudget: true,
    monthlyReports: true,
    savingsGoals: true,
    creditBook: false,
    parties: false,
    stockReminders: false,
    staffAccounts: false,
    dailySummary: true,
    voiceEntry: true,
    aiAdvisor: true,
  }),
  shop: Object.freeze({
    householdBudget: false,
    monthlyReports: true,
    savingsGoals: false,
    creditBook: true,
    parties: true,
    stockReminders: true,
    staffAccounts: true,
    dailySummary: true,
    voiceEntry: true,
    aiAdvisor: true,
  }),
  both: Object.freeze({
    householdBudget: true,
    monthlyReports: true,
    savingsGoals: true,
    creditBook: true,
    parties: true,
    stockReminders: true,
    staffAccounts: true,
    dailySummary: true,
    voiceEntry: true,
    aiAdvisor: true,
  }),
};

/** Features for a mode. Unknown values fall back to `both`. */
export function getFeatures(mode: SegmentMode): Readonly<ModeFeatures> {
  return MODE_FEATURES[mode] ?? MODE_FEATURES[DEFAULT_MODE];
}

export function hasFeature(mode: SegmentMode, feature: ModeFeature): boolean {
  return getFeatures(mode)[feature] === true;
}

export function isSegmentMode(value: unknown): value is SegmentMode {
  return typeof value === "string" && (SEGMENT_MODES as readonly string[]).includes(value);
}

/**
 * Reads a stored value defensively.
 *
 * Firestore may return `undefined`, a stale value from an older build, or
 * something hand-edited in the console. None of those may crash a render, so
 * anything unrecognised becomes `both`.
 */
export function parseMode(value: unknown): SegmentMode {
  if (typeof value !== "string") return DEFAULT_MODE;
  const normalised = value.trim().toLowerCase();
  return isSegmentMode(normalised) ? normalised : DEFAULT_MODE;
}

/** Injectable reader so the contract is testable without Firestore. */
export type StoredModeReader = (userId: string) => Promise<unknown>;

/**
 * Default reader: `users/{uid}.mode`.
 *
 * Read-only — the field is not written until phase 3, so today it resolves to
 * `undefined` and therefore to `both`. Loaded lazily so importing this module
 * never pulls Firebase into a test or a bundle chunk that does not need it.
 */
async function readStoredMode(userId: string): Promise<unknown> {
  const [{ db }, { doc, getDoc }] = await Promise.all([
    import("@/lib/firebase"),
    import("firebase/firestore"),
  ]);
  const snapshot = await getDoc(doc(db, "users", userId));
  if (!snapshot.exists()) return undefined;
  return (snapshot.data() as { mode?: unknown }).mode;
}

/**
 * The signed-in user's mode, or `both` when there is no user, no stored value,
 * no network, or a value we do not recognise.
 *
 * Never throws: a mode lookup must not be able to block the app.
 */
export async function readUserMode(
  userId: string | null | undefined,
  reader: StoredModeReader = readStoredMode,
): Promise<SegmentMode> {
  if (!userId) return DEFAULT_MODE;
  try {
    return parseMode(await reader(userId));
  } catch {
    return DEFAULT_MODE;
  }
}
