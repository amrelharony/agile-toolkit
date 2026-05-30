"use client";

/**
 * Custom Recharts tooltip for the cumulative-flow area chart — lists each
 * column's count (reversed to match the visual stacking order) plus a total.
 */

export function CFDTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-xl text-sm">
      <p className="text-sub font-medium mb-2">{label}</p>
      {[...payload].reverse().map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6 mb-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-sub">{p.name}</span>
          </div>
          <span className="font-data font-semibold text-text">{p.value}</span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-border flex justify-between">
        <span className="text-sub">Total</span>
        <span className="font-data font-bold text-accent">{total}</span>
      </div>
    </div>
  );
}
