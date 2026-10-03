import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Mission Control – Goodwill Michiana",
  description: "Nightly pulse, COO scorecard and month-end close for Goodwill Michiana e-commerce.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
