/**
 * Maps a numeric value to a RAG (red / amber / green) Tailwind text-colour
 * class, given two thresholds. Replaces the recurring nested-ternary
 * pattern across tools that highlight a percentage or score:
 *
 *   const cls = totals.flowEfficiency >= 40
 *     ? "text-accent"
 *     : totals.flowEfficiency >= 15
 *     ? "text-warning"
 *     : "text-danger";
 *
 *   →  const cls = ragTone(totals.flowEfficiency, { good: 40, warn: 15 });
 *
 * The colour vocabulary intentionally matches the existing palette:
 *   green   → "text-accent"      (cyan accent — the toolkit's "all good")
 *   amber   → "text-warning"
 *   red     → "text-danger"
 *   neutral → "text-sub"         (for NaN/null/missing data)
 *
 * Pass `direction: "lower-is-better"` for inverted metrics (cycle time,
 * defect count, age-in-days). Default is "higher-is-better".
 *
 * Threshold convention:
 *  - "higher-is-better": good > warn (e.g., flowEff good=40, warn=15)
 *  - "lower-is-better":  good < warn (e.g., cycleTime good=5d, warn=15d)
 *
 * Mis-ordering thresholds silently returns wrong colors — pass them in the
 * canonical direction. In dev, a swapped pair will warn once via console.
 */
export function ragTone(
  value: number | null | undefined,
  thresholds: { good: number; warn: number },
  direction: "higher-is-better" | "lower-is-better" = "higher-is-better"
): string {
  // Missing data renders neutral rather than red. The previous behavior
  // showed a NaN cell as `text-danger`, falsely signaling a critical alert
  // when in fact no data had been collected.
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "text-sub";
  }

  if (process.env.NODE_ENV !== "production") {
    if (direction === "higher-is-better" && thresholds.good < thresholds.warn) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ragTone] higher-is-better expects good > warn, got good=${thresholds.good} warn=${thresholds.warn}`
      );
    }
    if (direction === "lower-is-better" && thresholds.good > thresholds.warn) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ragTone] lower-is-better expects good < warn, got good=${thresholds.good} warn=${thresholds.warn}`
      );
    }
  }

  if (direction === "higher-is-better") {
    if (value >= thresholds.good) return "text-accent";
    if (value >= thresholds.warn) return "text-warning";
    return "text-danger";
  }
  // lower-is-better — invert the comparison
  if (value <= thresholds.good) return "text-accent";
  if (value <= thresholds.warn) return "text-warning";
  return "text-danger";
}
