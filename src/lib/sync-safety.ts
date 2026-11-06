/**
 * Device-local bookkeeping that makes cloud sync non-destructive.
 *
 * Two problems needed somewhere to live:
 *
 * 1. A locally deleted record still exists in Firestore (uploads never delete,
 *    on purpose — see `use-sync`). Without a local note of that deletion the
 *    next Cloud Download would pull it straight back into the ledger.
 *    `sauti_deleted_ids` is that note: a bounded, device-local tombstone list.
 *    It never travels to the cloud, so it cannot delete another device's data.
 *
 * 2. A download replaces the visible ledger. `sauti_pre_download_backup` keeps
 *    the exact pre-merge ledger, so a wrong download is recoverable instead of
 *    final. It is written before the merge is returned and is capped by one
 *    simple size guard, because localStorage is a small, shared quota.
 *
 * Nothing here changes rendering: these are pure storage helpers.
 */

const DELETED_IDS_KEY = "sauti_deleted_ids";
const PRE_DOWNLOAD_KEY = "sauti_pre_download_backup";

/** Enough history to stop resurrection for a long time without unbounded growth. */
export const MAX_TRACKED_DELETIONS = 1000;

function canStore(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Ids the user deleted on this device, oldest first.
 * Malformed or foreign values are dropped instead of trusted.
 */
export function loadDeletedIds(): number[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(DELETED_IDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is number => typeof id === "number" && Number.isFinite(id))
      .slice(-MAX_TRACKED_DELETIONS);
  } catch {
    return [];
  }
}

/**
 * Remembers deletions so a later download cannot resurrect them.
 * Existing ids are kept once, and the list is trimmed to the newest
 * {@link MAX_TRACKED_DELETIONS} entries.
 */
export function rememberDeletedIds(ids: number[]): void {
  if (!canStore() || ids.length === 0) return;
  try {
    const merged = [...loadDeletedIds()];
    const seen = new Set(merged);
    for (const id of ids) {
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
    localStorage.setItem(
      DELETED_IDS_KEY,
      JSON.stringify(merged.slice(-MAX_TRACKED_DELETIONS)),
    );
  } catch {
    /* storage full or disabled — sync stays safe, it only forgets the note */
  }
}

/** Drops tracked deletions (used by tests and by a deliberate full reset). */
export function clearDeletedIds(): void {
  if (!canStore()) return;
  try {
    localStorage.removeItem(DELETED_IDS_KEY);
  } catch {
    /* ignore */
  }
}

export type CloudIdentity = {
  isAuthenticated: boolean;
  /** UID from the live Firebase session. */
  sessionUid?: string | null;
  /** UID the rest of the app is showing data for. */
  userUid?: string | null;
};

/**
 * Single gate for every Firestore record write/read.
 *
 * A session that belongs to a different UID than the app's current user must
 * never read or write that user's documents, so the comparison is part of the
 * predicate rather than repeated inline (and it is unit-testable).
 */
export function canUseCloud({
  isAuthenticated,
  sessionUid,
  userUid,
}: CloudIdentity): boolean {
  return Boolean(
    isAuthenticated &&
      typeof sessionUid === "string" &&
      sessionUid.length > 0 &&
      typeof userUid === "string" &&
      userUid.length > 0 &&
      sessionUid === userUid,
  );
}

export type PreDownloadBackup<TEntry> = {
  income: TEntry[];
  expense: TEntry[];
  savedAt: number;
};

/**
 * Snapshots the ledger as it was before a cloud merge is applied.
 *
 * Returns `true` when the copy is safely stored. A `false` return is not an
 * error: the download still proceeds, but the caller must not claim that a
 * rollback copy exists.
 */
export function savePreDownloadBackup<TEntry>(
  income: TEntry[],
  expense: TEntry[],
): boolean {
  if (!canStore()) return false;
  try {
    const payload: PreDownloadBackup<TEntry> = {
      income,
      expense,
      savedAt: Date.now(),
    };
    localStorage.setItem(PRE_DOWNLOAD_KEY, JSON.stringify(payload));
    return true;
  } catch {
    /* quota exceeded: the merge is still safe, only the rollback copy is lost */
    return false;
  }
}

/** The last pre-download ledger, or `null` when none was stored. */
export function loadPreDownloadBackup<TEntry>(): PreDownloadBackup<TEntry> | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(PRE_DOWNLOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PreDownloadBackup<TEntry>>;
    if (!Array.isArray(parsed.income) || !Array.isArray(parsed.expense)) return null;
    return {
      income: parsed.income,
      expense: parsed.expense,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearPreDownloadBackup(): void {
  if (!canStore()) return;
  try {
    localStorage.removeItem(PRE_DOWNLOAD_KEY);
  } catch {
    /* ignore */
  }
}
