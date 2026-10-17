/**
 * Main-screen banners: budget overspend and the weekly backup nudge.
 *
 * Both use the existing glass tokens and are dismissible, so the first paint of
 * the dashboard is unchanged when there is nothing to report.
 */
import type { BudgetStatus } from "@/lib/insights";

const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1";

export function BudgetAlertBanner({
  statuses,
  format,
  onDismiss,
}: {
  statuses: BudgetStatus[];
  format: (value: number) => string;
  onDismiss: () => void;
}) {
  if (statuses.length === 0) return null;
  const danger = statuses.some((status) => status.level === "danger");

  return (
    <div
      className={`mb-3 rounded-2xl border p-3 ${
        danger ? "border-rose-500/40 bg-rose-500/10" : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`text-xs font-bold ${danger ? "text-rose-200" : "text-amber-200"}`}
        >
          <i className="fas fa-triangle-exclamation ml-1"></i>
          {danger ? "بجٹ سے زیادہ خرچ" : "بجٹ کی حد قریب ہے"}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="چھپائیں"
          className="text-white/45 transition hover:text-white"
        >
          <i className="fas fa-times text-xs"></i>
        </button>
      </div>

      <div className="space-y-2">
        {statuses.slice(0, 3).map((status) => {
          const filled = Math.min(100, Math.round(status.ratio * 100));
          return (
            <div key={status.category}>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/80">{status.category}</span>
                <span className={status.level === "danger" ? "text-rose-200" : "text-amber-200"}>
                  {format(status.spent)} / {format(status.limit)} روپے
                  {status.level === "danger"
                    ? ` — ${format(Math.abs(status.remaining))} زیادہ`
                    : ` (${filled}%)`}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className={`h-full rounded-full ${
                    status.level === "danger" ? "bg-rose-400" : "bg-amber-400"
                  }`}
                  style={{ width: `${filled}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BackupReminderBanner({
  days,
  onBackup,
  onSnooze,
}: {
  days: number;
  onBackup: () => void;
  onSnooze: () => void;
}) {
  return (
    <div className="mb-3 rounded-2xl border border-sky-500/35 bg-sky-500/10 p-3">
      <p className="text-xs font-bold text-sky-200">
        <i className="fas fa-cloud-arrow-up ml-1"></i> ہفتہ وار بیک اپ یاد دہانی
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/60">
        پچھلے بیک اپ کے {days} دن ہو گئے ہیں۔ فون گم یا ری سیٹ ہونے پر ڈیٹا بچانے کے لیے آج بیک اپ
        لے لیں۔
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onBackup}
          className={`${smallBtn} flex-1 border-sky-500/40 bg-sky-500/20 text-sky-200 hover:bg-sky-500/30`}
        >
          <i className="fas fa-download"></i> CSV بیک اپ ڈاؤن لوڈ
        </button>
        <button
          type="button"
          onClick={onSnooze}
          className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white/70 hover:bg-white/20`}
        >
          بعد میں
        </button>
      </div>
    </div>
  );
}
