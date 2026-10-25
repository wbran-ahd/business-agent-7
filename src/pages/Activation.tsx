/**
 * `/activate` — the only way into صوتی بقیہ.
 *
 * Design contract: this screen introduces no colour, font, radius, spacing or
 * button style of its own. It composes what the app already ships — the
 * `sauti-app` shell, `ambient-bg`, `glass-panel`, the shared `inputCls` /
 * `smallBtn` strings from Settings/Onboarding, Font Awesome glyphs and the
 * sky/rose/amber semantic accents — so the pixels match the dashboard the user
 * will land on.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import logo from "@/assets/logo.svg";
import { Modal, ModalHeader } from "@/components/sauti/Modal";
import { useActivation } from "@/hooks/use-activation";
import { useLicense } from "@/hooks/use-license";
import { BRAND } from "@/lib/brand";

/* Copied verbatim from SettingsModal/Onboarding — these strings are the app's
   control vocabulary, duplicated per file by convention rather than imported. */
const inputCls =
  "w-full bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-400 font-sans";
const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";
const primaryBtn = `${smallBtn} flex-[1.4] border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35 disabled:opacity-50 disabled:cursor-not-allowed`;
const ghostBtn = `${smallBtn} flex-1 border-white/20 bg-white/10 text-white hover:bg-white/20`;

export default function Activation() {
  const navigate = useNavigate();
  const license = useLicense();
  const { code, setCode, error, busy, submit } = useActivation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [expiredDismissed, setExpiredDismissed] = useState(false);

  const expired = license.phase === "expired";

  // Already licensed (opened /activate by hand, or a second tab): go home.
  useEffect(() => {
    if (license.phase === "active") navigate("/", { replace: true });
  }, [license.phase, navigate]);

  return (
    <div className="sauti-app min-h-screen">
      <div className="ambient-bg" aria-hidden="true" />

      <main className="relative z-10 flex min-h-screen items-center justify-center p-4">
        <section
          className="glass-panel m-4 w-full max-w-md p-6"
          aria-labelledby="activation-title"
        >
          <header className="flex items-center gap-3">
            <img
              src={logo}
              alt=""
              className="size-16 rounded-2xl border border-white/15"
            />
            <div className="leading-tight">
              <p className="nastaliq text-sm text-white">{BRAND.name}</p>
              <p className="text-[10px] text-white/45">{BRAND.tagline}</p>
            </div>
          </header>

          <h1
            id="activation-title"
            className="nastaliq mt-5 text-xl font-bold leading-loose text-white"
          >
            ایکٹیویشن کوڈ ڈالیں
          </h1>
          <p className="mt-1 text-xs leading-6 text-white/60">
            دکے گئے QR کوڈ کو کیمرہ ایپ سے اسکن کریں یا کوڈ خود لکھیں۔ ایک ڈیوپل
            پر ایک ہی بار کوڈ درکار ہے۔
          </p>

          {license.phase === "revoked" && (
            <p className="mt-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] leading-6 text-amber-200">
              آپ کی ایکٹیویشن منسوخ کر دی گئی ہے۔ نیا کوڈ ڈال کر دوبارہ ایکٹیویٹ
              کریں۔
            </p>
          )}

          <form
            className="mt-5 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label
              htmlFor="activation-code"
              className="text-[11px] text-white/60"
            >
              ایکٹیویشن کوڈ
            </label>
            <input
              id="activation-code"
              ref={inputRef}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              dir="ltr"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              placeholder="SAUTI-XXXX-XXXX-XXXX"
              aria-invalid={Boolean(error)}
              className={`${inputCls} text-center tracking-[0.25em] uppercase`}
            />

            {error && (
              <p role="alert" className="text-[11px] leading-6 text-rose-400">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className={primaryBtn}>
              {busy ? (
                <>
                  <i className="fas fa-circle-notch animate-spin"></i> جا رہا
                  ہے…
                </>
              ) : (
                <>
                  <i className="fas fa-unlock"></i> کھولیں
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-[10px] leading-5 text-white/40">
            QR کوڈ نہیں ملا؟ دکان کے صاحب سے وہی SAUTI-XXXX-XXXX-XXXX کوڈ لیں۔
          </p>
        </section>
      </main>

      <Modal
        open={expired && !expiredDismissed}
        onClose={() => setExpiredDismissed(true)}
        label="کوڈ ختم ہو گیا"
      >
        <ModalHeader
          icon="fa-clock"
          iconClass="text-rose-400"
          onClose={() => setExpiredDismissed(true)}
        >
          کوڈ ختم ہو گیا
        </ModalHeader>
        <p className="text-xs leading-7 text-white/70">
          آپ کے ایکٹیویشن کوڈ کی میعاد ختم ہو چکی ہے۔ نیا کوڈ ڈال کر دوبارہ
          ایکٹیویٹ کریں — اگر کوڈ نہیں ملا تو دکان کے صاحب سے رابطہ کریں۔
        </p>
        <div className="mt-5 flex gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => setExpiredDismissed(true)}
            className={ghostBtn}
          >
            ٹھیک ہے
          </button>
          <button
            type="button"
            onClick={() => {
              setExpiredDismissed(true);
              inputRef.current?.focus();
            }}
            className={primaryBtn}
          >
            نیا کوڈ ڈالیں
          </button>
        </div>
      </Modal>
    </div>
  );
}
