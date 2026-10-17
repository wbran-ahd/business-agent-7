/**
 * PIN dialog for the staff lock (set / unlock / remove).
 *
 * Kept deliberately small: numeric input, one action button, inline error. It is
 * a shop-floor convenience lock, so no recovery flow is promised beyond removing
 * it from the same device.
 *
 * The inputs live in an inner component: the shared `Modal` renders `null` when
 * closed, so the form unmounts and reopens empty without any reset effect.
 */
import { Modal } from "@/components/sauti/Modal";
import { useState } from "react";

export type PinMode = "set" | "unlock" | "remove";

const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-center text-white tracking-[0.4em] focus:outline-none focus:border-sky-400 font-sans";

const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1";

export function StaffPinModal({
  open,
  mode,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  mode: PinMode;
  busy: boolean;
  error: string;
  onSubmit: (pin: string, confirm: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} label={pinTitle(mode)} fontSans>
      <PinForm mode={mode} busy={busy} error={error} onSubmit={onSubmit} onClose={onClose} />
    </Modal>
  );
}

function pinTitle(mode: PinMode): string {
  if (mode === "set") return "PIN سیٹ کریں";
  if (mode === "unlock") return "مالک موڈ میں واپس";
  return "PIN ہٹائیں";
}

function PinForm({
  mode,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  mode: PinMode;
  busy: boolean;
  error: string;
  onSubmit: (pin: string, confirm: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");

  const title = pinTitle(mode);
  const hint =
    mode === "set"
      ? "4 سے 8 ہندسوں کا PIN چنیں — یہ صرف اسی فون میں محفوظ رہتا ہے۔"
      : mode === "unlock"
        ? "سیلز مین موڈ بند کرنے کے لیے PIN درج کریں۔"
        : "PIN ہٹانے کے لیے موجودہ PIN درج کریں۔";

  return (
    <>
      <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-white">
          <i className="fas fa-lock text-amber-300"></i> {title}
        </h2>
        <button
          onClick={onClose}
          aria-label="بند کریں"
          className="text-white/50 transition hover:text-white"
        >
          <i className="fas fa-times text-xl"></i>
        </button>
      </div>

      <p className="mb-3 text-[11px] text-white/60">{hint}</p>

      <div className="space-y-2">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          className={inputCls}
          placeholder="••••"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
        />
        {mode === "set" && (
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            className={inputCls}
            placeholder="دوبارہ لکھیں"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ""))}
          />
        )}
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={busy || pin.length < 4}
            onClick={() => onSubmit(pin, confirm)}
            className={`${smallBtn} flex-1 border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50`}
          >
            {busy ? "…" : "✓ تصدیق کریں"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`}
          >
            ✕ منسوخ
          </button>
        </div>
      </div>
    </>
  );
}
