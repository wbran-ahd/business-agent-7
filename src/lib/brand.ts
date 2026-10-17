/**
 * Brand + social-share metadata.
 *
 * One source of truth for the name, version and link preview. `index.html`
 * carries the static Open Graph tags (WhatsApp/Facebook read them without
 * running JavaScript), and {@link shareMetaTags} re-applies the same values at
 * runtime so a SPA route never reports a stale title.
 *
 * Nothing here touches the *visual* theme: the glassmorphism palette lives in
 * `index.css` and is intentionally untouched.
 */

export const BRAND = {
  name: "صوتی بقیہ",
  latin: "Sauti Baqaya",
  tagline: "اردو وائس فنانس اسسٹنٹ",
  description:
    "بول کر آمدنی اور خرچہ درج کریں، بجٹ الرٹ اور آواز میں تصدیق پائیں، دکان کا کھاتہ اور ماہانہ رپورٹ ایک ہی جگہ — اردو میں۔",
  descriptionLatin:
    "Urdu voice finance assistant: speak your income and expenses, get budget alerts, shop khata and monthly reports.",
  version: "1.0.0",
  themeColor: "#0F172A",
  ogImage: "/og-cover.png",
  ogImageWidth: 1200,
  ogImageHeight: 630,
  /** Support line; set VITE_SUPPORT_WHATSAPP (E.164 digits, no +). */
  supportWhatsApp: (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined)?.trim(),
} as const;

/** Site origin used for absolute OG URLs. Scrapers need an absolute URL. */
export function publicOrigin(fallback = ""): string {
  const configured = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return fallback.replace(/\/+$/, "");
}

export type SharePreview = {
  title: string;
  description: string;
  url: string;
  image: string;
  domain: string;
  siteName: string;
};

/** The exact card WhatsApp draws for a shared link. */
export function sharePreview(origin = publicOrigin()): SharePreview {
  const base = origin.replace(/\/+$/, "");
  let domain = base;
  try {
    domain = new URL(base || "https://sauti.example").host;
  } catch {
    domain = base.replace(/^https?:\/\//, "").split("/")[0];
  }
  const description =
    "آواز سے کھاتہ: آمدنی، خرچہ، بجٹ الرٹ، دکان کا کھاتہ اور ماہانہ رپورٹ — سب اردو میں۔";
  return {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description,
    url: `${base}/`,
    image: `${base}${BRAND.ogImage}`,
    domain,
    siteName: BRAND.name,
  };
}

export type MetaTag = { key: string; attr: "property" | "name"; content: string };

/**
 * Metadata pairs for a link preview. Kept as data (not DOM calls) so the exact
 * values are testable without a browser.
 */
export function shareMetaTags(origin = publicOrigin()): MetaTag[] {
  const card = sharePreview(origin);
  return [
    { key: "og:type", attr: "property", content: "website" },
    { key: "og:site_name", attr: "property", content: card.siteName },
    { key: "og:title", attr: "property", content: card.title },
    { key: "og:description", attr: "property", content: card.description },
    { key: "og:url", attr: "property", content: card.url },
    { key: "og:image", attr: "property", content: card.image },
    { key: "og:image:width", attr: "property", content: String(BRAND.ogImageWidth) },
    { key: "og:image:height", attr: "property", content: String(BRAND.ogImageHeight) },
    { key: "og:image:alt", attr: "property", content: `${BRAND.name} — ${BRAND.tagline}` },
    { key: "og:locale", attr: "property", content: "ur_PK" },
    { key: "twitter:card", attr: "name", content: "summary_large_image" },
    { key: "twitter:title", attr: "name", content: card.title },
    { key: "twitter:description", attr: "name", content: card.description },
    { key: "twitter:image", attr: "name", content: card.image },
    { key: "description", attr: "name", content: card.description },
  ];
}

/** Applies {@link shareMetaTags} to the live document (idempotent). */
export function applyShareMeta(origin = publicOrigin()): void {
  if (typeof document === "undefined") return;
  const head = document.head;
  for (const tag of shareMetaTags(origin)) {
    const selector = `meta[${tag.attr}="${tag.key}"]`;
    let node = head.querySelector<HTMLMetaElement>(selector);
    if (!node) {
      node = document.createElement("meta");
      node.setAttribute(tag.attr, tag.key);
      head.appendChild(node);
    }
    if (node.getAttribute("content") !== tag.content) {
      node.setAttribute("content", tag.content);
    }
  }
  const canonical = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const href = `${origin.replace(/\/+$/, "")}/`;
  if (canonical) canonical.href = href;
}

/** Share message used by the “واٹس ایپ پر بھیجیں” buttons. */
export function shareMessage(origin = publicOrigin()): string {
  const card = sharePreview(origin);
  return `${BRAND.name} — ${BRAND.tagline}\n${card.description}\n${card.url}`;
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Direct support chat; `configured` is false when no number is set. */
export function supportUrl(topic = "مدد"): { url: string; configured: boolean } {
  const number = (BRAND.supportWhatsApp ?? "").replace(/[^\d]/g, "");
  const text = `السلام علیکم — ${BRAND.name} (${BRAND.version}) کے بارے میں ${topic}۔`;
  if (!number) return { url: whatsappShareUrl(text), configured: false };
  return { url: `https://wa.me/${number}?text=${encodeURIComponent(text)}`, configured: true };
}
