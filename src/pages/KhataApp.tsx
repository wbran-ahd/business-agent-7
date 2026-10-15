/**
 * صوتی بقیہ — پاور فل اے آئی منشی
 * Voice-controlled Urdu finance assistant (income / expense / balance).
 *
 * The default screen is a faithful port of the original single-file HTML app:
 * same glassmorphism theme, ambient mesh, horizon-arc visualizer, three metric
 * boxes and mic. Everything else — manual entry, edit/delete, search, budgets,
 * recurring incomes, cloud sync, CSV restore and Gemini insights — lives inside
 * the existing modals so the first paint never changes.
 *
 * Structure:
 *   • `useKhata`           reducer-backed ledger (one audited mutation path)
 *   • `useVoiceAssistant`  conversation state machine with timeouts & mutex
 *   • `useSync`            versioned cloud backup, settings and AI status
 *   • `Modal`              accessible dialogs (Escape, focus trap, ARIA)
 */import {
  Modal } from "@/components/sauti/Modal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { api } from "@/convex/_generated/api";
import { useKhata } from "@/hooks/use-khata";
import { useSync } from "@/hooks/use-sync";
import { useVoiceAssistant } from "@/hooks/use-voice-assistant";
import {
  API_KEY_STORAGE,
  buildCsv,
  CATEGORY_CATALOG,
  dedupeEntries,
  entriesFromCsv,
  formatMonthName,
  formatNumber,
  getCurrentMonthKey,
  monthOf,
  nextId,
  type AiInsight,
  type Entry,
  type EntryType,
} from "@/lib/khata";
import { t } from "@/lib/i18n";
import { logError } from "@/lib/logger";
import { useAction } from "convex/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useNotifications } from "@/lib/notifications";
import { ConfirmDialog } from "@/lib/confirm";
import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/logo.svg";
import {
  BarChart3,
  LogOut,
  Menu,
  Mic,
  Settings,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/** Chart.js is only needed once the analytics modal is opened. */
const ChartsPanel = lazy(() => import("@/components/sauti/ChartsPanel"));

const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center gap-1";

type Draft = { amount: string; detail: string; category: string };
const emptyDraft: Draft = { amount: "", detail: "", category: "عام" };

/** Sidebar destinations — each one opens the view that owns the state. */
type NavId = "ledger" | EntryType | "analytics" | "settings";

export default function SautiBaqaya() {
  const khata = useKhata();
  const sync = useSync(khata.data);
  const analyze = useAction(api.ai.analyze);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const [historyType, setHistoryType] = useState<EntryType | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [notepadQuery, setNotepadQuery] = useState("");
  const [notepadCategory, setNotepadCategory] = useState("all");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { notifySuccess, notifyWarning } = useNotifications();

  /* ---- AI -------------------------------------------------------------- */
  async function runAi(question?: string) {
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await analyze({
        input: {
          monthKey: khata.activeMonth,
          totals: {
            carryForward: khata.totals.carryForward,
            totalIncome: khata.totals.totalIncome,
            totalExpense: khata.totals.totalExpense,
            balance: khata.totals.balance,
          },
          categories: khata.breakdown.map((c) => ({
            category: c.category,
            amount: c.amount,
            share: c.share,
          })),
          history: khata.trend.map((row) => ({
            monthKey: row.monthKey,
            income: row.income,
            expense: row.expense,
          })),
          question,
        },
      });
      const shaped: AiInsight = result;
      setInsight(shaped);
      voice.announce(
        <span className="text-sky-300 text-sm font-bold">
          🤖 {shaped.title}: {shaped.insight}
        </span>,
        shaped.spoken,
      );
    } catch (error) {
      logError("ai", "analyze failed", error);
      setAiError(error instanceof Error ? error.message : String(error));
      getFinancialAdvice();
    } finally {
      setAiBusy(false);
    }
  }

  /** Original rule-based advice — instant, and the fallback when AI is off. */
  function getFinancialAdvice() {
    const { totalIncome, totalExpense } = khata.totals;
    let advice: string;
    if (totalExpense === 0) {
      advice = "اس مہینے ابھی تک کوئی خرچہ درج نہیں ہوا۔ آپ کی بچت بہترین حالت میں ہے۔";
    } else if (totalExpense > totalIncome) {
      advice =
        "توجہ فرمائیں! اس مہینے آپ کا خرچہ آمدنی سے زیادہ ہو رہا ہے۔ اپنے غیر ضروری اخراجات کو کم کرنے کی کوشش کریں۔";
    } else if (totalIncome === 0) {
      advice = "آمدنی درج نہیں ہوئی، براہِ کرم اپنی آمدنی بھی درج کریں۔";
    } else {
      const saveRatio = Math.round(((totalIncome - totalExpense) / totalIncome) * 100);
      advice = `بہترین! آپ نے اس مہینے اپنی آمدنی کا تقریباً ${saveRatio} فیصد بچا لیا ہے۔ اپنا بجٹ اسی طرح برقرار رکھیں۔`;
    }
    voice.announce(
      <span className="text-amber-300 text-sm font-bold">💡 مالیاتی مشورہ: {advice}</span>,
      advice,
    );
  }

  /* ---- voice wiring (declared after so the closures stay fresh) -------- */
  const voice = useVoiceAssistant({
    onCommit: (type, amount, detail) => khata.addEntry({ type, amount, detail }),
    onUndo: () => {
      if (khata.data.undoStack.length === 0) return false;
      khata.undo();
      return true;
    },
    onAskAi: (question) => {
      void runAi(question);
    },
  });

  function handleUndoButton() {
    const removed = khata.data.undoStack.length > 0;
    if (removed) khata.undo();
    const message = removed ? t("undoDone") : t("undoEmpty");
    voice.announce(<span className="text-amber-300 font-bold">{message}</span>, message);
  }

  /* ---- recurring incomes ----------------------------------------------- */
  /* The server materialises them (idempotently) for the signed-in user; this
     mirrors them into the local ledger so an active session sees them at once.
     Matching is by label + amount + month, so the two paths converge instead of
     doubling up. */
  useEffect(() => {
    if (!sync.isAuthenticated || sync.recurring.length === 0) return;
    const monthKey = getCurrentMonthKey();
    const due = sync.recurring.filter(
      (entry) =>
        entry.enabled &&
        !khata.data.income.some(
          (i) => monthOf(i) === monthKey && i.detail === entry.label && i.amount === entry.amount,
        ),
    );
    if (due.length === 0) return;
    khata.merge(
      due.map((entry) => khataDraftToEntry(entry.label, entry.amount)),
      [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.isAuthenticated, sync.recurring, khata.data.income]);

  /* ---- ledger editing -------------------------------------------------- */
  function openModal(type: EntryType) {
    setHistoryType(type);
    setNotepadQuery("");
    setNotepadCategory("all");
    setEditingId(null);
    setManualOpen(false);
    setManual(emptyDraft);
    khata.clearValidationError();
  }

  function startEdit(item: Entry) {
    setEditingId(item.id);
    setEditDraft({ amount: String(item.amount), detail: item.detail, category: item.category });
  }

  function commitEdit(type: EntryType) {
    if (editingId === null) return;
    const ok = khata.updateEntry(type, editingId, {
      type,
      amount: Number.parseFloat(editDraft.amount),
      detail: editDraft.detail,
      category: editDraft.category,
    });
    if (!ok) return;
    setEditingId(null);
  }

  function addManualEntry(type: EntryType) {
    if (!khata.addEntry({ type, amount: Number.parseFloat(manual.amount), detail: manual.detail, category: manual.category })) {
      return;
    }
    setManual(emptyDraft);
    setManualOpen(false);
  }

  /* ---- backup & restore ------------------------------------------------ */
  function exportData() {
    const blob = new Blob([buildCsv(khata.data)], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sauti_baqaya_ultimate_report.csv";
    a.click();
    window.URL.revokeObjectURL(url);
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
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        if (file.name.toLowerCase().endsWith(".json")) {
          const parsed = JSON.parse(text) as Partial<{ income: Entry[]; expense: Entry[] }>;
          const income = dedupeEntries(khata.data.income, Array.isArray(parsed.income) ? parsed.income : []);
          const expense = dedupeEntries(khata.data.expense, Array.isArray(parsed.expense) ? parsed.expense : []);
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

  /* ---- settings -------------------------------------------------------- */
  function openSettings() {
    const local = localStorage.getItem(API_KEY_STORAGE);
    if (!sync.hasCloudKey) setApiKeyDraft("••••••••");
    else if (local) setApiKeyDraft(local);
    else setApiKeyDraft("");
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
    if (sync.isAuthenticated) {
      const ok = await sync.saveGeminiKey(key);
      if (ok) localStorage.removeItem(API_KEY_STORAGE);
      setSettingsOpen(false);
      voice.speak("سیٹنگز اور کلاؤڈ اے آئی کی سیو ہو گئی ہے۔");
      return;
    }
    localStorage.setItem(API_KEY_STORAGE, key);
    sync.setStatus(
      "کی اسی ڈیوائس پر محفوظ ہو گئی۔ سرور پر محفوظ کرنے کے لیے سائن ان کریں۔",
    );
    setSettingsOpen(false);
  }

  async function handleUpload() {
    if (!sync.isAuthenticated) {
      sync.setStatus("پہلے سائن ان کریں تاکہ ڈیٹا کلاؤڈ پر محفوظ ہو۔");
      return;
    }
    const ok = await sync.upload();
    if (ok) {
      notifySuccess("کلاؤڈ سینک محفوظ ہو گئی", sync.status);
    } else {
      notifyWarning("سینک مکمل نہیں ہو سکی", sync.status);
    }
  }

  function handleDownload() {
    const pulled = sync.download();
    if (pulled) khata.replaceAll(pulled.income, pulled.expense);
  }

  /* ---- notepad list ---------------------------------------------------- */
  function filterEntries(list: Entry[]): Entry[] {
    const q = notepadQuery.trim();
    return list
      .filter((item) => monthOf(item) === khata.activeMonth)
      .filter((item) => notepadCategory === "all" || item.category === notepadCategory)
      .filter((item) => (!q ? true : `${item.detail} ${item.category} ${item.amount}`.includes(q)))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function renderEditForm() {
    return (
      <div className="space-y-2 font-sans">
        <div className="flex gap-2">
          <input
            type="number"
            className={inputCls}
            value={editDraft.amount}
            onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
            placeholder={t("amountLabel")}
          />
          <select
            className={inputCls}
            value={editDraft.category}
            onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
          >
            {CATEGORY_CATALOG.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <input
          className={inputCls}
          value={editDraft.detail}
          onChange={(e) => setEditDraft({ ...editDraft, detail: e.target.value })}
          placeholder={t("detailLabel")}
        />
        {khata.validationError && <p className="text-[11px] text-rose-300">{khata.validationError}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => historyType && commitEdit(historyType)}
            className={`${smallBtn} flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40`}
          >
            ✓ {t("save")}
          </button>
          <button
            onClick={() => setEditingId(null)}
            className={`${smallBtn} flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20`}
          >
            ✕ {t("cancel")}
          </button>
        </div>
      </div>
    );
  }

  function renderEntryCard(type: EntryType, item: Entry) {
    const positive = type === "income";
    return (
      <div
        key={item.id}
        className="bg-black/30 border border-white/10 p-3.5 rounded-xl flex flex-col gap-2"
      >
        {editingId === item.id ? (
          renderEditForm()
        ) : (
          <>
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs font-sans text-white/40">
                <i
                  className={`fas ${item.icon || "fa-tag"} ${positive ? "text-emerald-400" : "text-rose-400"} ml-1`}
                ></i>{" "}
                {item.category || "عام"} • {item.date}
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                    positive
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                  }`}
                >
                  {positive ? "+" : "-"}
                  {formatNumber(item.amount, khata.prefs.digitStyle)} روپے
                </span>
                <button
                  onClick={() => startEdit(item)}
                  aria-label={t("edit")}
                  title={t("edit")}
                  className="text-white/40 hover:text-white transition"
                >
                  <i className="fas fa-pen text-xs"></i>
                </button>
                <button
                  onClick={() => khata.removeEntry(type, item.id)}
                  aria-label={t("delete")}
                  title={t("delete")}
                  className="text-rose-400/70 hover:text-rose-300 transition"
                >
                  <i className="fas fa-trash text-xs"></i>
                </button>
              </div>
            </div>
            <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
              📝 {t("detailPrefix")} {item.detail}
            </div>
          </>
        )}
      </div>
    );
  }

  function renderNotepad() {
    if (historyType === "income") {
      const carryForward = khata.totals.carryForward;
      const source = filterEntries(khata.data.income);
      const filtered = notepadQuery !== "" || notepadCategory !== "all";
      if (source.length === 0 && carryForward <= 0 && !filtered) {
        return <p className="text-center text-white/40 py-10 text-sm">{t("emptyList")}</p>;
      }
      return (
        <>
          {carryForward > 0 && !filtered && (
            <div className="bg-sky-950/40 border border-sky-500/30 p-3.5 rounded-xl flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-sans text-sky-300/80">{t("openingBalance")}</span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-sky-500/20 text-sky-300 border-sky-500/40">
                  +{formatNumber(carryForward, khata.prefs.digitStyle)} روپے
                </span>
              </div>
              <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
                {t("openingBalanceDetail")}
              </div>
            </div>
          )}
          {source.map((item) => renderEntryCard("income", item))}
          {source.length === 0 && filtered && (
            <p className="text-center text-white/40 py-8 text-sm">{t("noResults")}</p>
          )}
        </>
      );
    }

    const source = filterEntries(khata.data.expense);
    if (source.length === 0) {
      return (
        <p className="text-center text-white/40 py-10 text-sm">
          {notepadQuery || notepadCategory !== "all" ? t("noResults") : t("emptyList")}
        </p>
      );
    }
    return <>{source.map((item) => renderEntryCard("expense", item))}</>;
  }

  const alerts = khata.alertsFor(sync.budgets);

  /* ---- dashboard shell -------------------------------------------------- */
  const activeView: NavId = analyticsOpen
    ? "analytics"
    : settingsOpen
      ? "settings"
      : (historyType ?? "ledger");

  function goHome() {
    setHistoryType(null);
    setAnalyticsOpen(false);
    setSettingsOpen(false);
    setNavOpen(false);
  }

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      navigate("/");
    }
  }

  const navItems: {
    id: NavId;
    label: string;
    icon: typeof Mic;
    onClick: () => void;
  }[] = [
    { id: "ledger", label: "کھاتہ", icon: Mic, onClick: goHome },
    {
      id: "income",
      label: t("totalIncome"),
      icon: Wallet,
      onClick: () => {
        openModal("income");
        setNavOpen(false);
      },
    },
    {
      id: "expense",
      label: t("totalExpense"),
      icon: TrendingDown,
      onClick: () => {
        openModal("expense");
        setNavOpen(false);
      },
    },
    {
      id: "analytics",
      label: t("charts"),
      icon: BarChart3,
      onClick: () => {
        setAnalyticsOpen(true);
        setNavOpen(false);
      },
    },
    {
      id: "settings",
      label: "سیٹنگز",
      icon: Settings,
      onClick: () => {
        openSettings();
        setNavOpen(false);
      },
    },
  ];

  function renderNav(current: NavId) {
    return (
      <nav className="flex flex-col gap-1.5" aria-label="مینو">
        {navItems.map((item) => {
          const active = current === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
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
  }

  function renderBrand() {
    return (
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
  }

  function renderUser() {
    const label = user?.name || user?.email || "مہمان صارف";
    return (
      <div className="flex items-center gap-2.5 border-t border-white/10 pt-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/15 text-sm font-bold text-sky-200">
          {label.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-xs font-bold text-white/85">{label}</span>
          <span className="block truncate font-sans text-[10px] text-white/40">
            {user?.email ? user.email : "کلاؤڈ سینک فعال"}
          </span>
        </span>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          aria-label="سائن آؤٹ"
          title="سائن آؤٹ"
          className="shrink-0 rounded-lg border border-white/15 p-2 text-white/55 transition hover:border-rose-400/40 hover:text-rose-300"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    );
  }

  function renderSummary() {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <p className="font-sans text-[10px] uppercase tracking-widest text-white/40">
          {khata.isCurrentMonth ? t("currentMonth") : t("archivedMonth")}
        </p>
        <p className="nastaliq mt-0.5 text-xs text-white/60">{khata.monthName}</p>
        <p className="mt-1.5 text-xl font-bold text-white">
          {formatNumber(khata.totals.balance, khata.prefs.digitStyle)}
          <span className="nastaliq mr-1 text-xs font-normal text-white/50">روپے</span>
        </p>
        <div className="mt-2 flex items-center justify-between font-sans text-[11px]">
          <span className="text-emerald-300/90">
            ↑ {formatNumber(khata.totals.totalIncome, khata.prefs.digitStyle)}
          </span>
          <span className="text-rose-300/90">
            ↓ {formatNumber(khata.totals.totalExpense, khata.prefs.digitStyle)}
          </span>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <div dir="rtl" className="sauti-app min-h-screen">
      <div className="ambient-bg" />

      <div className="relative z-10 flex min-h-screen w-full">
        {/* Sidebar — desktop */}
        <aside className="hidden w-64 shrink-0 flex-col gap-5 border-l border-white/10 bg-black/25 p-4 backdrop-blur-xl lg:flex">
          {renderBrand()}
          {renderNav(activeView)}
          <div className="mt-auto flex flex-col gap-3">
            {renderSummary()}
            {renderUser()}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar — mobile */}
          <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/70 px-4 py-3 backdrop-blur-xl lg:hidden">
            {renderBrand()}
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label="مینو کھولیں"
              className="rounded-xl border border-white/15 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <Menu className="size-5" />
            </button>
          </header>

          <main className="flex flex-1 items-center justify-center p-3 sm:p-6">
            {/* Main App Container */}
            <div className="glass-panel my-auto flex w-full max-w-xl min-h-[78vh] flex-col relative overflow-hidden lg:min-h-[88vh]">
        {/* Header Section */}
        <div className="p-4 sm:p-6 border-b border-white/10">
          <div className="flex justify-between items-center text-[11px] sm:text-xs text-white/50 font-sans mb-3">
            <span className="flex items-center gap-1">
              <i className="fas fa-satellite-dish text-emerald-400"></i> {t("wakeWordStatus")}
            </span>
            <span>{t("spectralGrid")}</span>
            <span className="text-white/90 font-bold text-base sm:text-lg flex items-center gap-1.5">
              <i className="fas fa-brain text-sky-400"></i> {t("assistantName")}
            </span>
          </div>

          {/* Month Selector & Quick Actions */}
          <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl p-2.5 mb-3 gap-2">
            <div className="flex items-center gap-2 text-xs text-white/80 font-bold">
              <i className="fas fa-calendar-alt text-sky-400"></i>
              <select
                value={khata.activeMonth}
                onChange={(e) => khata.setActiveMonth(e.target.value)}
                className="bg-black/40 border border-white/20 text-white text-xs rounded-xl px-2.5 py-1 focus:outline-none focus:border-sky-400 font-sans cursor-pointer"
              >
                {khata.monthOptions.map((mKey) => (
                  <option key={mKey} value={mKey}>
                    {formatMonthName(mKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => (sync.aiHasKey ? void runAi() : getFinancialAdvice())}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
              >
                <i className="fas fa-lightbulb"></i> {aiBusy ? t("thinking") : t("advice")}
              </button>
              <button
                onClick={() => setAnalyticsOpen(true)}
                className="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
              >
                <i className="fas fa-chart-pie"></i> {t("charts")}
              </button>
              <button
                onClick={openSettings}
                aria-label={t("settingsTitle")}
                className="bg-white/10 hover:bg-white/20 text-white border border-white/20 px-2.5 py-1.5 rounded-xl text-xs transition"
              >
                <i className="fas fa-key"></i>
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center text-[10px] sm:text-xs font-sans text-white/40">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                <div className="w-2 h-2 rounded-full bg-sky-400"></div>
              </div>
              <span>{t("voiceActiveHint")}</span>
            </div>
            <button
              onClick={exportData}
              className="px-3 py-1 rounded-full border border-white/20 text-white/70 hover:bg-white/10 hover:text-white transition"
            >
              <i className="fas fa-file-csv ml-1"></i> {t("csvBackup")}
            </button>
          </div>
        </div>

        {/* Middle Content Area */}
        <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between z-10">
          {/* Top Metric Row: 3 Boxes in One Single Line */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full mb-6">
            {/* 1. کل رقم (Income Box) */}
            <div
              onClick={() => openModal("income")}
              className="bg-white/5 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition group"
            >
              <span className="text-white/60 text-xs sm:text-sm mb-1 group-hover:text-white/85">
                {t("totalIncome")}
              </span>
              <span className="text-lg sm:text-2xl font-bold text-emerald-400">
                {formatNumber(khata.totals.totalIncome, khata.prefs.digitStyle)}
              </span>
              <span className="text-[9px] text-white/30 font-sans mt-1">{t("openNotepad")}</span>
            </div>

            {/* 2. خرچہ (Expense Box) */}
            <div
              onClick={() => openModal("expense")}
              className="bg-white/5 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition group"
            >
              <span className="text-white/60 text-xs sm:text-sm mb-1 group-hover:text-white/85">
                {t("totalExpense")}
              </span>
              <span className="text-lg sm:text-2xl font-bold text-rose-400">
                {formatNumber(khata.totals.totalExpense, khata.prefs.digitStyle)}
              </span>
              <span className="text-[9px] text-white/30 font-sans mt-1">{t("openNotepad")}</span>
            </div>

            {/* 3. بقایا (Balance Box) */}
            <div className="bg-white/10 border border-white/20 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
              <span className="text-white/80 text-xs sm:text-sm mb-1 relative z-10 font-bold">
                {t("balance")}
              </span>
              <span className="text-xl sm:text-3xl font-bold text-white relative z-10">
                {formatNumber(khata.totals.balance, khata.prefs.digitStyle)}
              </span>
              <span
                className={`text-[9px] font-sans mt-1 relative z-10 ${
                  khata.isCurrentMonth ? "text-sky-300/80" : "text-amber-300/80"
                }`}
              >
                {khata.isCurrentMonth ? t("currentMonth") : t("archivedMonth")}
              </span>
            </div>
          </div>

          {/* Speech Output Display */}
          <div className="flex flex-col items-center justify-center my-auto space-y-4 text-center">
            <div className="bg-black/20 border border-white/10 rounded-2xl p-4 w-full max-w-md min-h-[100px] flex items-center justify-center">
              <p className="text-base sm:text-lg text-white/80 leading-relaxed">{voice.transcript}</p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 justify-center text-xs font-sans">
              <button
                onClick={handleUndoButton}
                className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 px-4 py-2 rounded-full transition shadow-lg"
              >
                {t("undoLast")}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Mic Section & Glowing Horizon Arc */}
        <div className="relative h-40 flex items-end justify-center pb-8 border-t border-white/5 mt-auto">
          <HorizonArc listening={voice.listening} />

          {/* Mic Button */}
          <button
            onClick={voice.toggle}
            aria-pressed={voice.listening}
            className={`mic-btn w-20 h-20 sm:w-22 sm:h-22 rounded-full flex items-center justify-center z-10 shadow-2xl ${
              voice.listening ? "listening" : ""
            }`}
          >
            <i className="fas fa-microphone text-2xl sm:text-3xl text-white"></i>
          </button>

          <div className="absolute bottom-5 left-6 text-white/20 text-2xl font-sans pointer-events-none">
            ✻
          </div>
        </div>
      </div>
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
            {renderNav(activeView)}
            <div className="flex flex-col gap-3">
              {renderSummary()}
              {renderUser()}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Notepad Details Modal */}
      <Modal
        open={historyType !== null}
        onClose={() => setHistoryType(null)}
        label={historyType === "income" ? t("totalIncome") : t("totalExpense")}
      >
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            {historyType === "income" ? (
              <>
                <i className="fas fa-file-alt text-emerald-400"></i> {t("totalIncome")} (بشمول
                پچھلا بقایا) - ({formatMonthName(khata.activeMonth)})
              </>
            ) : (
              <>
                <i className="fas fa-file-alt text-rose-400"></i> {t("totalExpense")} - (
                {formatMonthName(khata.activeMonth)})
              </>
            )}
          </h2>
          <button
            onClick={() => setHistoryType(null)}
            aria-label={t("cancel")}
            className="text-white/50 hover:text-white transition"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Search, filter and quick add */}
        <div className="flex gap-2 mb-3 font-sans">
          <input
            className={inputCls}
            placeholder={t("search")}
            value={notepadQuery}
            onChange={(e) => setNotepadQuery(e.target.value)}
          />
          <select
            className={inputCls}
            value={notepadCategory}
            onChange={(e) => setNotepadCategory(e.target.value)}
          >
            <option value="all">{t("allCategories")}</option>
            {khata.knownCategories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setManualOpen((v) => !v)}
            className={`${smallBtn} shrink-0 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40`}
          >
            <i className="fas fa-plus"></i> {t("newEntry")}
          </button>
        </div>

        {manualOpen && (
          <div className="bg-black/30 border border-white/10 rounded-xl p-3 mb-3 space-y-2 font-sans">
            <div className="flex gap-2">
              <input
                type="number"
                className={inputCls}
                placeholder={t("amountLabel")}
                value={manual.amount}
                onChange={(e) => setManual({ ...manual, amount: e.target.value })}
              />
              <select
                className={inputCls}
                value={manual.category}
                onChange={(e) => setManual({ ...manual, category: e.target.value })}
              >
                {CATEGORY_CATALOG.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <input
              className={inputCls}
              placeholder={t("detailOptional")}
              value={manual.detail}
              onChange={(e) => setManual({ ...manual, detail: e.target.value })}
            />
            {khata.validationError && (
              <p className="text-[11px] text-rose-300">{khata.validationError}</p>
            )}
            <button
              onClick={() => historyType && addManualEntry(historyType)}
              className="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 py-2 rounded-xl text-xs font-bold"
            >
              + {historyType === "income" ? t("totalIncome") : t("totalExpense")} درج کریں
            </button>
          </div>
        )}

        <div className="notepad-paper p-4 flex-1 overflow-y-auto space-y-3 mb-4">
          <div className="space-y-3 font-sans">{renderNotepad()}</div>
        </div>

        <div className="pt-2">
          <button
            onClick={shareWhatsApp}
            className="w-full bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] border border-[#25D366]/40 py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition text-sm"
          >
            <i className="fab fa-whatsapp text-xl"></i> {t("whatsappShare")}
          </button>
        </div>
      </Modal>

      {/* Analytics Charts Modal */}
      <Modal
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        label={t("analyticsTitle")}
        scrollable
        fontSans
      >
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <i className="fas fa-chart-pie text-sky-400"></i> {t("analyticsTitle")}
          </h2>
          <button
            onClick={() => setAnalyticsOpen(false)}
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
              income={khata.totals.totalIncome}
              expense={khata.totals.totalExpense}
              trend={khata.trend}
              breakdown={khata.breakdown}
            />
          </Suspense>
        </ErrorBoundary>

        {alerts.length > 0 && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-3 text-xs text-rose-200">
            {alerts.map((alert) => (
              <div key={alert.category} className="flex justify-between">
                <span>
                  <i className="fas fa-triangle-exclamation ml-1"></i> {alert.category} بجٹ ختم
                </span>
                <span>
                  {formatNumber(alert.spent, khata.prefs.digitStyle)} /{" "}
                  {formatNumber(alert.limit, khata.prefs.digitStyle)} روپے
                </span>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => void runAi()}
          disabled={aiBusy}
          className="w-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 py-2.5 rounded-xl text-xs font-bold transition disabled:opacity-50"
        >
          <i className="fas fa-wand-magic-sparkles ml-1"></i>{" "}
          {aiBusy ? t("aiRunning") : t("aiAnalyze")}
        </button>

        {!sync.aiHasKey && (
          <p className="text-[11px] text-white/50 mt-2">
            اے آئی کے لیے ⚙️ سیٹنگز میں Gemini API Key درج کریں۔
          </p>
        )}
        {sync.aiHasKey && (
          <p className="text-[11px] text-white/40 mt-2">
            آج بقیا اے آئی کوٹہ: {sync.aiRemaining}
          </p>
        )}

        {aiError && <p className="text-[11px] text-rose-300 mt-2">{aiError}</p>}

        {insight && (
          <div className="bg-sky-950/40 border border-sky-500/30 rounded-xl p-3 mt-3 text-xs text-white/85 space-y-1">
            <div className="flex justify-between items-center">
              <span className="font-bold text-sky-200">🤖 {insight.title}</span>
              <span
                className={`px-2 py-0.5 rounded-full border text-[10px] ${
                  insight.riskLevel === "high"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    : insight.riskLevel === "medium"
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                }`}
              >
                {insight.riskLevel === "high"
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

      {/* Settings Modal */}
      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        label={t("settingsTitle")}
        scrollable
        fontSans
      >
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <i className="fas fa-key text-sky-400"></i> {t("settingsTitle")}
          </h2>
          <button
            onClick={() => setSettingsOpen(false)}
            aria-label={t("cancel")}
            className="text-white/50 hover:text-white transition"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Gemini key */}
        <div className="space-y-2 text-sm text-white/80 mb-5">
          <p>ذہین جیمینی اے آئی اور کلاؤڈ انٹیلی جنس کے لیے اپنی اے آئی کی (API Key) درج کریں:</p>
          <input
            type="password"
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            placeholder="AIzaSy..."
            className={inputCls}
          />
          <button
            onClick={() => void saveApiKey()}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2.5 rounded-xl transition shadow-lg"
          >
            {t("saveSettings")}
          </button>
        </div>

        {/* Digit style */}
        <div className="mb-5">
          <h3 className="text-sm font-bold text-white/85 mb-2">اندازِ شمار</h3>
          <div className="flex gap-2">
            <button
              onClick={() => khata.setDigitStyle("latin")}
              className={`${smallBtn} flex-1 ${
                khata.prefs.digitStyle === "latin"
                  ? "bg-sky-500/25 text-sky-200 border-sky-400/50"
                  : "bg-white/5 text-white/70 border-white/20"
              }`}
            >
رومن ہندسے (500)
            </button>
            <button
              onClick={() => khata.setDigitStyle("eastern")}
              className={`${smallBtn} flex-1 ${
                khata.prefs.digitStyle === "eastern"
                  ? "bg-sky-500/25 text-sky-200 border-sky-400/50"
                  : "bg-white/5 text-white/70 border-white/20"
              }`}
            >
              مشرقی ہندسے (۵۰۰)
            </button>
          </div>
        </div>

        {/* Budgets */}
        <div className="mb-5">
          <h3 className="text-sm font-bold text-white/85 mb-2">
            <i className="fas fa-bullseye text-rose-300 ml-1"></i> قسم وار بجٹ (ماہانہ)
          </h3>
          <div className="space-y-2">
            {CATEGORY_CATALOG.map((category) => {
              const budget = sync.budgets.find((b) => b.category === category.name);
              return (
                <div key={category.name} className="flex items-center gap-2">
                  <span className="text-xs text-white/70 w-24 shrink-0">{category.name}</span>
                  <input
                    type="number"
                    className={inputCls}
                    placeholder="0"
                    value={budget ? budget.limit : ""}
                    onChange={(e) => {
                      const limit = Number.parseFloat(e.target.value) || 0;
                      sync.setBudgets((prev) => {
                        const rest = prev.filter((b) => b.category !== category.name);
                        return limit > 0
                          ? [...rest, { category: category.name, limit }].sort((a, b) =>
                              a.category.localeCompare(b.category),
                            )
                          : rest;
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
          <button
            onClick={() => void sync.persistSettings()}
            className={`${smallBtn} w-full mt-2 bg-white/10 hover:bg-white/20 text-white border-white/20`}
          >
            بجٹ محفوظ کریں
          </button>
        </div>

        {/* Recurring income */}
        <div className="mb-5">
          <h3 className="text-sm font-bold text-white/85 mb-2">
            <i className="fas fa-rotate text-emerald-300 ml-1"></i> ماہانہ آمدنی (خودکار)
          </h3>
          {sync.recurring.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {sync.recurring.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    aria-label={entry.label}
                    onChange={(e) =>
                      sync.setRecurring((prev) =>
                        prev.map((r) =>
                          r.id === entry.id ? { ...r, enabled: e.target.checked } : r,
                        ),
                      )
                    }
                  />
                  <span className="flex-1 text-white/80">{entry.label}</span>
                  <span className="text-emerald-300">
                    {formatNumber(entry.amount, khata.prefs.digitStyle)} روپے
                  </span>
                  <button
                    onClick={() =>
                      sync.setRecurring((prev) => prev.filter((r) => r.id !== entry.id))
                    }
                    aria-label={t("delete")}
                    className="text-rose-400/70 hover:text-rose-300"
                  >
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              ))}
            </div>
          )}
          <RecurringAdder
            onAdd={(label, amount) =>
              sync.setRecurring((prev) => [
                ...prev,
                { id: `${Date.now()}`, label, amount, enabled: true },
              ])
            }
          />
          <button
            onClick={() => void sync.persistSettings()}
            className={`${smallBtn} w-full mt-2 bg-white/10 hover:bg-white/20 text-white border-white/20`}
          >
            آمدنی محفوظ کریں
          </button>
        </div>

        {/* Backup & restore */}
        <div className="mb-5">
          <h3 className="text-sm font-bold text-white/85 mb-2">
            <i className="fas fa-database text-sky-300 ml-1"></i> بیک اپ اور بحالی
          </h3>
          <div className="flex gap-2">
            <button
              onClick={exportData}
              className={`${smallBtn} flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20`}
            >
              <i className="fas fa-file-csv"></i> CSV ڈاؤن لوڈ
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`${smallBtn} flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20`}
            >
              <i className="fas fa-file-import"></i> CSV/JSON واپس لائیں
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={handleImportFile}
          />
          {importMsg && <p className="text-[11px] text-emerald-300 mt-2">{importMsg}</p>}
        </div>

        {/* Cloud sync */}
        <div className="mb-2">
          <h3 className="text-sm font-bold text-white/85 mb-2">
            <i className="fas fa-cloud text-sky-300 ml-1"></i> کلاؤڈ سینک
          </h3>
          {sync.isAuthenticated ? (
            <div className="flex gap-2">
              <button
                onClick={() => setUploadConfirmOpen(true)}
                disabled={sync.busy || !sync.isAuthenticated}
                className={`${smallBtn} flex-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40 disabled:opacity-50`}
              >
                <i className="fas fa-cloud-arrow-up"></i> اپ لوڈ
              </button>
              <button
                onClick={handleDownload}
                className={`${smallBtn} flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20`}
              >
                <i className="fas fa-cloud-arrow-down"></i> ڈاؤن لوڈ
              </button>
              <button
                onClick={() => void sync.signOut()}
                aria-label="سائن آؤٹ کریں"
                className={`${smallBtn} bg-white/5 hover:bg-white/10 text-white/70 border-white/20`}
              >
                <i className="fas fa-right-from-bracket"></i>
              </button>
            </div>
          ) : (
            <a
              href="/auth?returnTo=/dashboard"
              className={`${smallBtn} w-full justify-center bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40 no-underline`}
            >
              <i className="fas fa-right-to-bracket"></i> سائن ان کریں تاکہ ڈیٹا کلاؤڈ پر رہے
            </a>
          )}
          <p className="text-[11px] text-white/40 mt-2">ورژن: {sync.cloudVersion}</p>
          {sync.status && <p className="text-[11px] text-white/60 mt-1">{sync.status}</p>}
        </div>

        <ConfirmDialog
          open={uploadConfirmOpen}
          onOpenChange={setUploadConfirmOpen}
          title="کلاؤڈ اپ لوڈ جانچ کریں"
          description="یہ آپ کے موجودہ مقامی ریکارڈوں کو کلاؤڈ والے حصے کے ساتھ ہم آہنگ کرے گا۔ اگر کلاؤڈ پر جدید ڈیٹا موجود ہے تو پہلے ڈاؤن لوڈ کریں۔"
          actionLabel="اپ لوڈ کریں"
          onConfirm={handleUpload}
          variant="default"
          loading={sync.busy}
        />
      </Modal>
    </div>
  );
}

/** Small helper kept out of the main body to avoid re-render churn. */
function RecurringAdder({
  onAdd,
}: {
  onAdd: (label: string, amount: number) => void;
}) {
  const [draft, setDraft] = useState({ label: "", amount: "" });
  return (
    <>
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="عنوان (مثلاً تنخواہ)"
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <input
          type="number"
          className={inputCls}
          placeholder="رقم"
          value={draft.amount}
          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
        />
      </div>
      <button
        onClick={() => {
          const amount = Number.parseFloat(draft.amount);
          const label = draft.label.trim();
          if (!label || !Number.isFinite(amount) || amount <= 0) return;
          onAdd(label, amount);
          setDraft({ label: "", amount: "" });
        }}
        className={`${smallBtn} w-full mt-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40`}
      >
        + {t("add")}
      </button>
    </>
  );
}

/** Draws the glowing horizon arc; reads the listening flag via an attribute. */
function HorizonArc({ listening }: { listening: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listeningRef = useRef(listening);
  // Kept out of render so the draw loop reads a committed value.
  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let time = 0;
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const active = listeningRef.current;
      const baseLine = canvas.height;
      const apexY = active ? baseLine - 90 - Math.sin(time * 2) * 15 : baseLine - 45;

      ctx.beginPath();
      ctx.moveTo(0, baseLine);
      ctx.quadraticCurveTo(canvas.width / 2, apexY, canvas.width, baseLine);

      const gradient = ctx.createLinearGradient(0, apexY, 0, baseLine);
      if (active) {
        gradient.addColorStop(0, "rgba(14, 165, 233, 0.8)");
        gradient.addColorStop(0.4, "rgba(14, 165, 233, 0.2)");
        gradient.addColorStop(1, "rgba(2, 132, 199, 0)");
      } else {
        gradient.addColorStop(0, "rgba(255, 255, 255, 0.3)");
        gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.05)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      }
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, baseLine);
      ctx.quadraticCurveTo(canvas.width / 2, apexY, canvas.width, baseLine);
      ctx.strokeStyle = active ? "rgba(186, 230, 253, 0.9)" : "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = active ? 3 : 1;
      ctx.stroke();

      if (active) time += 0.05;
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas id="horizon-canvas" ref={canvasRef} />;
}

/** Mirrors a recurring rule into a local entry for the current month. */
function khataDraftToEntry(label: string, amount: number): Entry {
  const now = new Date();
  return {
    id: nextId(),
    amount,
    detail: label,
    category: "ماہانہ آمدنی",
    icon: "fa-money-bill-wave",
    monthKey: getCurrentMonthKey(),
    date: now.toLocaleDateString("ur-PK"),
    time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
    timestamp: now.getTime(),
  };
}
