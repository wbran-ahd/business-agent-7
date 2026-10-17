/**
 * `useBackupReminder` — weekly "export your data" nudge.
 *
 * `markBackedUp` is the single place that records a successful export, so the
 * CSV button, the cloud upload and the customer-khata download all feed the same
 * timestamp.
 */
import {
  backupDue,
  loadBackupState,
  markBackedUp,
  persistBackupState,
  snoozeBackup,
  type BackupDue,
  type BackupState,
} from "@/lib/backup-reminder";
import { useCallback, useMemo, useState } from "react";

export function useBackupReminder() {
  const [state, setState] = useState<BackupState>(() => {
    const loaded = loadBackupState();
    // Persist the first-run record so the week is counted from day one.
    persistBackupState(loaded);
    return loaded;
  });

  const due: BackupDue = useMemo(() => backupDue(state), [state]);

  const backedUp = useCallback(() => {
    setState((current) => {
      const next = markBackedUp(current);
      persistBackupState(next);
      return next;
    });
  }, []);

  const snooze = useCallback((days?: number) => {
    setState((current) => {
      const next = snoozeBackup(current, days);
      persistBackupState(next);
      return next;
    });
  }, []);

  return { due, state, backedUp, snooze };
}

export type UseBackupReminder = ReturnType<typeof useBackupReminder>;
