/**
 * Export picker — PDF (print), Excel (.xlsx) and the existing CSV backup.
 *
 * The PDF path is a real A4 document sent to the browser's print dialog, where
 * “Save as PDF” exists on Android, iOS, Windows and macOS. Saying “PDF” while
 * shipping a screenshot would have been easier and useless for a bank.
 */
import { Modal } from "@/components/sauti/Modal";

const cardCls =
  "w-full text-right rounded-2xl border p-3 transition flex items-start gap-3 font-sans";

export function ExportModal({
  open,
  onClose,
  monthLabel,
  incomeCount,
  expenseCount,
  onPdf,
  onExcel,
  onCsv,
}: {
  open: boolean;
  onClose: () => void;
  monthLabel: string;
  incomeCount: number;
  expenseCount: number;
  onPdf: () => void;
  onExcel: () => void;
  onCsv: () => void;
}) {
  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} label="رپورٹ ڈاؤن لوڈ" scrollable fontSans>
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <i className="fas fa-file-export text-sky-400"></i> رپورٹ ڈاؤن لوڈ
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="بند کریں"
          className="text-white/50 transition hover:text-white"
        >
          <i className="fas fa-times text-xl"></i>
        </button>
      </div>

      <p className="mt-3 text-[11px] leading-6 text-white/50">
        {monthLabel} · آمدنی {incomeCount} اندراج · خرچہ {expenseCount} اندراج۔ خلاصہ، اخراجات کی
        تقسیم اور کھاتے کے مطابق بیلنس ہر فائل میں شامل ہیں۔
      </p>

      <div className="mt-4 space-y-2">
        <button
          type="button"
          onClick={() => run(onPdf)}
          className={`${cardCls} border-rose-500/35 bg-rose-500/10 hover:bg-rose-500/15`}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/15 text-rose-300">
            <i className="fas fa-file-pdf text-lg"></i>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-white">PDF رپورٹ (A4)</span>
            <span className="mt-0.5 block text-[11px] leading-5 text-white/55">
              پرنٹ ڈائیلاگ کھلے گا — وہاں «Save as PDF» منتخب کریں۔ واٹس ایپ پر بھیجنے کے لیے بہترین۔
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => run(onExcel)}
          className={`${cardCls} border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15`}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
            <i className="fas fa-file-excel text-lg"></i>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-white">Excel فائل (.xlsx)</span>
            <span className="mt-0.5 block text-[11px] leading-5 text-white/55">
              تین شیٹس: خلاصہ، آمدنی، خرچہ۔ رقم اصل نمبروں میں ہے، اس لیے حساب اور چھانٹی چلتی ہے۔
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => run(onCsv)}
          className={`${cardCls} border-white/20 bg-white/5 hover:bg-white/10`}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white/70">
            <i className="fas fa-file-csv text-lg"></i>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-white">CSV بیک اپ</span>
            <span className="mt-0.5 block text-[11px] leading-5 text-white/55">
              پورا کھاتہ (ہر مہینہ) ایک فائل میں — بیک اپ اور دوبارہ بحالی کے لیے۔
            </span>
          </span>
        </button>
      </div>

      <p className="mt-4 text-[10px] leading-5 text-white/35">
        فائلیں اسی فون پر بنتی ہیں — کوئی ڈیٹا کسی سرور کو نہیں جاتا۔
      </p>
    </Modal>
  );
}
