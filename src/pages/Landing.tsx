/**
 * صوتی بقیہ — پاور فل اے آئی منشی
 * Voice-controlled Urdu finance assistant (income / expense / balance).
 *
 * Faithful React port of the original single-file HTML app: same layout, same
 * glassmorphism theme, same voice commands, same localStorage records, same
 * notepad detail modal, doughnut analytics chart, WhatsApp report & CSV backup.
 */
import Chart from "chart.js/auto";
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

/* ------------------------------------------------------------------ */
/* Data model & pure helpers                                           */
/* ------------------------------------------------------------------ */
type Entry = {
  id: number;
  amount: number;
  detail: string;
  category: string;
  icon: string;
  monthKey: string;
  date: string;
  time: string;
  timestamp: number;
};

type UndoEntry = { type: "income" | "expense"; record: Entry };

type DataState = {
  income: Entry[];
  expense: Entry[];
  undoStack: UndoEntry[];
};

type DialogState = "IDLE" | "WAITING_INCOME_DETAIL" | "WAITING_EXPENSE_DETAIL";
type EntryType = "income" | "expense";

const STORAGE_KEY = "nabeelUltimateMasterRecord";
const API_KEY_STORAGE = "nabeelGeminiApiKey";

const MONTH_NAMES: Record<string, string> = {
  "01": "جنوری",
  "02": "فروری",
  "03": "مارچ",
  "04": "اپریل",
  "05": "مئی",
  "06": "جون",
  "07": "جولائی",
  "08": "اگست",
  "09": "ستمبر",
  "10": "اکتوبر",
  "11": "نومبر",
  "12": "دسمبر",
};

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getPreviousMonthKey(mKey: string): string {
  let [y, m] = mKey.split("-").map(Number);
  m--;
  if (m < 1) {
    m = 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function formatMonthName(mKey: string): string {
  const [year, month] = mKey.split("-");
  return `${MONTH_NAMES[month] ?? month} ${year}`;
}

function monthOf(entry: { monthKey?: string }): string {
  return entry.monthKey || getCurrentMonthKey();
}

function sumFor(list: Entry[], mKey: string): number {
  return list
    .filter((item) => monthOf(item) === mKey)
    .reduce((sum, item) => sum + item.amount, 0);
}

function getMonthEndingBalance(db: DataState, mKey: string): number {
  const income = sumFor(db.income, mKey);
  const expense = sumFor(db.expense, mKey);
  return getMonthCarryForward(db, mKey) + income - expense;
}

function getMonthCarryForward(db: DataState, mKey: string): number {
  const prevKey = getPreviousMonthKey(mKey);
  const hasPrevData =
    db.income.some((i) => monthOf(i) === prevKey) ||
    db.expense.some((e) => monthOf(e) === prevKey);
  if (!hasPrevData) {
    const hasOlder =
      db.income.some((i) => monthOf(i) < mKey) ||
      db.expense.some((e) => monthOf(e) < mKey);
    if (!hasOlder) return 0;
  }
  return getMonthEndingBalance(db, prevKey);
}

function getTotals(db: DataState, activeMonth: string) {
  const carryForward = getMonthCarryForward(db, activeMonth);
  const directIncome = sumFor(db.income, activeMonth);
  const totalIncome = carryForward + directIncome;
  const totalExpense = sumFor(db.expense, activeMonth);
  const balance = totalIncome - totalExpense;
  return { carryForward, directIncome, totalIncome, totalExpense, balance };
}

function detectCategory(text: string): { name: string; icon: string } {
  if (/پٹرول|پیٹرول|سفر|گاڑی|بائیک/i.test(text)) return { name: "سفر", icon: "fa-gas-pump" };
  if (/چائے|کھانا|روٹی|پانی|ہوٹل/i.test(text)) return { name: "کھانا", icon: "fa-utensils" };
  if (/بل|بجلی|گیس|انٹرنیٹ/i.test(text)) return { name: "یوٹیلیٹی بل", icon: "fa-bolt" };
  if (/ادھار|قرض|واپسی/i.test(text)) return { name: "ادھار کھاتہ", icon: "fa-hand-holding-usd" };
  if (/دوکان|سامان|مال|دکان/i.test(text)) return { name: "دوکان", icon: "fa-store" };
  return { name: "عام", icon: "fa-receipt" };
}

function loadData(): DataState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { income: [], expense: [], undoStack: [] };
    const parsed = JSON.parse(raw) as Partial<DataState>;
    return {
      income: Array.isArray(parsed.income) ? parsed.income : [],
      expense: Array.isArray(parsed.expense) ? parsed.expense : [],
      undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
    };
  } catch {
    return { income: [], expense: [], undoStack: [] };
  }
}

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
  const [apiKey, setApiKey] = useState<string>(
    () => localStorage.getItem(API_KEY_STORAGE) ?? "",
  );
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [activeMonth, setActiveMonth] = useState<string>(() => getCurrentMonthKey());
  const [transcript, setTranscript] = useState<ReactNode>(DEFAULT_TRANSCRIPT);
  const [isListening, setIsListening] = useState(false);
  const [historyType, setHistoryType] = useState<EntryType | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const dbRef = useRef(db);
  const dialogRef = useRef<DialogState>("IDLE");
  const pendingRef = useRef(0);
  const listeningRef = useRef(isListening);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const conversationRef = useRef<(text: string) => void>(() => {});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  dbRef.current = db;
  listeningRef.current = isListening;

  /* Persist every change to localStorage */
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }, [db]);

  const totals = useMemo(() => getTotals(db, activeMonth), [db, activeMonth]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    set.add(getCurrentMonthKey());
    db.income.forEach((i) => {
      if (i.monthKey) set.add(i.monthKey);
    });
    db.expense.forEach((e) => {
      if (e.monthKey) set.add(e.monthKey);
    });
    return Array.from(set).sort().reverse();
  }, [db]);

  const isCurrentMonth = activeMonth === getCurrentMonthKey();

  /* -------------------- actions -------------------- */
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
    const { totalIncome } = getTotals(current, activeMonth);
    const totalExpense = sumFor(current.expense, activeMonth);
    let advice: string;

    if (totalExpense === 0) {
      advice = "اس مہینے ابھی تک کوئی خرچہ درج نہیں ہوا۔ آپ کی بچت بہترین حالت میں ہے۔";
    } else if (totalExpense > totalIncome) {
      advice =
        "توجہ فرمائیں! اس مہینے آپ کا خرچہ آمدنی سے زیادہ ہو رہا ہے۔ اپنے غیر ضروری اخراجات کو کم کرنے کی کوشش کریں۔";
    } else {
      const saveRatio = Math.round(((totalIncome - totalExpense) / totalIncome) * 100);
      advice = `بہترین! آپ نے اس مہینے اپنی آمدنی کا تقریباً ${saveRatio} فیصد بچا لیا ہے۔ اپنا بجٹ اسی طرح برقرار رکھیں۔`;
    }

    setTranscript(
      <span className="text-amber-300 text-sm font-bold">💡 مالیاتی مشورہ: {advice}</span>,
    );
    speakNaturalUrdu(advice);
  }

  function handleConversationalInput(text: string) {
    if (/غلطی|واپس|انڈو/i.test(text)) {
      handleUndo();
      return;
    }

    if (dialogRef.current === "WAITING_INCOME_DETAIL") {
      saveTransaction("income", pendingRef.current, text);
      dialogRef.current = "IDLE";
      pendingRef.current = 0;
      return;
    }

    if (dialogRef.current === "WAITING_EXPENSE_DETAIL") {
      saveTransaction("expense", pendingRef.current, text);
      dialogRef.current = "IDLE";
      pendingRef.current = 0;
      return;
    }

    const numMatch = text.match(/\d+/);
    if (!numMatch) {
      if (/مشورہ|ایڈوائس|بجٹ/i.test(text)) {
        getFinancialAdvice();
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
      saveTransaction(isIncome && !isExpense ? "income" : "expense", amount, text);
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

  function openSettings() {
    setApiKeyDraft(apiKey);
    setSettingsOpen(true);
  }

  function saveApiKey() {
    const key = apiKeyDraft.trim();
    setApiKey(key);
    localStorage.setItem(API_KEY_STORAGE, key);
    setSettingsOpen(false);
    speakNaturalUrdu("سیٹنگز اور کلاؤڈ اے آئی کی سیو ہو گئی ہے۔");
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

  function exportData() {
    const current = dbRef.current;
    let csv = "Month,Type,Category,Date,Time,Amount,Detail\n";
    current.income.forEach((i) => {
      csv += `${i.monthKey || "2026-10"},Income,${i.category || "Income"},${i.date},${i.time},${i.amount},"${i.detail}"\n`;
    });
    current.expense.forEach((e) => {
      csv += `${e.monthKey || "2026-10"},Expense,${e.category || "Expense"},${e.date},${e.time},${e.amount},"${e.detail}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sauti_baqaya_ultimate_report.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /* -------------------- speech recognition setup -------------------- */
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
      const spoken = event.results[0][0].transcript;
      conversationRef.current(spoken);
    };
    recognition.onerror = () => {
      setTranscript(<>آواز واضح نہیں آئی، دوبارہ کوشش کریں۔</>);
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;

    /* Passive wake-word listening ("اے منشی") */
    let wake: SpeechRecognitionLike | null = null;
    let wakeFailed = false;
    try {
      wake = new SpeechRecognitionCtor();
      wake.continuous = true;
      wake.lang = "ur-PK";
      wake.interimResults = true;
      wake.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const text = event.results[i][0].transcript;
          if (/منشی|اے منشی|صوتی بقیہ/i.test(text)) {
            wake?.stop();
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
            wake?.start();
          } catch {
            /* ignore */
          }
        }
      };
      wake.start();
    } catch {
      /* Wake word passive listening unavailable — app still works via mic button */
    }

    return () => {
      try {
        recognition.abort();
      } catch {
        /* ignore */
      }
      try {
        wake?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

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

  /* -------------------- analytics doughnut chart -------------------- */
  useEffect(() => {
    if (!analyticsOpen) return;
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["کل آمدنی", "کل خرچہ"],
        datasets: [
          {
            data: [totals.totalIncome, totals.totalExpense],
            backgroundColor: ["rgba(52, 211, 153, 0.8)", "rgba(251, 113, 133, 0.8)"],
            borderColor: ["#34d399", "#fb7185"],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: { color: "#ffffff", font: { family: "Noto Nastaliq Urdu" } },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [analyticsOpen, totals]);

  /* -------------------- notepad modal list -------------------- */
  function renderNotepad() {
    if (historyType === "income") {
      const carryForward = totals.carryForward;
      const source = db.income
        .filter((i) => monthOf(i) === activeMonth)
        .sort((a, b) => b.timestamp - a.timestamp);

      if (source.length === 0 && carryForward <= 0) {
        return (
          <p className="text-center text-white/40 py-10 text-sm">
            ({formatMonthName(activeMonth)}) کے لیے کوئی انٹری موجود نہیں ہے۔
          </p>
        );
      }

      return (
        <>
          {carryForward > 0 && (
            <div className="bg-sky-950/40 border border-sky-500/30 p-3.5 rounded-xl flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-sans text-sky-300/80">
                  آغاز بیلنس • پچھلا مہینہ
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-sky-500/20 text-sky-300 border-sky-500/40">
                  +{carryForward.toLocaleString("ur-PK")} روپے
                </span>
              </div>
              <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
                📒 <strong>تفصیل:</strong> پچھلے مہینے سے منتقل ہونے والا بقایا کیش
              </div>
            </div>
          )}
          {source.map((item) => (
            <div
              key={item.id}
              className="bg-black/30 border border-white/10 p-3.5 rounded-xl flex flex-col gap-2"
            >
              <div className="flex justify-between items-center">
                <span className="text-xs font-sans text-white/40">
                  <i className={`fas ${item.icon || "fa-tag"} text-emerald-400 ml-1`}></i>{" "}
                  {item.category || "عام"} • {item.date}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
                  +{item.amount.toLocaleString("ur-PK")} روپے
                </span>
              </div>
              <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
                📝 <strong>تفصیل:</strong> {item.detail}
              </div>
            </div>
          ))}
        </>
      );
    }

    const source = db.expense
      .filter((e) => monthOf(e) === activeMonth)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (source.length === 0) {
      return (
        <p className="text-center text-white/40 py-10 text-sm">
          ({formatMonthName(activeMonth)}) کے لیے کوئی انٹری موجود نہیں ہے۔
        </p>
      );
    }

    return (
      <>
        {source.map((item) => (
          <div
            key={item.id}
            className="bg-black/30 border border-white/10 p-3.5 rounded-xl flex flex-col gap-2"
          >
            <div className="flex justify-between items-center">
              <span className="text-xs font-sans text-white/40">
                <i className={`fas ${item.icon || "fa-tag"} text-rose-400 ml-1`}></i>{" "}
                {item.category || "عام"} • {item.date}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-rose-500/20 text-rose-300 border-rose-500/30">
                -{item.amount.toLocaleString("ur-PK")} روپے
              </span>
            </div>
            <div className="text-white/90 text-sm leading-relaxed bg-white/5 p-2.5 rounded-lg border border-white/5">
              📝 <strong>تفصیل:</strong> {item.detail}
            </div>
          </div>
        ))}
      </>
    );
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
                onClick={getFinancialAdvice}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1"
              >
                <i className="fas fa-lightbulb"></i> مشورہ
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
              onClick={() => setHistoryType("income")}
              className="bg-white/5 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition group"
            >
              <span className="text-white/60 text-xs sm:text-sm mb-1 group-hover:text-white/85">
                کل رقم
              </span>
              <span className="text-lg sm:text-2xl font-bold text-emerald-400">
                {totals.totalIncome.toLocaleString("ur-PK")}
              </span>
              <span className="text-[9px] text-white/30 font-sans mt-1">
                نوٹ پیڈ کھولیں →
              </span>
            </div>

            {/* 2. خرچہ (Expense Box) */}
            <div
              onClick={() => setHistoryType("expense")}
              className="bg-white/5 border border-white/10 rounded-2xl p-3 sm:p-4 flex flex-col items-center justify-center cursor-pointer hover:bg-white/10 transition group"
            >
              <span className="text-white/60 text-xs sm:text-sm mb-1 group-hover:text-white/85">
                خرچہ
              </span>
              <span className="text-lg sm:text-2xl font-bold text-rose-400">
                {totals.totalExpense.toLocaleString("ur-PK")}
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
                {totals.balance.toLocaleString("ur-PK")}
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
              <p className="text-base sm:text-lg text-white/80 leading-relaxed">
                {transcript}
              </p>
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
                    <i className="fas fa-file-alt text-emerald-400"></i> کل رقم (بشمول
                    پچھلا بقایا) - ({formatMonthName(activeMonth)})
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

            <div className="notepad-paper p-4 flex-1 overflow-y-auto space-y-3 mb-4">
              <div className="space-y-3 font-sans">{renderNotepad()}</div>
            </div>

            <div className="pt-2">
              <button
                onClick={shareWhatsApp}
                className="w-full bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] border border-[#25D366]/40 py-3 rounded-xl flex items-center justify-center gap-2 font-bold transition text-sm"
              >
                <i className="fab fa-whatsapp text-xl"></i> اس مہینے کی رپورٹ واٹس ایپ پر
                شیئر کریں
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Charts Modal */}
      {analyticsOpen && (
        <div className="modal">
          <div className="glass-panel w-full max-w-lg m-4 p-6 flex flex-col relative font-sans">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-white/10">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <i className="fas fa-chart-pie text-sky-400"></i> ماہانہ خرچ و آمدنی کا
                گراف
              </h2>
              <button
                onClick={() => setAnalyticsOpen(false)}
                className="text-white/50 hover:text-white transition"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
            <div className="bg-black/30 p-4 rounded-2xl border border-white/10">
              <canvas ref={chartCanvasRef} height="200"></canvas>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal">
          <div className="glass-panel w-full max-w-md m-4 p-6 flex flex-col relative font-sans">
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

            <div className="space-y-4 text-sm text-white/80">
              <p>
                ذہین جیمینی اے آئی اور کلاؤڈ انٹیلی جنس کے لیے اپنی API Key درج کریں:
              </p>
              <input
                type="password"
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-black/40 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-sky-400 text-sm"
              />
              <button
                onClick={saveApiKey}
                className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-xl transition shadow-lg"
              >
                سیو کریں
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
