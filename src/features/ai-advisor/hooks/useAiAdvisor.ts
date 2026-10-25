import { useState, type ReactNode } from "react";
import { type AiInsight } from "@/lib/khata";
import { logError } from "@/lib/logger";

interface UseAiAdvisorOptions {
  monthName: string;
  totals: {
    totalIncome: number;
    totalExpense: number;
    balance: number;
    carryForward: number;
  };
  breakdown: { category: string; icon: string; amount: number; share: number }[];
  announce?: (display: ReactNode, speechText?: string) => void;
}

export function useAiAdvisor({ monthName, totals, breakdown, announce }: UseAiAdvisorOptions) {
  const [aiBusy, setAiBusy] = useState(false);
  const [insight, setInsight] = useState<AiInsight | null>(null);

  // The stub answers a fixed monthly brief; spoken questions arrive via
  // `onAskAi` but only signal intent — carrying the raw question forward would
  // imply the stub actually reads it.
  const runAi = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 800));
      const savingsRate = totals.totalIncome > 0 ? ((totals.totalIncome - totals.totalExpense) / totals.totalIncome) * 100 : 0;
      const topCat = breakdown[0]?.category || "متفرق";

      const riskLevel: "low" | "medium" | "high" = totals.totalExpense > totals.totalIncome ? "high" : savingsRate < 10 ? "medium" : "low";
      
      const summaryText = `آپ کے مالی سالانہ جائزے کے مطابق (${monthName}): کل آمدنی ${totals.totalIncome} روپے اور کل اخراجات ${totals.totalExpense} روپے ہیں۔ سب سے بڑا خرچہ ${topCat} پر ہوا ہے۔`;
      
      const result: AiInsight = {
        title: `مالیاتی تجزیہ — ${monthName}`,
        spoken: summaryText,
        insight: summaryText,
        topCategory: topCat,
        riskLevel,
      };

      setInsight(result);
      if (announce) {
        announce(summaryText, summaryText);
      }
    } catch (err) {
      logError("ai", "AI Advisor error", err);
    } finally {
      setAiBusy(false);
    }
  };

  return {
    aiBusy,
    insight,
    runAi,
  };
}
