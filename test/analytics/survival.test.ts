import { describe, it, expect } from "vitest";
import { durationsFromTimeRanges } from "@/lib/analytics/survival";

const NOW = new Date("2026-10-21T00:00:00.000Z");

describe("durationsFromTimeRanges", () => {
  it("counts a resolved item as an event ending at its resolvedAt", () => {
    expect(
      durationsFromTimeRanges(
        [{ raisedAt: "2026-10-01T00:00:00.000Z", resolvedAt: "2026-10-11T00:00:00.000Z" }],
        NOW
      )
    ).toEqual([{ duration: 10, event: true }]);
  });

  it("censors an unresolved item at now", () => {
    expect(durationsFromTimeRanges([{ raisedAt: "2026-10-01T00:00:00.000Z" }], NOW)).toEqual([
      { duration: 20, event: false },
    ]);
  });

  it("censors a reopened item at now, not at its preserved resolvedAt", () => {
    // Reopened risks keep their first close date; they are still at risk today.
    expect(
      durationsFromTimeRanges(
        [
          {
            raisedAt: "2026-10-01T00:00:00.000Z",
            resolvedAt: "2026-10-03T00:00:00.000Z",
            status: "open",
          },
        ],
        NOW
      )
    ).toEqual([{ duration: 20, event: false }]);
  });

  it("uses resolvedAt for an item whose status is closed", () => {
    expect(
      durationsFromTimeRanges(
        [
          {
            raisedAt: "2026-10-01T00:00:00.000Z",
            resolvedAt: "2026-10-05T00:00:00.000Z",
            status: "closed",
          },
        ],
        NOW
      )
    ).toEqual([{ duration: 4, event: true }]);
  });

  it("drops items that end before they start", () => {
    expect(
      durationsFromTimeRanges(
        [{ raisedAt: "2026-10-10T00:00:00.000Z", resolvedAt: "2026-10-01T00:00:00.000Z" }],
        NOW
      )
    ).toEqual([]);
  });
});
