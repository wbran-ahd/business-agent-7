/**
 * دکان — the shop floor in one glass modal.
 *
 * Four tabs, all derived from data the app already owns:
 *   • گاہک      — per-customer udhaar ledger, reminders, receipts
 *   • سپلائر    — the same for wholesalers (payables)
 *   • روزنامچہ  — today's cash in/out with opening & closing balance
 *   • کھاتے     — cash-in-hand vs JazzCash / EasyPaisa / bank
 *
 * Styling reuses the exact existing tokens (`glass-panel`, the same input and
 * button classes) so it is visually indistinguishable from the rest of the app.
 */
import { Modal, ModalHeader } from "@/components/sauti/Modal";
import { useParties, type UseParties } from "@/hooks/use-parties";
import {
  ACCOUNT_CATALOG,
  formatNumber,
  type AccountKind,
  type DataState,
  type Prefs,
} from "@/lib/khata";
import {
  accountBalances,
  accountLabel,
  buildDaybook,
  todayKey,
  totalBalance,
  type Daybook,
} from "@/lib/daybook";
import {
  balanceLabel,
  displayPhone,
  outstandingTotals,
  partyKindLabel,
  partySummary,
  partyTxnLabel,
  partyTxns,
  reminderText,
  whatsappUrl,
  type Party,
  type PartyKind,
} from "@/lib/parties";
import { escapeHtml, printReceipt } from "@/lib/print";
import { useMemo, useRef, useState } from "react";

export type ShopTab = "customers" | "suppliers" | "daybook" | "accounts";

export type ShopPanelProps = {
  open: boolean;
  tab: ShopTab;
  onTabChange: (tab: ShopTab) => void;
  onClose: () => void;
  data: DataState;
  prefs: Prefs;
  /** Salesman mode: entries can still be added, deletions are hidden. */
  isStaff: boolean;
  /** Called after a successful party-khata download (weekly backup reminder). */
  onBackedUp?: () => void;
};

const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1";
const cardCls = "bg-white/5 border border-white/10 rounded-2xl p-3";

const TABS: { id: ShopTab; label: string; icon: string }[] = [
  { id: "customers", label: "گاہک", icon: "fa-user-group" },
  { id: "suppliers", label: "سپلائر", icon: "fa-truck-field" },
  { id: "daybook", label: "روزنامچہ", icon: "fa-book" },
  { id: "accounts", label: "کھاتے", icon: "fa-wallet" },
];

