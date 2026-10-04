"use client";
import { Button, buttonClass } from "./Button";
import { DownloadIcon, PrintIcon } from "./icons";

/**
 * Monthly report (period given): download the branded CEO workbook and PDF, the same files the
 * monthly email attaches (#76). Other pages (Month-end Close): print the page.
 */
export function PrintButton({ period }: { period?: string }) {
  if (!period) {
    return (
      <Button data-print-hide variant="primary" className="px-[15px]" icon={<PrintIcon />} onClick={() => window.print()}>
        Print / PDF
      </Button>
    );
  }
  return (
    <div data-print-hide className="flex flex-wrap gap-2">
      <a href={`/api/export/scorecard?period=${encodeURIComponent(period)}&format=xlsx`} className={buttonClass("secondary")}><DownloadIcon />Export XLSX</a>
      <a href={`/api/export/monthly?period=${encodeURIComponent(period)}&format=pdf`} className={buttonClass("primary")}><DownloadIcon />Export PDF</a>
    </div>
  );
}
