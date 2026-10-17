/**
 * Licence state for the local payment flow.
 *
 * The trial starts on first open, activation codes are validated offline, and
 * everything is stored on the device. No network, no gateway, no promises the
 * build cannot keep.
 */
import {
  applyActivation,
  licenseSnapshot,
  loadLicense,
  persistLicense,
  type ActivationResult,
  type LicenseSnapshot,
  type LicenseState,
} from "@/lib/payments";
import { installId as readInstallId } from "@/lib/telemetry";
import { useCallback, useMemo, useState } from "react";

export type UseLicense = {
  state: LicenseState;
  snapshot: LicenseSnapshot;
  installId: string;
  activate: (code: string) => ActivationResult;
};

export function useLicense(): UseLicense {
  const [state, setState] = useState<LicenseState>(() => loadLicense());
  const installId = useMemo(() => readInstallId(), []);
  const snapshot = licenseSnapshot(state);

  const activate = useCallback(
    (code: string) => {
      const { state: next, result } = applyActivation(state, code, installId);
      if (result.ok) {
        persistLicense(next);
        setState(next);
      }
      return result;
    },
    [state, installId],
  );

  return { state, snapshot, installId, activate };
}
