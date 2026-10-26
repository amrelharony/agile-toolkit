import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MATURITY_DIMENSIONS } from "@/lib/constants/maturity-model";
import { MaturityRadarChart } from "@/app/(tools)/maturity/charts";

/**
 * The Maturity radar at phone width: the eight dimension names wrap over
 * two lines and the radar shrinks, so "Technical Excellence" and
 * "Stakeholder Engagement" at its left and right edges stay inside a
 * 375 px screen. On a wide plot the names stay on one line.
 */

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const data = MATURITY_DIMENSIONS.map((d) => ({ subject: d.name, latest: 3, target: 4 }));

const lines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".recharts-polar-angle-axis tspan")).map(
    (t) => t.textContent
  );

describe("the radar's dimension names", () => {
  it("wrap over two lines on a narrow plot", () => {
    const { container } = render(<MaturityRadarChart data={data} width={295} height={360} />);
    expect(lines(container)).toEqual(
      expect.arrayContaining(["Stakeholder", "Engagement", "Technical", "Excellence"])
    );
    expect(lines(container)).not.toContain("Stakeholder Engagement");
  });

  it("stay whole on a wide plot", () => {
    const { container } = render(<MaturityRadarChart data={data} width={640} height={360} />);
    expect(lines(container)).toEqual(
      expect.arrayContaining(["Stakeholder Engagement", "Technical Excellence"])
    );
  });
});
