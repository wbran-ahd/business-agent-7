import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, signInAnonymously, User as FirebaseUser } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

/**
 * Silent data safeguard for صوتی بقیہ.
 *
 * The app opens straight into the ledger, so there is no login screen and no
 * account to create. Firestore rules still scope every read and write to
 * `users/{uid}`, so the device mints an anonymous Firebase session in the
 * background. The user never sees it; it only keeps the same uid the device
 * already had, which is what makes the existing cloud data reachable.
 *
 * Local-first: if anonymous sign-in is unavailable (offline, disabled), the
 * ledger keeps working on-device and `isAuthenticated` stays false so cloud
 * actions degrade instead of blocking the UI.
 */

export interface AppUser {
  uid: string;
  name?: string;
  isAnonymous?: boolean;
}

const GUEST_NAME = "مہمان صارف";

function mapUser(fbUser: FirebaseUser): AppUser {
  return {
    uid: fbUser.uid,
    name: fbUser.displayName || GUEST_NAME,
    isAnonymous: fbUser.isAnonymous,
  };
}

/**
 * One bootstrap at a time: StrictMode double-mounts and several hooks call
 * `useAuth` simultaneously, and concurrent `signInAnonymously` calls would
 * otherwise race to create more than one identity.
 */
let bootstrap: Promise<boolean> | null = null;

function ensureAnonymousSession(): Promise<boolean> {
  if (auth.currentUser) return Promise.resolve(true);
  if (!bootstrap) {
    bootstrap = signInAnonymously(auth)
      .then(() => true)
      .catch(() => {
        bootstrap = null;
        return false;
      });
  }
  return bootstrap;
}

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (cancelled) return;

      if (!fbUser) {
        // No session yet: mint the silent anonymous one. Loading stays true
        // until it resolves so consumers do not treat this as "denied".
        void ensureAnonymousSession().then((ok) => {
          if (!cancelled && !ok) setIsLoading(false);
        });
        return;
      }

      const mappedUser = mapUser(fbUser);
      setUser(mappedUser);
      setIsLoading(false);

      // Audit #26: only anonymous sessions need a profile document.
      if (fbUser.isAnonymous) {
        void ensureUserProfile(fbUser, mappedUser);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return {
    isLoading,
    isAuthenticated: Boolean(user),
    user,
  };
}

/** Writes the profile doc once per uid (local-first: failures never block). */
async function ensureUserProfile(fbUser: FirebaseUser, mappedUser: AppUser) {
  try {
    const userRef = doc(db, "users", fbUser.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        id: fbUser.uid,
        name: mappedUser.name,
        isAnonymous: fbUser.isAnonymous,
        createdAt: Date.now(),
      });
    }
  } catch {
    // Offline or restricted mode — the ledger keeps working locally.
  }
}
