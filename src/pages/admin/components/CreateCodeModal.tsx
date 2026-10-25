/**
 * "نیا کوڈ بنائیں" — the create-voucher form and its QR receipt.
 *
 * Same vocabulary as Activation/Settings: the shared `Modal` + `ModalHeader`
 * (glass-panel inside), `inputCls` for fields, `smallBtn`/`primaryBtn` for
 * actions, sky for the primary action and rose for errors. The only extra is
 * the QR image, drawn on a white tile so cameras can read it.
 *
 * The QR encodes `/activate?c=SAUTI-…` (see `activationLink`), so a WhatsApp
 * screenshot scanned by the camera app opens the activation screen with the
 * code already filled in. The code itself is printed under the QR for manual
 * typing — the plaintext is only ever held in this component and the parent's
 * `issued` map, never re-fetched (the server stores a hash).
 */
import { toCanvas } from "qrcode";
import { useState, type FormEvent } from "react";
import { Modal, ModalHeader } from "@/components/sauti/Modal";
import { notifySuccess, notifyWarning } from "@/lib/notifications";
import {
  activationLink,
  adminCreateCodes,
  type IssuedCode,
} from "@/lib/admin";
import { activationErrorMessage } from "@/lib/activation";

/* Verbatim copies of the app's control strings (see SettingsModal/Onboarding). */
const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";
const primaryBtn = `${smallBtn} flex-[1.4] border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35 disabled:opacity-50 disabled:cursor-not-allowed`;
const ghostBtn = `${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`;
const checkChip = (on: boolean) =>
  `${smallBtn} flex-1 ${
    on
      ? "border-sky-500/40 bg-sky-500/20 text-sky-200"
      : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10"
  }`;

/** Server bounds (functions/src/config.ts + validation.ts). */
const MIN_DAYS = 1;
const MAX_DAYS = 3650;
const MAX_DEVICES = 10;
/** `PLAN_PATTERN`: starts with a letter, then a-z/0-9/_/- , max 16 chars. */
const PLAN_PATTERN = /^[a-z][a-z0-9_-]{0,15}$/;

/** Free-form strings the server accepts; `ai`/`shop` are the shipped defaults. */
const FEATURE_CHOICES = [
  { id: "ai", label: "AI مشورہ" },
  { id: "voice", label: "وائس" },
  { id: "shop", label: "دکان" },
  { id: "reports", label: "رپورٹس" },
] as const;

