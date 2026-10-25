import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, doc, getDocFromServer } from "firebase/firestore";
import appletConfig from "../../firebase-applet-config.json";

export interface FirebaseAppConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
}

export const firebaseConfig: FirebaseAppConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || appletConfig.apiKey || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || appletConfig.authDomain || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || appletConfig.projectId || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || appletConfig.storageBucket || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || appletConfig.messagingSenderId || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || appletConfig.appId || "",
  measurementId: (appletConfig as { measurementId?: string }).measurementId || undefined,
  firestoreDatabaseId: appletConfig.firestoreDatabaseId?.trim() || undefined,
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);


/**
 * Firebase App Check — optional and env-gated.
 *
 * Without `VITE_RECAPTCHA_SITE_KEY` this resolves to `false` and nothing is
 * registered, so development and the current production build behave exactly
 * as before. The App Check module is imported lazily so the Firebase vendor
 * chunk and the boot payload stay unchanged until a key exists.
 *
 * Enforcement in the Firebase console must stay off until every client sends a
 * valid token — see docs/SETUP-ACCOUNTS.md.
 */
export async function initAppCheck(app: FirebaseApp): Promise<boolean> {
  const raw = (import.meta.env as Record<string, unknown>).VITE_RECAPTCHA_SITE_KEY;
  const siteKey = typeof raw === "string" ? raw.trim() : "";
  if (!siteKey) {
    if (import.meta.env.DEV) {
      console.info("[App Check] No site key — skipped in dev");
    }
    return false;
  }

  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
    return true;
  } catch (error) {
    console.warn("[App Check] Initialisation failed:", error);
    return false;
  }
}

void initAppCheck(app);

// Validate connection to Firestore on initial boot as required by Firestore integration
async function testConnection() {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Firebase client is currently offline or connecting:", error.message);
    }
  }
}

testConnection();
