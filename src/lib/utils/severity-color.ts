/**
 * One severity scale for the tools that label findings and chart them by level.
 *
 * Four tokens that stay readable as text on their own tints and stay distinct from
 * each other in all three modes (test/design/theme-contrast.test.ts). Mapping the
 * old hexes through `themed()` would not do: #f59e0b and #facc15 both become
 * --warning, and two series on one chart would merge. The fallbacks serve PNG
 * exports, as in chart-theme.ts.
 */
export const SEVERITY_SCALE = {
  critical: "var(--danger, #9c1c2e)",
  high: "var(--neon-amber, #784a10)",
  medium: "var(--accent3, #6a3560)",
  low: "var(--success, #1c5f3d)",
} as const;
