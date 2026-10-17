/**
 * Receipt printing.
 *
 * A receipt is rendered into a hidden iframe on an 80 mm page and handed to the
 * browser's print dialog. That covers three real-world paths with no extra
 * dependency:
 *   • a Bluetooth/USB thermal printer installed at OS level (driver handles it)
 *   • “Save as PDF” for sharing on WhatsApp
 *   • a normal A4 print, because the page auto-sizes
 *
 * It deliberately does not talk ESC/POS over Web Bluetooth: pairing protocols
 * differ per printer and cannot be verified here, so promising it would be a lie.
 */

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const RECEIPT_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body {
    width: 74mm; margin: 0; color: #111; background: #fff;
    font-family: "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Segoe UI", Tahoma, sans-serif;
    font-size: 11px; line-height: 1.9; direction: rtl;
  }
  h1 { font-size: 15px; margin: 0 0 2px; text-align: center; }
  .muted { color: #555; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .big { font-size: 16px; font-weight: 700; }
  hr { border: 0; border-top: 1px dashed #999; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 0; vertical-align: top; }
  td.amount { text-align: left; white-space: nowrap; }
  .in { color: #047857; }
  .out { color: #b91c1c; }
  .foot { margin-top: 6px; text-align: center; font-size: 10px; color: #555; }
`;

export function receiptShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html dir="rtl" lang="ur"><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title><style>${RECEIPT_CSS}</style></head>
<body>${bodyHtml}</body></html>`;
}

/**
 * Prints a complete HTML document (the A4 monthly report) through the same
 * hidden-iframe trick, so the user can pick “Save as PDF” in the print dialog.
 */
export function printHtmlDocument(html: string): boolean {
  if (typeof document === "undefined") return false;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  // A4 @96dpi, so the printed layout matches the on-screen preview width.
  iframe.style.width = "794px";
  iframe.style.height = "1123px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();

  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => iframe.remove(), 60_000);
    }
  };

  // Wait for the (self-hosted) Nastaliq face so the PDF is not set in a
  // fallback font, but never block the dialog forever.
  const fonts = doc.fonts;
  if (fonts?.ready) {
    void fonts.ready.then(() => window.setTimeout(fire, 120));
  }
  window.setTimeout(fire, 1500);
  return true;
}

/** Opens the print dialog for a receipt; the dialog offers “Save as PDF”. */
export function printReceipt(title: string, bodyHtml: string): boolean {
  if (typeof document === "undefined") return false;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "320px";
  iframe.style.height = "600px";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return false;
  }
  doc.open();
  doc.write(receiptShell(title, bodyHtml));
  doc.close();

  // Give the iframe a tick to lay out, then print from inside it.
  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // Safari needs the frame alive while the dialog is open.
      window.setTimeout(() => iframe.remove(), 60_000);
    }
  }, 250);
  return true;
}
