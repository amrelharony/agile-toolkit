import { describe, it, expect } from "vitest";
import { cusum } from "@/lib/analytics/changepoint";
import { changepointMarkers } from "@/app/(tools)/velocity/changepoints";

/**
 * Velocity: CUSUM runs on the finished sprints only, so its changepoint
 * index must be looked up in that same list. It was looked up in the full
 * sprint list, so planned (unfinished) sprints listed before the finished
 * ones pushed every regime-shift marker onto the wrong sprint.
 */

const sprints = [
  // Planned rows (completed 0) ahead of the finished ones.
  { name: "Plan A", completed: 0 },
  { name: "Plan B", completed: 0 },
  { name: "S1", completed: 10 },
  { name: "S2", completed: 10 },
  { name: "S3", completed: 10 },
  { name: "S4", completed: 10 },
  { name: "S5", completed: 10 },
  { name: "S6", completed: 10 },
  { name: "S7", completed: 10 },
  { name: "S8", completed: 10 },
  { name: "S9", completed: 10 },
  { name: "S10", completed: 10 },
  { name: "S11", completed: 30 },
  { name: "S12", completed: 30 },
  { name: "S13", completed: 30 },
  { name: "S14", completed: 30 },
  { name: "S15", completed: 30 },
];
// The client's rule: a sprint is finished once it has completed points.
const finished = sprints.filter((s) => s.completed > 0);

describe("Velocity changepoint markers", () => {
  it("anchors each marker to the finished sprint CUSUM flagged", () => {
    const points = cusum(finished.map((s) => s.completed));
    expect(points.map((cp) => cp.index)).toEqual([14]);

    // The shift to 30 is flagged on the last finished sprint, S15. The old
    // lookup, sprints[14], landed two rows early on S13.
    const markers = changepointMarkers(finished);
    expect(markers.map((m) => m.annotation.x)).toEqual(["S15"]);
    expect(sprints[points[0].index].name).toBe("S13");
    for (const m of markers) {
      expect(m.annotation.detail).toContain(`at ${m.annotation.x}.`);
    }
  });

  it("has no markers below MIN_SAMPLE.changePoint (8) finished sprints", () => {
    expect(changepointMarkers(finished.slice(0, 3))).toEqual([]);
    // A jump in the last of seven is still noise, not a regime shift.
    expect(changepointMarkers([...finished.slice(0, 6), { name: "S7", completed: 60 }])).toEqual(
      []
    );
  });
});
