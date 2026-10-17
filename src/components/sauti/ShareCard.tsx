/**
 * Link-preview card.
 *
 * Shows exactly what WhatsApp/Facebook will draw for the shared link — the same
 * `og:title`, `og:description` and 1200×630 image that `index.html` (and the
 * runtime meta sync) publishes. If the picture is wrong here, the preview in
 * the chat is wrong too, so this is the fastest place to notice it.
 */
import {
  BRAND,
  applyShareMeta,
  publicOrigin,
  shareMessage,
  sharePreview,
  whatsappShareUrl,
} from "@/lib/brand";
import { track } from "@/lib/telemetry";
import { useState } from "react";

const smallBtn =
  "px-3 py-2 rounded-xl text-xs font-bold transition border font-sans flex items-center justify-center gap-1.5";

export function ShareCard({ onShared }: { onShared?: () => void }) {
  const [copied, setCopied] = useState(false);
  const origin = publicOrigin();
  const card = sharePreview(origin);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      track("share_copy", { ok: true });
    } catch {
      track("share_copy", { ok: false });
    }
  };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/5">
        <img
          src={BRAND.ogImage}
          alt="صوتی بقیہ — اردو وائس فنانس اسسٹنٹ"
          width={BRAND.ogImageWidth}
          height={BRAND.ogImageHeight}
          loading="lazy"
          className="aspect-[1200/630] w-full object-cover"
        />
        <div className="border-t border-white/10 p-3">
          <p className="font-sans text-[10px] uppercase tracking-widest text-white/35">
            {card.domain}
          </p>
          <p className="mt-1 text-sm font-bold text-white">{card.title}</p>
          <p className="mt-1 text-[11px] leading-5 text-white/55">{card.description}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className={`${smallBtn} flex-1 border-white/20 bg-white/10 text-white/80 hover:bg-white/20`}
        >
          <i className={`fas ${copied ? "fa-check text-emerald-300" : "fa-link"}`}></i>
          {copied ? "لنک کاپی ہو گیا" : "لنک کاپی کریں"}
        </button>
        <a
          href={whatsappShareUrl(shareMessage(origin))}
          target="_blank"
          rel="noreferrer"
          onClick={() => {
            applyShareMeta(origin);
            track("share_whatsapp", { source: "settings" });
            onShared?.();
          }}
          className={`${smallBtn} flex-1 border-[#25D366]/40 bg-[#25D366]/15 text-[#25D366] no-underline hover:bg-[#25D366]/25`}
        >
          <i className="fab fa-whatsapp text-base"></i> واٹس ایپ پر بھیجیں
        </a>
      </div>

      <p className="text-[10px] leading-5 text-white/35">
        پری ویو کے لیے <span className="font-sans">og:image</span> کو مکمل (absolute) لنک چاہیے —{" "}
        <span className="font-sans">VITE_PUBLIC_ORIGIN</span> سیٹ ہونے پر کارڈ ہر جگہ درست نظر آئے گا۔
      </p>
    </div>
  );
}
