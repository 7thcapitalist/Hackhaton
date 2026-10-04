import { buttonClass } from "./Button";
import { DownloadIcon } from "./icons";

export function PrintButton({ period }: { period: string }) {
  return (
    <div data-print-hide className="flex flex-wrap gap-2">
      <a href={`/api/export/scorecard?period=${encodeURIComponent(period)}&format=xlsx`} className={buttonClass("secondary")}><DownloadIcon />Export XLSX</a>
      <a href={`/api/export/monthly?period=${encodeURIComponent(period)}&format=pdf`} className={buttonClass("primary")}><DownloadIcon />Export PDF</a>
    </div>
  );
}
