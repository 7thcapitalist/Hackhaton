"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

/** POST /api/close/[period] with a JSON action (or multipart for the workbook). */
export async function postClose(period: string, body: Record<string, unknown> | FormData): Promise<unknown> {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api/close/${period}`, {
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  return readJson(res);
}

export async function patchException(id: string, status: "resolved" | "waived" | "open", note?: string) {
  const res = await fetch(`/api/exceptions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note: note?.trim() || undefined }),
  });
  return readJson(res);
}

/** Downloads the BC journal file, which also marks the close exported. */
export async function downloadExport(period: string, format: "xlsx" | "csv") {
  const res = await fetch(`/api/close/${period}/export?format=${format}`);
  if (!res.ok) await readJson(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `close-${period}.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readJson(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data;
}

/** Runs one action at a time, refreshes the server data after it, keeps the last error. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, [router]);
  return { busy, error, run, setError };
}

const NAME_KEY = "mc-close-name";
export const rememberedName = () => {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};
export const rememberName = (n: string) => {
  try { localStorage.setItem(NAME_KEY, n); } catch { /* private window */ }
};
