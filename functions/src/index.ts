/**
 * صوتی بقیہ — Cloud Functions entrypoint.
 *
 * User callables (any signed-in device):
 *   activate     — voucher → licence, with rate limit + device limit
 *   checkStatus  — licence state, always answered with plan/features
 *
 * Admin callables (ADMIN_UID only):
 *   createCodes, listCodes, resetActivation, revokeCode, extendCode
 *
 * Region lives here because `firebase.json` has no `region` key.
 */
import { setGlobalOptions } from "firebase-functions/v2";
import { activate, checkStatus } from "./auth";
import {
  createCodes,
  extendCode,
  listCodes,
  resetActivation,
  revokeCode,
} from "./admin";
import { ADMIN_UID } from "./config";

// NOTE: `region` is set on every `onCall` instead of here. ES module imports
// run before this statement, so the functions would already have been defined
// (in the default region) by the time `setGlobalOptions` executed.
setGlobalOptions({ maxInstances: 10 });

export {
  activate,
  checkStatus,
  createCodes,
  listCodes,
  resetActivation,
  revokeCode,
  extendCode,
  ADMIN_UID,
};
