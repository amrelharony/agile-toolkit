"use client";

/**
 * Custom Recharts tooltips for the cycle-time histogram + scatter charts.
 */

export function HistogramTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { bucket: string; count: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-xl text-sm">
      <p className="text-sub mb-1">{d.bucket}</p>
      <p className="font-data font-bold text-accent">{d.count} items</p>
    </div>
  );
}

export function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { idx: number; cycleTime: number; name: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-xl text-sm">
      <p className="text-sub mb-1">
        #{d.idx} — {d.name || "(unnamed)"}
      </p>
      <p className="font-data font-bold text-accent">{d.cycleTime} days</p>
    </div>
  );
}
