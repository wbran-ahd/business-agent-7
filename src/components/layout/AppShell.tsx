import { ReactNode } from "react";
import { Link } from "react-router";
import logo from "@/assets/logo.svg";
import {
  BarChart3,
  Menu,
  Mic,
  Settings,
  Store,
  TrendingDown,
  Wallet,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatNumber, type DigitStyle, type EntryType } from "@/lib/khata";
import { t } from "@/lib/i18n";

export type NavId = "ledger" | EntryType | "analytics" | "settings" | "shop";

interface AppShellProps {
  activeView: NavId;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  isStaff: boolean;
  user: { name?: string | null } | null;
  isCurrentMonth: boolean;
  monthName: string;
  totals: {
    balance: number;
    totalIncome: number;
    totalExpense: number;
  };
  digitStyle: DigitStyle;
  onNavigate: (view: NavId) => void;
  children: ReactNode;
}

export function AppShell({
  activeView,
  navOpen,
  setNavOpen,
  isStaff,
  user,
  isCurrentMonth,
  monthName,
  totals,
  digitStyle,
  onNavigate,
  children,
}: AppShellProps) {
  const navItems: { id: NavId; label: string; icon: typeof Mic }[] = [
    { id: "ledger", label: "کھاتہ", icon: Mic },
    { id: "income", label: t("totalIncome"), icon: Wallet },
    { id: "expense", label: t("totalExpense"), icon: TrendingDown },
    { id: "analytics", label: t("charts"), icon: BarChart3 },
    { id: "shop", label: "دکان (گاہک/سپلائر)", icon: Store },
    { id: "settings", label: "سیٹنگز", icon: Settings },
  ];

  const visibleNavItems = isStaff
    ? navItems.filter((item) => item.id !== "settings")
    : navItems;

  const renderBrand = (
    <Link to="/" className="flex items-center gap-2.5" aria-label="صفحۂ اول">
      <img
        src={logo}
        alt="صوتی بقیہ"
        className="size-9 rounded-xl border border-white/15"
      />
      <span className="leading-tight">
        <span className="nastaliq block text-sm text-white">صوتی بقیہ</span>
        <span className="block font-sans text-[10px] text-white/40">
          اردو وائس فنانس اسسٹنٹ
        </span>
      </span>
    </Link>
  );

  const renderNavList = (
    <nav className="flex flex-col gap-1.5" aria-label="مینو">
      {visibleNavItems.map((item) => {
        const active = activeView === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onNavigate(item.id);
              setNavOpen(false);
            }}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-right text-sm font-bold transition ${
              active
                ? "border-sky-400/40 bg-sky-500/15 text-sky-200"
                : "border-transparent text-white/65 hover:border-white/10 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );

  const userLabel = user?.name || "مہمان صارف";
  const renderUserBlock = (
    <div className="flex items-center gap-2.5 border-t border-white/10 pt-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/15 text-sm font-bold text-sky-200">
        {userLabel.trim().charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-xs font-bold text-white/85">{userLabel}</span>
        <span className="block truncate font-sans text-[10px] text-white/40">
          کلاؤڈ سینک فعال
        </span>
      </span>
    </div>
  );

  const renderSummaryBlock = (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="font-sans text-[10px] uppercase tracking-widest text-white/40">
        {isCurrentMonth ? t("currentMonth") : t("archivedMonth")}
      </p>
      <p className="nastaliq mt-0.5 text-xs text-white/60">{monthName}</p>
      <p className="mt-1.5 text-xl font-bold text-white">
        {formatNumber(totals.balance, digitStyle)}
        <span className="nastaliq mr-1 text-xs font-normal text-white/50">روپے</span>
      </p>
      <div className="mt-2 flex items-center justify-between font-sans text-[11px]">
        <span className="text-emerald-300/90">
          ↑ {formatNumber(totals.totalIncome, digitStyle)}
        </span>
        <span className="text-rose-300/90">
          ↓ {formatNumber(totals.totalExpense, digitStyle)}
        </span>
      </div>
    </div>
  );

  return (
    <div dir="rtl" className="sauti-app min-h-dvh">
      <div className="ambient-bg" />

      <div className="relative z-10 flex min-h-dvh w-full">
        {/* Sidebar — desktop */}
        <aside className="hidden w-64 shrink-0 flex-col gap-5 border-l border-white/10 bg-black/25 p-4 backdrop-blur-xl lg:flex">
          {renderBrand}
          {renderNavList}
          <div className="mt-auto flex flex-col gap-3">
            {renderSummaryBlock}
            {renderUserBlock}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar — mobile */}
          <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/70 px-4 pb-3 pt-[calc(env(safe-area-inset-top)_+_0.75rem)] backdrop-blur-xl lg:hidden">
            {renderBrand}
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="مینو کھولیں"
              className="rounded-xl border border-white/15 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <Menu className="size-5" />
            </button>
          </header>

          {/* Full-bleed content well: no gutters here at all. The panel stretches
              to every remaining pixel of the viewport, edge to edge. The content
              gutter and the safe-area handling live *inside* the panel so the
              glass reaches the true display bounds while content stays clear of
              notches, rounded corners and the iOS home bar. */}
          <main className="flex flex-1 items-stretch justify-center">
            {children}
          </main>
        </div>
      </div>

      {/* Navigation — mobile */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="right"
          className="gap-4 border-l border-white/15 bg-slate-950/95 text-white backdrop-blur-xl"
        >
          <SheetHeader className="pb-1">
            <SheetTitle className="text-white">مینو</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {renderNavList}
            <div className="flex flex-col gap-3">
              {renderSummaryBlock}
              {renderUserBlock}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
