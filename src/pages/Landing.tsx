/**
 * صوتی بقیہ — پاور فل اے آئی منشی
 * Voice-controlled Urdu finance assistant (income / expense / balance).
 *
 * The default screen is a faithful port of the original single-file HTML app:
 * same glassmorphism theme, ambient mesh, horizon-arc visualizer, three metric
 * boxes and mic. Everything added afterwards — manual entry, edit/delete,
 * search, budgets, recurring incomes, cloud sync, CSV restore and Gemini
 * insights — lives inside the existing modals so the first paint never changes.
 */
import {
  API_KEY_STORAGE,
  buildCsv,
  CATEGORY_CATALOG,
  collectMonthKeys,
  detectCategory,
  entriesFromCsv,
  formatMonthName,
  formatNumber,
  getCurrentMonthKey,
  getCategoryBreakdown,
  getBudgetAlerts,
  getMonthlySeries,
  getTotals,
  loadPrefs,
  loadData,
  monthOf,
  persistData,
  persistPrefs,
  type AiInsight,
  type Budget,
  type DataState,
  type DialogState,
  type DigitStyle,
  type Entry,
  type EntryType,
  type Prefs,
  type RecurringEntry,
} from "@/lib/khata";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { CategoryBarChart, MonthlyDoughnut, TrendLineChart } from "@/components/sauti/Charts";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Speech Recognition API shim (not part of the standard TS DOM lib)  */
/* ------------------------------------------------------------------ */
type SpeechResultEvent = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      length: number;
      [alternativeIndex: number]: { transcript: string };
    };
  };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

type CloudRow = {
  localId: number;
  kind: "income" | "expense";
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
};

const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center gap-1";

