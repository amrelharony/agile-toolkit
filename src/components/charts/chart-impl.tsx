"use client";

import * as Recharts from "recharts";

/**
 * The lazy boundary's actual loaded module. Imports Recharts at
 * module-load time (NOT static-deferred), so this file goes into a
 * separate chunk created by `next/dynamic` in lazy-chart.tsx. Tools
 * that use <Chart> trigger this chunk; tools that don't never load it.
 *
 * The render prop receives the full Recharts namespace so callers can
 * destructure exactly what they need. Avoids re-exporting every
 * primitive individually (Recharts ships ~40 of them) and keeps the
 * tree-shake decision in the tool's hands.
 */
export function ChartImpl({
  children,
}: {
  children: (recharts: typeof Recharts) => React.ReactNode;
}): React.ReactElement {
  return <>{children(Recharts)}</>;
}
