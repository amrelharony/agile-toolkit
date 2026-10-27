import type { RiskLevel } from "@/lib/risks/model";

/**
 * The register's 1–5 scales and its level colours.
 *
 * The likelihood and impact steps are lib/risks/scales', which the
 * Premortem rates its causes on too: they become these risks (the "risk"
 * hand-off), so a 4 means the same on both pages. The level tones are
 * theme tokens (low success, medium info, high warning, critical danger),
 * never hex, so they follow the light, dark and high-contrast themes.
 */
export { IMPACT_HINT, IMPACT_STEPS, LIKELIHOOD_HINT, LIKELIHOOD_STEPS } from "@/lib/risks/scales";

/** Border, tint and text for a level's chip or matrix cell. */
export const LEVEL_TONE: Readonly<Record<RiskLevel, string>> = {
  low: "border-success/40 bg-success/10 text-success",
  medium: "border-info/40 bg-info/10 text-info",
  high: "border-warning/40 bg-warning/10 text-warning",
  critical: "border-danger/40 bg-danger/15 text-danger",
};
