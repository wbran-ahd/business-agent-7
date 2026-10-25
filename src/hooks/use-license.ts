/**
 * Licence state for the signed-in device.
 *
 * This hook is also what starts the session: صوتی بقیہ has no sign-in form,
 * so `use-license` mints the anonymous identity and *then* asks the server
 * whether that uid holds an active licence. `use-auth` stays a passive
 * observer of whatever identity exists here.
 *
 * Failure policy is local-first on purpose: only a *definitive* answer
 * (`no_license`, `revoked`, `expired`) gates the app. A network error, a rate
 * limit or an offline device leaves the ledger usable — enforcement happens
 * in Firestore rules anyway, so a pass-through here cannot grant access to
 * data the licence does not cover.
 */
import { signInAnonymously } from "firebase/auth";
import { useEffect, useState } from "react";
import { checkLicense, type CheckStatusResult } from "@/lib/activation";
import { auth } from "@/lib/firebase";

export type LicensePhase =
  | "loading"
  | "active"
  | "missing"
  | "expired"
  | "revoked"
  | "offline";

export interface LicenseState {
  phase: LicensePhase;
  plan: string;
  features: string[];
  expiresAt: number | null;
}

function phaseOf(status: CheckStatusResult): LicensePhase {
  if (status.active) return "active";
  switch (status.reason) {
    case "revoked":
      return "revoked";
    case "expired":
      return "expired";
    default:
      return "missing";
  }
}

function answered(status: CheckStatusResult): LicenseState {
  return {
    phase: phaseOf(status),
    plan: status.plan,
    features: status.features,
    expiresAt: status.expiresAt,
  };
}

const INITIAL: LicenseState = {
  phase: "loading",
  plan: "",
  features: [],
  expiresAt: null,
};

export function useLicense() {
  const [state, setState] = useState<LicenseState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        if (!auth.currentUser) await signInAnonymously(auth);
        const status = await checkLicense();
        if (!cancelled) setState(answered(status));
      } catch {
        if (!cancelled) {
          setState((current) => ({ ...current, phase: "offline" }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ...state,
    active: state.phase === "active",
    isChecking: state.phase === "loading",
  };
}