function money(amount: number, prefs: Prefs): string {
  const sign = amount < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(amount), prefs.digitStyle)}`;
}

export function ShopPanel({
  open,
  tab,
  onTabChange,
  onClose,
  data,
  prefs,
  isStaff,
  onBackedUp,
}: ShopPanelProps) {
  const shop = useParties();
  const [notice, setNotice] = useState("");

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="دکان: گاہک، سپلائر، روزنامچہ اور کھاتے"
      fontSans
      scrollable
    >
      <ModalHeader icon="fa-store" iconClass="text-sky-300" onClose={onClose}>
        دکان
      </ModalHeader>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => {
              onTabChange(item.id);
              setNotice("");
            }}
            className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              tab === item.id
                ? "border-sky-400/40 bg-sky-500/20 text-sky-200"
                : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            <i className={`fas ${item.icon} ml-1`}></i>
            {item.label}
          </button>
        ))}
      </div>

      {notice && <p className="mb-2 text-[11px] text-amber-300">{notice}</p>}

      {tab === "customers" && (
        <PartySection
          kind="customer"
          shop={shop}
          prefs={prefs}
          isStaff={isStaff}
          onNotice={setNotice}
          onBackedUp={onBackedUp}
        />
      )}
      {tab === "suppliers" && (
        <PartySection
          kind="supplier"
          shop={shop}
          prefs={prefs}
          isStaff={isStaff}
          onNotice={setNotice}
        />
      )}
      {tab === "daybook" && <DaybookSection data={data} book={shop.book} prefs={prefs} />}
      {tab === "accounts" && <AccountsSection data={data} book={shop.book} prefs={prefs} />}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Parties                                                             */
/* ------------------------------------------------------------------ */
function PartySection({
  kind,
  shop,
  prefs,
  isStaff,
  onNotice,
  onBackedUp,
}: {
  kind: PartyKind;
  shop: UseParties;
  prefs: Prefs;
  isStaff: boolean;
  onNotice: (message: string) => void;
  onBackedUp?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", note: "" });
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selected = shop.book.parties.find((party) => party.id === selectedId) ?? null;
  if (selected) {
    return (
      <PartyDetail
        party={selected}
        shop={shop}
        prefs={prefs}
        isStaff={isStaff}
        onBack={() => setSelectedId(null)}
        onNotice={onNotice}
      />
    );
  }

  const needle = query.trim();
  const list = shop.parties.filter(
    (party) =>
      party.kind === kind &&
      (needle === "" || party.name.includes(needle) || party.phone.includes(needle)),
  );

  const totals = outstandingTotals(shop.book);
  const headline = kind === "customer" ? totals.receivable : totals.payable;

  function handleRestore(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const message = shop.importJson(String(reader.result ?? ""));
      if (message) setError(message);
      else {
        setError("");
        onNotice("گاہک کھاتہ فائل سے بحال ہو گیا۔");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <div className={`${cardCls} mb-3`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/60">
            {kind === "customer" ? "کل وصولی باقی" : "کل واجب الادا"}
          </span>
          <span
            className={`text-lg font-bold ${kind === "customer" ? "text-emerald-300" : "text-rose-300"}`}
          >
            {money(headline, prefs)} <span className="text-[10px] text-white/40">روپے</span>
          </span>
        </div>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          className={inputCls}
          placeholder={`${partyKindLabel(kind)} تلاش کریں (نام یا فون)`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className={`${smallBtn} shrink-0 border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30`}
        >
          <i className="fas fa-plus"></i> نیا
        </button>
      </div>

      {adding && (
        <div className="mb-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3 font-sans">
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="نام"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <input
              className={inputCls}
              placeholder="03001234567"
              inputMode="tel"
              value={draft.phone}
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </div>
          <input
            className={inputCls}
            placeholder="نوٹ (اختیاری)"
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <button
            type="button"
            onClick={() => {
              const message = shop.addParty({ ...draft, kind });
              if (message) {
                setError(message);
                return;
              }
              setDraft({ name: "", phone: "", note: "" });
              setError("");
              setAdding(false);
              onNotice("نیا اندراج محفوظ ہو گیا۔");
            }}
            className={`${smallBtn} w-full border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30`}
          >
            + {partyKindLabel(kind)} محفوظ کریں
          </button>
        </div>
      )}

      <div className="space-y-2">
        {list.length === 0 && (
          <p className="py-8 text-center text-sm text-white/40">
            {needle ? "کوئی نتیجہ نہیں ملا۔" : `ابھی کوئی ${partyKindLabel(kind)} محفوظ نہیں۔`}
          </p>
        )}
        {list.map((party) => {
          const summary = partySummary(shop.book, party.id);
          return (
            <button
              key={party.id}
              type="button"
              onClick={() => {
                setSelectedId(party.id);
                onNotice("");
              }}
              className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-right transition hover:bg-white/5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/15 text-sm font-bold text-sky-200">
                {party.name.trim().charAt(0)}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-xs font-bold text-white/90">
                  {party.name}
                </span>
                <span className="block truncate text-[10px] text-white/40">
                  {party.phone ? displayPhone(party.phone) : "فون محفوظ نہیں"}
                  {summary.lastAt ? " • آخری لین دین موجود" : ""}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                  summary.balance > 0
                    ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                    : summary.balance < 0
                      ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                      : "border-white/20 bg-white/10 text-white/60"
                }`}
              >
                {money(summary.balance, prefs)}
              </span>
            </button>
          );
        })}
      </div>

      {isStaff ? (
        <p className="mt-4 border-t border-white/10 pt-3 text-[10px] text-white/35">
          سیلز مین موڈ: بیک اپ، بحالی اور حذف کے بٹن مالک موڈ میں دستیاب ہوتے ہیں۔
        </p>
      ) : (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([shop.exportJson()], { type: "application/json" });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "sauti_party_khata.json";
                link.click();
                window.URL.revokeObjectURL(url);
                onBackedUp?.();
              }}
              className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`}
            >
              <i className="fas fa-download"></i> گاہک کھاتہ بیک اپ
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`}
            >
              <i className="fas fa-upload"></i> بحال کریں
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleRestore}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-white/35">
            بحالی موجودہ گاہک کھاتے کو فائل والے ڈیٹا سے بدل دے گی۔
          </p>
        </div>
      )}
    </>
  );
}

