import { formatNumber, type DigitStyle } from "@/lib/khata";
import { t } from "@/lib/i18n";
import { Wallet, TrendingUp, TrendingDown, DollarSign } from "lucide-react";

interface MetricBoxesProps {
  totals: {
    totalIncome: number;
    totalExpense: number;
    balance: number;
    carryForward: number;
  };
  digitStyle?: DigitStyle;
  onOpenHistory: (type: "income" | "expense" | "balance") => void;
}

export function MetricBoxes({ totals, digitStyle = "latin", onOpenHistory }: MetricBoxesProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {/* Carry Forward / Opening Balance */}
      <div 
        onClick={() => onOpenHistory("balance")}
        className="bg-white/5 border border-white/10 rounded-2xl p-3.5 backdrop-blur-xl cursor-pointer hover:bg-white/10 transition group"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/60 font-medium">{t("openingBalance")}</span>
          <div className="w-7 h-7 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400">
            <Wallet className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-bold text-white group-hover:text-purple-300 transition">
          {formatNumber(totals.carryForward, digitStyle)}
        </div>
      </div>

      {/* Total Income */}
      <div 
        onClick={() => onOpenHistory("income")}
        className="bg-white/5 border border-white/10 rounded-2xl p-3.5 backdrop-blur-xl cursor-pointer hover:bg-white/10 transition group"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/60 font-medium">{t("totalIncome")}</span>
          <div className="w-7 h-7 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-bold text-emerald-400 group-hover:text-emerald-300 transition">
          {formatNumber(totals.totalIncome, digitStyle)}
        </div>
      </div>

      {/* Total Expense */}
      <div 
        onClick={() => onOpenHistory("expense")}
        className="bg-white/5 border border-white/10 rounded-2xl p-3.5 backdrop-blur-xl cursor-pointer hover:bg-white/10 transition group"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/60 font-medium">{t("totalExpense")}</span>
          <div className="w-7 h-7 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-400">
            <TrendingDown className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="text-base font-bold text-rose-400 group-hover:text-rose-300 transition">
          {formatNumber(totals.totalExpense, digitStyle)}
        </div>
      </div>

      {/* Net Balance */}
      <div 
        onClick={() => onOpenHistory("balance")}
        className="bg-white/5 border border-white/10 rounded-2xl p-3.5 backdrop-blur-xl cursor-pointer hover:bg-white/10 transition group"
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-white/60 font-medium">{t("balance")}</span>
          <div className="w-7 h-7 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400">
            <DollarSign className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className={`text-base font-bold ${totals.balance >= 0 ? "text-sky-300" : "text-amber-300"} group-hover:opacity-80 transition`}>
          {formatNumber(totals.balance, digitStyle)}
        </div>
      </div>
    </div>
  );
}