function speakNaturalUrdu(text: string) {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ur-PK";
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

const DEFAULT_TRANSCRIPT: ReactNode = (
  <>
    بولیں <strong>"اے منشی"</strong> یا مائیک دبائیں...
    <br />
    <span className="text-xs text-sky-300/80 font-sans mt-2 block">
      💡 مثال: "500 روپے ایڈ کر لو" یا "مالیاتی مشورہ دو"
    </span>
  </>
);

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function SautiBaqaya() {
  const [db, setDb] = useState<DataState>(() => loadData());
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [activeMonth, setActiveMonth] = useState<string>(() => getCurrentMonthKey());
  const [transcript, setTranscript] = useState<ReactNode>(DEFAULT_TRANSCRIPT);
  const [isListening, setIsListening] = useState(false);
  const [historyType, setHistoryType] = useState<EntryType | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* voice confirmation */
  const [pending, setPending] = useState<{
    type: EntryType;
    amount: number;
    detail: string;
  } | null>(null);

  /* notepad modal */
  const [notepadQuery, setNotepadQuery] = useState("");
  const [notepadCategory, setNotepadCategory] = useState("all");
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState({ amount: "", detail: "", category: "عام" });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({
    amount: "",
    detail: "",
    category: "عام",
  });

  /* settings modal */
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<RecurringEntry[]>([]);
  const [recurringDraft, setRecurringDraft] = useState({ label: "", amount: "" });
  const [syncMsg, setSyncMsg] = useState("");
  const [importMsg, setImportMsg] = useState("");

  /* analytics modal */
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const dbRef = useRef(db);
  const dialogRef = useRef<DialogState>("IDLE");
  const pendingRef = useRef(0);
  const listeningRef = useRef(isListening);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRef = useRef<SpeechRecognitionLike | null>(null);
  const conversationRef = useRef<(text: string) => void>(() => {});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  dbRef.current = db;
  listeningRef.current = isListening;

  /* -------------------- backend wiring -------------------- */
  const { isAuthenticated, signOut } = useAuth();
  const aiStatus = useQuery(api.sync.aiStatus);
  const cloudRecords = useQuery(api.sync.listRecords, isAuthenticated ? {} : "skip");
  const cloudSettings = useQuery(api.sync.getSettings, isAuthenticated ? {} : "skip");
  const replaceRecords = useMutation(api.sync.replaceRecords);
  const saveCloudSettings = useMutation(api.sync.saveSettings);
  const setGeminiKey = useMutation(api.sync.setGeminiKey);
  const analyze = useAction(api.ai.analyze);

  /* Persist every local change */
  useEffect(() => {
    persistData(db);
  }, [db]);

  useEffect(() => {
    persistPrefs(prefs);
  }, [prefs]);

  /* Pull budgets / recurring / key flag down once cloud settings arrive */
  useEffect(() => {
    if (!cloudSettings) return;
    setBudgets(cloudSettings.budgets ?? []);
    setRecurring(cloudSettings.recurring ?? []);
    setKeySaved(Boolean(cloudSettings.hasGeminiKey));
    if (cloudSettings.hasGeminiKey) setApiKeyDraft("••••••••");
  }, [cloudSettings]);

  /* Auto-apply recurring incomes once per month */
  useEffect(() => {
    const mKey = getCurrentMonthKey();
    const applied = new Set(prefs.appliedRecurring[mKey] ?? []);
    const due = recurring.filter((r) => r.enabled && !applied.has(r.id));
    if (due.length === 0) return;

    const now = new Date();
    const additions: Entry[] = due.map((r, index) => ({
      id: now.getTime() + index,
      amount: r.amount,
      detail: r.label,
      category: "ماہانہ آمدنی",
      icon: "fa-money-bill-wave",
      monthKey: mKey,
      date: now.toLocaleDateString("ur-PK"),
      time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
      timestamp: now.getTime() + index,
    }));

    setDb((prev) => ({ ...prev, income: [...prev.income, ...additions] }));
    setPrefs((prev) => ({
      ...prev,
      appliedRecurring: {
        ...prev.appliedRecurring,
        [mKey]: [...(prev.appliedRecurring[mKey] ?? []), ...due.map((r) => r.id)],
      },
    }));
  }, [recurring, prefs.appliedRecurring, db]);

  /* -------------------- derived -------------------- */
  const totals = useMemo(() => getTotals(db, activeMonth), [db, activeMonth]);
  const monthOptions = useMemo(() => collectMonthKeys(db), [db]);
  const breakdown = useMemo(
    () => getCategoryBreakdown(db, activeMonth),
    [db, activeMonth],
  );
  const budgetAlerts = useMemo(
    () => getBudgetAlerts(db, activeMonth, budgets),
    [db, activeMonth, budgets],
  );
  const trend = useMemo(() => getMonthlySeries(db, activeMonth, 6), [db, activeMonth]);
  const knownCategories = useMemo(() => {
    const set = new Set<string>(CATEGORY_CATALOG.map((c) => c.name));
    [...db.income, ...db.expense].forEach((e) => set.add(e.category));
    return Array.from(set);
  }, [db]);
  const isCurrentMonth = activeMonth === getCurrentMonthKey();
  const hasAiKey = Boolean(aiStatus?.hasKey);

  /* -------------------- transactions -------------------- */
  function saveTransaction(type: EntryType, amount: number, detail: string) {
    const now = new Date();
    const cat = detectCategory(detail);
    const record: Entry = {
      id: now.getTime(),
      amount,
      detail,
      category: cat.name,
      icon: cat.icon,
      monthKey: getCurrentMonthKey(),
      date: now.toLocaleDateString("ur-PK"),
      time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
      timestamp: now.getTime(),
    };

    setDb((prev) =>
      type === "income"
        ? {
            ...prev,
            income: [...prev.income, record],
            undoStack: [...prev.undoStack, { type, record }],
          }
        : {
            ...prev,
            expense: [...prev.expense, record],
            undoStack: [...prev.undoStack, { type, record }],
          },
    );

    dialogRef.current = "IDLE";
    setPending(null);
    setTranscript(
      <>
        "{detail}"
        <br />
        <span className="text-emerald-300 text-sm font-bold">
          ✓ {amount} روپے ({cat.name}) درج ہو گئے۔
        </span>
      </>,
    );
    speakNaturalUrdu(`${amount} روپے درج ہو گئے۔`);
  }

  function confirmPending() {
    if (!pending) return;
    saveTransaction(pending.type, pending.amount, pending.detail);
  }

  function cancelPending() {
    setPending(null);
    dialogRef.current = "IDLE";
    setTranscript(<span className="text-rose-400 font-bold">درج رد کر دی گئی۔</span>);
    speakNaturalUrdu("درج رد کر دی گئی۔");
  }

  function handleUndo() {
    const current = dbRef.current;
    if (current.undoStack.length === 0) {
      const msg = "منسوخ کرنے کے لیے کوئی انٹری موجود نہیں ہے۔";
      setTranscript(<>{msg}</>);
      speakNaturalUrdu(msg);
      return;
    }
    const last = current.undoStack[current.undoStack.length - 1];
    setDb((prev) => ({
      income:
        last.type === "income"
          ? prev.income.filter((i) => i.id !== last.record.id)
          : prev.income,
      expense:
        last.type === "expense"
          ? prev.expense.filter((e) => e.id !== last.record.id)
          : prev.expense,
      undoStack: prev.undoStack.slice(0, -1),
    }));
    setTranscript(
      <span className="text-amber-300 font-bold">آخری انٹری منسوخ کر دی گئی۔</span>,
    );
    speakNaturalUrdu("آخری انٹری منسوخ کر دی گئی۔");
  }

  function getFinancialAdvice() {
    const current = dbRef.current;
    const { totalIncome, totalExpense } = getTotals(current, activeMonth);
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

    setTranscript(
      <span className="text-amber-300 text-sm font-bold">💡 مالیاتی مشورہ: {advice}</span>,
    );
    speakNaturalUrdu(advice);
  }

  async function runAi(question?: string) {
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await analyze({
        input: {
          monthKey: activeMonth,
          totals: {
            carryForward: totals.carryForward,
            totalIncome: totals.totalIncome,
            totalExpense: totals.totalExpense,
            balance: totals.balance,
          },
          categories: breakdown.map((c) => ({
            category: c.category,
            amount: c.amount,
            share: c.share,
          })),
          history: trend.map((t) => ({
            monthKey: t.monthKey,
            income: t.income,
            expense: t.expense,
          })),
          question,
        },
      });
      const shaped: AiInsight = {
        title: result.title,
        spoken: result.spoken,
        insight: result.insight,
        topCategory: result.topCategory,
        riskLevel: result.riskLevel,
      };
      setInsight(shaped);
      setTranscript(
        <span className="text-sky-300 text-sm font-bold">
          🤖 {shaped.title}: {shaped.insight}
        </span>,
      );
      if (shaped.spoken) speakNaturalUrdu(shaped.spoken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAiError(message);
      getFinancialAdvice();
    } finally {
      setAiBusy(false);
    }
  }

  function handleConversationalInput(text: string) {
    /* While a confirmation is pending, "ہاں / نہیں" decides that entry only —
       it must win over the generic undo keyword. */
    if (dialogRef.current === "WAITING_CONFIRM") {
      if (/نہیں|رد|نہ |مت کرو|نہیں چاہیے/i.test(text)) {
        cancelPending();
        return;
      }
      if (/ہاں|جی|ٹھیک|تصدیق|کر دو|کرو|ہو جاوے/i.test(text)) {
        confirmPending();
        return;
      }
      setTranscript(
        <span className="text-rose-400 text-sm font-bold">
          "ہاں" یا "نہیں" میں سے ایک بولیں۔
        </span>,
      );
      speakNaturalUrdu("ہاں یا نہیں میں سے ایک بولیں۔");
      return;
    }

    if (/غلطی|واپس|انڈو|منسوخ/i.test(text)) {
      handleUndo();
      return;
    }

    if (dialogRef.current === "WAITING_INCOME_DETAIL") {
      saveTransaction("income", pendingRef.current, text);
      pendingRef.current = 0;
      return;
    }

    if (dialogRef.current === "WAITING_EXPENSE_DETAIL") {
      saveTransaction("expense", pendingRef.current, text);
      pendingRef.current = 0;
      return;
    }

    const numMatch = text.match(/\d+/);
    if (!numMatch) {
      if (/مشورہ|ایڈوائس|بجٹ|تجزیہ/i.test(text)) {
        void runAi(text);
        return;
      }
      const msg = "نبیل بھائی، براہ کرم رقم واضح بولیں۔";
      setTranscript(
        <>
          "{text}"
          <br />
          <span className="text-rose-400 text-sm">{msg}</span>
        </>,
      );
      speakNaturalUrdu(msg);
      return;
    }

    const amount = parseInt(numMatch[0], 10);
    const isIncome = /جمع|آمدنی|ملے|کرایه|پرافٹ|آئے|رقم|ایڈ/i.test(text);
    const isExpense = /خرچ|دیا|کٹے|خریدا/i.test(text);
    const hasDetail =
      text
        .replace(numMatch[0], "")
        .replace(/روپے|روپیہ|جمع|کر|دو|لیں|ایڈ|کریں|گئے|تھے/g, "")
        .trim().length > 3;

    if (hasDetail) {
      const type: EntryType = isIncome && !isExpense ? "income" : "expense";
      setPending({ type, amount, detail: text });
      dialogRef.current = "WAITING_CONFIRM";
      const qMsg = `${amount} روپے ${type === "income" ? "آمدنی" : "خرچہ"} درج کروں؟`;
      setTranscript(
        <>
          "{text}"
          <br />
          <span className="text-amber-300 text-sm font-bold">❓ {qMsg}</span>
          <br />
          <span className="text-xs text-white/50 font-sans">
            بولیں "ہاں" یا "نہیں" — یا نیچے کلک کریں
          </span>
          <div className="flex gap-2 justify-center mt-2 font-sans text-xs">
            <button
              onClick={confirmPending}
              className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 px-4 py-1.5 rounded-full"
            >
              ✓ ہاں، درج کریں
            </button>
            <button
              onClick={cancelPending}
              className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 px-4 py-1.5 rounded-full"
            >
              ✕ نہیں
            </button>
          </div>
        </>,
      );
      speakNaturalUrdu(qMsg);
      return;
    }

    pendingRef.current = amount;
    if (isIncome && !isExpense) {
      dialogRef.current = "WAITING_INCOME_DETAIL";
      const qMsg = `آپ جو ${amount} روپے ایڈ کر رہے ہیں، یہ کہاں سے آئے ہیں؟ وضاحت کریں۔`;
      setTranscript(
        <>
          "{text}"
          <br />
          <span className="text-amber-300 text-sm font-bold">❓ {qMsg}</span>
        </>,
      );
      speakNaturalUrdu(qMsg);
    } else {
      dialogRef.current = "WAITING_EXPENSE_DETAIL";
      const qMsg = `آپ جو ${amount} روپے خرچ کر رہے ہیں، یہ کس کام کے لیے خرچ ہوئے؟ وضاحت کریں۔`;
      setTranscript(
        <>
          "{text}"
          <br />
          <span className="text-amber-300 text-sm font-bold">❓ {qMsg}</span>
        </>,
      );
      speakNaturalUrdu(qMsg);
    }
  }

  /* Keep the speech handlers pointing at the freshest logic */
  useEffect(() => {
    conversationRef.current = handleConversationalInput;
  });

  /* -------------------- speech engines -------------------- */
  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.lang = "ur-PK";
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      setTranscript(<span className="text-sky-300 font-bold">منشی سن رہا ہے... فرمائیے!</span>);
    };
    recognition.onresult = (event) => {
      conversationRef.current(event.results[0][0].transcript);
    };
    recognition.onerror = () => {
      setTranscript(<>آواز واضح نہیں آئی، دوبارہ کوشش کریں۔</>);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
      try {
        wakeRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  /* Passive wake word ("اے منشی") — armed on the first user gesture so the
     browser never asks for the microphone before the visitor has touched
     anything. */
  useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    let wakeFailed = false;
    const armWakeWord = () => {
      window.removeEventListener("pointerdown", armWakeWord);
      window.removeEventListener("keydown", armWakeWord);
      try {
        const wake = new SpeechRecognitionCtor();
        wake.continuous = true;
        wake.lang = "ur-PK";
        wake.interimResults = true;
        wake.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const text = event.results[i][0].transcript;
            if (/منشی|اے منشی|صوتی بقیہ/i.test(text)) {
              wake.stop();
              speakNaturalUrdu("جی نابل بھائی، میں سن رہا ہوں۔");
              setTimeout(() => {
                try {
                  recognitionRef.current?.start();
                } catch {
                  /* already running */
                }
              }, 1200);
            }
          }
        };
        wake.onerror = () => {
          wakeFailed = true;
        };
        wake.onend = () => {
          if (!wakeFailed && !listeningRef.current) {
            try {
              wake.start();
            } catch {
              /* ignore */
            }
          }
        };
        wakeRef.current = wake;
        wake.start();
      } catch {
        /* wake word unavailable — the mic button still works */
      }
    };

    window.addEventListener("pointerdown", armWakeWord);
    window.addEventListener("keydown", armWakeWord);
    return () => {
      window.removeEventListener("pointerdown", armWakeWord);
      window.removeEventListener("keydown", armWakeWord);
    };
  }, []);

  function toggleMic() {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setTranscript(<>یہ براؤزر آواز کی سہولت نہیں دیتا۔ برائے مہربانی Chrome استعمال کریں۔</>);
      return;
    }
    if (listeningRef.current) {
      recognition.stop();
    } else {
      recognition.start();
    }
  }

  /* -------------------- horizon arc visualizer -------------------- */
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
      const listening = listeningRef.current;
      const baseLine = canvas.height;
      const apexY = listening ? baseLine - 90 - Math.sin(time * 2) * 15 : baseLine - 45;

      ctx.beginPath();
      ctx.moveTo(0, baseLine);
      ctx.quadraticCurveTo(canvas.width / 2, apexY, canvas.width, baseLine);

      const gradient = ctx.createLinearGradient(0, apexY, 0, baseLine);
      if (listening) {
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
      ctx.strokeStyle = listening
        ? "rgba(186, 230, 253, 0.9)"
        : "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = listening ? 3 : 1;
      ctx.stroke();

      if (listening) time += 0.05;
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  /* -------------------- ledger editing -------------------- */
  function deleteEntry(type: EntryType, item: Entry) {
    setDb((prev) => ({
      ...prev,
      income: type === "income" ? prev.income.filter((i) => i.id !== item.id) : prev.income,
      expense:
        type === "expense" ? prev.expense.filter((e) => e.id !== item.id) : prev.expense,
      undoStack: prev.undoStack.filter((u) => u.record.id !== item.id),
    }));
  }

  function startEdit(item: Entry) {
    setEditingId(item.id);
    setEditDraft({
      amount: String(item.amount),
      detail: item.detail,
      category: item.category,
    });
  }

  function commitEdit(type: EntryType) {
    const amount = Number.parseFloat(editDraft.amount);
    if (editingId === null || !Number.isFinite(amount)) return;
    const cat = editDraft.detail.trim()
      ? detectCategory(editDraft.detail)
      : { name: editDraft.category, icon: "fa-receipt" };
    setDb((prev) => ({
      ...prev,
      income:
        type === "income"
          ? prev.income.map((i) =>
              i.id === editingId
                ? {
                    ...i,
                    amount,
                    detail: editDraft.detail,
                    category: editDraft.category || cat.name,
                    icon:
                      CATEGORY_CATALOG.find((c) => c.name === (editDraft.category || cat.name))
                        ?.icon ?? cat.icon,
                  }
                : i,
            )
          : prev.income,
      expense:
        type === "expense"
          ? prev.expense.map((e) =>
              e.id === editingId
                ? {
                    ...e,
                    amount,
                    detail: editDraft.detail,
                    category: editDraft.category || cat.name,
                    icon:
                      CATEGORY_CATALOG.find((c) => c.name === (editDraft.category || cat.name))
                        ?.icon ?? cat.icon,
                  }
                : e,
            )
          : prev.expense,
    }));
    setEditingId(null);
  }

  function addManualEntry(type: EntryType) {
    const amount = Number.parseFloat(manual.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const now = new Date();
    const cat = manual.detail.trim()
      ? detectCategory(manual.detail)
      : { name: manual.category, icon: "fa-receipt" };
    const category = manual.category || cat.name;
    const record: Entry = {
      id: now.getTime(),
      amount,
      detail: manual.detail.trim() || category,
      category,
      icon:
        CATEGORY_CATALOG.find((c) => c.name === category)?.icon ?? cat.icon,
      monthKey: getCurrentMonthKey(),
      date: now.toLocaleDateString("ur-PK"),
      time: now.toLocaleTimeString("ur-PK", { hour: "2-digit", minute: "2-digit" }),
      timestamp: now.getTime(),
    };
    setDb((prev) =>
      type === "income"
        ? {
            ...prev,
            income: [...prev.income, record],
            undoStack: [...prev.undoStack, { type, record }],
          }
        : {
            ...prev,
            expense: [...prev.expense, record],
            undoStack: [...prev.undoStack, { type, record }],
          },
    );
    setManual({ amount: "", detail: "", category: "عام" });
    setManualOpen(false);
  }

  /* -------------------- backup & restore -------------------- */
  function exportData() {
    const blob = new Blob([buildCsv(dbRef.current)], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sauti_baqaya_ultimate_report.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function shareWhatsApp() {
    const monthName = formatMonthName(activeMonth);
    let msg = `*📒 صوتی بقیہ - الٹیمیٹ پورٹ رپورٹ (${monthName})*\n`;
    msg += `-----------------------------------\n`;
    if (totals.carryForward > 0) msg += `📌 پچھلا بقایا کیش: Rs. ${totals.carryForward}\n`;
    msg += `💰 کل رقم: Rs. ${totals.totalIncome}\n`;
    msg += `💸 کل خرچہ: Rs. ${totals.totalExpense}\n`;
    msg += `💵 موجودہ بقایا: Rs. ${totals.balance}\n`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  }

  function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      try {
        if (file.name.toLowerCase().endsWith(".json")) {
          const parsed = JSON.parse(text) as Partial<DataState>;
          const income = Array.isArray(parsed.income) ? parsed.income : [];
          const expense = Array.isArray(parsed.expense) ? parsed.expense : [];
          setDb((prev) => ({
            ...prev,
            income: [...prev.income, ...income],
            expense: [...prev.expense, ...expense],
          }));
          setImportMsg(`JSON سے ${income.length + expense.length} انٹریز درج ہو گئیں۔`);
        } else {
          const { income, expense } = entriesFromCsv(text);
          setDb((prev) => ({
            ...prev,
            income: [...prev.income, ...income],
            expense: [...prev.expense, ...expense],
          }));
          setImportMsg(`CSV سے ${income.length + expense.length} انٹریز درج ہو گئیں۔`);
        }
      } catch {
        setImportMsg("فائل پڑھی نہیں جا سکی — براہِ کرم درست CSV/JSON فائل منتخب کریں۔");
      }
    };
    reader.readAsText(file);
  }

  /* -------------------- cloud sync -------------------- */
  async function uploadToCloud() {
    if (!isAuthenticated) {
      setSyncMsg("پہلے سائن ان کریں تاکہ ڈیٹا کلاؤڈ پر محفوظ ہو۔");
      return;
    }
    setSyncMsg("سینک ہو رہا ہے…");
    try {
      const rows: CloudRow[] = [
        ...dbRef.current.income.map((e) => ({
          localId: e.id,
          kind: "income" as const,
          amount: e.amount,
          detail: e.detail,
          category: e.category,
          icon: e.icon,
          monthKey: e.monthKey,
          date: e.date,
          time: e.time,
          timestamp: e.timestamp,
        })),
        ...dbRef.current.expense.map((e) => ({
          localId: e.id,
          kind: "expense" as const,
          amount: e.amount,
          detail: e.detail,
          category: e.category,
          icon: e.icon,
          monthKey: e.monthKey,
          date: e.date,
          time: e.time,
          timestamp: e.timestamp,
        })),
      ];
      const result = await replaceRecords({ records: rows });
      setSyncMsg(`${result.synced} انٹریز کلاؤڈ پر محفوظ ہو گئیں۔`);
    } catch (error) {
      setSyncMsg(error instanceof Error ? error.message : "سینک ناکام ہو گیا۔");
    }
  }

  async function downloadFromCloud() {
    if (!isAuthenticated || !cloudRecords) {
      setSyncMsg("کلاؤڈ ڈیٹا دستیاب نہیں۔");
      return;
    }
    const income: Entry[] = [];
    const expense: Entry[] = [];
    cloudRecords.forEach((row) => {
      const entry: Entry = {
        id: row.localId,
        amount: row.amount,
        detail: row.detail,
        category: row.category,
        icon: row.icon,
        monthKey: row.monthKey,
        date: row.date,
        time: row.time,
        timestamp: row.timestamp,
      };
      (row.kind === "income" ? income : expense).push(entry);
    });
    setDb({ income, expense, undoStack: [] });
    setSyncMsg(`کلاؤڈ سے ${income.length + expense.length} انٹریز واپس آ گئیں۔`);
  }

  async function persistCloudSettings() {
    if (!isAuthenticated) {
      setSyncMsg("سیٹنگز محفوظ کرنے کے لیے سائن ان کریں۔");
      return;
    }
    try {
      await saveCloudSettings({ budgets, recurring });
      setSyncMsg("سیٹنگز محفوظ ہو گئیں۔");
    } catch (error) {
      setSyncMsg(error instanceof Error ? error.message : "سیٹنگز سیو نہیں ہو سکیں۔");
    }
  }

  function openSettings() {
    const local = localStorage.getItem(API_KEY_STORAGE);
    if (!keySaved && local) setApiKeyDraft(local);
    setSettingsOpen(true);
    setSyncMsg("");
    setImportMsg("");
  }

  async function saveApiKey() {
    const key = apiKeyDraft.trim();
    if (!key || key === "••••••••") {
      setSettingsOpen(false);
      return;
    }
    if (isAuthenticated) {
      try {
        await setGeminiKey({ key });
        localStorage.removeItem(API_KEY_STORAGE);
        setKeySaved(true);
        setApiKeyDraft("••••••••");
        setSyncMsg("اے آئی کی محفوظ ہو گئی (سرور پر)۔");
      } catch (error) {
        setSyncMsg(
          error instanceof Error
            ? error.message
            : "کی سیو نہیں ہو سکی — لوکل سیو کر دی گئی۔",
        );
        localStorage.setItem(API_KEY_STORAGE, key);
      }
    } else {
      localStorage.setItem(API_KEY_STORAGE, key);
      setSyncMsg("کی اسی ڈیوائس پر محفوظ ہو گئی۔ سرور پر محفوظ کرنے کے لیے سائن ان کریں۔");
    }
    setSettingsOpen(false);
    speakNaturalUrdu("سیٹنگز اور کلاؤڈ اے آئی کی سیو ہو گئی ہے۔");
  }

  function toggleDigitStyle(style: DigitStyle) {
    setPrefs((prev) => ({ ...prev, digitStyle: style }));
  }

  /* -------------------- notepad modal -------------------- */
  function openModal(type: EntryType) {
    setHistoryType(type);
    setNotepadQuery("");
    setNotepadCategory("all");
    setEditingId(null);
    setManualOpen(false);
    setManual({ amount: "", detail: "", category: "عام" });
  }

  function filterEntries(list: Entry[]): Entry[] {
    const q = notepadQuery.trim();
    return list
      .filter((item) => monthOf(item) === activeMonth)
      .filter((item) => notepadCategory === "all" || item.category === notepadCategory)
      .filter((item) => {
        if (!q) return true;
        return `${item.detail} ${item.category} ${item.amount}`.includes(q);
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function renderEditForm(type: EntryType) {
    return (
      <div className="space-y-2 font-sans">
        <div className="flex gap-2">
          <input
            type="number"
            className={inputCls}
            value={editDraft.amount}
            onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
            placeholder="رقم"
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
          placeholder="تفصیل"
        />
        <div className="flex gap-2">
          <button
            onClick={() => commitEdit(type)}
            className={`${smallBtn} flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40`}
          >
            ✓ محفوظ کریں
          </button>
          <button
            onClick={() => setEditingId(null)}
            className={`${smallBtn} flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20`}
          >
            ✕ منسوخ
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
          renderEditForm(type)
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
                  {formatNumber(item.amount, prefs.digitStyle)} روپے
                </span>
                <button
                  onClick={() => startEdit(item)}
                  title="ترمیم"
                  className="text-white/40 hover:text-white transition"
                >
                  <i className="fas fa-pen text-xs"></i>
                </button>
                <button
                  onClick={() => deleteEntry(type, item)}
                  title="حذف کریں"
                  className="text-rose-400/70 hover:text-rose-300 transition"
                >
                  <i className="fas fa-trash text-xs"></i>
                </button>
              </div>
            </div>
            <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
              📝 <strong>تفصیل:</strong> {item.detail}
            </div>
          </>
        )}
      </div>
    );
  }

  function renderNotepad() {
    if (historyType === "income") {
      const carryForward = totals.carryForward;
      const source = filterEntries(db.income);
      if (source.length === 0 && carryForward <= 0 && !notepadQuery && notepadCategory === "all") {
        return (
          <p className="text-center text-white/40 py-10 text-sm">
            ({formatMonthName(activeMonth)}) کے لیے کوئی انٹری موجود نہیں ہے۔
          </p>
        );
      }
      return (
        <>
          {carryForward > 0 && notepadQuery === "" && notepadCategory === "all" && (
            <div className="bg-sky-950/40 border border-sky-500/30 p-3.5 rounded-xl flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-sans text-sky-300/80">
                  آغاز بیلنس • پچھلا مہینہ
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-sky-500/20 text-sky-300 border-sky-500/40">
                  +{formatNumber(carryForward, prefs.digitStyle)} روپے
                </span>
              </div>
              <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
                📒 <strong>تفصیل:</strong> پچھلے مہینے سے منتقل ہونے والا بقایا کیش
              </div>
            </div>
          )}
          {source.map((item) => renderEntryCard("income", item))}
          {source.length === 0 && (notepadQuery || notepadCategory !== "all") && (
            <p className="text-center text-white/40 py-8 text-sm">کوئی ممکنہ انٹری نہیں ملی۔</p>
          )}
        </>
      );
    }

    const source = filterEntries(db.expense);
    if (source.length === 0) {
      return (
        <p className="text-center text-white/40 py-10 text-sm">
          {notepadQuery || notepadCategory !== "all"
            ? "کوئی ممکنہ انٹری نہیں ملی۔"
            : `(${formatMonthName(activeMonth)}) کے لیے کوئی انٹری موجود نہیں ہے۔`}
        </p>
      );
    }
    return <>{source.map((item) => renderEntryCard("expense", item))}</>;
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <div
      dir="rtl"
      className="sauti-app min-h-screen flex items-center justify-center p-3 sm:p-6"
    >
      <div className="ambient-bg" />

      {/* Main App Container */}
      <div className="glass-panel w-full max-w-xl min-h-[90vh] flex flex-col relative overflow-hidden my-auto">
        {/* Header Section */}
        <div className="p-4 sm:p-6 border-b border-white/10">
          <div className="flex justify-between items-center text-[11px] sm:text-xs tracking-widest text-white/50 font-sans mb-3">
            <span className="flex items-center gap-1">
              <i className="fas fa-satellite-dish text-emerald-400"></i> WAKE WORD ACTIVE
            </span>
            <span>SPECTRAL GRID</span>
            <span className="text-white/90 font-bold text-base sm:text-lg flex items-center gap-1.5">
              <i className="fas fa-brain text-sky-400"></i> صوتی بقیہ (پرو اسسٹنٹ)
            </span>
          </div>

          {/* Month Selector & Quick Actions */}
          <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-2xl p-2.5 mb-3 gap-2">
            <div className="flex items-center gap-2 text-xs text-white/80 font-bold">
              <i className="fas fa-calendar-alt text-sky-400"></i>
              <select
                value={activeMonth}
                onChange={(e) => setActiveMonth(e.target.value)}
                className="bg-black/40 border border-white/20 text-white text-xs rounded-xl px-2.5 py-1 focus:outline-none focus:border-sky-400 font-sans cursor-pointer"
              >
                {monthOptions.map((mKey) => (
                  <option key={mKey} value={mKey}>
                    {formatMonthName(mKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => (hasAiKey ? void runAi() : getFinancialAdvice())}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
              >
                <i className="fas fa-lightbulb"></i> {aiBusy ? "…" : "مشورہ"}
              </button>
              <button
                onClick={() => setAnalyticsOpen(true)}
                className="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
              >
                <i className="fas fa-chart-pie"></i> چارٹس
              </button>
              <button
                onClick={openSettings}
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
              <span>"اے منشی" وائس ایکٹیو →</span>
            </div>
            <button
              onClick={exportData}
              className="px-3 py-1 rounded-full border border-white/20 text-white/70 hover:bg-white/10 hover:text-white transition"
            >
              <i className="fas fa-file-csv ml-1"></i> CSV بیک اپ
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
                کل رقم
              </span>
              <span className="text-lg sm:text-2xl font-bold text-emerald-400">
                {formatNumber(totals.totalIncome, prefs.digitStyle)}
              </span>
              <span className="text-[9px] text-white/30 font-sans mt-1">
                نوٹ پیڈ کھولیں →
              </span>
            </div>

            {/* 2. خرچہ (Expense Box) */}
            <div
              onClick={() => openModal("expense")}
              className="bg-white/5 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition group"
            >
              <span className="text-white/60 text-xs sm:text-sm mb-1 group-hover:text-white/85">
                خرچہ
              </span>
              <span className="text-lg sm:text-2xl font-bold text-rose-400">
                {formatNumber(totals.totalExpense, prefs.digitStyle)}
              </span>
              <span className="text-[9px] text-white/30 font-sans mt-1">
                نوٹ پیڈ کھولیں →
              </span>
            </div>

            {/* 3. بقایا (Balance Box) */}
            <div className="bg-white/10 border border-white/20 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none"></div>
              <span className="text-white/80 text-xs sm:text-sm mb-1 relative z-10 font-bold">
                بقایا
              </span>
              <span className="text-xl sm:text-3xl font-bold text-white relative z-10">
                {formatNumber(totals.balance, prefs.digitStyle)}
              </span>
              <span
                className={`text-[9px] font-sans mt-1 relative z-10 ${
                  isCurrentMonth ? "text-sky-300/80" : "text-amber-300/80"
                }`}
              >
                {isCurrentMonth ? "موجودہ مہینہ" : "آرکائیو شدہ ریکارڈ"}
              </span>
            </div>
          </div>

          {/* Speech Output Display */}
          <div className="flex flex-col items-center justify-center my-auto space-y-4 text-center">
            <div className="bg-black/20 border border-white/10 rounded-2xl p-4 w-full max-w-md min-h-[100px] flex items-center justify-center">
              <p className="text-base sm:text-lg text-white/80 leading-relaxed">{transcript}</p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 justify-center text-xs font-sans">
              <button
                onClick={handleUndo}
                className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 px-4 py-2 rounded-full transition shadow-lg"
              >
                ↩ آخری انٹری منسوخ کریں
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Mic Section & Glowing Horizon Arc */}
        <div className="relative h-40 flex items-end justify-center pb-8 border-t border-white/5 mt-auto">
          <canvas id="horizon-canvas" ref={canvasRef}></canvas>

          {/* Mic Button */}
          <button
            onClick={toggleMic}
            className={`mic-btn w-20 h-20 sm:w-22 sm:h-22 rounded-full flex items-center justify-center z-10 shadow-2xl ${
              isListening ? "listening" : ""
            }`}
          >
            <i className="fas fa-microphone text-2xl sm:text-3xl text-white"></i>
          </button>

          <div className="absolute bottom-5 left-6 text-white/20 text-2xl font-sans pointer-events-none">
            ✻
          </div>
        </div>
      </div>

      {/* Notepad Details Modal */}
      {historyType !== null && (
        <div className="modal">
          <div className="glass-panel w-full max-w-lg m-4 p-6 max-h-[85vh] flex flex-col relative">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {historyType === "income" ? (
                  <>
                    <i className="fas fa-file-alt text-emerald-400"></i> کل رقم (بشمول پچھلا
                    بقایا) - ({formatMonthName(activeMonth)})
                  </>
                ) : (
                  <>
                    <i className="fas fa-file-alt text-rose-400"></i> خرچہ - (
                    {formatMonthName(activeMonth)})
                  </>
                )}
              </h2>
              <button
                onClick={() => setHistoryType(null)}
                className="text-white/50 hover:text-white transition"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>

            {/* Search, filter and quick add */}
            <div className="flex gap-2 mb-3 font-sans">
              <input
                className={inputCls}
                placeholder="تلاش کریں…"
                value={notepadQuery}
                onChange={(e) => setNotepadQuery(e.target.value)}
              />
              <select
                className={inputCls}
                value={notepadCategory}
                onChange={(e) => setNotepadCategory(e.target.value)}
              >
                <option value="all">تمام categories</option>
                {knownCategories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setManualOpen((v) => !v)}
                className={`${smallBtn} shrink-0 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40`}
              >
                <i className="fas fa-plus"></i> نئی
              </button>
            </div>

            {manualOpen && (
              <div className="bg-black/30 border border-white/10 rounded-xl p-3 mb-3 space-y-2 font-sans">
                <div className="flex gap-2">
                  <input
                    type="number"
                    className={inputCls}
                    placeholder="رقم"
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
                  placeholder="تفصیل (اختیاری)"
                  value={manual.detail}
                  onChange={(e) => setManual({ ...manual, detail: e.target.value })}
                />
                <button
                  onClick={() => addManualEntry(historyType)}
                  className="w-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 py-2 rounded-xl text-xs font-bold"
                >
                  + {historyType === "income" ? "آمدنی" : "خرچہ"} درج کریں
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
                <i className="fab fa-whatsapp text-xl"></i> اس مہینے کی رپورٹ واٹس ایپ پر شیئر
                کریں
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Charts Modal */}
      {analyticsOpen && (
        <div className="modal">
          <div className="glass-panel w-full max-w-lg m-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col relative font-sans">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <i className="fas fa-chart-pie text-sky-400"></i> ماہانہ خرچ و آمدنی کا گراف
              </h2>
              <button
                onClick={() => setAnalyticsOpen(false)}
                className="text-white/50 hover:text-white transition"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>

            <div className="bg-black/30 p-4 rounded-2xl border border-white/10 mb-3">
              <MonthlyDoughnut income={totals.totalIncome} expense={totals.totalExpense} />
            </div>

            <h3 className="text-sm font-bold text-white/80 mb-2">
              <i className="fas fa-chart-line text-sky-400 ml-1"></i> پچھلے 6 ماہ کا رجحان
            </h3>
            <div className="bg-black/30 p-4 rounded-2xl border border-white/10 mb-3">
              <TrendLineChart
                labels={trend.map((t) => formatMonthName(t.monthKey).split(" ")[0])}
                income={trend.map((t) => t.income)}
                expense={trend.map((t) => t.expense)}
              />
            </div>

            {breakdown.length > 0 && (
              <>
                <h3 className="text-sm font-bold text-white/80 mb-2">
                  <i className="fas fa-layer-group text-sky-400 ml-1"></i> category وار خرچہ
                </h3>
                <div className="bg-black/30 p-4 rounded-2xl border border-white/10 mb-3">
                  <CategoryBarChart
                    labels={breakdown.map((b) => b.category)}
                    data={breakdown.map((b) => b.amount)}
                  />
                </div>
              </>
            )}

            {budgetAlerts.length > 0 && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 mb-3 text-xs text-rose-200">
                {budgetAlerts.map((alert) => (
                  <div key={alert.category} className="flex justify-between">
                    <span>
                      <i className="fas fa-triangle-exclamation ml-1"></i> {alert.category}{" "}
                      بجٹ ختم
                    </span>
                    <span>
                      {formatNumber(alert.spent, prefs.digitStyle)} /{" "}
                      {formatNumber(alert.limit, prefs.digitStyle)} روپے
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
              {aiBusy ? "تجزیہ تیار ہو رہا ہے…" : "🤖 اے آئی سے تجزیہ کروائیں"}
            </button>

            {!hasAiKey && (
              <p className="text-[11px] text-white/50 mt-2">
                اے آئی کے لیے ⚙️ سیٹنگز میں Gemini API Key درج کریں۔
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
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal">
          <div className="glass-panel w-full max-w-md m-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col relative font-sans">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <i className="fas fa-key text-sky-400"></i> جیمینی اے آئی سیٹنگز
              </h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-white/50 hover:text-white transition"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>

            {/* Gemini key */}
            <div className="space-y-2 text-sm text-white/80 mb-5">
              <p>ذہین جیمینی اے آئی اور کلاؤڈ انٹیلی جنس کے لیے اپنی API Key درج کریں:</p>
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
                سیو کریں
              </button>
            </div>

            {/* Digit style */}
            <div className="mb-5">
              <h3 className="text-sm font-bold text-white/85 mb-2">اندازِ شمار</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleDigitStyle("ur")}
                  className={`${smallBtn} flex-1 ${
                    prefs.digitStyle === "ur"
                      ? "bg-sky-500/25 text-sky-200 border-sky-400/50"
                      : "bg-white/5 text-white/70 border-white/20"
                  }`}
                >
                  اردو ہندسے (۵۰۰)
                </button>
                <button
                  onClick={() => toggleDigitStyle("latin")}
                  className={`${smallBtn} flex-1 ${
                    prefs.digitStyle === "latin"
                      ? "bg-sky-500/25 text-sky-200 border-sky-400/50"
                      : "bg-white/5 text-white/70 border-white/20"
                  }`}
                >
                  Roman (500)
                </button>
              </div>
            </div>

            {/* Budgets */}
            <div className="mb-5">
              <h3 className="text-sm font-bold text-white/85 mb-2">
                <i className="fas fa-bullseye text-rose-300 ml-1"></i> category بجٹ (ماہانہ)
              </h3>
              <div className="space-y-2">
                {CATEGORY_CATALOG.map((category) => {
                  const budget = budgets.find((b) => b.category === category.name);
                  return (
                    <div key={category.name} className="flex items-center gap-2">
                      <span className="text-xs text-white/70 w-24 shrink-0">
                        {category.name}
                      </span>
                      <input
                        type="number"
                        className={inputCls}
                        placeholder="0"
                        value={budget ? budget.limit : ""}
                        onChange={(e) => {
                          const limit = Number.parseFloat(e.target.value) || 0;
                          setBudgets((prev) => {
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
                onClick={() => void persistCloudSettings()}
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
              {recurring.length > 0 && (
                <div className="space-y-1.5 mb-2">
                  {recurring.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={(e) =>
                          setRecurring((prev) =>
                            prev.map((r) =>
                              r.id === entry.id
                                ? { ...r, enabled: e.target.checked }
                                : r,
                            ),
                          )
                        }
                      />
                      <span className="flex-1 text-white/80">{entry.label}</span>
                      <span className="text-emerald-300">
                        {formatNumber(entry.amount, prefs.digitStyle)} روپے
                      </span>
                      <button
                        onClick={() =>
                          setRecurring((prev) => prev.filter((r) => r.id !== entry.id))
                        }
                        className="text-rose-400/70 hover:text-rose-300"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="عنوان (مثلاً تنخواہ)"
                  value={recurringDraft.label}
                  onChange={(e) =>
                    setRecurringDraft({ ...recurringDraft, label: e.target.value })
                  }
                />
                <input
                  type="number"
                  className={inputCls}
                  placeholder="رقم"
                  value={recurringDraft.amount}
                  onChange={(e) =>
                    setRecurringDraft({ ...recurringDraft, amount: e.target.value })
                  }
                />
              </div>
              <button
                onClick={() => {
                  const amount = Number.parseFloat(recurringDraft.amount);
                  const label = recurringDraft.label.trim();
                  if (!label || !Number.isFinite(amount)) return;
                  setRecurring((prev) => [
                    ...prev,
                    { id: `${Date.now()}`, label, amount, enabled: true },
                  ]);
                  setRecurringDraft({ label: "", amount: "" });
                }}
                className={`${smallBtn} w-full mt-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40`}
              >
                + شامل کریں
              </button>
              <button
                onClick={() => void persistCloudSettings()}
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
              {isAuthenticated ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => void uploadToCloud()}
                    className={`${smallBtn} flex-1 bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40`}
                  >
                    <i className="fas fa-cloud-arrow-up"></i> اپ لوڈ
                  </button>
                  <button
                    onClick={() => void downloadFromCloud()}
                    className={`${smallBtn} flex-1 bg-white/10 hover:bg-white/20 text-white border-white/20`}
                  >
                    <i className="fas fa-cloud-arrow-down"></i> ڈاؤن لوڈ
                  </button>
                  <button
                    onClick={() => void signOut()}
                    className={`${smallBtn} bg-white/5 hover:bg-white/10 text-white/70 border-white/20`}
                  >
                    <i className="fas fa-right-from-bracket"></i>
                  </button>
                </div>
              ) : (
                <a
                  href="/auth?returnTo=/"
                  className={`${smallBtn} w-full justify-center bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border-sky-500/40 no-underline`}
                >
                  <i className="fas fa-right-to-bracket"></i> سائن ان کریں تاکہ ڈیٹا کلاؤڈ پر رہے
                </a>
              )}
              {syncMsg && <p className="text-[11px] text-white/60 mt-2">{syncMsg}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
