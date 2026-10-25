import { useState } from "react";
import { type EntryType } from "@/lib/khata";
import { t } from "@/lib/i18n";

const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center gap-1";

interface RecurringAdderProps {
  onAdd: (label: string, amount: number, kind: EntryType) => void;
}

export function RecurringAdder({ onAdd }: RecurringAdderProps) {
  const [draft, setDraft] = useState<{
    label: string;
    amount: string;
    kind: EntryType;
  }>({ label: "", amount: "", kind: "income" });

  const kindBtn = (kind: EntryType, label: string) => (
    <button
      type="button"
      aria-pressed={draft.kind === kind}
      onClick={() => setDraft({ ...draft, kind })}
      className={`flex-1 rounded-xl px-2 py-1.5 border text-xs font-bold transition font-sans ${
        draft.kind === kind
          ? kind === "income"
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            : "bg-rose-500/20 text-rose-300 border-rose-500/40"
          : "bg-white/5 text-white/60 border-white/15 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="عنوان (مثلاً کرایہ)"
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
      <div className="flex gap-2 mt-2">
        {kindBtn("income", "آمدنی")}
        {kindBtn("expense", "خرچہ")}
      </div>
      <button
        onClick={() => {
          const amount = Number.parseFloat(draft.amount);
          const label = draft.label.trim();
          if (!label || !Number.isFinite(amount) || amount <= 0) return;
          onAdd(label, amount, draft.kind);
          setDraft({ label: "", amount: "", kind: draft.kind });
        }}
        className={`${smallBtn} w-full mt-2 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40`}
      >
        + {t("add")}
      </button>
    </>
  );
}
