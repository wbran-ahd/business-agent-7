/**
 * Monthly report generation: printable PDF, Excel workbook and the local
 * diagnostics dump. Numbers, filenames and messages are byte-identical to the
 * previous inline handlers — only their home changed.
 */
import {
  buildReport,
  downloadBlob,
  reportFileBase,
  reportHtml,
  xlsxBlob,
  type ReportModel,
} from "@/lib/export-report";
import { notifySuccess, notifyWarning } from "@/lib/notifications";
import { printHtmlDocument } from "@/lib/print";
import { formatNumber, type DataState, type DigitStyle } from "@/lib/khata";
import { BRAND } from "@/lib/brand";
import {
  buildFieldReport,
  clearEvents,
  installId,
  loadEvents,
  track,
} from "@/lib/telemetry";

export type UseMonthlyReportsOptions = {
  data: DataState;
  activeMonth: string;
  /** Shown at the top of the report; empty for a guest device. */
  owner: string;
  digitStyle: DigitStyle;
  onBackedUp: () => void;
};

export function useMonthlyReports({
  data,
  activeMonth,
  owner,
  digitStyle,
  onBackedUp,
}: UseMonthlyReportsOptions) {
  function monthlyReport(): ReportModel {
    return buildReport({
      data,
      monthKey: activeMonth,
      owner,
      generatedAt: new Date(),
    });
  }

  function exportReportPdf() {
    const model = monthlyReport();
    const rows = model.income.length + model.expense.length;
    const ok = printHtmlDocument(
      reportHtml(model, (value) => formatNumber(value, digitStyle)),
    );
    track("export_pdf", { ok, rows });
    if (!ok) notifyWarning("پرنٹ ونڈو نہیں کھل سکی", "براہِ کرم دوبارہ کوشش کریں۔");
  }

  function exportReportExcel() {
    const model = monthlyReport();
    const rows = model.income.length + model.expense.length;
    downloadBlob(
      xlsxBlob(model.sheets, model.generatedAt),
      `${reportFileBase(model.monthKey)}.xlsx`,
    );
    onBackedUp();
    track("export_xlsx", { rows, sheets: model.sheets.length });
    notifySuccess("Excel فائل ڈاؤن لوڈ ہو گئی", `${model.monthLabel} — خلاصہ، آمدنی، خرچہ`);
  }

  function exportDiagnostics() {
    const report = buildFieldReport({
      events: loadEvents(),
      version: BRAND.version,
      installId: installId(),
    });
    downloadBlob(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
      `sauti-baqaya-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
    );
    track("diagnostics_export", { events: report.events.length });
    notifySuccess("تشخیصی رپورٹ محفوظ ہو گئی", "اس میں رقم یا نام شامل نہیں ہیں۔");
  }

  function clearDiagnostics() {
    clearEvents();
    notifySuccess("لاگ صاف ہو گیا", "مقامی تشخیصی ریکارڈ خالی کر دیا گیا ہے۔");
  }

  return {
    exportReportPdf,
    exportReportExcel,
    exportDiagnostics,
    clearDiagnostics,
  };
}
