/**
 * صوتی بقیہ — پاور فل اے آئی منشی
 * Voice-controlled Urdu finance assistant (income / expense / balance).
 *
 * Refactored using Domain-Driven Design (DDD) feature isolation:
 *   • `AppShell`            Responsive desktop/mobile layout shell with zero styling deviation
 *   • `features/ledger`     Ledger header, voice center, HorizonArc, MetricBoxes, NotepadModal
 *   • `features/analytics`  AnalyticsModal with Chart.js visualization, insights & report exports
 *   • `features/settings`   SettingsModal with cloud sync, API keys, budgets & PIN lock
 *   • `features/ai-advisor` AI Munshi conversational interface & prompt controllers
 *   • `features/shop`       Shop floor, customer/supplier udhaar (PartyBook), daybook
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { AppShell, type NavId } from "@/components/layout/index";
import {
  LedgerHeader,
  LedgerVoiceCenter,
  NotepadModal,
  type Draft,
} from "@/features/ledger/index";
import { AnalyticsModal } from "@/features/analytics/index";
import { SettingsModal } from "@/features/settings/index";
import { ShopPanel, type ShopTab } from "@/features/shop/index";
import { useAiAdvisor } from "@/features/ai-advisor/index";
import { StaffPinModal, type PinMode } from "@/components/sauti/StaffPinModal";
import { Onboarding } from "@/components/sauti/Onboarding";
import { ExportModal } from "@/components/sauti/ExportModal";
import { useBackupReminder } from "@/hooks/use-backup-reminder";
import { useKhata } from "@/hooks/use-khata";
import { usePwa } from "@/hooks/use-pwa";
import { useStaffLock } from "@/hooks/use-staff-lock";
import { useSync } from "@/hooks/use-sync";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/lib/notifications";
import { supportUrl, BRAND } from "@/lib/brand";
import {
  buildReport,
  downloadBlob,
  reportFileBase,
  reportHtml,
  xlsxBlob,
} from "@/lib/export-report";
import { printHtmlDocument } from "@/lib/print";
import {
  finishOnboarding,
  loadOnboarding,
  persistOnboarding,
  secondsSpent,
  shouldShowOnboarding,
  skipOnboarding,
  startOnboarding,
  type OnboardingStep,
} from "@/lib/onboarding";
import {
  buildFieldReport,
  clearEvents,
  installId,
  loadEvents,
  track,
} from "@/lib/telemetry";
import {
  activeBudgetAlerts,
  budgetStatus,
  purchaseInsights,
} from "@/lib/insights";
import {
  budgetNoticeText,
  markBudgetNotified,
  nextBudgetNotice,
} from "@/lib/budget-notices";
import {
  type AccountKind,
  buildCsv,
  dedupeEntries,
  detectCategory,
  entriesFromCsv,
  formatMonthName,
  formatNumber,
  getCurrentMonthKey,
  monthOf,
  nextId,
  type DataState,
  type Entry,
  type EntryType,
  LEGACY_API_KEY_STORAGE,
} from "@/lib/khata";
import { t } from "@/lib/i18n";
import { logError } from "@/lib/logger";

/** First-run tour state */
function initialTourState() {
  const loaded = loadOnboarding();
  if (!shouldShowOnboarding(loaded)) return loaded;
  const started = startOnboarding(loaded);
  persistOnboarding(started);
  return started;
}

/** Mirrors a recurring rule into a local entry for the current month. */
function khataDraftToEntry(
  label: string,
  amount: number,
  kind: EntryType = "income",
): Entry {
  const now = new Date();
  return {
    id: nextId(),
    amount,
    detail: label,
    category: kind === "income" ? "ماہانہ آمدنی" : "ماہانہ خرچہ",
    icon: kind === "income" ? "fa-money-bill-wave" : "fa-file-invoice-dollar",
    monthKey: getCurrentMonthKey(),
    date: now.toLocaleDateString("ur-PK"),
    time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
    timestamp: now.getTime(),
  };
}

