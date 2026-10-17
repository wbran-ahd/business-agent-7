/**
 * خریداری کا مشورہ — deterministic purchase insights and budget status.
 *
 * Everything here is derived from the ledger with plain arithmetic, so the shop
 * gets useful advice instantly, offline, and without spending AI quota. The same
 * insights are also handed to Gemini, so a real question is answered with the
 * same numbers the panel shows.
 */
import {
  getPreviousMonthKey,
  monthOf,
  type Budget,
  type DataState,
} from "./khata";

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */
export type BudgetLevel = "ok" | "warning" | "danger";

export type BudgetStatus = {
  category: string;
  spent: number;
  limit: number;
  remaining: number;
  /** Spent ÷ limit — 0.85 means 85% used, 1.2 means 20% over. */
  ratio: number;
  level: BudgetLevel;
};

/** Alerts start at 80% used, not only once the limit is already broken. */
export const BUDGET_WARNING_RATIO = 0.8;

export function budgetStatus(db: DataState, mKey: string, budgets: Budget[]): BudgetStatus[] {
  return budgets
    .filter((budget) => budget.limit > 0)
    .map((budget) => {
      const spent = db.expense
        .filter((entry) => monthOf(entry) === mKey && entry.category === budget.category)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const ratio = spent / budget.limit;
      const level: BudgetLevel =
        ratio >= 1 ? "danger" : ratio >= BUDGET_WARNING_RATIO ? "warning" : "ok";
      return {
        category: budget.category,
        spent,
        limit: budget.limit,
        remaining: budget.limit - spent,
        ratio,
        level,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/** The categories worth telling the shopkeeper about, worst first. */
export function activeBudgetAlerts(statuses: BudgetStatus[]): BudgetStatus[] {
  return statuses.filter((status) => status.level !== "ok");
}

/* ------------------------------------------------------------------ */
/* Purchase insights                                                   */
/* ------------------------------------------------------------------ */
export function monthlyCategoryTotals(db: DataState, mKey: string): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of db.expense) {
    if (monthOf(entry) !== mKey) continue;
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.amount);
  }
  return totals;
}

/** Items bought again and again — the real "fast movers" in a small shop. */
export function repeatItems(
  db: DataState,
  mKey: string,
  limit = 3,
): { label: string; count: number; total: number }[] {
  const byLabel = new Map<string, { count: number; total: number }>();
  for (const entry of db.expense) {
    if (monthOf(entry) !== mKey) continue;
    const label = entry.detail.trim() || entry.category;
    const current = byLabel.get(label) ?? { count: 0, total: 0 };
    byLabel.set(label, { count: current.count + 1, total: current.total + entry.amount });
  }
  return Array.from(byLabel.entries())
    .map(([label, row]) => ({ label, ...row }))
    .filter((row) => row.count >= 2)
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, limit);
}

export type PurchaseInsight = {
  id: string;
  kind: "budget" | "top" | "rising" | "frequent" | "steady";
  headline: string;
  detail: string;
};

export type InsightOptions = {
  /** Formats a number for the headline (digit style comes from the UI). */
  format?: (value: number) => string;
  limit?: number;
  /** A month needs this much spend before “rising” is meaningful. */
  minimumAmount?: number;
};

export function purchaseInsights(
  db: DataState,
  mKey: string,
  budgets: Budget[],
  options: InsightOptions = {},
): PurchaseInsight[] {
  const format = options.format ?? ((value: number) => String(Math.round(value)));
  const limit = options.limit ?? 4;
  const minimum = options.minimumAmount ?? 500;
  const insights: PurchaseInsight[] = [];

  /* 1. Budgets first — they are the most actionable. */
  for (const status of activeBudgetAlerts(budgetStatus(db, mKey, budgets)).slice(0, 2)) {
    insights.push({
      id: `budget-${status.category}`,
      kind: "budget",
      headline:
        status.level === "danger"
          ? `${status.category}: بجٹ ${format(Math.abs(status.remaining))} روپے سے زیادہ`
          : `${status.category}: بجٹ کا ${Math.round(status.ratio * 100)}% استعمال`,
      detail:
        status.level === "danger"
          ? "اس مہینے مزید خریداری روک کر اگلے ماہ کے لیے بچائیں۔"
          : "مہینے کے باقی دنوں میں اس مد میں ہلکی خریداری رکھیں۔",
    });
  }

  const current = monthlyCategoryTotals(db, mKey);
  const totalExpense = Array.from(current.values()).reduce((a, b) => a + b, 0);

  /* 2. Where the money actually went. */
  if (totalExpense > 0) {
    const [topCategory, topAmount] = Array.from(current.entries()).sort((a, b) => b[1] - a[1])[0];
    insights.push({
      id: `top-${topCategory}`,
      kind: "top",
      headline: `${topCategory}: سب سے بڑی خریداری (${format(topAmount)} روپے)`,
      detail: `کل خرچ کا ${Math.round((topAmount / totalExpense) * 100)}% اسی مد میں گیا۔`,
    });
  }

  /* 3. What is climbing against last month. */
  const previous = monthlyCategoryTotals(db, getPreviousMonthKey(mKey));
  let rising: { category: string; growth: number; amount: number } | null = null;
  for (const [category, amount] of current) {
    const before = previous.get(category) ?? 0;
    if (before < minimum || amount < before * 1.25) continue;
    const growth = Math.round(((amount - before) / before) * 100);
    if (!rising || growth > rising.growth) rising = { category, growth, amount };
  }
  if (rising) {
    insights.push({
      id: `rising-${rising.category}`,
      kind: "rising",
      headline: `${rising.category}: پچھلے مہینے سے ${rising.growth}% زیادہ`,
      detail: `اس ماہ ${format(rising.amount)} روپے — اسٹاک جلدی ختم ہو رہا ہے، بروقت mangwaiyein.`,
    });
  }

  /* 4. Fast movers. */
  const repeat = repeatItems(db, mKey, 1)[0];
  if (repeat && repeat.count >= 3) {
    insights.push({
      id: `frequent-${repeat.label}`,
      kind: "frequent",
      headline: `"${repeat.label}" سب سے زیادہ بار (${repeat.count} بار)`,
      detail: `کل ${format(repeat.total)} روپے — یہ چیز جلدی فروخت ہوتی ہے، اسٹاک رکھیں۔`,
    });
  }

  /* 5. Always give one constructive line. */
  if (insights.length < limit && totalExpense > 0) {
    const average = Math.round(totalExpense / Math.max(1, db.expense.filter((e) => monthOf(e) === mKey).length));
    insights.push({
      id: "steady-average",
      kind: "steady",
      headline: `اوسط خریداری: ${format(average)} روپے فی انٹری`,
      detail: "بڑی ایک ہی خریداری کی جگہ تھوڑی تھوڑی خریداری سے نقدی بہتر رہتی ہے۔",
    });
  }

  return insights.slice(0, limit);
}
