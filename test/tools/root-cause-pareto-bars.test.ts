import { describe, expect, it } from "vitest";
import { PARETO_BARS } from "@/app/(tools)/root-cause/pareto-chart";
import { chartTheme } from "@/components/charts/chart-theme";

/**
 * Root Cause's Pareto chart: the vital few and the other causes must differ
 * by more than hue (blue and violet look alike to many colour-blind people),
 * and the quieter bars still need an edge that clears 3:1 against the card.
 */
describe("the Pareto chart's bars", () => {
  it("keeps the vital few solid", () => {
    expect(PARETO_BARS.vital).toEqual({ fill: chartTheme.colors.cyan });
  });

  it("gives the other causes a lighter fill inside a solid edge of their colour", () => {
    const { other } = PARETO_BARS;
    expect(other.fill).toBe(chartTheme.colors.purple);
    expect(other.fillOpacity).toBeLessThanOrEqual(0.5);
    expect(other.stroke).toBe(chartTheme.colors.purple);
    expect(other).not.toHaveProperty("strokeOpacity");
    expect(other.strokeWidth).toBeGreaterThanOrEqual(1);
  });
});