export default function SautiBaqaya() {
  const khata = useKhata();
  const sync = useSync(khata.data);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  // "balance" is the read-only متوسط view MetricBoxes opens — NotepadModal's
  // actual prop type (EntryType | "balance" | null) is the truth here.
  const [historyType, setHistoryType] = useState<EntryType | "balance" | null>(
    null,
  );
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopTab, setShopTab] = useState<ShopTab>("customers");
  const [pinOpen, setPinOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("unlock");
  const [budgetDismissed, setBudgetDismissed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const staff = useStaffLock();
  const backup = useBackupReminder();
  const pwa = usePwa();
  const [onboarding, setOnboarding] = useState(initialTourState);
  const [onboardingOpen, setOnboardingOpen] = useState(() =>
    shouldShowOnboarding(onboarding),
  );

  const { notifySuccess, notifyWarning } = useNotifications();

  // Ref to route announcer to voice assistant once initialized
  const announceRef = useRef<((display: ReactNode, speechText?: string) => void) | null>(null);

  /* ---- AI Advisor (Domain-Driven) -------------------------------------- */
  const ai = useAiAdvisor({
    monthName: khata.monthName,
    totals: khata.totals,
    breakdown: khata.breakdown,
    announce: (display: ReactNode, speechText?: string) =>
      announceRef.current?.(display, speechText),
  });

  /* ---- Voice Assistant wiring ------------------------------------------ */
  const voice = useVoiceAssistant({
    onCommit: (type, amount, detail) => {
      const ok = khata.addEntry({ type, amount, detail });
      if (ok) {
        track("entry_voice", { type });
        speakBudgetWarning(type, amount, detail);
      }
      return ok;
    },
    onUndo: () => {
      if (khata.data.undoStack.length === 0) return false;
      khata.undo();
      return true;
    },
    onAskAi: () => {
      void ai.runAi();
    },
    ttsEnabled: khata.prefs.ttsEnabled,
    ttsRate: khata.prefs.ttsRate,
  });

  // Keep announcer ref fresh (assignments that touched the ref during render
  // are the exact pattern the react-hooks/refs rule flags; effect timing gives
  // the same freshness without reading refs mid-render).
  useEffect(() => {
    announceRef.current = voice.announce;
  });

  function handleUndoButton() {
    const removed = khata.data.undoStack.length > 0;
    if (removed) khata.undo();
    const message = removed ? t("undoDone") : t("undoEmpty");
    voice.announce(<span className="text-amber-300 font-bold">{message}</span>, message);
  }

  /* ---- Recurring entries mirror ---------------------------------------- */
  useEffect(() => {
    if (!sync.isAuthenticated || sync.recurring.length === 0) return;
    const monthKey = getCurrentMonthKey();
    const monthHas = (list: Entry[], entry: { label: string; amount: number }) =>
      list.some(
        (i) => monthOf(i) === monthKey && i.detail === entry.label && i.amount === entry.amount,
      );
    const due = sync.recurring.filter((entry) => {
      if (!entry.enabled) return false;
      const kind = entry.kind ?? "income";
      return !monthHas(kind === "income" ? khata.data.income : khata.data.expense, entry);
    });
    if (due.length === 0) return;
    khata.merge(
      due
        .filter((entry) => (entry.kind ?? "income") === "income")
        .map((entry) => khataDraftToEntry(entry.label, entry.amount, "income")),
      due
        .filter((entry) => entry.kind === "expense")
        .map((entry) => khataDraftToEntry(entry.label, entry.amount, "expense")),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.isAuthenticated, sync.recurring, khata.data.income, khata.data.expense]);

  /* ---- First-run tour -------------------------------------------------- */
  useEffect(() => {
    if (onboardingOpen) track("onboarding_start");
  }, [onboardingOpen]);

  function handleTourFinish() {
    setOnboarding((current) => {
      const next = finishOnboarding(current);
      persistOnboarding(next);
      track("onboarding_done", { seconds: secondsSpent(next) });
      return next;
    });
    setOnboardingOpen(false);
  }

  function handleTourSkip() {
    setOnboarding((current) => {
      const next = skipOnboarding(current);
      persistOnboarding(next);
      track("onboarding_skip", { step: current.step });
      return next;
    });
    setOnboardingOpen(false);
  }

  function handleTourAction(step: OnboardingStep) {
    setOnboardingOpen(false);
    if (step.id === "shop") openShop("customers");
    else if (step.id === "backup") {
      pushOverlayHistory();
      setSettingsOpen(true);
    }
    track("onboarding_action", { step: step.id });
  }

  /* ---- Monthly report, Excel and field diagnostics ---------------------- */
  function monthlyReport() {
    return buildReport({
      data: khata.data,
      monthKey: khata.activeMonth,
      owner: user?.name ?? "",
      generatedAt: new Date(),
    });
  }

  function exportReportPdf() {
    const model = monthlyReport();
    const rows = model.income.length + model.expense.length;
    const ok = printHtmlDocument(
      reportHtml(model, (value) => formatNumber(value, khata.prefs.digitStyle)),
    );
    track("export_pdf", { ok, rows });
    if (!ok) notifyWarning("پرنٹ ونڈو نہیں کھل سکی", "براہِ کرم دوبارہ کوشش کریں۔");
  }

  function exportReportExcel() {
    const model = monthlyReport();
    const rows = model.income.length + model.expense.length;
    downloadBlob(
      xlsxBlob(model.sheets, model.generatedAt),
      `${reportFileBase(model.monthKey)}.xlsx`,
    );
    backup.backedUp();
    track("export_xlsx", { rows, sheets: model.sheets.length });
    notifySuccess("Excel فائل ڈاؤن لوڈ ہو گئی", `${model.monthLabel} — خلاصہ، آمدنی، خرچہ`);
  }

  function exportDiagnostics() {
    const report = buildFieldReport({
      events: loadEvents(),
      version: BRAND.version,
      installId: installId(),
    });
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `sauti-baqaya-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    );
    track("diagnostics_export", { events: report.events.length });
    notifySuccess("تشخیصی رپورٹ محفوظ ہو گئی", "اس میں رقم یا نام شامل نہیں ہیں۔");
  }

  function clearDiagnostics() {
    clearEvents();
    notifySuccess("لاگ صاف ہو گیا", "مقامی تشخیصی ریکارڈ خالی کر دیا گیا ہے۔");
  }

  /* ---- Ledger modal triggers ------------------------------------------- */
  // MetricBoxes opens the balance view too (NotepadModal's "balance" tab), so
  // the panel type is the full union, not just EntryType.
  function openModal(type: EntryType | "balance") {
    pushOverlayHistory();
    setHistoryType(type);
    khata.clearValidationError();
  }

  function handleAddManual(type: EntryType, draft: Draft): boolean {
    const detail = draft.detail;
    const ok = khata.addEntry({
      type,
      amount: Number.parseFloat(draft.amount),
      detail,
      category: draft.category,
      account: draft.account,
    });
    if (ok) {
      track("entry_manual", { type, category: draft.category });
      afterEntryAdded(type, Number.parseFloat(draft.amount), detail || draft.category);
    }
    return ok;
  }

  function handleUpdateEntry(type: EntryType, id: number, draft: Draft): boolean {
    return khata.updateEntry(type, id, {
      type,
      amount: Number.parseFloat(draft.amount),
      detail: draft.detail,
      category: draft.category,
      account: draft.account,
    });
  }

  /* ---- Budget warnings ------------------------------------------------- */
  function pendingBudgetWarning(
    type: EntryType,
    amount: number,
    detail: string,
  ): string | null {
    if (type !== "expense") return null;
    const preview: DataState = {
      ...khata.data,
      expense: [
        ...khata.data.expense,
        {
          id: -1,
          amount,
          detail,
          category: detectCategory(detail).name,
          icon: "fa-receipt",
          monthKey: khata.activeMonth,
          date: "",
          time: "",
          timestamp: Date.now(),
        },
      ],
    };
    const notice = nextBudgetNotice(
      budgetStatus(preview, khata.activeMonth, sync.budgets),
      khata.activeMonth,
    );
    if (!notice) return null;
    markBudgetNotified(notice.key);
    return budgetNoticeText(notice.status, (value) =>
      formatNumber(value, khata.prefs.digitStyle),
    );
  }

  function speakBudgetWarning(type: EntryType, amount: number, detail: string) {
    const warning = pendingBudgetWarning(type, amount, detail);
    if (!warning) return;
    voice.announce(
      <span className="text-rose-300 text-sm font-bold">⚠ {warning}</span>,
      warning,
    );
  }

  function afterEntryAdded(type: EntryType, amount: number, detail: string) {
    const confirmation = `${amount} روپے درج ہو گئے۔`;
    const warning = pendingBudgetWarning(type, amount, detail);
    voice.announce(
      <>
        <span className="text-emerald-300 text-sm font-bold">✓ {confirmation}</span>
        {warning && (
          <>
            <br />
            <span className="text-rose-300 text-sm font-bold">⚠ {warning}</span>
          </>
        )}
      </>,
      warning ? `${confirmation} ${warning}` : confirmation,
    );
  }

  /* ---- Backup & restore ------------------------------------------------ */
  function exportData() {
    const blob = new Blob([buildCsv(khata.data)], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sauti_baqaya_ultimate_report.csv";
    a.click();
    window.URL.revokeObjectURL(url);
    backup.backedUp();
    track("export_csv");
  }

  function shareWhatsApp() {
    const monthName = formatMonthName(khata.activeMonth);
    let msg = `*📒 صوتی بقیہ - الٹیمیٹ پورٹ رپورٹ (${monthName})*\n`;
    msg += `-----------------------------------\n`;
    if (khata.totals.carryForward > 0) {
      msg += `📌 پچھلا بقایا کیش: Rs. ${khata.totals.carryForward}\n`;
    }
    msg += `💰 کل رقم: Rs. ${khata.totals.totalIncome}\n`;
    msg += `💸 کل خرچہ: Rs. ${khata.totals.totalExpense}\n`;
    msg += `💵 موجودہ بقایا: Rs. ${khata.totals.balance}\n`;
    track("share_whatsapp", { source: "ledger" });
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    // A 500 MB stray download must never reach FileReader (audit #31).
    if (file.size > 2 * 1024 * 1024) {
      setImportMsg("فائل 2 MB سے بڑی ہے — چھوٹی CSV/JSON فائل منتخب کریں۔");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        if (file.name.toLowerCase().endsWith(".json")) {
          const parsed = JSON.parse(text) as Partial<{ income: Entry[]; expense: Entry[] }>;
          const income = dedupeEntries(
            khata.data.income,
            Array.isArray(parsed.income) ? parsed.income : [],
          );
          const expense = dedupeEntries(
            khata.data.expense,
            Array.isArray(parsed.expense) ? parsed.expense : [],
          );
          khata.merge(income, expense);
          setImportMsg(`JSON سے ${income.length + expense.length} نئی انٹریز درج ہو گئیں۔`);
        } else {
          const { income: rawIncome, expense: rawExpense } = entriesFromCsv(text);
          const income = dedupeEntries(khata.data.income, rawIncome);
          const expense = dedupeEntries(khata.data.expense, rawExpense);
          khata.merge(income, expense);
          setImportMsg(`CSV سے ${income.length + expense.length} نئی انٹریز درج ہو گئیں۔`);
        }
      } catch (error) {
        logError("import", "file could not be read", error);
        setImportMsg("فائل پڑھی نہیں جا سکی — براہِ کرم درست CSV/JSON فائل منتخب کریں۔");
      }
    };
    reader.readAsText(file);
  }

  /* ---- Settings handlers ----------------------------------------------- */
  function openSettings() {
    localStorage.removeItem(LEGACY_API_KEY_STORAGE);
    setApiKeyDraft(sync.hasCloudKey ? "••••••••" : "");
    pushOverlayHistory();
    setSettingsOpen(true);
    setImportMsg("");
    sync.setStatus("");
  }

  async function saveApiKey() {
    const key = apiKeyDraft.trim();
    if (!key || key === "••••••••") {
      setSettingsOpen(false);
      return;
    }
    if (!sync.isAuthenticated) {
      sync.setStatus(t("aiKeyNeedsActivation"));
      setSettingsOpen(false);
      return;
    }
    const ok = await sync.saveGeminiKey(key);
    localStorage.removeItem(LEGACY_API_KEY_STORAGE);
    setSettingsOpen(false);
    if (ok) voice.speak(t("aiKeySavedVoice"));
  }

  async function handleUpload() {
    if (!sync.isAuthenticated) {
      sync.setStatus("پہلے ایپ ایکٹیویٹ کریں تاکہ ڈیٹا کلاؤڈ پر محفوظ ہو۔");
      return;
    }
    const ok = await sync.upload();
    if (ok) {
      backup.backedUp();
      notifySuccess("کلاؤڈ سینک محفوظ ہو گئی", sync.status);
    } else {
      notifyWarning("سینک مکمل نہیں ہو سکی", sync.status);
    }
  }

  function handleDownload() {
    const pulled = sync.download();
    if (pulled) khata.replaceAll(pulled.income, pulled.expense);
  }

  /* ---- Spending signals & derivations ----------------------------------- */
  const alerts = khata.alertsFor(sync.budgets);
  const budgetStatuses = budgetStatus(khata.data, khata.activeMonth, sync.budgets);
  const budgetAlerts = activeBudgetAlerts(budgetStatuses);
  const insights = purchaseInsights(khata.data, khata.activeMonth, sync.budgets, {
    format: (value) => formatNumber(value, khata.prefs.digitStyle),
  });

  /* ---- Navigation orchestration ---------------------------------------- */
  // "balance" panel سائیڈبار کی کوئی nav entry نہیں — وہ ledger view کے اوپر
  // جانے والا modal ہے، اس لیے active highlight ledger پر ہی رہتا ہے؛
  // income/expense کا highlight ویسا ہی برقرار ہے (pass-through)۔
  const activeView: NavId = shopOpen
    ? "shop"
    : analyticsOpen
      ? "analytics"
      : settingsOpen
        ? "settings"
        : historyType === "balance"
          ? "ledger"
          : (historyType ?? "ledger");

  function goHome() {
    setHistoryType(null);
    setAnalyticsOpen(false);
    setSettingsOpen(false);
    setShopOpen(false);
    setNavOpen(false);
  }

  function openShop(tab: ShopTab) {
    pushOverlayHistory();
    setShopTab(tab);
    setShopOpen(true);
    setHistoryType(null);
    setAnalyticsOpen(false);
    setSettingsOpen(false);
    setNavOpen(false);
  }

  /* ---- Back-button closes overlays (audit #20) ------------------------- */
  // ایپ کے سب overlays اسی ایک روٹ پر کھلتے ہیں، اس ليے براؤزر back پہلے ایپ
  // چھوڑ دیتا تھا۔ اب ہر overlay open ایک history entry push کرتا ہے اور back
  // اس entry پر overlays بند کر دیتا ہے — ایپ کا صفحه ویسے ہی رہتا ہے۔
  function pushOverlayHistory() {
    window.history.pushState({ sautiOverlay: true }, "");
  }

  useEffect(() => {
    function onPopState() {
      setHistoryType(null);
      setAnalyticsOpen(false);
      setSettingsOpen(false);
      setShopOpen(false);
      setNavOpen(false);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      navigate("/");
    }
  }

  function handleNavigate(id: NavId) {
    if (id === "ledger") {
      goHome();
    } else if (id === "income" || id === "expense") {
      openModal(id);
    } else if (id === "analytics") {
      pushOverlayHistory();
      setAnalyticsOpen(true);
    } else if (id === "shop") {
      openShop("customers");
    } else if (id === "settings") {
      openSettings();
    }
  }

  return (
    <AppShell
      activeView={activeView}
      navOpen={navOpen}
      setNavOpen={setNavOpen}
      isStaff={staff.isStaff}
      user={user}
      isCurrentMonth={khata.isCurrentMonth}
      monthName={khata.monthName}
      totals={khata.totals}
      digitStyle={khata.prefs.digitStyle}
      onNavigate={handleNavigate}
      onSignOut={() => void handleSignOut()}
    >
      {/* Main Glass Panel — edge-to-edge with square outer corners. The width
          cap and the outer padding wrapper used to box it inside the screen,
          leaving ambient background and curved gaps at the device corners.
          Cap, wrapper gutters and the outer border radius are all gone: the
          glass now meets the exact mobile screen boundary with sharp corners,
          while the same gutter sits *inside* the panel (identical values), so
          every text box, metric card and button keeps its exact screen
          position. Height stays automatic: content taller than the screen
          grows the panel and scrolls the page rather than being clipped.
          The radius override is inline because `.sauti-app .glass-panel`
          (specificity 0-2-0, unlayered) beats any single-class utility. */}
      <div
        style={{ borderRadius: 0 }}
        className="glass-panel relative flex w-full min-w-0 flex-col overflow-hidden pt-2.5 pb-[calc(env(safe-area-inset-bottom)_+_0.625rem)] pl-[max(env(safe-area-inset-left),0.625rem)] pr-[max(env(safe-area-inset-right),0.625rem)] sm:p-6"
      >
        {/* Header Section */}
        <LedgerHeader
          activeMonth={khata.activeMonth}
          monthOptions={khata.monthOptions}
          onSelectMonth={khata.setActiveMonth}
          aiBusy={ai.aiBusy}
          onRunAiOrAdvice={() => void ai.runAi()}
          onOpenAnalytics={() => {
            pushOverlayHistory();
            setAnalyticsOpen(true);
          }}
          onOpenShop={() => openShop("customers")}
          isStaff={staff.isStaff}
          onOpenExport={() => {
            pushOverlayHistory();
            setExportOpen(true);
          }}
          onOpenSettings={openSettings}
          onUnlockStaff={() => {
            staff.clearError();
            setPinMode("unlock");
            pushOverlayHistory();
            setPinOpen(true);
          }}
          onExportCsv={exportData}
        />

        {/* Center content & glowing mic section — this wrapper fills the
            remaining panel height and centres the block vertically, so the
            mic sits in the middle of the screen instead of near the top. */}
        <div className="flex flex-1 flex-col justify-center">
          <LedgerVoiceCenter
            pwa={pwa}
            backupDue={backup.due}
            onBackup={() => {
              exportData();
              notifySuccess("بیک اپ ڈاؤن لوڈ ہو گیا", "اگلی یاد دہانی سات دن بعد آئے گی۔");
            }}
            onSnoozeBackup={() => backup.snooze()}
            budgetDismissed={budgetDismissed}
            budgetAlerts={budgetAlerts}
            onDismissBudgetAlerts={() => setBudgetDismissed(true)}
            totals={khata.totals}
            digitStyle={khata.prefs.digitStyle}
            isCurrentMonth={khata.isCurrentMonth}
            onOpenModal={openModal}
            transcript={voice.transcript}
            onUndo={handleUndoButton}
            prefs={khata.prefs}
            onQuickCommit={(input: {
              type: EntryType;
              amount: number;
              detail: string;
              category?: string;
              account?: AccountKind;
            }) => {
              const ok = khata.addEntry({
                type: input.type,
                amount: input.amount,
                detail: input.detail,
                category: input.category,
                account: input.account,
              });
              if (ok) {
                track("entry_quick", { type: input.type });
                afterEntryAdded(input.type, input.amount, input.detail);
              }
              return ok;
            }}
            voiceListening={voice.listening}
            onToggleVoice={voice.toggle}
          />
        </div>
      </div>

      {/* Notepad Details Modal */}
      <NotepadModal
        historyType={historyType}
        onClose={() => setHistoryType(null)}
        activeMonth={khata.activeMonth}
        carryForward={khata.totals.carryForward}
        income={khata.data.income}
        expense={khata.data.expense}
        digitStyle={khata.prefs.digitStyle}
        knownCategories={khata.knownCategories}
        isStaff={staff.isStaff}
        validationError={khata.validationError}
        clearValidationError={khata.clearValidationError}
        onAddManual={handleAddManual}
        onUpdateEntry={handleUpdateEntry}
        onRemoveEntry={(type: EntryType, id: number) => khata.removeEntry(type, id)}
        onShareWhatsApp={shareWhatsApp}
      />

      {/* Analytics Charts Modal */}
      <AnalyticsModal
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        totals={khata.totals}
        trend={khata.trend}
        breakdown={khata.breakdown.map((b) => ({
          category: b.category,
          amount: b.amount,
          percentage: b.share,
        }))}
        insights={insights}
        alerts={alerts}
        digitStyle={khata.prefs.digitStyle}
        aiHasKey={sync.aiHasKey}
        aiRemaining={sync.aiRemaining}
        aiBusy={ai.aiBusy}
        aiError={null}
        insight={ai.insight}
        onRunAi={() => void ai.runAi()}
        onExportPdf={exportReportPdf}
        onExportExcel={exportReportExcel}
      />

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKeyDraft={apiKeyDraft}
        setApiKeyDraft={setApiKeyDraft}
        onSaveApiKey={() => void saveApiKey()}
        digitStyle={khata.prefs.digitStyle}
        onSetDigitStyle={khata.setDigitStyle}
        budgets={sync.budgets}
        setBudgets={sync.setBudgets}
        onPersistSettings={() => void sync.persistSettings()}
        recurring={sync.recurring}
        setRecurring={sync.setRecurring}
        onExportCsv={exportData}
        onImportFile={handleImportFile}
        importMsg={importMsg}
        isAuthenticated={sync.isAuthenticated}
        syncBusy={sync.busy}
        cloudVersion={sync.cloudVersion}
        syncStatus={sync.status}
        capWarning={sync.capWarning}
        uploadConfirmOpen={uploadConfirmOpen}
        setUploadConfirmOpen={setUploadConfirmOpen}
        onConfirmUpload={handleUpload}
        onDownload={handleDownload}
        onSignOut={() => void sync.signOut()}
        ttsEnabled={khata.prefs.ttsEnabled}
        onSetTtsEnabled={khata.setTtsEnabled}
        ttsRate={khata.prefs.ttsRate}
        onSetTtsRate={khata.setTtsRate}
        activeMonth={khata.activeMonth}
        onExportReportPdf={exportReportPdf}
        onExportReportExcel={exportReportExcel}
        onExportDiagnostics={exportDiagnostics}
        onClearDiagnostics={clearDiagnostics}
        hasPin={staff.hasPin}
        staffError={staff.error}
        pinOpen={pinOpen}
        onOpenPin={(mode: PinMode) => {
          staff.clearError();
          setPinMode(mode);
          pushOverlayHistory();
          setPinOpen(true);
        }}
        onLockSalesman={() => {
          if (!staff.lockOwner()) return;
          setSettingsOpen(false);
          notifyWarning(
            "سیلز مین موڈ آن ہے",
            "مالک موڈ میں واپس آنے کے لیے PIN درکار ہوگا۔",
          );
        }}
      />

      {/* 60-second first-run tour */}
      <Onboarding
        open={onboardingOpen}
        step={onboarding.step}
        onStep={(step) => {
          setOnboarding((current) => {
            const next = { ...current, step };
            persistOnboarding(next);
            return next;
          });
        }}
        onFinish={handleTourFinish}
        onSkip={handleTourSkip}
        onAction={handleTourAction}
      />

      {/* Report export picker (PDF / Excel / CSV) */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        monthLabel={formatMonthName(khata.activeMonth)}
        incomeCount={khata.data.income.filter((i) => monthOf(i) === khata.activeMonth).length}
        expenseCount={khata.data.expense.filter((i) => monthOf(i) === khata.activeMonth).length}
        onPdf={exportReportPdf}
        onExcel={exportReportExcel}
        onCsv={exportData}
      />

      {/* Direct WhatsApp support */}
      {supportUrl().configured && (
        <a
          href={supportUrl("مدد").url}
          target="_blank"
          rel="noreferrer"
          onClick={() => track("support_open", { source: "fab" })}
          aria-label="واٹس ایپ پر مدد"
          title="واٹس ایپ پر مدد"
          className="fixed bottom-4 left-4 z-40 flex size-11 items-center justify-center rounded-full border border-[#25D366]/40 bg-slate-950/80 text-[#25D366] shadow-xl backdrop-blur transition hover:bg-[#25D366]/20"
        >
          <i className="fab fa-whatsapp text-xl"></i>
        </a>
      )}

      {/* Shop: customers, suppliers, daybook and account balances */}
      <ShopPanel
        open={shopOpen}
        tab={shopTab}
        onTabChange={setShopTab}
        onClose={() => setShopOpen(false)}
        data={khata.data}
        prefs={khata.prefs}
        isStaff={staff.isStaff}
        onBackedUp={backup.backedUp}
      />

      {/* PIN lock / salesman mode */}
      <StaffPinModal
        open={pinOpen}
        mode={pinMode}
        busy={staff.busy}
        error={staff.error}
        onClose={() => {
          setPinOpen(false);
          staff.clearError();
        }}
        onSubmit={(pin, confirm) => {
          void (async () => {
            if (pinMode === "set") {
              if (await staff.savePin(pin, confirm)) setPinOpen(false);
              return;
            }
            if (pinMode === "unlock") {
              if (await staff.unlock(pin)) setPinOpen(false);
              return;
            }
            if (await staff.clearPin(pin)) setPinOpen(false);
          })();
        }}
      />
    </AppShell>
  );
}
