type CategoryBarsProps = { items: { label: string; value: number }[]; format: (v: number) => string; highlightTop?: number };

export function CategoryBars({ items, format, highlightTop = 3 }: CategoryBarsProps) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <ol className="mt-0.5 flex flex-col gap-[3px]" aria-label="Top 10 categories">
      {items.map((it, i) => (
        <li key={it.label} className="grid grid-cols-[64px_1fr_34px] items-center gap-1.5 text-[10.5px] leading-[11px]">
          <span className="truncate text-ink-2">{it.label}</span>
          <span className="h-[7px] rounded-[2px] bg-surface-2">
            <span className={`block h-full rounded-[2px] ${i < highlightTop ? "bg-s1" : "bg-s2"}`} style={{ width: `${(it.value / max) * 100}%` }} />
          </span>
          <span className="text-right text-ink-2">{format(it.value)}</span>
        </li>
      ))}
    </ol>
  );
}
