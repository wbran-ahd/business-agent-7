/**
 * `useVoiceAssistant` — the conversation state machine.
 *
 * The previous version kept its state in a mutable ref with no timeout, so a
 * half-finished confirmation could swallow an unrelated sentence minutes later.
 * The flow is now explicit:
 *
 *   IDLE ──utterance with amount──▶ WAITING_CONFIRM ──ہاں──▶ commit
 *     │                                   │◀──نہیں / Escape / 25s──┘
 *     └──bare amount──▶ WAITING_INCOME_DETAIL / WAITING_EXPENSE_DETAIL
 *
 * The wake-word listener and the command listener are mutually exclusive: only
 * one recognition instance is ever running, so they can no longer fight.
 */
import {
  extractDetail,
  hasSpokenDetail,
  parseAmount,
  type DialogState,
  type EntryType,
} from "@/lib/khata";
import { t } from "@/lib/i18n";
import { logError, logEvent } from "@/lib/logger";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* Speech Recognition API shim — still absent from the TS DOM lib. */
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

const WAKE_WORD = /منشی|اے منشی|صوتی بقیہ/i;
const NEGATIVE = /نہیں|نہ |رد|مت کرو|نہیں چاہیے/i;
const POSITIVE = /ہاں|جی|ٹھیک|تصدیق|کر دو|کرو|ہو جاوے/i;
const UNDO = /غلطی|واپس|انڈو|منسوخ/i;
const ADVICE = /مشورہ|ایڈوائس|بجٹ|تجزیہ/i;
/** A pending question expires so a stray sentence cannot answer it later. */
const IDLE_TIMEOUT_MS = 25_000;

const IDLE_TRANSCRIPT: ReactNode = (
  <>
    بولیں <strong>"اے منشی"</strong> یا مائیک دبائیں...
    <br />
    <span className="text-xs text-sky-300/80 font-sans mt-2 block">{t("micExample")}</span>
  </>
);

export type PendingEntry = { type: EntryType; amount: number; detail: string };

export type VoiceOptions = {
  /** Writes a confirmed entry. Returns false when validation rejected it. */
  onCommit: (type: EntryType, amount: number, detail: string) => boolean;
  /** Returns false when there was nothing left to undo. */
  onUndo: () => boolean;
  onAskAi: (question?: string) => void;
};

