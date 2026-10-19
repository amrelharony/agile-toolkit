export const chartTheme = {
  // Theme variables (globals.css) with the dark values as fallbacks, so
  // series stay readable on the light theme and PNG exports — which render
  // the SVG outside the page's CSS — still get a colour.
  colors: {
    cyan: "var(--chart-1, #00e1ff)",
    magenta: "var(--chart-2, #ff00aa)",
    green: "var(--chart-3, #00ff88)",
    amber: "var(--chart-4, #ffaa00)",
    purple: "var(--chart-5, #8b5cf6)",
    red: "var(--danger, #ef4444)",
    blue: "var(--info, #3b82f6)",
  },
  background: "var(--bg, #06080f)",
  cardBackground: "var(--surface, #1a1f36)",
  gridColor: "var(--border, rgba(255,255,255,0.05))",
  axisColor: "var(--sub, #8a95a8)",
  tooltipStyle: {
    backgroundColor: "var(--surface, rgba(12, 16, 24, 0.9))",
    border: "1px solid var(--border, rgba(255,255,255,0.08))",
    borderRadius: "12px",
    color: "var(--text, #f0f2f5)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "12px",
  },
  legendStyle: {
    color: "var(--sub, #8a95a8)",
    fontSize: "12px",
    fontFamily: "var(--font-inter, sans-serif)",
  },
};

export const CHART_COLORS = [
  "var(--chart-1, #00e1ff)",
  "var(--chart-2, #ff00aa)",
  "var(--chart-3, #00ff88)",
  "var(--chart-4, #ffaa00)",
  "var(--chart-5, #8b5cf6)",
  "var(--danger, #ef4444)",
  "var(--info, #3b82f6)",
];
