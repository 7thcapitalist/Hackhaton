type P = { className?: string };
const base = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 16 16", "aria-hidden": true };

export const WarnIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.5} className={className}><path d="M8 2.2 14.6 13.6H1.4z" /><path d="M8 6.6v3M8 11.7v.05" /></svg>
);
export const CheckIcon = ({ className = "size-3" }: P) => (
  <svg {...base} strokeWidth={2} className={className}><path d="M3.5 8.5l3 3 6-7" /></svg>
);
export const ClockIcon = ({ className = "size-4" }: P) => (
  <svg {...base} strokeWidth={1.3} className={className}><circle cx="8" cy="8" r="6.2" /><path d="M8 4.6V8l2.2 1.6" /></svg>
);
export const DashedRingIcon = ({ className = "size-3" }: P) => (
  <svg {...base} strokeWidth={1.8} className={className}><circle cx="8" cy="8" r="5.6" strokeDasharray="2.2 2" /></svg>
);
export const FileIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.5} className={className}><path d="M4 1.5h5.5L13 5v9.5H4z" /><path d="M9 1.5V5.5h4M6.5 9h4M6.5 11.5h4" /></svg>
);
export const DownloadIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.5} className={className}><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" /></svg>
);
export const UploadIcon = ({ className = "size-5" }: P) => (
  <svg {...base} strokeWidth={1.3} className={className}><path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v3h11v-3" /></svg>
);
export const ChevronIcon = ({ dir, className = "size-3.5" }: P & { dir: "left" | "right" }) => (
  <svg {...base} strokeWidth={1.6} className={className}><path d={dir === "left" ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} /></svg>
);
export const TeamIcon = ({ className = "size-3" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><circle cx="5.5" cy="5.5" r="2.2" /><circle cx="11" cy="6" r="1.8" /><path d="M1.5 13c.4-2.4 2-3.6 4-3.6s3.6 1.2 4 3.6M10 9.6c1.9 0 3.3 1 3.7 3.1" /></svg>
);
export const CalendarIcon = ({ className = "size-[15px]" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
);
export const MailIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.5} className={className}><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" /><path d="m2 4.5 6 4.5 6-4.5" /></svg>
);
export const PrintIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.5} className={className}><path d="M4 6V1.5h8V6M4 11.5H2V6h12v5.5h-2" /><rect x="4" y="9" width="8" height="5.5" /></svg>
);
export const CloseIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.6} className={className}><path d="m4 4 8 8M12 4l-8 8" /></svg>
);
export const GridIcon = ({ className = "size-4" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></svg>
);
export const PulseIcon = ({ className = "size-4" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><path d="M1.5 8.5h3l2-5 3 9 2-4h3" /></svg>
);
export const BarsIcon = ({ className = "size-4" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><path d="M3 13.5V9M8 13.5V3M13 13.5V6.5" /></svg>
);
export const DatabaseIcon = ({ className = "size-4" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" /></svg>
);
export const SunMoonIcon = ({ className = "size-3.5" }: P) => (
  <svg {...base} strokeWidth={1.4} className={className}><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" /></svg>
);
