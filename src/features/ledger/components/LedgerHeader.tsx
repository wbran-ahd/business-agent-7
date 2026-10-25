import { formatMonthName } from "@/lib/khata";
import { t } from "@/lib/i18n";
import { ShieldAlert, Sparkles, Store, Settings, BarChart3 } from "lucide-react";

interface LedgerHeaderProps {
  activeMonth: string;
  monthOptions: string[];
  onSelectMonth: (month: string) => void;
  aiBusy: boolean;
  onRunAiOrAdvice: () => void;
  onOpenAnalytics: () => void;
  onOpenShop: () => void;
  isStaff: boolean;
  onOpenExport: () => void;
  onOpenSettings: () => void;
  onUnlockStaff: () => void;
  onExportCsv: () => void;
  listening?: boolean;
  onToggleVoice?: () => void;
  onOpenHelp?: () => void;
}

export function LedgerHeader({
  activeMonth,
  monthOptions,
  onSelectMonth,
  aiBusy,
  onRunAiOrAdvice,
  onOpenAnalytics,
  onOpenShop,
  isStaff,
  onOpenSettings,
  onUnlockStaff,
}: LedgerHeaderProps) {
  return (
    <header className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-6">
      {/* Controls & Actions */}
      <div className="flex items-center flex-wrap gap-2">
        {/* Month Selector */}
        <select
          value={activeMonth}
          onChange={(e) => onSelectMonth(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500"
        >
          {monthOptions.map((m) => (
            <option key={m} value={m} className="bg-slate-900 text-white">
              {formatMonthName(m)}
            </option>
          ))}
        </select>

        {/* Shop Panel Button */}
        <button
          onClick={onOpenShop}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-xs font-medium transition"
        >
          <Store className="w-3.5 h-3.5" />
          <span>دوکان</span>
        </button>

        {/* Analytics Button */}
        <button
          onClick={onOpenAnalytics}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-medium transition"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>{t("charts")}</span>
        </button>

        {/* AI Advice Button */}
        <button
          onClick={onRunAiOrAdvice}
          disabled={aiBusy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 text-xs font-medium transition disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{aiBusy ? t("thinking") : t("advice")}</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 transition"
          title="سیٹنگز"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Staff Pin / Lock */}
        <button
          onClick={onUnlockStaff}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition ${
            isStaff
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
              : "bg-white/5 border border-white/10 text-white/80 hover:bg-white/10"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>{isStaff ? "اسٹاف موڈ" : "ایڈمن"}</span>
        </button>
      </div>
    </header>
  );
}
