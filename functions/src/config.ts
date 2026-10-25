/**
 * Single source of truth for identity and defaults.
 *
 * ⚠️ `ADMIN_UID` must always equal the uid in `firestore.rules` (`isAdmin()`).
 * There is no admin claim and no admin document: the uid is the whole admin
 * model, so the two files are checked against each other by hand whenever one
 * changes.
 */
import { getApps, initializeApp } from "firebase-admin/app";
import { defineSecret } from "firebase-functions/params";

// Every callable reaches Firestore through the Admin SDK, and that SDK needs a
// default app. Cloud Functions no longer creates one for us, so do it here —
// this module is imported first by every function file.
if (getApps().length === 0) {
  const projectId =
    process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
  initializeApp(projectId ? { projectId } : {});
}

export const ADMIN_UID = "vDzRVOYUgMNwcvD5oBdPVibDFFq1";

/**
 * Secret Manager secret used to pepper voucher hashes and activation tokens.
 * Set it before the first deploy (`firebase functions:secrets:set
 * ACTIVATION_PEPPER`); the emulator reads the value from `functions/.env`.
 */
export const ACTIVATION_PEPPER = defineSecret("ACTIVATION_PEPPER");

/** Region for every function (firebase.json has no `region` key). */
export const REGION = "asia-south1";

/** Voucher defaults used when `createCodes` is called without overrides. */
export const DEFAULT_PLAN = "standard";
export const DEFAULT_FEATURES = ["ai", "shop"] as string[];
export const DEFAULT_LICENSE_DAYS: number | null = null; // null = no expiry
export const DEFAULT_MAX_DEVICES = 1;

/** Bounds enforced on every `createCodes` call. */
export const CREATE_LIMITS = {
  maxBatch: 50,
  minDays: 1,
  maxDays: 3650, // 10 years
  maxFeatures: 20,
} as const;
