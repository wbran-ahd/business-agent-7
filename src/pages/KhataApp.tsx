/**
 * صوتی بقیہ — پاور فل اے آئی منشی
 * Voice-controlled Urdu finance assistant (income / expense / balance).
 *
 * This file is now the **composition layer** only: it wires the domain hooks
 * together and renders the existing component tree. Every responsibility that
 * used to live here has an owner:
 *
 *   • `pages` (this file)          — composition, page-level wiring, layout
 *   • `features/ledger/hooks`      — entry commits, budget feedback, backup,
 *                                    recurring mirrors
 *   • `features/analytics/hooks`   — monthly reports (PDF / Excel / diagnostics)
 *   • `features/settings/hooks`    — AI key + cloud upload/download
 *   • `features/onboarding/hooks`  — 60-second tour
 *   • `hooks/use-overlay-navigation` — overlays, browser back-button, `activeView`
 *
 * Rendering is unchanged: same components, same props, same classes.
 */
import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { AppShell, type NavId } from "@/components/layout/index";
import { LedgerHeader, LedgerVoiceCenter, NotepadModal } from "@/features/ledger/index";
import { AnalyticsModal } from "@/features/analytics/index";
import { SettingsModal } from "@/features/settings/index";
import { ShopPanel } from "@/features/shop/index";
import { useAiAdvisor } from "@/features/ai-advisor/index";
import { useMonthlyReports } from "@/features/analytics/hooks/useMonthlyReports";
import { useLedgerBackup } from "@/features/ledger/hooks/useLedgerBackup";
import { useLedgerEntryActions } from "@/features/ledger/hooks/useLedgerEntryActions";
import { useRecurringEntries } from "@/features/ledger/hooks/useRecurringEntries";
import { useOnboardingTour } from "@/features/onboarding/hooks/useOnboardingTour";
import { useCloudSettings } from "@/features/settings/hooks/useCloudSettings";
import { StaffPinModal, type PinMode } from "@/components/sauti/StaffPinModal";
import { Onboarding } from "@/components/sauti/Onboarding";
import { ExportModal } from "@/components/sauti/ExportModal";
import { useBackupReminder } from "@/hooks/use-backup-reminder";
import { useKhata } from "@/hooks/use-khata";
import { useOverlayNavigation } from "@/hooks/use-overlay-navigation";
import { usePwa } from "@/hooks/use-pwa";
import { useStaffLock } from "@/hooks/use-staff-lock";
import { useSync } from "@/hooks/use-sync";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import { useAuth } from "@/hooks/use-auth";
import { useNotifications } from "@/lib/notifications";
import { supportUrl } from "@/lib/brand";
import {
  formatMonthName,
  formatNumber,
  monthOf,
  type EntryType,
} from "@/lib/khata";
import {
  activeBudgetAlerts,
  budgetStatus,
  purchaseInsights,
} from "@/lib/insights";
import { track } from "@/lib/telemetry";

