/**
 * Monthly financial report → Excel (.xlsx) and PDF (browser print).
 *
 * No dependencies:
 *   • the XLSX file is a ZIP of SpreadsheetML parts written here (stored, not
 *     deflated), which Excel/Numbers/Google Sheets all open;
 *   • the “PDF” path renders an A4 HTML document and hands it to the print
 *     dialog, where every platform offers “Save as PDF”.
 *
 * `zipStore`/`crc32`/`sheetXml` are exported so the verification script can
 * prove the archive is structurally valid instead of trusting it by eye.
 */

import {
  ACCOUNT_CATALOG,
  formatMonthName,
  getTotals,
  monthOf,
  normalizeAccount,
  type AccountKind,
  type DataState,
  type Entry,
} from "@/lib/khata";
import { escapeHtml } from "@/lib/print";

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export type CellStyle = "title" | "header" | "money";
export type ReportCell = string | number | { value: string | number; style?: CellStyle };
export type ReportRow = ReportCell[];
export type ReportSheet = { name: string; rows: ReportRow[] };

export type AccountTotal = {
  id: AccountKind;
  label: string;
  income: number;
  expense: number;
  net: number;
};

export type CategoryTotal = { category: string; amount: number; share: number };

export type ReportModel = {
  monthKey: string;
  monthLabel: string;
  generatedAt: Date;
  owner: string;
  totals: ReturnType<typeof getTotals>;
  categories: CategoryTotal[];
  accounts: AccountTotal[];
  income: Entry[];
  expense: Entry[];
  sheets: ReportSheet[];
};

export type ReportInput = {
  data: DataState;
  monthKey: string;
  owner?: string;
  generatedAt?: Date;
};

