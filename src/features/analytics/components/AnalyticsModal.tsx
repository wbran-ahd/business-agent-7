import { lazy, Suspense } from "react";
import { Modal } from "@/components/sauti/Modal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { InsightsPanel } from "@/components/sauti/InsightsPanel";
import { formatNumber, type DigitStyle, type AiInsight } from "@/lib/khata";
import type { purchaseInsights } from "@/lib/insights";
import { t } from "@/lib/i18n";

const ChartsPanel = lazy(() => import("@/components/sauti/ChartsPanel"));

const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center gap-1";

interface AnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  totals: {
    totalIncome: number;
    totalExpense: number;
  };
  trend: Array<{ monthKey: string; income: number; expense: number }>;
  breakdown: Array<{ category: string; amount: number; percentage: number }>;
  insights: ReturnType<typeof purchaseInsights>;
  alerts: Array<{ category: string; spent: number; limit: number }>;
  digitStyle: DigitStyle;
  aiHasKey: boolean;
  aiRemaining: number;
  aiBusy: boolean;
  aiError: string | null;
  insight: AiInsight | null;
  onRunAi: () => void;
  onExportPdf: () => void;
  onExportExcel: () => void;
}

export function AnalyticsModal({
  open,
  onClose,
  totals,
  trend,
  breakdown,
  insights,
  alerts,
  digitStyle,
  aiHasKey,
  aiRemaining,
  aiBusy,
  aiError,
  insight,
  onRunAi,
  onExportPdf,
  onExportExcel,
}: AnalyticsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      label={t("analyticsTitle")}
      scrollable
      fontSans
    >
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <i className="fas fa-chart-pie text-sky-400"></i> {t("analyticsTitle")}
        </h2>
        <button
          onClick={onClose}
          aria-label={t("cancel")}
          className="text-white/50 hover:text-white transition"
        >
          <i className="fas fa-times text-xl"></i>
        </button>
      </div>

      <ErrorBoundary
        scope="charts"
        fallback={
          <p className="text-center text-white/50 text-xs py-6">
            گراف لوڈ نہیں ہو سکا — براہِ کرم دوبارہ کوشش کریں۔
          </p>
        }
      >
        <Suspense
          fallback={<p className="text-center text-white/50 text-xs py-6">گراف تیار ہو رہا ہے…</p>}
        >
          <ChartsPanel
            income={totals.totalIncome}
            expense={totals.totalExpense}
            trend={trend}
            breakdown={breakdown}
          />
        </Suspense>
      </ErrorBoundary>

      <InsightsPanel insights={insights} />

      {alerts.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-3 text-xs text-rose-200">
          {alerts.map((alert) => (
            <div key={alert.category} className="flex justify-between">
              <span>
                <i className="fas fa-triangle-exclamation ml-1"></i> {alert.category} بجٹ ختم
              </span>
              <span>
                {formatNumber(alert.spent, digitStyle)} /{" "}
                {formatNumber(alert.limit, digitStyle)} روپے
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onRunAi}
        disabled={aiBusy}
        className="w-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-50"
      >
        <i className="fas fa-wand-magic-sparkles ml-1"></i>{" "}
        {aiBusy ? t("aiRunning") : t("aiAnalyze")}
      </button>

      {/* The same numbers the panel shows, in shareable formats */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onExportPdf}
          className={`${smallBtn} justify-center bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 border-rose-500/40`}
        >
          <i className="fas fa-file-pdf"></i> PDF رپورٹ
        </button>
        <button
          type="button"
          onClick={onExportExcel}
          className={`${smallBtn} justify-center bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-500/40`}
        >
          <i className="fas fa-file-excel"></i> Excel رپورٹ
        </button>
      </div>

      {!aiHasKey && (
        <p className="text-[11px] text-white/50 mt-2">
          اے آئی کے لیے ⚙️ سیٹنگز میں Gemini API Key درج کریں۔
        </p>
      )}
      {aiHasKey && (
        <p className="text-[11px] text-white/40 mt-2">
          آج بقیا اے آئی کوٹہ: {aiRemaining}
        </p>
      )}

      {aiError && <p className="text-[11px] text-rose-300 mt-2">{aiError}</p>}

      {insight && (
        <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 mt-3 text-xs text-white/85 space-y-1">
          <div className="flex justify-between items-center">
            <span className="font-bold text-sky-200">🤖 {insight.title}</span>
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] ${
                insight.riskLevel === "unavailable"
                  ? "bg-slate-500/20 text-slate-300 border-slate-400/40"
                  : insight.riskLevel === "high"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    : insight.riskLevel === "medium"
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
              }`}
            >
              {insight.riskLevel === "unavailable"
                ? "دستیاب نہیں"
                : insight.riskLevel === "high"
                  ? "خطرہ زیادہ"
                  : insight.riskLevel === "medium"
                    ? "انتہائی"
                    : "ٹھیک ہے"}
            </span>
          </div>
          <p>{insight.insight}</p>
          {insight.topCategory !== "-" && (
            <p className="text-white/60">
              سب سے بڑا خرچہ: <strong>{insight.topCategory}</strong>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