export default function SautiBaqaya() {
  const khata = useKhata();
  const sync = useSync(khata.data);
  const { user } = useAuth();
  const staff = useStaffLock();
  const backup = useBackupReminder();
  const pwa = usePwa();
  const { notifySuccess, notifyWarning } = useNotifications();

  /* ---- Overlays, history and the sidebar highlight --------------------- */
  const nav = useOverlayNavigation();
  const {
    historyType,
    setHistoryType,
    analyticsOpen,
    setAnalyticsOpen,
    settingsOpen,
    setSettingsOpen,
    exportOpen,
    setExportOpen,
    shopOpen,
    setShopOpen,
    shopTab,
    setShopTab,
    navOpen,
    setNavOpen,
    pinOpen,
    setPinOpen,
    pinMode,
    budgetDismissed,
    setBudgetDismissed,
    activeView,
    openShop,
    openAnalytics,
    openExport,
  } = nav;

  const tour = useOnboardingTour({
    openShop,
    openSettings: nav.openSettingsPanel,
  });
  const {
    onboarding,
    onboardingOpen,
    setOnboardingStep,
    handleTourFinish,
    handleTourSkip,
    handleTourAction,
  } = tour;

  /* Ref to route announcer to voice assistant once initialized */
  const announceRef = useRef<((display: ReactNode, speechText?: string) => void) | null>(null);
  /* Stable identity: only the ref is touched, so consumers can memoise safely. */
  const announce = useCallback(
    (display: ReactNode, speechText?: string) =>
      announceRef.current?.(display, speechText),
    [],
  );

  /* ---- AI Advisor ------------------------------------------------------ */
  const ai = useAiAdvisor({
    monthName: khata.monthName,
    totals: khata.totals,
    breakdown: khata.breakdown,
    announce,
  });

  /* ---- Entry commits + budget feedback ---------------------------------- */
  const {
    handleAddManual,
    handleUpdateEntry,
    handleQuickCommit,
    handleUndoButton,
    speakBudgetWarning,
  } = useLedgerEntryActions({
    data: khata.data,
    activeMonth: khata.activeMonth,
    budgets: sync.budgets,
    digitStyle: khata.prefs.digitStyle,
    addEntry: khata.addEntry,
    updateEntry: khata.updateEntry,
    undo: khata.undo,
    announce,
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

  /* ---- Local backup: CSV, WhatsApp share, file import ------------------- */
  const {
    importMsg,
    resetImportMsg,
    exportData,
    shareWhatsApp,
    handleImportFile,
  } = useLedgerBackup({
    data: khata.data,
    activeMonth: khata.activeMonth,
    totals: khata.totals,
    merge: khata.merge,
    onBackedUp: backup.backedUp,
  });

  /* ---- Recurring rules mirrored into the current month ------------------ */
  useRecurringEntries({
    isAuthenticated: sync.isAuthenticated,
    recurring: sync.recurring,
    data: khata.data,
    appliedRecurring: khata.prefs.appliedRecurring,
    markRecurringApplied: khata.markRecurringApplied,
    merge: khata.merge,
  });

  /* ---- Monthly reports, exports and diagnostics ------------------------- */
  const {
    exportReportPdf,
    exportReportExcel,
    exportDiagnostics,
    clearDiagnostics,
  } = useMonthlyReports({
    data: khata.data,
    activeMonth: khata.activeMonth,
    owner: user?.name ?? "",
    digitStyle: khata.prefs.digitStyle,
    onBackedUp: backup.backedUp,
  });

  /* ---- Settings panel: AI key + cloud sync ------------------------------ */
  const settings = useCloudSettings({
    isAuthenticated: sync.isAuthenticated,
    hasCloudKey: sync.hasCloudKey,
    status: sync.status,
    setStatus: sync.setStatus,
    saveGeminiKey: sync.saveGeminiKey,
    upload: sync.upload,
    download: sync.download,
    replaceAll: khata.replaceAll,
    onBackedUp: backup.backedUp,
    resetImportMsg,
    speak: voice.speak,
    closePanel: () => setSettingsOpen(false),
  });
  const {
    apiKeyDraft,
    setApiKeyDraft,
    uploadConfirmOpen,
    setUploadConfirmOpen,
    preparePanel,
    saveApiKey,
    handleUpload,
    handleDownload,
  } = settings;

  /* ---- Page-level orchestration ---------------------------------------- */
  function openModal(type: EntryType | "balance") {
    nav.openLedgerPanel(type);
    khata.clearValidationError();
  }

  function openSettings() {
    preparePanel();
    nav.openSettingsPanel();
  }

  function openPinPanel(mode: PinMode) {
    staff.clearError();
    nav.openPin(mode);
  }

  function handleNavigate(id: NavId) {
    if (id === "settings") {
      openSettings();
      return;
    }
    nav.handleNavigate(id);
  }

  function handleLockSalesman() {
    if (!staff.lockOwner()) return;
    setSettingsOpen(false);
    notifyWarning(
      "سیلز مین موڈ آن ہے",
      "مالک موڈ میں واپس آنے کے لیے PIN درکار ہوگا۔",
    );
  }

  function handlePinSubmit(pin: string, confirm: string) {
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
  }

  /* ---- Spending signals & derivations ----------------------------------- */
  const alerts = khata.alertsFor(sync.budgets);
  const budgetStatuses = budgetStatus(khata.data, khata.activeMonth, sync.budgets);
  const budgetAlerts = activeBudgetAlerts(budgetStatuses);
  const insights = purchaseInsights(khata.data, khata.activeMonth, sync.budgets, {
    format: (value) => formatNumber(value, khata.prefs.digitStyle),
  });

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
          onOpenAnalytics={openAnalytics}
          onOpenShop={() => openShop("customers")}
          isStaff={staff.isStaff}
          onOpenExport={openExport}
          onOpenSettings={openSettings}
          onUnlockStaff={() => openPinPanel("unlock")}
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
            onQuickCommit={handleQuickCommit}
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
        onOpenPin={openPinPanel}
        onLockSalesman={handleLockSalesman}
      />

      {/* 60-second first-run tour */}
      <Onboarding
        open={onboardingOpen}
        step={onboarding.step}
        onStep={setOnboardingStep}
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
        onSubmit={handlePinSubmit}
      />
    </AppShell>
  );
}
