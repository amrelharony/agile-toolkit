"use client";

import dynamic from "next/dynamic";
import type * as Recharts from "recharts";

/**
 * Lazy boundary for Recharts.
 *
 * Why: importing `recharts` directly from a tool page statically pulls
 * the entire Recharts tree (~65 KB gzipped, ~220 KB raw) into that
 * route's bundle. Tools that don't render a chart on first paint pay
 * this cost up front. Wrapping the chart usage in this `<Chart>`
 * component defers the import until the chart actually mounts:
 *
 *   import { Chart } from "@/components/charts/lazy-chart";
 *
 *   <Chart height={280}>
 *     {({ BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer }) => (
 *       <ResponsiveContainer>
 *         <BarChart data={data}>
 *           <XAxis dataKey="name" />
 *           <YAxis />
 *           <Tooltip />
 *           <Bar dataKey="value" fill="#8884d8" />
 *         </BarChart>
 *       </ResponsiveContainer>
 *     )}
 *   </Chart>
 *
 * The render prop receives the full Recharts namespace at runtime. The
 * tool file never `import`s recharts at module-load time, so the route
 * bundle stays light. Type-wise, `RechartsNamespace` is imported as a
 * type-only — erased at compile time, zero bundle impact.
 *
 * SSR is disabled because Recharts produces hydration-time DOM
 * differences from server-rendered placeholders for ResponsiveContainer
 * (it queries layout dimensions at mount).
 */
export type RechartsNamespace = typeof Recharts;

interface ChartProps {
  /** Container height in pixels (or CSS string). Wraps with a fixed
   *  box so the skeleton/loading state reserves the right space and
   *  Recharts' ResponsiveContainer measures into a stable parent. */
  height?: number | string;
  className?: string;
  children: (recharts: RechartsNamespace) => React.ReactNode;
}

function ChartSkeleton(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 8,
        background:
          "linear-gradient(90deg, color-mix(in srgb, currentColor 4%, transparent), color-mix(in srgb, currentColor 8%, transparent), color-mix(in srgb, currentColor 4%, transparent))",
        backgroundSize: "200% 100%",
        animation: "lazyChartPulse 1.6s linear infinite",
      }}
    />
  );
}

// The implementation lives in chart-impl so the dynamic import resolves
// to a module that itself static-imports recharts. That module loads
// only when <Chart> mounts on the client. `loading` is shown ONLY while
// the chunk is fetching; once it resolves, only the real chart renders
// — no layered fallback hiding the chart after load.
const ChartImpl = dynamic(() => import("./chart-impl").then((m) => ({ default: m.ChartImpl })), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

export function Chart({ height = 280, className, children }: ChartProps): React.ReactElement {
  const heightStyle = typeof height === "number" ? `${height}px` : height;
  return (
    <div className={className} style={{ width: "100%", height: heightStyle, position: "relative" }}>
      <style>{`@keyframes lazyChartPulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <ChartImpl>{children}</ChartImpl>
    </div>
  );
}
