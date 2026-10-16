/**
 * Theme-aware versions of the toolkit's hard-coded brand colours.
 *
 * Many tools keep colours as hex strings in data (retro column colours are
 * even saved inside each board), and the neon values are unreadable on the
 * light theme (#00ff88 is 1.3:1 on white). `themed()` maps the known brand
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
