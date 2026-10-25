import { useState } from "react";
import { type AccountKind, type Entry, type EntryType, formatNumber, type DigitStyle, formatMonthName } from "@/lib/khata";
import { Modal } from "@/components/sauti/Modal";
import { t } from "@/lib/i18n";
import { Plus, Trash2, Edit3, Share2, AlertCircle, Check } from "lucide-react";

export type Draft = {
  amount: string;
  detail: string;
  category: string;
  account?: AccountKind;
};

interface NotepadModalProps {
  historyType: EntryType | "balance" | null;
  onClose: () => void;
  activeMonth: string;
  carryForward: number;
  income: Entry[];
  expense: Entry[];
  digitStyle?: DigitStyle;
  knownCategories: string[];
  isStaff: boolean;
  validationError: string | null;
  clearValidationError: () => void;
  onAddManual: (type: EntryType, draft: Draft) => boolean;
  onUpdateEntry: (type: EntryType, id: number, draft: Draft) => boolean;
  onRemoveEntry: (type: EntryType, id: number) => void;
  onShareWhatsApp: () => void;
}

export function NotepadModal({
  historyType,
  onClose,
  activeMonth,
  carryForward,
  income,
  expense,
  digitStyle = "latin",
  knownCategories,
  isStaff,
  validationError,
  clearValidationError,
  onAddManual,
  onUpdateEntry,
  onRemoveEntry,
  onShareWhatsApp,
}: NotepadModalProps) {
  const [newType, setNewType] = useState<EntryType>("expense");
  const [newAmount, setNewAmount] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [newCategory, setNewCategory] = useState("خورد و نوش");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editCategory, setEditCategory] = useState("");

  if (!historyType) return null;

  const isBalance = historyType === "balance";
  const titleMap = {
    income: t("totalIncome"),
    expense: t("totalExpense"),
    balance: t("balance"),
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(newAmount);
    if (isNaN(amt) || amt <= 0) return;
    onAddManual(newType, {
      amount: newAmount,
      detail: newDetail.trim() || (newType === "income" ? "آمدنی" : "خرچہ"),
      category: newCategory,
    });
    setNewAmount("");
    setNewDetail("");
  };

  const startEdit = (entry: Entry) => {
    setEditingId(entry.id);
    setEditAmount(entry.amount.toString());
    setEditDetail(entry.detail);
    setEditCategory(entry.category || "متفرق");
  };

  const saveEdit = (type: EntryType, id: number) => {
    const amt = parseFloat(editAmount);
    if (isNaN(amt) || amt <= 0) return;
    onUpdateEntry(type, id, {
      amount: editAmount,
      detail: editDetail.trim(),
      category: editCategory,
    });
    setEditingId(null);
  };

  return (
    <Modal open={true} onClose={onClose} label={titleMap[historyType as keyof typeof titleMap] || "تفصیل"}>
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Header Title inside modal */}
        <div className="flex justify-between items-center pb-3 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">
            {titleMap[historyType as keyof typeof titleMap] || "تفصیل"}
          </h2>
          <button onClick={onClose} className="text-white/50 hover:text-white transition text-sm">
            ✕
          </button>
        </div>

        {/* Month Banner */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex items-center justify-between">
          <span className="text-xs text-white/70 font-medium">{formatMonthName(activeMonth)}</span>
          <button
            onClick={onShareWhatsApp}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-xs font-medium transition"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>{t("whatsappShare")}</span>
          </button>
        </div>

        {validationError && (
          <div className="bg-rose-500/20 border border-rose-500/40 rounded-xl p-3 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-rose-200">{validationError}</div>
            <button onClick={clearValidationError} className="text-rose-300 text-xs hover:underline">
              {t("cancel")}
            </button>
          </div>
        )}

        {/* Add Entry Form */}
        {!isBalance && (
          <form onSubmit={handleAdd} className="bg-black/30 border border-white/10 rounded-2xl p-3 space-y-3">
            <div className="text-xs font-semibold text-white/80">{t("newEntry")}</div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as EntryType)}
                className="bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                <option value="income">{t("totalIncome")}</option>
                <option value="expense">{t("totalExpense")}</option>
              </select>
              <input
                type="number"
                placeholder={t("amountLabel")}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder={t("detailOptional")}
                value={newDetail}
                onChange={(e) => setNewDetail(e.target.value)}
                className="bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-sky-500"
              />
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="bg-black/50 border border-white/20 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
              >
                {knownCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="w-full py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 text-white text-xs font-bold hover:opacity-95 transition flex items-center justify-center gap-1"
            >
              <Plus className="w-4 h-4" />
              <span>{t("add")}</span>
            </button>
          </form>
        )}

        {/* Entries List / Balance View */}
        {isBalance ? (
          <div className="space-y-2">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex justify-between items-center text-xs">
              <span className="text-white/70">{t("openingBalance")}</span>
              <span className="font-bold text-white">{formatNumber(carryForward, digitStyle)}</span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex justify-between items-center text-xs">
              <span className="text-white/70">{t("totalIncome")}</span>
              <span className="font-bold text-emerald-400">
                {formatNumber(income.reduce((s, i) => s + i.amount, 0), digitStyle)}
              </span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex justify-between items-center text-xs">
              <span className="text-white/70">{t("totalExpense")}</span>
              <span className="font-bold text-rose-400">
                {formatNumber(expense.reduce((s, e) => s + e.amount, 0), digitStyle)}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {(historyType === "income" ? income : expense).length === 0 ? (
              <div className="text-center py-8 text-xs text-white/40">{t("emptyList")}</div>
            ) : (
              (historyType === "income" ? income : expense).map((item) => (
                <div
                  key={item.id}
                  className="bg-white/5 border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-3 text-xs"
                >
                  {editingId === item.id ? (
                    <div className="flex-1 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="bg-black/50 border border-white/20 rounded-xl px-2 py-1 text-white text-xs"
                        />
                        <input
                          type="text"
                          value={editDetail}
                          onChange={(e) => setEditDetail(e.target.value)}
                          className="bg-black/50 border border-white/20 rounded-xl px-2 py-1 text-white text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => saveEdit(historyType as EntryType, item.id)}
                          className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-medium"
                        >
                          <Check className="w-3.5 h-3.5 inline mr-1" />
                          {t("save")}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1 rounded-lg bg-white/10 text-white/70 hover:bg-white/20"
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-white truncate">{item.detail}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                            {item.category || t("allCategories")}
                          </span>
                        </div>
                        <div className="text-[10px] text-white/40">
                          {new Date(item.timestamp).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`font-bold ${
                            historyType === "income" ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {formatNumber(item.amount, digitStyle)}
                        </span>
                        {!isStaff && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startEdit(item)}
                              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 transition"
                              title={t("edit")}
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onRemoveEntry(historyType as EntryType, item.id)}
                              className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition"
                              title={t("delete")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
