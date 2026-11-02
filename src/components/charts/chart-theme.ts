export const chartTheme = {
  // Theme variables (globals.css) with the comic's values as fallbacks, so
  // PNG exports — which render the SVG outside the page's CSS — still get a
  // colour. The names are the old palette's; each token keeps a distinct hue.
  colors: {
    cyan: "var(--chart-1, #1958b3)",
    magenta: "var(--chart-2, #b0306f)",
    green: "var(--chart-3, #2e7a3a)",
    amber: "var(--chart-4, #96600f)",
    purple: "var(--chart-5, #5d4a9c)",
    red: "var(--danger, #9c1c2e)",
    blue: "var(--info, #174f9c)",
  },
  background: "var(--bg, #f7f1e6)",
  cardBackground: "var(--surface, #fdf9f0)",
  // The quieter line: grids in full ink would fight the series.
  gridColor: "var(--rule, #d8cfbf)",
  axisColor: "var(--sub, #574e44)",
  tooltipStyle: {
    backgroundColor: "var(--surface, #fdf9f0)",
    border: "1.5px solid var(--border, #2b2622)",
    borderRadius: "6px",
    color: "var(--text, #1d1a18)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "12px",
  },
  legendStyle: {
    color: "var(--sub, #574e44)",
    fontSize: "12px",
    fontFamily: "var(--font-inter, sans-serif)",
  },
};

export const CHART_COLORS = [
  "var(--chart-1, #1958b3)",
  "var(--chart-2, #b0306f)",
  "var(--chart-3, #2e7a3a)",
  "var(--chart-4, #96600f)",
  "var(--chart-5, #5d4a9c)",
  "var(--danger, #9c1c2e)",
  "var(--info, #174f9c)",
];
