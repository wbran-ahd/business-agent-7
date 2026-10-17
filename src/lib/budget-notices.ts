/**
 * Keeps spoken budget warnings from repeating.
 *
 * The warning is fired from an event handler (right after an entry is added),
 * not from an effect, and each `month|category|level` combination is remembered
 * in localStorage — so crossing 80% speaks once, crossing 100% speaks once, and
 * re-rendering or reloading the page never nags again.
 */
import { activeBudgetAlerts, type BudgetStatus } from "./insights";

export const BUDGET_NOTICE_KEY = "sautiBudgetNotices";

export type Notice = { status: BudgetStatus; key: string };

export function noticeKey(status: BudgetStatus, mKey: string): string {
  return `${mKey}|${status.category}|${status.level}`;
}

function loadNotices(): string[] {
  try {
    const raw = localStorage.getItem(BUDGET_NOTICE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function saveNotices(keys: string[]): void {
  try {
    localStorage.setItem(BUDGET_NOTICE_KEY, JSON.stringify(keys.slice(-200)));
  } catch {
    /* ignore — worst case the warning repeats next session */
  }
}

/** The single most urgent threshold not spoken yet, or null. */
export function nextBudgetNotice(
  statuses: BudgetStatus[],
  mKey: string,
  already?: string[],
): Notice | null {
  const seen = new Set(already ?? loadNotices());
  const pending = activeBudgetAlerts(statuses).find(
    (status) => !seen.has(noticeKey(status, mKey)),
  );
  return pending ? { status: pending, key: noticeKey(pending, mKey) } : null;
}

export function markBudgetNotified(key: string): void {
  const seen = loadNotices();
  if (seen.includes(key)) return;
  saveNotices([...seen, key]);
}

/** Urdu sentence read out after the entry that crossed the threshold. */
export function budgetNoticeText(status: BudgetStatus, format: (value: number) => string): string {
  if (status.level === "danger") {
    return `خبردار! ${status.category} کا بجٹ ختم ہو گیا، ${format(Math.abs(status.remaining))} روپے زیادہ خرچ ہو چکے ہیں۔`;
  }
  return `توجہ: ${status.category} کا بجٹ ${Math.round(status.ratio * 100)} فیصد استعمال ہو گیا ہے۔`;
}
