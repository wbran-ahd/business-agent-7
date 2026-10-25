/**
 * Runtime environment validation for Firebase and application variables.
 */

function read(name: string): string | undefined {
  const value = import.meta.env[name] as string | undefined;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function getFirebaseEnv() {
  return {
    apiKey: read("VITE_FIREBASE_API_KEY"),
    authDomain: read("VITE_FIREBASE_AUTH_DOMAIN"),
    projectId: read("VITE_FIREBASE_PROJECT_ID"),
    storageBucket: read("VITE_FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: read("VITE_FIREBASE_MESSAGING_SENDER_ID"),
    appId: read("VITE_FIREBASE_APP_ID"),
  };
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    read("VITE_FIREBASE_API_KEY") ||
    read("VITE_FIREBASE_PROJECT_ID")
  );
}
