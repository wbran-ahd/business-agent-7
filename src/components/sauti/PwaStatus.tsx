/**
 * PWA banners: offline, install and “new version”.
 *
 * Each one is a single glass strip above the ledger; when none applies the
 * component renders nothing, so the first paint is byte-for-byte the same as
 * before. Dismissal is remembered for two weeks instead of forever, because an
 * install nudge that never returns is a lost install.
 */
import type { UsePwa } from "@/hooks/use-pwa";
import { track } from "@/lib/telemetry";
import { useState } from "react";

const DISMISS_KEY = "sautiBaqayaInstallDismissed";
const DAY = 86_400_000;

function dismissedRecently(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return at > 0 && now - at < 14 * DAY;
  } catch {
    return false;
  }
}

const smallBtn =
  "px-3 py-1.5 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";

export function PwaStatus({ pwa, onInstalled }: { pwa: UsePwa; onInstalled?: () => void }) {
  const [hidden, setHidden] = useState(() => dismissedRecently());
  const [busy, setBusy] = useState(false);

  if (pwa.updateReady) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-sky-500/35 bg-sky-500/10 p-3">
        <p className="text-[11px] text-sky-100">
          <i className="fas fa-rotate ml-1"></i> نیا ورژن دستیاب ہے — تازہ ترین اصلاحات کے لیے دوبارہ
          کھولیں۔
        </p>
        <button
          type="button"
          onClick={pwa.applyUpdate}
          className={`${smallBtn} shrink-0 border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35`}
        >
          اپ ڈیٹ کریں
        </button>
      </div>
    );
  }

  if (!pwa.online) {
    return (
      <div className="mb-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3">
        <p className="text-[11px] text-amber-100">
          <i className="fas fa-wifi ml-1"></i> آپ آف لائن ہیں — نیا اندراج اسی فون پر محفوظ رہے گا اور
          انٹرنیٹ آنے پر کلاؤڈ سینک ہو جائے گا۔
        </p>
      </div>
    );
  }

  if (!pwa.installable || pwa.installed || hidden) return null;

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-2xl border border-white/15 bg-white/5 p-3">
      <p className="text-[11px] leading-relaxed text-white/70">
        <i className="fas fa-mobile-screen ml-1 text-sky-300"></i> صوتی بقیہ کو فون پر نصب کریں — پھر
        بغیر براؤزر کھولے، آف لائن بھی چلے گا۔
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void pwa.install().then((accepted) => {
              setBusy(false);
              track("install_prompt", { accepted });
              if (accepted) onInstalled?.();
            });
          }}
          className={`${smallBtn} border-sky-500/40 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30 disabled:opacity-60`}
        >
          نصب کریں
        </button>
        <button
          type="button"
          aria-label="بعد میں"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, String(Date.now()));
            } catch {
              /* ignore */
            }
            setHidden(true);
          }}
          className="rounded-lg p-1.5 text-white/40 transition hover:text-white"
        >
          <i className="fas fa-times text-xs"></i>
        </button>
      </div>
    </div>
  );
}