export function useVoiceAssistant({ onCommit, onUndo, onAskAi }: VoiceOptions) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [dialog, setDialogState] = useState<DialogState>("IDLE");
  const [pending, setPending] = useState<PendingEntry | null>(null);
  const [transcript, setTranscript] = useState<ReactNode>(IDLE_TRANSCRIPT);

  const commandRef = useRef<SpeechRecognitionLike | null>(null);
  const wakeRef = useRef<SpeechRecognitionLike | null>(null);
  /** True while the command listener owns the microphone. */
  const commandActiveRef = useRef(false);
  const dialogRef = useRef<DialogState>("IDLE");
  const pendingAmountRef = useRef(0);
  const wakeFailedRef = useRef(false);

  // Keep the freshest callbacks reachable from long-lived recognition handlers.
  const onCommitRef = useRef(onCommit);
  const onUndoRef = useRef(onUndo);
  const onAskAiRef = useRef(onAskAi);
  useEffect(() => {
    onCommitRef.current = onCommit;
    onUndoRef.current = onUndo;
    onAskAiRef.current = onAskAi;
  });

  const setDialog = useCallback((next: DialogState) => {
    dialogRef.current = next;
    setDialogState(next);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ur-PK";
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      logError("voice", "speech synthesis failed", error);
    }
  }, []);

  const reset = useCallback(
    (node: ReactNode = IDLE_TRANSCRIPT) => {
      setDialog("IDLE");
      setPending(null);
      setTranscript(node);
    },
    [setDialog],
  );

  const cancelPending = useCallback(() => {
    reset(<span className="text-rose-400 font-bold">{t("entryRejected")}</span>);
    speak(t("entryRejected"));
  }, [reset, speak]);

  const confirmPending = useCallback(() => {
    const current = pending;
    if (!current) return;
    const ok = onCommitRef.current(current.type, current.amount, current.detail);
    setDialog("IDLE");
    setPending(null);
    const message = ok
      ? `${current.amount} روپے درج ہو گئے۔`
      : "درج نہیں ہو سکی — رقم چیک کریں۔";
    setTranscript(
      <span
        className={`text-sm font-bold ${ok ? "text-emerald-300" : "text-rose-300"}`}
      >
        {ok ? "✓" : "✕"} {message}
      </span>,
    );
    speak(message);
  }, [pending, setDialog, speak]);

  /* ---- command handling ------------------------------------------------ */
  const handleUtterance = useCallback(
    (text: string) => {
      if (dialogRef.current === "WAITING_CONFIRM") {
        if (NEGATIVE.test(text)) return cancelPending();
        if (POSITIVE.test(text)) return confirmPending();
        setTranscript(<span className="text-rose-400 text-sm font-bold">{t("onlyYesOrNo")}</span>);
        speak(t("onlyYesOrNo"));
        return;
      }

      if (UNDO.test(text)) {
        const removed = onUndoRef.current();
        const message = removed ? t("undoDone") : t("undoEmpty");
        setTranscript(<span className="text-amber-300 font-bold">{message}</span>);
        speak(message);
        return;
      }

      if (
        dialogRef.current === "WAITING_INCOME_DETAIL" ||
        dialogRef.current === "WAITING_EXPENSE_DETAIL"
      ) {
        const type: EntryType =
          dialogRef.current === "WAITING_INCOME_DETAIL" ? "income" : "expense";
        const amount = pendingAmountRef.current;
        const detail = extractDetail(text, amount) || text;
        const ok = onCommitRef.current(type, amount, detail);
        setDialog("IDLE");
        setPending(null);
        const message = ok
          ? `${amount} روپے درج ہو گئے۔`
          : "درج نہیں ہو سکی — رقم چیک کریں۔";
        setTranscript(
          <>
            "{text}"
            <br />
            <span
              className={`text-sm font-bold ${ok ? "text-emerald-300" : "text-rose-300"}`}
            >
              {ok ? "✓" : "✕"} {message}
            </span>
          </>,
        );
        speak(message);
        return;
      }

      const amount = parseAmount(text);
      if (amount === null) {
        if (ADVICE.test(text)) {
          onAskAiRef.current(text);
          return;
        }
        const message = "نبیل بھائی، براہ کرم رقم واضح بولیں۔";
        setTranscript(
          <>
            "{text}"
            <br />
            <span className="text-rose-400 text-sm">{message}</span>
          </>,
        );
        speak(message);
        return;
      }

      const isIncome = /جمع|آمدنی|ملے|کرایه|پرافٹ|آئے|رقم|ایڈ/i.test(text);
      const isExpense = /خرچ|دیا|کٹے|خریدا/i.test(text);
      const type: EntryType = isIncome && !isExpense ? "income" : "expense";

      if (hasSpokenDetail(text, amount)) {
        const detail = extractDetail(text, amount) || text;
        setPending({ type, amount, detail });
        setDialog("WAITING_CONFIRM");
        const question = `${amount} روپے ${type === "income" ? "آمدنی" : "خرچہ"} درج کروں؟`;
        setTranscript(
          <>
            "{text}"
            <br />
            <span className="text-amber-300 text-sm font-bold">❓ {question}</span>
            <br />
            <span className="text-xs text-white/50 font-sans">{t("sayYesOrNo")}</span>
            <div className="flex gap-2 justify-center mt-2 font-sans text-xs">
              <button
                onClick={confirmPending}
                className="bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 px-4 py-1.5 rounded-full"
              >
                {t("confirmYes")}
              </button>
              <button
                onClick={cancelPending}
                className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 px-4 py-1.5 rounded-full"
              >
                {t("confirmNo")}
              </button>
            </div>
          </>,
        );
        speak(question);
        return;
      }

      pendingAmountRef.current = amount;
      setDialog(type === "income" ? "WAITING_INCOME_DETAIL" : "WAITING_EXPENSE_DETAIL");
      const question =
        type === "income"
          ? `آپ جو ${amount} روپے ایڈ کر رہے ہیں، یہ کہاں سے آئے ہیں؟ وضاحت کریں۔`
          : `آپ جو ${amount} روپے خرچ کر رہے ہیں، یہ کس کام کے لیے خرچ ہوئے؟ وضاحت کریں۔`;
      setTranscript(
        <>
          "{text}"
          <br />
          <span className="text-amber-300 text-sm font-bold">❓ {question}</span>
        </>,
      );
      speak(question);
    },
    [cancelPending, confirmPending, setDialog, speak],
  );

  const handleUtteranceRef = useRef(handleUtterance);
  useEffect(() => {
    handleUtteranceRef.current = handleUtterance;
  });

  /* ---- speech engines -------------------------------------------------- */
  useEffect(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const command = new Ctor();
    command.continuous = false;
    command.lang = "ur-PK";
    command.interimResults = false;
    command.onstart = () => {
      commandActiveRef.current = true;
      setListening(true);
      setTranscript(<span className="text-sky-300 font-bold">{t("micListening")}</span>);
    };
    command.onresult = (event) => handleUtteranceRef.current(event.results[0][0].transcript);
    command.onerror = (event) => {
      logEvent("voice", "warn", "recognition error", {
        reason: (event as { error?: string })?.error ?? "unknown",
      });
      setTranscript(<>{t("micError")}</>);
    };
    command.onend = () => {
      commandActiveRef.current = false;
      setListening(false);
    };
    commandRef.current = command;

    /* Wake word — armed on the first gesture so the browser never asks for the
       microphone before the visitor has touched anything. */
    let wake: SpeechRecognitionLike | null = null;
    const armWakeWord = () => {
      window.removeEventListener("pointerdown", armWakeWord);
      window.removeEventListener("keydown", armWakeWord);
      try {
        wake = new Ctor();
        wake.continuous = true;
        wake.lang = "ur-PK";
        wake.interimResults = true;
        wake.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const text = event.results[i][0].transcript;
            if (!WAKE_WORD.test(text)) continue;
            // Mutex: never run both recognizers at once.
            if (commandActiveRef.current) return;
            wake?.stop();
            speak("جی نابل بھائی، میں سن رہا ہوں۔");
            window.setTimeout(() => {
              try {
                commandRef.current?.start();
              } catch (error) {
                logError("voice", "could not start command listener", error);
              }
            }, 1200);
            return;
          }
        };
        wake.onerror = () => {
          wakeFailedRef.current = true;
        };
        wake.onend = () => {
          if (wakeFailedRef.current || commandActiveRef.current) return;
          try {
            wake?.start();
          } catch {
            /* the next gesture re-arms it */
          }
        };
        wakeRef.current = wake;
        wake.start();
        logEvent("voice", "info", "wake word armed");
      } catch (error) {
        logError("voice", "wake word unavailable", error);
      }
    };

    window.addEventListener("pointerdown", armWakeWord);
    window.addEventListener("keydown", armWakeWord);

    return () => {
      window.removeEventListener("pointerdown", armWakeWord);
      window.removeEventListener("keydown", armWakeWord);
      try {
        command.abort();
      } catch {
        /* ignore */
      }
      try {
        wake?.abort();
      } catch {
        /* ignore */
      }
    };
  }, [speak]);

  /* ---- pending questions expire ---------------------------------------- */
  useEffect(() => {
    if (dialog === "IDLE") return;
    const timer = window.setTimeout(() => {
      reset(<span className="text-amber-300 text-sm font-bold">وقت ختم — دوبارہ بولیں۔</span>);
      speak("وقت ختم ہو گیا، دوبارہ بولیں۔");
    }, IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [dialog, reset, speak]);

  /* ---- Escape cancels a pending question ------------------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialogRef.current === "IDLE") return;
      cancelPending();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelPending]);

  /** Lets the page post a message (and optionally speak it) into the panel. */
  const announce = useCallback(
    (node: ReactNode, speakText?: string) => {
      setTranscript(node);
      if (speakText) speak(speakText);
    },
    [speak],
  );

  const toggle = useCallback(() => {
    const command = commandRef.current;
    if (!command) {
      setTranscript(<>{t("micUnsupported")}</>);
      return;
    }
    try {
      if (commandActiveRef.current) command.stop();
      else command.start();
    } catch (error) {
      logError("voice", "toggle failed", error);
    }
  }, []);

  return {
    supported,
    listening,
    dialog,
    pending,
    transcript,
    toggle,
    confirmPending,
    cancelPending,
    announce,
    speak,
  };
}
