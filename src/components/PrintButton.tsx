"use client";
import { Button } from "./Button";
import { PrintIcon } from "./icons";

export function PrintButton() {
  return (
    <Button data-print-hide variant="primary" className="px-[15px]" icon={<PrintIcon />} onClick={() => window.print()}>
      Print / PDF
    </Button>
  );
}
