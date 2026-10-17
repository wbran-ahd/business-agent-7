/**
 * Local payment sheet — JazzCash / EasyPaisa.
 *
 * The flow is the one that actually works in a Pakistani shop today:
 *   1. choose a plan;
 *   2. send the amount to the shop's JazzCash/EasyPaisa number (copy button);
 *   3. submit the TID — a WhatsApp message opens with the order reference,
 *      amount and TID prefilled;
 *   4. the owner confirms and sends back an activation code, which unlocks the
 *      plan offline on this device.
 *
 * No gateway, no card data, and no claim that money was verified automatically.
 */
import { Modal } from "@/components/sauti/Modal";
import {
  PLANS,
  WALLETS,
  orderReference,
  paymentRequestMessage,
  paymentRequestUrl,
  planById,
  validateTid,
  walletById,
  type ActivationResult,
  type LicenseSnapshot,
  type PlanId,
  type WalletId,
} from "@/lib/payments";
import { track } from "@/lib/telemetry";
import { useMemo, useState } from "react";

const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";
const TID_KEY = "sautiBaqayaSubmittedTids";

function loadSubmittedTids(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TID_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberTid(tid: string): string[] {
  const next = Array.from(new Set([...loadSubmittedTids(), tid])).slice(-50);
  try {
    localStorage.setItem(TID_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function UpgradeModal({
  open,
  onClose,
  snapshot,
  installId,
  onActivate,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: LicenseSnapshot;
  installId: string;
  onActivate: (code: string) => ActivationResult;
}) {
  const [plan, setPlan] = useState<PlanId>("yearly");
  const [wallet, setWallet] = useState<WalletId>("jazzcash");
  const [tid, setTid] = useState("");
  const [payerTail, setPayerTail] = useState("");
  const [error, setError] = useState("");
  const [requested, setRequested] = useState("");
  const [code, setCode] = useState("");
  const [activationMessage, setActivationMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const selectedPlan = planById(plan);
  const selectedWallet = walletById(wallet);
  const orderRef = useMemo(() => orderReference(plan, installId), [plan, installId]);

  const copyNumber = async () => {
    if (!selectedWallet.number) return;
    try {
      await navigator.clipboard.writeText(selectedWallet.number);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("نمبر کاپی نہیں ہو سکا — دستی طور پر لکھ لیں۔");
    }
  };

  const submit = () => {
    const check = validateTid(tid, loadSubmittedTids());
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError("");
    const { url, configured } = paymentRequestUrl({
      plan,
      wallet,
      orderRef,
      tid: check.tid,
      payerTail: payerTail.replace(/[^\d]/g, "").slice(-4),
    });
    rememberTid(check.tid);
    setRequested(orderRef);
    track("payment_request", {
      plan,
      wallet,
      configured,
      amount: selectedPlan.price,
    });
    window.open(url, "_blank", "noopener");
  };

  const activate = () => {
    const result = onActivate(code);
    setActivationMessage({ ok: result.ok, text: result.message });
    track("activation_attempt", { ok: result.ok });
    if (result.ok) setCode("");
  };

  return (
    <Modal open={open} onClose={onClose} label="پرو اور ادائیگی" scrollable fontSans>
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <i className="fas fa-crown text-amber-400"></i> پرو / ادائیگی
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="بند کریں"
          className="text-white/50 transition hover:text-white"
        >
          <i className="fas fa-times text-xl"></i>
        </button>
      </div>

      <div
        className={`mt-3 flex items-center justify-between rounded-2xl border p-3 text-[11px] ${
          snapshot.status === "active"
            ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
            : snapshot.status === "trial"
              ? "border-sky-500/35 bg-sky-500/10 text-sky-100"
              : "border-rose-500/35 bg-rose-500/10 text-rose-100"
        }`}
      >
        <span>
          <i
            className={`fas ${
              snapshot.status === "active"
                ? "fa-circle-check"
                : snapshot.status === "trial"
                  ? "fa-hourglass-half"
                  : "fa-circle-exclamation"
            } ml-1`}
          ></i>
          {snapshot.label}
        </span>
        {snapshot.status === "active" && (
          <span className="text-[10px] text-white/50">{snapshot.planLabel}</span>
        )}
      </div>

      <h3 className="mt-4 text-xs font-bold text-white/85">پلان منتخب کریں</h3>
      <div className="mt-2 space-y-2">
        {PLANS.map((option) => {
          const active = option.id === plan;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setPlan(option.id)}
              aria-pressed={active}
              className={`w-full rounded-2xl border p-3 text-right transition ${
                active
                  ? "border-amber-500/50 bg-amber-500/10"
                  : "border-white/15 bg-white/5 hover:bg-white/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">{option.label}</span>
                <span className="font-sans text-sm font-bold text-amber-200">
                  Rs. {option.price.toLocaleString("en-PK")}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px] text-white/45">
                <span>{option.note}</span>
                {option.badge && (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                    {option.badge}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <h3 className="mt-4 text-xs font-bold text-white/85">ادائیگی کہاں بھیجیں</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {WALLETS.map((option) => {
          const active = option.id === wallet;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setWallet(option.id)}
              aria-pressed={active}
              className={`rounded-2xl border p-2.5 text-center transition ${
                active ? "border-white/40 bg-white/10" : "border-white/15 bg-white/5 hover:bg-white/10"
              }`}
            >
              <span className="block text-xs font-bold" style={{ color: option.accent }}>
                {option.label}
              </span>
              <span className="mt-0.5 block font-sans text-[10px] text-white/45">{option.latin}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 p-2.5">
        <span className="font-sans text-[11px] tracking-wider text-white/70">
          {selectedWallet.number || "نمبر سیٹ نہیں"}
        </span>
        {selectedWallet.number ? (
          <button
            type="button"
            onClick={() => void copyNumber()}
            className="rounded-lg border border-white/20 px-2 py-1 text-[10px] text-white/70 transition hover:bg-white/10"
          >
            <i className={`fas ${copied ? "fa-check text-emerald-300" : "fa-copy"} ml-1`}></i>
            {copied ? "کاپی" : "نمبر کاپی"}
          </button>
        ) : (
          <span className="text-[10px] text-amber-300/80">واٹس ایپ پر رابطہ کریں</span>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-5 text-white/40">
        رقم بھیجنے کے بعد نیچے TID درج کریں۔ درخواست واٹس ایپ پر کھلے گی، مالک تصدیق کر کے ایکٹیویشن
        کوڈ بھیجے گا۔
      </p>

      <div className="mt-2 flex gap-2">
        <input
          className="w-full rounded-xl border border-white/20 bg-black/40 px-3 py-2 font-sans text-xs text-white focus:border-sky-400 focus:outline-none"
          placeholder="TID / ٹرانزیکشن نمبر"
          inputMode="numeric"
          value={tid}
          onChange={(event) => setTid(event.target.value)}
        />
        <input
          className="w-28 shrink-0 rounded-xl border border-white/20 bg-black/40 px-3 py-2 font-sans text-xs text-white focus:border-sky-400 focus:outline-none"
          placeholder="آخری 4 ہندسے"
          inputMode="numeric"
          maxLength={4}
          value={payerTail}
          onChange={(event) => setPayerTail(event.target.value)}
        />
      </div>

      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}

      <button
        type="button"
        onClick={submit}
        className="mt-2 w-full rounded-xl border border-[#25D366]/40 bg-[#25D366]/15 py-2.5 text-xs font-bold text-[#25D366] transition hover:bg-[#25D366]/25"
      >
        <i className="fab fa-whatsapp ml-1 text-base"></i> ادائیگی کی تصدیق بھیجیں — Rs.{" "}
        {selectedPlan.price.toLocaleString("en-PK")}
      </button>

      {requested && (
        <p className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2 text-[10px] leading-5 text-emerald-100">
          درخواست تیار ہے (آرڈر <span className="font-sans">{requested}</span>)۔ واٹس ایپ پر پیغام بھیج
          دیں — تصدیق کے بعد کوڈ نیچے درج کریں۔
          <br />
          <span className="text-white/40">{paymentRequestMessage({
            plan,
            wallet,
            orderRef: requested,
            tid: tid.replace(/[^\d]/g, ""),
            payerTail,
          }).split("\n").slice(1, 3).join(" · ")}</span>
        </p>
      )}

      <div className="mt-5 border-t border-white/10 pt-4">
        <h3 className="text-xs font-bold text-white/85">ایکٹیویشن کوڈ</h3>
        <div className="mt-2 flex gap-2">
          <input
            className="w-full rounded-xl border border-white/20 bg-black/40 px-3 py-2 font-sans text-xs uppercase text-white focus:border-amber-400 focus:outline-none"
            placeholder="SB-Y-202610-XXXX"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            type="button"
            onClick={activate}
            disabled={code.trim().length < 8}
            className={`${smallBtn} shrink-0 border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50`}
          >
            فعال کریں
          </button>
        </div>
        {activationMessage && (
          <p
            className={`mt-2 text-[11px] ${
              activationMessage.ok ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {activationMessage.text}
          </p>
        )}
        <p className="mt-2 text-[10px] leading-5 text-white/35">
          کوڈ اس فون کے لیے بنتا ہے، اسی لیے مشترکہ نہیں کیا جا سکتا۔ ادائیگی کی تصدیق دستی ہوتی ہے —
          یہ فیچر ابھی پائلٹ مرحلے میں ہے۔
        </p>
      </div>
    </Modal>
  );
}