function entriesFor(list: Entry[], monthKey: string): Entry[] {
  return list
    .filter((entry) => monthOf(entry) === monthKey)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/** Cash / wallet / bank split for the month (not cumulative). */
export function accountTotals(data: DataState, monthKey: string): AccountTotal[] {
  return ACCOUNT_CATALOG.map((account) => {
    const income = data.income
      .filter((entry) => monthOf(entry) === monthKey && normalizeAccount(entry.account) === account.id)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const expense = data.expense
      .filter((entry) => monthOf(entry) === monthKey && normalizeAccount(entry.account) === account.id)
      .reduce((sum, entry) => sum + entry.amount, 0);
    return { id: account.id, label: account.label, income, expense, net: income - expense };
  }).filter((account) => account.income > 0 || account.expense > 0);
}

export function categoryTotals(data: DataState, monthKey: string): CategoryTotal[] {
  const totals = new Map<string, number>();
  for (const entry of entriesFor(data.expense, monthKey)) {
    totals.set(entry.category, (totals.get(entry.category) ?? 0) + entry.amount);
  }
  const sum = Array.from(totals.values()).reduce((a, b) => a + b, 0);
  return Array.from(totals.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      share: sum > 0 ? Math.round((amount / sum) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

const money = (value: number) => ({ value: Math.round(value * 100) / 100, style: "money" as const });
const head = (value: string) => ({ value, style: "header" as const });
const title = (value: string) => ({ value, style: "title" as const });

export function buildReport(input: ReportInput): ReportModel {
  const generatedAt = input.generatedAt ?? new Date();
  const monthLabel = formatMonthName(input.monthKey);
  const totals = getTotals(input.data, input.monthKey);
  const categories = categoryTotals(input.data, input.monthKey);
  const accounts = accountTotals(input.data, input.monthKey);
  const income = entriesFor(input.data.income, input.monthKey);
  const expense = entriesFor(input.data.expense, input.monthKey);
  const owner = input.owner?.trim() || "صوتی بقیہ";

  const summary: ReportRow[] = [
    [title(`${owner} — ماہانہ رپورٹ`)],
    [head("مہینہ"), monthLabel],
    [head("تیاری"), generatedAt.toISOString().slice(0, 16).replace("T", " ")],
    [],
    [head("تفصیل"), head("رقم (روپے)")],
    ["پچھلے مہینوں کا بقایا", money(totals.carryForward)],
    ["اس ماہ کی آمدنی", money(totals.directIncome)],
    ["کل آمدنی (بقایا سمیت)", money(totals.totalIncome)],
    ["کل خرچہ", money(totals.totalExpense)],
    ["موجودہ بقایا", money(totals.balance)],
    [],
    [head("قسم"), head("رقم (روپے)"), head("حصہ %")],
    ...(categories.length > 0
      ? categories.map((row) => [row.category, money(row.amount), `${row.share}%`])
      : [["کوئی خرچہ درج نہیں", money(0), "0%"]]),
    [],
    [head("کھاتہ"), head("آمدنی"), head("خرچہ"), head("بیلنس")],
    ...(accounts.length > 0
      ? accounts.map((row) => [row.label, money(row.income), money(row.expense), money(row.net)])
      : [["کیش", money(0), money(0), money(0)]]),
  ];

  const entrySheet = (
    rows: Entry[],
    name: "آمدنی" | "خرچہ",
    total: number,
    /** Rows that belong in the total but are not individual entries. */
    extra: ReportRow[] = [],
  ): ReportSheet => ({
    name,
    rows: [
      [
        head("تاریخ"),
        head("وقت"),
        head("تفصیل"),
        head("قسم"),
        head("کھاتہ"),
        head("رقم (روپے)"),
        head("تاریخ (ISO)"),
      ],
      ...rows.map((entry) => [
        entry.date,
        entry.time,
        entry.detail,
        entry.category,
        ACCOUNT_CATALOG.find((a) => a.id === normalizeAccount(entry.account))?.label ?? "کیش",
        money(entry.amount),
        new Date(entry.timestamp).toISOString().slice(0, 10),
      ]),
      ...extra,
      [head(name === "آمدنی" ? "کل آمدنی" : "کل خرچہ"), "", "", "", "", money(total), ""],
    ],
  });

  return {
    monthKey: input.monthKey,
    monthLabel,
    generatedAt,
    owner,
    totals,
    categories,
    accounts,
    income,
    expense,
    sheets: [
      { name: "خلاصہ", rows: summary },
      entrySheet(
        income,
        "آمدنی",
        totals.totalIncome,
        // Without this line the income column would not add up to its total:
        // the carry-forward is income for this month but not an entry of it.
        totals.carryForward > 0
          ? [["—", "", "پچھلے مہینوں کا بقایا (کھاتہ)", "", "", money(totals.carryForward), ""]]
          : [],
      ),
      entrySheet(expense, "خرچہ", totals.totalExpense),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* XLSX writer (stored ZIP + SpreadsheetML)                            */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  // ZIP stores local time in 2-second steps, 1980-based.
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type ZipEntry = { name: string; data: Uint8Array };

/** Minimal ZIP (method 0, UTF-8 names). Enough for Office Open XML. */
export function zipStore(files: ZipEntry[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);

    const local = new Uint8Array(30 + name.length + file.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const STYLE_ID: Record<CellStyle, number> = { header: 1, title: 2, money: 3 };

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function columnName(index: number): string {
  let name = "";
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

export function sheetXml(sheet: ReportSheet): string {
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => {
          const ref = `${columnName(colIndex)}${rowIndex + 1}`;
          if (cell === "" || cell === null || cell === undefined) return "";
          const style = typeof cell === "object" ? cell.style : undefined;
          const raw = typeof cell === "object" ? cell.value : cell;
          const styleAttr = style ? ` s="${STYLE_ID[style]}"` : "";
          if (typeof raw === "number" && Number.isFinite(raw)) {
            return `<c r="${ref}"${styleAttr}><v>${raw}</v></c>`;
          }
          const text = escapeXml(String(raw));
          if (!text) return "";
          return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="0" topLeftCell="A1" activePane="topLeft"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="18"/>',
    '<cols><col min="1" max="1" width="26" customWidth="1"/><col min="2" max="7" width="20" customWidth="1"/></cols>',
    `<sheetData>${rows}</sheetData>`,
    "</worksheet>",
  ].join("");
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CONTENT_TYPES = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${Array.from({ length: sheetCount }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const workbookXml = (sheets: ReportSheet[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n")}
</sheets>
</workbook>`;

const workbookRels = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${Array.from({ length: sheetCount }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** The complete .xlsx archive, ready for a Blob. */
export function buildXlsx(sheets: ReportSheet[], now = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES(sheets.length)) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: encoder.encode(workbookXml(sheets)) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels(sheets.length)) },
    { name: "xl/styles.xml", data: encoder.encode(STYLES_XML) },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: encoder.encode(sheetXml(sheet)),
    })),
  ];
  return zipStore(files, now);
}

export function xlsxBlob(sheets: ReportSheet[], now = new Date()): Blob {
  const bytes = buildXlsx(sheets, now);
  // Copy into a fresh ArrayBuffer so the Blob never aliases a larger buffer.
  return new Blob([bytes.slice().buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ------------------------------------------------------------------ */
/* PDF-ready HTML                                                      */
/* ------------------------------------------------------------------ */

const REPORT_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #0f172a; background: #fff; direction: rtl; text-align: right;
    font-family: "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Noto Naskh Arabic", Tahoma, sans-serif;
    font-size: 12px; line-height: 2;
  }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 18px 0 6px; color: #0f172a; }
  .sub { color: #64748b; font-size: 11px; margin: 0 0 14px; }
  .cards { display: flex; gap: 8px; margin-bottom: 8px; }
  .card { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; }
  .card .label { font-size: 10px; color: #64748b; }
  .card .value { font-size: 16px; font-weight: 700; }
  .in { color: #047857; } .out { color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #0f172a; color: #fff; padding: 5px 7px; text-align: right; font-weight: 700; }
  td { border-bottom: 1px solid #e2e8f0; padding: 4px 7px; vertical-align: top; }
  tr:nth-child(even) td { background: #f8fafc; }
  .amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar { display: inline-block; height: 6px; border-radius: 3px; background: #0ea5e9; vertical-align: middle; }
  .empty { color: #94a3b8; text-align: center; padding: 12px; }
  .foot { margin-top: 16px; border-top: 1px dashed #cbd5e1; padding-top: 6px; color: #64748b; font-size: 10px; }
  .total td { font-weight: 700; background: #f1f5f9 !important; }
`;

function rowsHtml(rows: Entry[], format: (value: number) => string): string {
  if (rows.length === 0) {
    return `<tr><td colspan="4" class="empty">اس مہینے کوئی اندراج نہیں۔</td></tr>`;
  }
  return rows
    .map(
      (entry) => `<tr>
      <td>${escapeHtml(entry.date)}<br /><span class="sub">${escapeHtml(entry.time)}</span></td>
      <td>${escapeHtml(entry.detail || entry.category)}</td>
      <td>${escapeHtml(entry.category)}</td>
      <td class="amount">${format(entry.amount)}</td>
    </tr>`,
    )
    .join("");
}

export function reportHtml(model: ReportModel, format: (value: number) => string): string {
  const categoryBars = model.categories
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.category)}</td>
      <td class="amount">${format(row.amount)}</td>
      <td class="amount">${row.share}%</td>
      <td><span class="bar" style="width:${Math.max(2, row.share) * 1.8}px"></span></td>
    </tr>`,
    )
    .join("");

  const accountRows = model.accounts
    .map(
      (row) => `<tr>
      <td>${escapeHtml(row.label)}</td>
      <td class="amount in">${format(row.income)}</td>
      <td class="amount out">${format(row.expense)}</td>
      <td class="amount">${format(row.net)}</td>
    </tr>`,
    )
    .join("");

  return `<!doctype html><html dir="rtl" lang="ur"><head><meta charset="utf-8" />
<title>${escapeHtml(`${model.owner} — ${model.monthLabel}`)}</title>
<style>${REPORT_CSS}</style></head>
<body>
  <h1>${escapeHtml(model.owner)} — ماہانہ رپورٹ</h1>
  <p class="sub">${escapeHtml(model.monthLabel)} · تیاری: ${escapeHtml(
    model.generatedAt.toLocaleString("ur-PK"),
  )}</p>

  <div class="cards">
    <div class="card"><div class="label">کل آمدنی</div><div class="value in">${format(
      model.totals.totalIncome,
    )}</div></div>
    <div class="card"><div class="label">کل خرچہ</div><div class="value out">${format(
      model.totals.totalExpense,
    )}</div></div>
    <div class="card"><div class="label">بقایا</div><div class="value">${format(
      model.totals.balance,
    )}</div></div>
  </div>
  <p class="sub">پچھلے مہینوں کا بقایا: ${format(model.totals.carryForward)} · اس ماہ کی آمدنی: ${format(
    model.totals.directIncome,
  )}</p>

  <h2>اخراجات کی تقسیم</h2>
  <table>
    <thead><tr><th>قسم</th><th>رقم</th><th>حصہ</th><th></th></tr></thead>
    <tbody>${categoryBars || `<tr><td colspan="4" class="empty">کوئی خرچہ درج نہیں۔</td></tr>`}</tbody>
  </table>

  <h2>کھاتے کے مطابق بیلنس</h2>
  <table>
    <thead><tr><th>کھاتہ</th><th>آمدنی</th><th>خرچہ</th><th>بیلنس</th></tr></thead>
    <tbody>${accountRows || `<tr><td colspan="4" class="empty">کوئی اندراج نہیں۔</td></tr>`}</tbody>
  </table>

  <h2>آمدنی (${model.income.length})</h2>
  <table>
    <thead><tr><th>تاریخ</th><th>تفصیل</th><th>قسم</th><th>رقم</th></tr></thead>
    <tbody>${rowsHtml(model.income, format)}
      ${
        model.totals.carryForward > 0
          ? `<tr><td>—</td><td>پچھلے مہینوں کا بقایا (کھاتہ)</td><td>—</td><td class="amount">${format(
              model.totals.carryForward,
            )}</td></tr>`
          : ""
      }
      <tr class="total"><td colspan="3">کل آمدنی</td><td class="amount">${format(
        model.totals.totalIncome,
      )}</td></tr>
    </tbody>
  </table>

  <h2>خرچہ (${model.expense.length})</h2>
  <table>
    <thead><tr><th>تاریخ</th><th>تفصیل</th><th>قسم</th><th>رقم</th></tr></thead>
    <tbody>${rowsHtml(model.expense, format)}
      <tr class="total"><td colspan="3">کل خرچہ</td><td class="amount">${format(
        model.totals.totalExpense,
      )}</td></tr>
    </tbody>
  </table>

  <p class="foot">صوتی بقیہ — اردو وائس فنانس اسسٹنٹ · یہ رپورٹ آپ کے فون پر موجود ڈیٹا سے بنی ہے۔</p>
</body></html>`;
}

export function reportFileBase(monthKey: string): string {
  return `sauti-baqaya-${monthKey}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Safari needs the URL alive for a tick after the click.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
