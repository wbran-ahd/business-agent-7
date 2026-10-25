/**
 * The voucher list: one card per code with its four actions.
 *
 * Every row is a `rounded-2xl border-white/10 bg-white/5` card — the same
 * building block the dashboard and settings use — and the buttons are the
 * shared `smallBtn` with the app's semantic accents (amber = reset, rose =
 * revoke, sky = extend, neutral = copy). No new colour, radius or type scale.
 */
import type { CodeRow } from "@/lib/admin";

const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed";

const resetBtn = `${smallBtn} border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25`;
const revokeBtn = `${smallBtn} border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25`;
const extendBtn = `${smallBtn} border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30`;
const copyBtn = `${smallBtn} border-white/20 bg-white/10 text-white/85 hover:bg-white/15`;

function dateLabel(timestamp: number | null): string {
  if (!timestamp) return "کبھی نہیں";
  return new Date(timestamp).toLocaleDateString("ur-PK");
}

function statusBadge(row: CodeRow) {
  if (row.revoked) {
    return (
      <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300">
        منسوخ
      </span>
    );
  }
  if (row.used_by_uid) {
    return (
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
        استعمال شدہ
      </span>
    );
  }
  return (
    <span className="rounded-full border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300">
      تیار
    </span>
  );
}

export function CodesTable({
  rows,
  loading,
  error,
  busyId,
  issued,
  onReset,
  onRevoke,
  onExtend,
  onCopy,
  onRetry,
}: {
  rows: CodeRow[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  issued: Record<string, string>;
  onReset: (row: CodeRow) => void;
  onRevoke: (row: CodeRow) => void;
  onExtend: (row: CodeRow) => void;
  onCopy: (row: CodeRow) => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/5"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3">
        <p className="text-[11px] leading-6 text-rose-300">{error}</p>
        <button type="button" onClick={onRetry} className={`${copyBtn} mt-2 w-full`}>
          <i className="fas fa-rotate"></i> دوبارہ
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
        <i className="fas fa-ticket text-xl text-white/35"></i>
        <p className="mt-2 text-xs leading-6 text-white/55">
          ابھی کوئی کوڈ بنایا نہیں گیا۔ اوپر والا بٹن دبا کر پہلا کوڈ بنائیں۔
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => {
        const busy = busyId === row.id;
        const plain = issued[row.id];
        return (
          <li
            key={row.id}
            className="rounded-2xl border border-white/10 bg-white/5 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span dir="ltr" className="font-sans text-xs font-bold text-white">
                {row.masked}
              </span>
              {statusBadge(row)}
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-sans text-[10px] text-white/55">
              <span>پلان: {row.plan}</span>
              <span>
                ڈیوپل: {row.device_count}/{row.max_devices}
              </span>
              <span>میعاد: {dateLabel(row.code_expires_at)}</span>
              {row.license_days !== null && <span>لائسنس: {row.license_days} دن</span>}
              <span>بنائ: {dateLabel(row.created_at)}</span>
              {row.used_by_uid && (
                <span dir="ltr">uid: {row.used_by_uid.slice(0, 12)}…</span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => onReset(row)}
                className={resetBtn}
              >
                <i className="fas fa-rotate-left"></i> ری سیٹ
              </button>
              <button
                type="button"
                disabled={busy || row.revoked}
                onClick={() => onRevoke(row)}
                className={revokeBtn}
              >
                <i className="fas fa-ban"></i> منسوخ
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onExtend(row)}
                className={extendBtn}
              >
                <i className="fas fa-hourglass-half"></i> میعاد
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onCopy(row)}
                className={copyBtn}
                title={
                  plain
                    ? "کوڈ کاپی کریں"
                    : "کوڈ صرف بنائے وقت ظاہر ہوتا ہے — پرانے کوڈ کا متن محفوظ نہیں رکھا جاتا"
                }
              >
                <i className={`fa-solid ${plain ? "fa-copy" : "fa-lock"}`}></i> کاپی
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
