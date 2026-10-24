import { describe, expect, it } from "vitest";
import {
  designSprintDates,
  designSprintToday,
  shownDesignSprintDay,
} from "@/lib/design-sprint/day";

/** A design sprint's day comes from its start date and the team's working days. */

describe("design sprint days", () => {
  it("runs on five working days from the first one on or after the start", () => {
    // Thursday 22 Oct 2026: Thu, Fri, Mon, Tue, Wed.
    expect(designSprintDates("2026-10-22")).toEqual([
      "2026-10-22",
      "2026-10-23",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ]);
    // Starting on a Saturday begins on Monday; a holiday moves the rest along.
    expect(
      designSprintDates("2026-10-24", { workingDays: [1, 2, 3, 4, 5], holidays: ["2026-10-27"] })
    ).toEqual(["2026-10-26", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"]);
    expect(designSprintDates("nope")).toEqual([]);
  });

  it("says where the sprint stands today", () => {
    expect(designSprintToday("2026-10-26", "2026-10-22")).toMatchObject({
      status: "upcoming",
      day: null,
      startsIn: 2,
    });
    expect(designSprintToday("2026-10-22", "2026-10-27").day).toBe(4);
    // On the weekend in the middle: the last day worked.
    expect(designSprintToday("2026-10-22", "2026-10-24")).toMatchObject({
      status: "running",
      day: 2,
    });
    expect(designSprintToday("2026-10-22", "2026-10-29")).toMatchObject({
      status: "over",
      day: null,
    });
    expect(shownDesignSprintDay({ status: "upcoming", day: null })).toBe(1);
    expect(shownDesignSprintDay({ status: "over", day: null })).toBe(5);
    expect(shownDesignSprintDay({ status: "running", day: 3 })).toBe(3);
  });
});
