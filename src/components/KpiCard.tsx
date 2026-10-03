import type { Kpi } from "@/app/_lib/types";
import { formatChange, formatKpiShort, formatKpiValue, TRACK, trackStatus } from "@/app/_lib/format";
import { StatusBadge } from "./StatusBadge";
import { Sparkline } from "./Sparkline";
import { CategoryBars } from "./CategoryBars";
import { ClockIcon, TeamIcon } from "./icons";

type KpiCardProps = { kpi: Kpi; variant?: "compact" | "anchor"; periodShort?: string };

export function KpiCard({ kpi, variant = "compact", periodShort = "this month" }: KpiCardProps) {
  return variant === "anchor" ? <AnchorCard kpi={kpi} /> : <CompactCard kpi={kpi} periodShort={periodShort} />;
}

function TrackPill({ kpi }: { kpi: Kpi }) {
  const t = TRACK[trackStatus(kpi)];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${t.fg} ${t.bg}`}>{t.label}</span>;
}

function CompactCard({ kpi, periodShort }: { kpi: Kpi; periodShort: string }) {
  const track = TRACK[trackStatus(kpi)];
  const change = formatChange(kpi);
  const v = kpi.value != null ? formatKpiValue(kpi.unit, kpi.value) : null;
  const suffix = kpi.displaySuffix ?? v?.suffix;
  const simulated = kpi.status === "simulated";
  const targetText = kpi.target != null ? `Target ${formatKpiShort(kpi.unit, kpi.target)}` : `Ranked, ${periodShort}`;
  return (
    <article className="flex min-w-0 flex-col gap-1.5 rounded-[10px] border border-line bg-surface px-3.5 py-3 shadow-xs">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-[12.5px] leading-[1.3] font-medium text-pretty text-ink-2">{kpi.label}</h3>
        <StatusBadge size="sm" status={kpi.status} label={kpi.status === "awaiting_data" ? "Awaiting" : undefined} />
      </header>

      {v ? (
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-1.5">
            <p className="flex min-w-0 items-baseline gap-[5px]">
              <span className="text-2xl leading-[1.1] font-semibold tracking-[-0.025em]">{v.value}</span>
              {suffix && <span className="min-w-0 truncate text-[11.5px] text-ink-3" title={suffix}>{suffix}</span>}
            </p>
            {change && <span className="text-xs font-medium whitespace-nowrap text-ink-2">{change}</span>}
          </div>
          {kpi.breakdown ? (
            <CategoryBars items={kpi.breakdown} format={n => (kpi.unit === "percent" ? `${n}%` : `$${(n / 100000).toFixed(1)}k`)} />
          ) : (
            <div className="mt-auto"><Sparkline values={kpi.history ?? []} dashed={simulated} tone={simulated ? "warn" : "accent"} /></div>
          )}
          <footer className="flex items-center justify-between gap-1.5 border-t border-line-2 pt-1.5 text-[11.5px]">
            <span className="whitespace-nowrap text-ink-3">{targetText}</span>
            <span className={`font-semibold whitespace-nowrap ${track.fg}`}>{track.label}</span>
          </footer>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-1.5 pt-2.5 pb-0.5">
          <p className="flex items-center gap-2 text-ink-3"><ClockIcon className="size-4.5" /><span className="text-[15px] font-medium text-ink-2">Awaiting data</span></p>
          {kpi.note && <p className="text-xs text-pretty text-ink-3">{kpi.note}</p>}
          <div className="mt-2 mb-1 border-t-[1.5px] border-dashed border-line" />
          <p className="flex justify-between text-[11.5px] text-ink-3">
            <span>{targetText}</span><span>Prior {formatKpiShort(kpi.unit, kpi.previous)}</span>
          </p>
        </div>
      )}

      {kpi.teamLevel && <p className="flex items-center gap-[5px] text-[11px] text-ink-3"><TeamIcon />Team-level, for capacity planning</p>}
    </article>
  );
}

function AnchorCard({ kpi }: { kpi: Kpi }) {
  const change = formatChange(kpi);
  const v = kpi.value != null ? formatKpiValue(kpi.unit, kpi.value) : null;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface px-5 py-4.5 shadow-xs">
      <header className="flex flex-col gap-1">
        <span className="text-[10.5px] font-semibold tracking-[0.04em] text-accent uppercase">2027 anchor</span>
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[13.5px] font-semibold">{kpi.label}</h3>
          <TrackPill kpi={kpi} />
        </div>
      </header>
      {v ? (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-4xl leading-none font-semibold tracking-[-0.035em]">{v.value}</span>
          {v.suffix && <span className="text-[13px] whitespace-nowrap text-ink-3">{v.suffix}</span>}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-ink-2"><ClockIcon className="size-5" />Awaiting data</p>
      )}
      <Sparkline values={kpi.history ?? []} target={kpi.target} height={48} />
      <dl className="grid grid-cols-3 gap-2 border-t border-line-2 pt-2.5 text-xs">
        <div><dt className="text-ink-3">Target</dt><dd className="text-[13.5px] font-semibold">{formatKpiShort(kpi.unit, kpi.target)}</dd></div>
        <div><dt className="text-ink-3">Prior month</dt><dd className="text-[13.5px] font-semibold">{formatKpiShort(kpi.unit, kpi.previous)}</dd></div>
        <div><dt className="text-ink-3">Change</dt><dd className="text-[13.5px] font-semibold">{change ?? "—"}</dd></div>
      </dl>
    </article>
  );
}
