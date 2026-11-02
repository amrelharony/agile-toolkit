/**
 * Theme-aware versions of the toolkit's hard-coded brand colours.
 *
 * Many tools keep colours as hex strings in data (retro column colours are
 * even saved inside each board), and the neon values are unreadable on the
 * comic's paper (#00ff88 is 1.3:1 on white). `themed()` maps the known brand
 * hexes onto the per-theme CSS variables at render time; unknown colours
 * pass through unchanged. `tint()` replaces the `${hex}55` alpha-suffix
 * trick, which only works on hex strings.
 */

const BRAND_TO_TOKEN: Record<string, string> = {
  "#00ff88": "var(--neon-green)",
  "#00f0ff": "var(--accent)",
  "#00e1ff": "var(--accent)",
  "#ffaa00": "var(--neon-amber)",
  "#ff00aa": "var(--neon-magenta)",
  "#22c55e": "var(--success)",
  "#10b981": "var(--success)",
  "#f59e0b": "var(--warning)",
  "#eab308": "var(--warning)",
  "#fbbf24": "var(--warning)",
  "#ef4444": "var(--danger)",
  "#3b82f6": "var(--info)",
  "#6366f1": "var(--accent2)",
  "#a855f7": "var(--accent3)",
  "#9d4edd": "var(--accent3)",
  "#a78bfa": "var(--accent3)",
  "#ff6b6b": "var(--danger)",
  "#f87171": "var(--danger)",
  "#34d399": "var(--success)",
  "#facc15": "var(--warning)",
  "#fb923c": "var(--neon-amber)",
  "#f97316": "var(--neon-amber)",
  "#f472b6": "var(--neon-magenta)",
  "#60a5fa": "var(--info)",
  "#888": "var(--sub)",
  // The weather palette (lib/weather/wmo.ts).
  "#fcd34d": "var(--warning)",
  "#94a3b8": "var(--sub)",
  "#64748b": "var(--sub)",
  "#cbd5e1": "var(--sub)",
  "#e2e8f0": "var(--sub)",
  "#f1f5f9": "var(--sub)",
  "#2563eb": "var(--info)",
  "#1d4ed8": "var(--info)",
  "#1e3a8a": "var(--info)",
  "#7c3aed": "var(--accent3)",
  "#6d28d9": "var(--accent3)",
  "#5b21b6": "var(--accent3)",
};

/** CSS colour for `color`, following the active theme when it's a brand colour. */
export function themed(color: string): string {
  return BRAND_TO_TOKEN[color.trim().toLowerCase()] ?? color;
}

/** `color` at `percent`% opacity (0–100), theme-aware. */
export function tint(color: string, percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  return `color-mix(in srgb, ${themed(color)} ${p}%, transparent)`;
}
