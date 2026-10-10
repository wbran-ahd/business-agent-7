/**
 * Analytics charts panel.
 *
 * A default-exported, self-contained component so the parent can load it with
 * `React.lazy`. Chart.js is ~90 kB and was previously sitting in the first-paint
 * bundle for a modal that is usually never opened.
 */
import { formatMonthName } from "@/lib/khata";
import { t } from "@/lib/i18n";
import { CategoryBarChart, MonthlyDoughnut, TrendLineChart } from "./Charts";

export type ChartsPanelProps = {
  income: number;
  expense: number;
  trend: { monthKey: string; income: number; expense: number }[];
  breakdown: { category: string; amount: number }[];
};

export default function ChartsPanel({ income, expense, trend, breakdown }: ChartsPanelProps) {
  return (
    <>
      <div className="bg-black/30 p-4 rounded-2xl border border-white/10 mb-3">
        <MonthlyDoughnut income={income} expense={expense} />
      </div>

      <h3 className="text-sm font-bold text-white/80 mb-2">
        <i className="fas fa-chart-line text-sky-400 ml-1"></i> {t("trendTitle")}
      </h3>
      <div className="bg-black/30 p-4 rounded-2xl border border-white/10 mb-3">
        <TrendLineChart
          labels={trend.map((row) => formatMonthName(row.monthKey).split(" ")[0])}
          income={trend.map((row) => row.income)}
          expense={trend.map((row) => row.expense)}
        />
      </div>

      {breakdown.length > 0 && (
        <>
          <h3 className="text-sm font-bold text-white/80 mb-2">
            <i className="fas fa-layer-group text-sky-400 ml-1"></i> {t("categoryTitle")}
          </h3>
          <div className="bg-black/30 p-4 rounded-2xl border border-white/10 mb-3">
            <CategoryBarChart
              labels={breakdown.map((b) => b.category)}
              data={breakdown.map((b) => b.amount)}
            />
          </div>
        </>
      )}
    </>
  );
}
