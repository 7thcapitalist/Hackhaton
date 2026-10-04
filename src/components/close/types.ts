// UI-side shape of the close page. Base fields come from getCloseView (src/close/view.ts);
// everything marked optional is being added to the view additively, so the page renders
// it when present and shows "coming soon" (or derives it) when absent.
import type { CloseSourceFile, CloseSourceItem, CloseView } from "@/close";

export type CloseStage = "collecting" | "generated" | "reconciled" | "approved" | "exported" | "imported" | "posted";
export const STAGES: CloseStage[] = ["collecting", "generated", "reconciled", "approved", "exported", "imported", "posted"];

export type StepStatus = "done" | "warning" | "todo";
export type CloseStep = { key: string; label: string; status: StepStatus; detail: string };

export type WorkbookDiff = { sourceId: string; accountNo: string; ourCents: number; workbookCents: number; diffCents: number };
export type Workbook = { loaded: boolean; rows: number; differences: WorkbookDiff[]; fileName?: string; loadedAt?: string };

export type Posting = {
  status: string; // "not_posted" | "imported" | "posted" | …
  batch: string | null;
  documentNos: string[];
  postedAt: string | null;
  postedBy: string | null;
  importedAt?: string | null;
  importedBy?: string | null;
  simulated: boolean;
};

export type AuditEvent = { action: string; by: string | null; at: string; detail?: string | null };

export type CloseCan = CloseView["can"] & Partial<{ markImported: boolean; markPosted: boolean }>;

export type UiSourceFile = CloseSourceFile & { archiveUrl?: string | null; archivePath?: string | null };
export type UiSource = Omit<CloseSourceItem, "files" | "status"> & {
  status: CloseSourceItem["status"] | "not_due";
  files: UiSourceFile[];
  owner?: string | null;
  cadence?: "daily" | "monthly";
  archiveUrl?: string | null;
};

export type UiCloseView = Omit<CloseView, "status" | "can" | "sources"> & {
  status: CloseStage | string;
  sources: UiSource[];
  can: CloseCan;
  steps?: CloseStep[];
  workbook?: Workbook | null;
  posting?: Posting | null;
  evidenceUrl?: string | null;
  audit?: AuditEvent[];
  generatedAt?: string | null;
  reconciledAt?: string | null;
  exportedAt?: string | null;
};

/** The furthest stage reached, folding posting status in (imported / posted live there). */
export function stageOf(v: Pick<UiCloseView, "status" | "posting">): CloseStage {
  const p = v.posting?.status;
  if (p === "posted") return "posted";
  if (p === "imported") return "imported";
  return (STAGES as string[]).includes(v.status) ? (v.status as CloseStage) : "collecting";
}

export const STAGE_LABEL: Record<CloseStage, string> = {
  collecting: "Collecting",
  generated: "Generated",
  reconciled: "Reconciled",
  approved: "Approved",
  exported: "Exported",
  imported: "Imported to BC",
  posted: "Posted",
};