export function CreateCodeModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Hands the plaintext code up so the table can copy/re-show it. */
  onCreated: (issued: IssuedCode) => void;
}) {
  const [plan, setPlan] = useState("pro");
  const [days, setDays] = useState("30");
  const [maxDevices, setMaxDevices] = useState("1");
  const [features, setFeatures] = useState<string[]>(["ai", "shop"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCode | null>(null);

  function resetForm() {
    setPlan("pro");
    setDays("30");
    setMaxDevices("1");
    setFeatures(["ai", "shop"]);
    setError(null);
    setIssued(null);
  }

  function close() {
    if (busy) return; // a request is in flight — no accidental dismissal
    onClose();
    // Show a clean form next time; the code stays in the parent's map.
    if (issued) resetForm();
  }

  function toggleFeature(id: string) {
    setFeatures((current) =>
      current.includes(id)
        ? current.filter((feature) => feature !== id)
        : [...current, id],
    );
    setError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const planName =
      plan.trim() === ""
        ? "standard"
        : plan.trim().toLowerCase().replace(/\s+/g, "-");
    if (!PLAN_PATTERN.test(planName)) {
      setError(
        "پلان کا نام a–z، digits، یا - / _ سے بنے، اور 16 حروف سے کم ہو (مثلاً pro، shop)۔",
      );
      return;
    }

    const daysValue = days.trim() === "" ? null : Number(days.trim());
    if (daysValue !== null) {
      if (!Number.isInteger(daysValue) || daysValue < MIN_DAYS || daysValue > MAX_DAYS) {
        setError(`میعاد ${MIN_DAYS} سے ${MAX_DAYS} دن کے درمیان ہونی چاہیے (خالی = کبھی ختم نہیں ہوتی)۔`);
        return;
      }
    }

    const deviceValue = Number(maxDevices.trim());
    if (!Number.isInteger(deviceValue) || deviceValue < 1 || deviceValue > MAX_DEVICES) {
      setError(`ڈیوپل 1 سے ${MAX_DEVICES} کے درمیان ہونے چاہئیں۔`);
      return;
    }

    if (features.length === 0) {
      setError("کم از کم ایک فیچر منتخب کریں۔");
      return;
    }

    setBusy(true);
    try {
      const codes = await adminCreateCodes({
        plan: planName,
        features,
        licenseDays: daysValue,
        maxDevices: deviceValue,
      });
      const first = codes[0];
      if (!first) {
        setError("سیرور نے کوڈ واپس نہیں کیا — دوبارہ کوشش کریں۔");
        return;
      }
      setIssued(first);
      onCreated(first);
      notifySuccess("کوڈ بن گیا", first.masked);
    } catch (err) {
      setError(activationErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} label="نیا کوڈ بنائیں">
      <ModalHeader
        icon="fa-ticket"
        iconClass="text-sky-300"
        onClose={busy ? () => {} : close}
      >
        {issued ? "کوڈ تیار ہے" : "نیا کوڈ بنائیں"}
      </ModalHeader>

      {issued ? (
        <div className="flex flex-col items-center text-center">
          <div
            id="admin-qr-tile"
            className="rounded-2xl border border-white/15 bg-white p-3"
          >
            <QRCanvas value={activationLink(issued.code)} size={200} />
          </div>

          <p
            dir="ltr"
            className="mt-3 font-sans text-sm font-bold tracking-[0.15em] text-white"
          >
            {issued.code}
          </p>
          <p className="mt-1 text-[11px] leading-6 text-white/55">
            اسکرین شاٹ لے کر واٹس ایپ پر بھیجیں — کیمرہ اسکن کرتے ہی کوڈ خود
            بھر جائے گا۔
          </p>

          <div className="mt-4 flex gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              className={ghostBtn}
              onClick={() => void copyText(activationLink(issued.code), "لنک کاپی ہو گیا")}
            >
              <i className="fa-solid fa-link"></i> لنک
            </button>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => void copyText(issued.code, "کوڈ کاپی ہو گیا")}
            >
              <i className="fa-solid fa-copy"></i> کوڈ
            </button>
            <button type="button" className={primaryBtn} onClick={resetForm}>
              <i className="fa-solid fa-plus"></i> ایک اور
            </button>
          </div>
          <button
            type="button"
            className={`${ghostBtn} mt-2 w-full`}
            onClick={close}
          >
            بند کریں
          </button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          <label htmlFor="create-plan" className="text-[11px] text-white/60">
            پلان کا نام
          </label>
          <input
            id="create-plan"
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value);
              setError(null);
            }}
            placeholder="pro / shop / standard"
            className={inputCls}
          />

          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="create-days" className="text-[11px] text-white/60">
                میعاد (دن)
              </label>
              <input
                id="create-days"
                dir="ltr"
                inputMode="numeric"
                value={days}
                onChange={(event) => {
                  setDays(event.target.value);
                  setError(null);
                }}
                placeholder="30"
                className={`${inputCls} text-center`}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="create-devices" className="text-[11px] text-white/60">
                زیادہ سے زیادہ ڈیوپل
              </label>
              <input
                id="create-devices"
                dir="ltr"
                inputMode="numeric"
                value={maxDevices}
                onChange={(event) => {
                  setMaxDevices(event.target.value);
                  setError(null);
                }}
                placeholder="1"
                className={`${inputCls} text-center`}
              />
            </div>
          </div>

          <div>
            <span className="text-[11px] text-white/60">فیچرز</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {FEATURE_CHOICES.map((choice) => {
                const on = features.includes(choice.id);
                return (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleFeature(choice.id)}
                    className={checkChip(on)}
                  >
                    <i className={`fa-solid ${on ? "fa-square-check" : "fa-square"}`}></i>
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-[11px] leading-6 text-rose-400">
              {error}
            </p>
          )}

          <div className="mt-1 flex gap-2 border-t border-white/10 pt-4">
            <button type="button" className={ghostBtn} onClick={close} disabled={busy}>
              منسوخ
            </button>
            <button type="submit" className={primaryBtn} disabled={busy}>
              {busy ? (
                <>
                  <i className="fas fa-circle-notch animate-spin"></i> بن رہا ہے…
                </>
              ) : (
                <>
                  <i className="fas fa-plus"></i> بنائیں
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function copyText(text: string, successTitle: string) {
  try {
    await navigator.clipboard.writeText(text);
    notifySuccess(successTitle);
  } catch {
    notifyWarning("کاپی نہیں ہو سکا", "خود select کر کے کاپی کریں۔");
  }
}

/**
 * Draws the QR into a canvas.
 *
 * Uses `toCanvas` rather than rendering `QRCodeCanvas` directly so the tile can
 * be captured as an image later if a native share sheet is ever added; the
 * markup stays a plain `<canvas>` either way. Kept as a tiny component so the
 * parent re-renders do not redraw manually.
 */
function QRCanvas({ value, size }: { value: string; size: number }) {
  return (
    <canvas
      ref={(node) => {
        if (!node) return;
        void toCanvas(node, value, {
          width: size,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#0F172A", light: "#FFFFFF" },
        }).catch(() => {
          /* value is validated above; nothing to do if the draw fails */
        });
      }}
      width={size}
      height={size}
      aria-label="ایکٹیویشن کوڈ کا QR"
      className="block"
    />
  );
}
