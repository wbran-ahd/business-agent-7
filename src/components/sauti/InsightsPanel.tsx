/**
 * خریداری کا مشورہ — the deterministic insight list.
 *
 * Rendered from `purchaseInsights()` output, so the analytics screen is useful
 * even with no Gemini key and no network. The same lines are sent to Gemini with
 * an AI question so both answers agree.
 */
import type { PurchaseInsight } from "@/lib/insights";

const ICONS: Record<PurchaseInsight["kind"], { icon: string; tone: string }> = {
  budget: { icon: "fa-triangle-exclamation", tone: "text-rose-300" },
  top: { icon: "fa-arrow-trend-up", tone: "text-sky-300" },
  rising: { icon: "fa-chart-line", tone: "text-amber-300" },
  frequent: { icon: "fa-rotate", tone: "text-emerald-300" },
  steady: { icon: "fa-scale-balanced", tone: "text-white/70" },
};

export function InsightsPanel({ insights }: { insights: PurchaseInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      <h3 className="mb-2 text-xs font-bold text-white/80">
        <i className="fas fa-cart-shopping text-amber-300 ml-1"></i> خریداری کا مشورہ
      </h3>
      <div className="space-y-2">
        {insights.map((insight) => {
          const meta = ICONS[insight.kind];
          return (
            <div
              key={insight.id}
              className="rounded-xl border border-white/10 bg-black/25 p-2.5"
            >
              <p className={`text-[11px] font-bold ${meta.tone}`}>
                <i className={`fas ${meta.icon} ml-1`}></i>
                {insight.headline}
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-white/50">
                {insight.detail}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
