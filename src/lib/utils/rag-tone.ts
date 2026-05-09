/**
 * Maps a numeric value to a RAG (red / amber / green) Tailwind text-colour
 * class, given two thresholds. Replaces the recurring nested-ternary
 * pattern across tools that highlight a percentage or score:
 *
 *   const cls = totals.flowEfficiency >= 40
 *     ? "text-accent"
 *     : totals.flowEfficiency >= 15
 *     ? "text-amber-300"
 *     : "text-danger";
 *
 *   →  const cls = ragTone(totals.flowEfficiency, { good: 40, warn: 15 });
 *
 * The colour vocabulary intentionally matches the existing palette:
 *   green   → "text-accent"      (cyan accent — the toolkit's "all good")
 *   amber   → "text-amber-300"
 *   red     → "text-danger"
 *
 * Pass `direction: "lower-is-better"` for inverted metrics (cycle time,
 * defect count, age-in-days). Default is "higher-is-better".
 */
export function ragTone(
  value: number,
  thresholds: { good: number; warn: number },
  direction: "higher-is-better" | "lower-is-better" = "higher-is-better"
): string {
  if (direction === "higher-is-better") {
    if (value >= thresholds.good) return "text-accent";
    if (value >= thresholds.warn) return "text-amber-300";
    return "text-danger";
  }
  // lower-is-better — invert the comparison
  if (value <= thresholds.good) return "text-accent";
  if (value <= thresholds.warn) return "text-amber-300";
  return "text-danger";
}
