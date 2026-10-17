/**
 * فوری اندراج — numeric chips (50 / 100 / 500 / 1000) for entering an amount
 * without speaking.
 *
 * One tap picks the amount, then a compact panel asks only for آمدنی/خرچہ and an
 * optional detail. The category is detected from the detail, exactly like a
 * spoken entry, so the chip path and the voice path write identical records.
 */
import {
  detectCategory,
  formatNumber,
  type AccountKind,
  type EntryType,
  type Prefs,
} from "@/lib/khata";
import { useState } from "react";

const CHIPS = [50, 100, 500, 1000];

const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1";

export type QuickEntryInput = {
  type: EntryType;
  amount: number;
  detail: string;
  category: string;
  account: AccountKind;
};

export function QuickEntry({
  prefs,
  onCommit,
}: {
  prefs: Prefs;
  /** Returns false when the ledger rejected the record. */
  onCommit: (input: QuickEntryInput) => boolean;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [type, setType] = useState<EntryType>("expense");
  const [detail, setDetail] = useState("");
  const [saved, setSaved] = useState("");

  function commit() {
    if (amount === null) return;
    const trimmed = detail.trim();
    const category = trimmed ? detectCategory(trimmed).name : "عام";
    const ok = onCommit({ type, amount, detail: trimmed || category, category, account: "cash" });
    if (!ok) {
      setSaved("درج نہیں ہو سکی — رقم چیک کریں۔");
      return;
    }
    setSaved(`${formatNumber(amount, prefs.digitStyle)} روپے درج ہو گئے۔`);
    setDetail("");
  }

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center justify-center gap-1.5 font-sans">
        {CHIPS.map((value) => {
          const active = amount === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setAmount(active ? null : value);
                setSaved("");
              }}
              className={`min-w-14 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                active
                  ? "border-sky-400/50 bg-sky-500/25 text-sky-200 shadow-[0_0_18px_rgba(56,189,248,0.25)]"
                  : "border-white/15 bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"
              }`}
            >
              {formatNumber(value, prefs.digitStyle)}
            </button>
          );
        })}
      </div>

      {amount !== null && (
        <div className="mt-2 space-y-2 rounded-xl border border-white/10 bg-black/30 p-2.5 font-sans">
          <div className="flex gap-1.5">
            {(["income", "expense"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={type === kind}
                onClick={() => setType(kind)}
                className={`flex-1 rounded-xl border px-2 py-1 text-[11px] font-bold transition ${
                  type === kind
                    ? kind === "income"
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                      : "border-rose-500/40 bg-rose-500/20 text-rose-300"
                    : "border-white/15 bg-white/5 text-white/55 hover:bg-white/10"
                }`}
              >
                {kind === "income" ? "آمدنی" : "خرچہ"} —{" "}
                {formatNumber(amount, prefs.digitStyle)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="تفصیل (اختیاری، مثلاً چائے)"
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commit();
              }}
            />
            <button
              type="button"
              onClick={commit}
              className={`${smallBtn} shrink-0 border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30`}
            >
              <i className="fas fa-check"></i> درج
            </button>
          </div>
          {saved && <p className="text-center text-[10px] text-emerald-300/90">{saved}</p>}
        </div>
      )}
    </div>
  );
}