function PartyDetail({
  party,
  shop,
  prefs,
  isStaff,
  onBack,
  onNotice,
}: {
  party: Party;
  shop: UseParties;
  prefs: Prefs;
  isStaff: boolean;
  onBack: () => void;
  onNotice: (message: string) => void;
}) {
  const summary = partySummary(shop.book, party.id);
  const rows = partyTxns(shop.book, party.id);
  const [txnOpen, setTxnOpen] = useState(false);
  const [draft, setDraft] = useState({
    kind: "charge" as "charge" | "payment",
    amount: "",
    note: "",
    account: "cash" as AccountKind,
  });
  const [error, setError] = useState("");
  const [askDelete, setAskDelete] = useState(false);

  function sendReminder() {
    if (!party.phone) {
      setError("واٹس ایپ یاد دہانی کے لیے فون نمبر درج کریں۔");
      return;
    }
    if (summary.balance <= 0) {
      setError("بقایا صفر یا ایڈوانس ہے — یاد دہانی کی ضرورت نہیں۔");
      return;
    }
    setError("");
    window.open(
      whatsappUrl(party.phone, reminderText(party, summary.balance)),
      "_blank",
      "noopener,noreferrer",
    );
    onNotice("واٹس ایپ پیغام کھل گیا۔");
  }

  function print() {
    printReceipt(`${party.name} — کھاتہ`, partyReceiptHtml(party, shop, prefs));
    onNotice("پرنٹ ونڈو کھل گئی — PDF کے لیے “Save as PDF” منتخب کریں۔");
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className={`${smallBtn} shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20`}
        >
          <i className="fas fa-arrow-right"></i> واپس
        </button>
        <span className="truncate text-sm font-bold text-white">{party.name}</span>
        <span className="shrink-0 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
          {partyKindLabel(party.kind)}
        </span>
      </div>

      <div className={`${cardCls} mb-3`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/60">{balanceLabel(summary.balance, party.kind)}</span>
          <span
            className={`text-xl font-bold ${
              summary.balance > 0
                ? "text-rose-300"
                : summary.balance < 0
                  ? "text-emerald-300"
                  : "text-white/70"
            }`}
          >
            {money(summary.balance, prefs)} روپے
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-white/70">
            {party.kind === "customer" ? "کل ادھار" : "کل خریداری"}:{" "}
            <strong className="text-white/90">{money(summary.charges, prefs)}</strong>
          </span>
          <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-white/70">
            {party.kind === "customer" ? "کل وصولی" : "کل ادائیگی"}:{" "}
            <strong className="text-white/90">{money(summary.payments, prefs)}</strong>
          </span>
        </div>
        {party.phone && (
          <p className="mt-2 text-[11px] text-white/45">📞 {displayPhone(party.phone)}</p>
        )}
        {party.note && <p className="mt-1 text-[11px] text-white/45">📝 {party.note}</p>}
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={sendReminder}
          className={`${smallBtn} border-[#25D366]/40 bg-[#25D366]/20 text-[#25D366] hover:bg-[#25D366]/30`}
        >
          <i className="fab fa-whatsapp text-base"></i> یاد دہانی
        </button>
        <button
          type="button"
          onClick={print}
          className={`${smallBtn} border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30`}
        >
          <i className="fas fa-print"></i> پرنٹ
        </button>
        <button
          type="button"
          onClick={() => setTxnOpen((value) => !value)}
          className={`${smallBtn} border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30`}
        >
          <i className="fas fa-plus"></i> انٹری
        </button>
      </div>

      {txnOpen && (
        <div className="mb-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3 font-sans">
          <div className="flex gap-2">
            {(["charge", "payment"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={draft.kind === kind}
                onClick={() => setDraft({ ...draft, kind })}
                className={`flex-1 rounded-xl border px-2 py-1.5 text-xs font-bold transition ${
                  draft.kind === kind
                    ? kind === "charge"
                      ? "border-rose-500/40 bg-rose-500/20 text-rose-300"
                      : "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
                    : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {partyTxnLabel(kind, party.kind)}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              className={inputCls}
              placeholder="رقم"
              value={draft.amount}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
            <select
              className={inputCls}
              value={draft.account}
              onChange={(event) =>
                setDraft({ ...draft, account: event.target.value as AccountKind })
              }
            >
              {ACCOUNT_CATALOG.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label}
                </option>
              ))}
            </select>
          </div>
          <input
            className={inputCls}
            placeholder="تفصیل (مثلاً 2 بوری چاول)"
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
          {error && <p className="text-[11px] text-rose-300">{error}</p>}
          <button
            type="button"
            onClick={() => {
              const message = shop.addTxn(party.id, draft);
              if (message) {
                setError(message);
                return;
              }
              setDraft({ kind: "charge", amount: "", note: "", account: "cash" });
              setError("");
              setTxnOpen(false);
              onNotice("انٹری محفوظ ہو گئی۔");
            }}
            className={`${smallBtn} w-full border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30`}
          >
            ✓ محفوظ کریں
          </button>
        </div>
      )}

      <div className="space-y-2">
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-white/40">کھاتہ خالی ہے۔</p>
        )}
        {rows.map((txn) => (
          <div
            key={txn.id}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-2.5"
          >
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                txn.kind === "charge"
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                  : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {partyTxnLabel(txn.kind, party.kind)}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[11px] text-white/85">
                {txn.note || accountLabel(txn.account)}
              </span>
              <span className="block text-[10px] text-white/40">
                {txn.date} • {txn.time} • {accountLabel(txn.account)}
              </span>
            </span>
            <span className="shrink-0 text-xs font-bold text-white/90">
              {money(txn.amount, prefs)}
            </span>
            {!isStaff && (
              <button
                type="button"
                onClick={() => shop.removeTxn(txn.id)}
                aria-label="انٹری حذف کریں"
                className="shrink-0 text-rose-400/70 transition hover:text-rose-300"
              >
                <i className="fas fa-trash text-xs"></i>
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-white/10 pt-3">
        {isStaff ? (
          <p className="text-[10px] text-white/35">اندراج حذف کرنے کے لیے مالک موڈ درکار ہے۔</p>
        ) : askDelete ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                shop.removeParty(party.id);
                onNotice("اندراج حذف ہو گیا۔");
                onBack();
              }}
              className={`${smallBtn} flex-1 border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30`}
            >
              ہاں، حذف کریں
            </button>
            <button
              type="button"
              onClick={() => setAskDelete(false)}
              className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`}
            >
              نہیں
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAskDelete(true)}
            className={`${smallBtn} w-full border-white/15 bg-white/5 text-white/60 hover:bg-white/10`}
          >
            <i className="fas fa-user-minus"></i> اندراج حذف کریں
          </button>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Daybook                                                             */
/* ------------------------------------------------------------------ */
function DaybookSection({
  data,
  book,
  prefs,
}: {
  data: DataState;
  book: UseParties["book"];
  prefs: Prefs;
}) {
  const [dateKey, setDateKey] = useState(() => todayKey());
  const day: Daybook = useMemo(() => buildDaybook(data, book, dateKey), [data, book, dateKey]);

  return (
    <>
      <div className="mb-3 flex gap-2">
        <input
          type="date"
          className={inputCls}
          value={dateKey}
          onChange={(event) => setDateKey(event.target.value || todayKey())}
        />
        <button
          type="button"
          onClick={() => setDateKey(todayKey())}
          className={`${smallBtn} shrink-0 border-white/20 bg-white/10 text-white hover:bg-white/20`}
        >
          آج
        </button>
        <button
          type="button"
          onClick={() => printReceipt(`${dateKey} — روزنامچہ`, daybookReceiptHtml(day, prefs))}
          className={`${smallBtn} shrink-0 border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30`}
        >
          <i className="fas fa-print"></i> پرنٹ
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <StatCard label="کھولتے وقت کیش" value={money(day.cashOpening, prefs)} tone="text-sky-300" />
        <StatCard label="بند کرتے وقت کیش" value={money(day.cashClosing, prefs)} tone="text-emerald-300" />
        <StatCard label="کل آمد" value={money(day.totalIn, prefs)} tone="text-emerald-300" />
        <StatCard label="کل خرچ" value={money(day.totalOut, prefs)} tone="text-rose-300" />
      </div>

      <div className={`${cardCls} mb-3`}>
        <h3 className="mb-2 text-xs font-bold text-white/80">کھاتے کے مطابق دن کا خلاصہ</h3>
        <div className="space-y-1.5">
          {day.accounts.map((account) => (
            <div key={account.account} className="flex items-center gap-2 text-[11px]">
              <i className={`fas ${account.icon} w-4 text-sky-300`}></i>
              <span className="w-20 shrink-0 text-white/60">{account.label}</span>
              <span className="flex-1 text-white/50">
                <span className="text-emerald-300/90">+{money(account.inflow, prefs)}</span>{" "}
                <span className="text-rose-300/90">−{money(account.outflow, prefs)}</span>
              </span>
              <span className="font-bold text-white/90">{money(account.closing, prefs)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-white/35">
          یاد دہانی: ادھار پر دیا گیا مال کیش نہیں، صرف وصولی/ادائیگی اس دن کے کھاتے میں آتی ہے۔
        </p>
      </div>

      <div className="space-y-2">
        {day.rows.length === 0 && (
          <p className="py-6 text-center text-sm text-white/40">اس دن کوئی لین دین نہیں۔</p>
        )}
        {day.rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-2.5"
          >
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                row.direction === "in"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  : "border-rose-500/40 bg-rose-500/15 text-rose-300"
              }`}
            >
              {row.direction === "in" ? "آمد" : "خرچ"}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[11px] text-white/85">{row.label}</span>
              <span className="block truncate text-[10px] text-white/40">
                {row.detail || "—"} • {accountLabel(row.account)}
                {row.source === "party" ? " • گاہک کھاتہ" : ""}
              </span>
            </span>
            <span className="shrink-0 text-xs font-bold text-white/90">
              {money(row.amount, prefs)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[10px] text-white/50">{label}</p>
      <p className={`mt-0.5 text-base font-bold ${tone}`}>{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Accounts (cash vs bank)                                             */
/* ------------------------------------------------------------------ */
function AccountsSection({
  data,
  book,
  prefs,
}: {
  data: DataState;
  book: UseParties["book"];
  prefs: Prefs;
}) {
  const balances = useMemo(() => accountBalances(data, book), [data, book]);
  const total = totalBalance(balances);

  return (
    <>
      <div className={`${cardCls} mb-3`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/60">کل موجود رقم</span>
          <span className="text-xl font-bold text-white">{money(total, prefs)} روپے</span>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        {balances.map((account) => (
          <div
            key={account.account}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/15 text-sky-200">
              <i className={`fas ${account.icon}`}></i>
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-xs font-bold text-white/90">{account.label}</span>
              <span className="block text-[10px] text-white/40">
                آمد {money(account.inflow, prefs)} • خرچ {money(account.outflow, prefs)}
              </span>
            </span>
            <span
              className={`shrink-0 text-sm font-bold ${
                account.balance < 0 ? "text-rose-300" : "text-emerald-300"
              }`}
            >
              {money(account.balance, prefs)}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => printReceipt("کھاتے — موجود رقم", accountsReceiptHtml(balances, total, prefs))}
        className={`${smallBtn} w-full border-sky-500/40 bg-sky-500/20 text-sky-300 hover:bg-sky-500/30`}
      >
        <i className="fas fa-print"></i> کھاتوں کا خلاصہ پرنٹ کریں
      </button>
      <p className="mt-2 text-[10px] text-white/35">
        نئی انٹری کا کھاتہ منتخب کریں (کیش، جاز کیش، ایزی پیسہ، بینک) — ادھار کی وصولی بھی گاہک
        کھاتے میں اسی کھاتے کے ساتھ درج ہوتی ہے۔
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Printable receipts                                                  */
/* ------------------------------------------------------------------ */
function partyReceiptHtml(party: Party, shop: UseParties, prefs: Prefs): string {
  const summary = partySummary(shop.book, party.id);
  const rows = partyTxns(shop.book, party.id).slice(0, 10);
  const body = rows
    .map(
      (txn) => `<tr>
        <td>${escapeHtml(txn.date)} — ${escapeHtml(partyTxnLabel(txn.kind, party.kind))}${
          txn.note ? `<br /><span class="muted">${escapeHtml(txn.note)}</span>` : ""
        }</td>
        <td class="amount">${escapeHtml(money(txn.amount, prefs))}</td>
      </tr>`,
    )
    .join("");

  return `
    <h1>صوتی بقیہ</h1>
    <div class="center muted">${escapeHtml(partyKindLabel(party.kind))} کا کھاتہ</div>
    <hr />
    <div class="row"><span>نام</span><span>${escapeHtml(party.name)}</span></div>
    ${
      party.phone
        ? `<div class="row"><span>فون</span><span>${escapeHtml(displayPhone(party.phone))}</span></div>`
        : ""
    }
    <div class="row"><span>تاریخ</span><span>${escapeHtml(new Date().toLocaleDateString("ur-PK"))}</span></div>
    <hr />
    <div class="row"><span>${
      party.kind === "customer" ? "کل ادھار" : "کل خریداری"
    }</span><span>${escapeHtml(money(summary.charges, prefs))}</span></div>
    <div class="row"><span>${
      party.kind === "customer" ? "کل وصولی" : "کل ادائیگی"
    }</span><span>${escapeHtml(money(summary.payments, prefs))}</span></div>
    <hr />
    <div class="row big"><span>${escapeHtml(
      balanceLabel(summary.balance, party.kind),
    )}</span><span>Rs. ${escapeHtml(money(summary.balance, prefs))}</span></div>
    <hr />
    <div class="center muted">آخری ${rows.length} انٹریز</div>
    <table>${body}</table>
    <div class="foot">شکریہ — صوتی بقیہ<br />PDF کے لیے “Save as PDF” منتخب کریں</div>
  `;
}

function daybookReceiptHtml(day: Daybook, prefs: Prefs): string {
  const accountRows = day.accounts
    .map(
      (account) =>
        `<div class="row"><span>${escapeHtml(account.label)}</span><span>${escapeHtml(
          money(account.closing, prefs),
        )}</span></div>`,
    )
    .join("");
  return `
    <h1>روزنامچہ</h1>
    <div class="center muted">${escapeHtml(day.date)}</div>
    <hr />
    <div class="row"><span>کھولتے وقت کیش</span><span>${escapeHtml(money(day.cashOpening, prefs))}</span></div>
    <div class="row in"><span>کل آمد</span><span>+${escapeHtml(money(day.totalIn, prefs))}</span></div>
    <div class="row out"><span>کل خرچ</span><span>−${escapeHtml(money(day.totalOut, prefs))}</span></div>
    <hr />
    <div class="row big"><span>بند کرتے وقت کیش</span><span>Rs. ${escapeHtml(
      money(day.cashClosing, prefs),
    )}</span></div>
    <hr />
    <div class="center muted">کھاتے</div>
    ${accountRows}
    <hr />
    <div class="center muted">${day.rows.length} لین دین</div>
    <div class="foot">صوتی بقیہ — صبح کا کھاتہ<br />PDF کے لیے “Save as PDF” منتخب کریں</div>
  `;
}

function accountsReceiptHtml(
  balances: { label: string; balance: number }[],
  total: number,
  prefs: Prefs,
): string {
  const rows = balances
    .map(
      (account) =>
        `<div class="row"><span>${escapeHtml(account.label)}</span><span>${escapeHtml(
          money(account.balance, prefs),
        )}</span></div>`,
    )
    .join("");
  return `
    <h1>کھاتے — موجود رقم</h1>
    <div class="center muted">${escapeHtml(new Date().toLocaleDateString("ur-PK"))}</div>
    <hr />
    ${rows}
    <hr />
    <div class="row big"><span>کل</span><span>Rs. ${escapeHtml(money(total, prefs))}</span></div>
    <div class="foot">صوتی بقیہ<br />PDF کے لیے “Save as PDF” منتخب کریں</div>
  `;
}
