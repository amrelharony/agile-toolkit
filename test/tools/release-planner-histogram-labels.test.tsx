import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import {
  SimulationHistogramChart,
  groupPercentiles,
  percentileLabel,
  spreadLabels,
} from "@/app/(tools)/release-planner/charts";

/**
 * The Release Planner's histogram at phone width (mobile audit 2026-11-08):
 * P50 and P85 in the same bucket printed their labels over each other, so
 * P50 couldn't be read. Percentiles in one bucket now share one label
 * ("P50·P85"), and labels in neighbouring buckets are spread apart. The
 * margins leave room for the labels above the plot and "Sprints needed"
 * below it.
 */

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

describe("groupPercentiles", () => {
  it("merges percentiles that land in the same bucket and skips missing ones", () => {
    const groups = groupPercentiles([
      { x: 10, name: "P50", colour: "a" },
      { x: 10, name: "P85", colour: "b" },
      { x: 11, name: "P95", colour: "c" },
    ]);
    expect(groups.map((g) => [g.x, percentileLabel(g)])).toEqual([
      [10, "P50·P85"],
      [11, "P95"],
    ]);
    expect(groups[0].members.map((m) => m.colour)).toEqual(["a", "b"]);
    expect(
      groupPercentiles([
        { x: null, name: "P50", colour: "a" },
        { x: 12, name: "P85", colour: "b" },
      ]).map(percentileLabel)
    ).toEqual(["P85"]);
  });
});

describe("spreadLabels", () => {
  it("leaves labels that don't touch where they are", () => {
    expect(
      spreadLabels([
        { x: 50, width: 24 },
        { x: 100, width: 24 },
      ])
    ).toEqual([50, 100]);
  });

  it("pushes touching labels apart, centred on their lines", () => {
    const [a, b] = spreadLabels(
      [
        { x: 100, width: 24 },
        { x: 114, width: 24 },
      ],
      { gap: 4 }
    );
    expect(b - a).toBe(28);
    expect((a + b) / 2).toBe(107);
  });

  it("keeps a crowded cluster inside the chart", () => {
    const [a, b] = spreadLabels(
      [
        { x: 290, width: 24 },
        { x: 296, width: 24 },
      ],
      { min: 0, max: 300, gap: 4 }
    );
    expect(b + 12).toBeLessThanOrEqual(300);
    expect(b - a).toBe(28);
  });

  it("spreads three crowded labels without overlap", () => {
    const centres = spreadLabels(
      [
        { x: 100, width: 24 },
        { x: 108, width: 24 },
        { x: 116, width: 24 },
      ],
      { gap: 4 }
    );
    expect(centres[1] - centres[0]).toBe(28);
    expect(centres[2] - centres[1]).toBe(28);
    expect(centres[1]).toBe(108);
  });
});

describe("SimulationHistogramChart", () => {
  it("gives P50 and P85 in one bucket a single label", () => {
    // The chart sizes itself (ResponsiveContainer): give its box a phone's size.
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 292,
      height: 350,
      top: 0,
      left: 0,
      right: 292,
      bottom: 350,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    try {
      const { container } = render(
        <SimulationHistogramChart
          histogram={[8, 9, 10, 11, 12].map((sprints, i) => ({
            sprints,
            count: [0, 30, 60, 10, 1][i],
          }))}
          total={101}
          p50={10}
          p85={10}
          p95={11}
          target={9}
        />
      );
      const labels = Array.from(container.querySelectorAll("text.recharts-label")).map(
        (t) => t.textContent
      );
      expect(labels).toEqual(expect.arrayContaining(["P50·P85", "P95", "Target"]));
      expect(labels).not.toContain("P50");
      // Each name keeps its line's colour inside the shared label.
      const shared = Array.from(container.querySelectorAll("text.recharts-label")).find(
        (t) => t.textContent === "P50·P85"
      );
      expect(Array.from(shared?.querySelectorAll("tspan") ?? []).map((t) => t.textContent)).toEqual(
        ["P50", "·", "P85"]
      );
    } finally {
      box.mockRestore();
    }
  });
});
