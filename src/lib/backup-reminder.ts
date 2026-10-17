/**
 * ہفتہ وار بیک اپ یاد دہانی.
 *
 * A shop phone is lost, wiped or reset far more often than anyone plans for, so
 * the app tracks the last time data left the device (CSV download or a cloud
 * upload) and asks for a fresh backup every week. Snoozing is explicit: it
 * silences the banner for a few days instead of pretending the backup happened.
 */
export const BACKUP_STORAGE_KEY = "sautiBackupState";

export const BACKUP_INTERVAL_DAYS = 7;
export const BACKUP_SNOOZE_DAYS = 3;

export type BackupState = {
  /** First run — used only for messaging. */
  startedAt: number;
  /** Last successful CSV download or cloud upload. */
  lastAt: number;
  /** Banner stays hidden until this timestamp. */
  snoozedUntil: number;
};

export function defaultBackupState(now: number = Date.now()): BackupState {
  return { startedAt: now, lastAt: now, snoozedUntil: 0 };
}

export function loadBackupState(now: number = Date.now()): BackupState {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (!raw) return defaultBackupState(now);
    const parsed = JSON.parse(raw) as Partial<BackupState>;
    return {
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : now,
      lastAt: typeof parsed.lastAt === "number" ? parsed.lastAt : now,
      snoozedUntil: typeof parsed.snoozedUntil === "number" ? parsed.snoozedUntil : 0,
    };
  } catch {
    return defaultBackupState(now);
  }
}

export function persistBackupState(state: BackupState): void {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore — the reminder simply falls back to in-memory state */
  }
}

export function daysSince(timestamp: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - timestamp) / 86_400_000));
}

export type BackupDue = {
  due: boolean;
  days: number;
  snoozed: boolean;
  lastAt: number;
};

export function backupDue(state: BackupState, now: number = Date.now()): BackupDue {
  const days = daysSince(state.lastAt, now);
  const snoozed = state.snoozedUntil > now;
  return { due: !snoozed && days >= BACKUP_INTERVAL_DAYS, days, snoozed, lastAt: state.lastAt };
}

export function markBackedUp(state: BackupState, now: number = Date.now()): BackupState {
  return { ...state, lastAt: now, snoozedUntil: 0 };
}

export function snoozeBackup(
  state: BackupState,
  days: number = BACKUP_SNOOZE_DAYS,
  now: number = Date.now(),
): BackupState {
  return { ...state, snoozedUntil: now + days * 86_400_000 };
}
