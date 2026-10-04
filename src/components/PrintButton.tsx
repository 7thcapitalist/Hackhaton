"use client";
import { Button } from "./Button";
import { PrintIcon } from "./icons";

/** Primary on the Monthly report (its main action); secondary where another action leads (Close). */
export function PrintButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  return (
    <Button data-print-hide variant={variant} icon={<PrintIcon />} onClick={() => window.print()}>
      Print / PDF
    </Button>
  );
}
