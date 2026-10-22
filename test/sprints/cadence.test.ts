import { describe, expect, it } from "vitest";
import type { Sprint } from "@/lib/stores/workspace-types";
import {
  DEFAULT_CADENCE,
  ceremonyDates,
  localDateTime,
  nextCeremonies,
  normalizeCadence,
  whenLabel,
} from "@/lib/sprints/cadence";

// Monday 19 Oct 2026 to Friday 30 Oct 2026: an 11-day sprint over two working weeks.
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 30,
  status: "active",
};

const at = (iso: string, time: string) => localDateTime(iso, time)!;

describe("ceremonyDates", () => {
  it("places planning on day 0, dailies on working days, refinement weekly, review and retro last", () => {
    const all = ceremonyDates(SPRINT, DEFAULT_CADENCE);
    const kinds = all.map((o) => o.kind);
    expect(kinds.filter((k) => k === "planning")).toHaveLength(1);
    expect(kinds.filter((k) => k === "daily")).toHaveLength(9); // Tue–Fri, Mon–Fri
    expect(kinds.filter((k) => k === "refinement")).toHaveLength(2); // the two Wednesdays
    expect(kinds.filter((k) => k === "review")).toHaveLength(1);
    expect(kinds.filter((k) => k === "retro")).toHaveLength(1);

    expect(all[0]).toMatchObject({ kind: "planning", day: 0, at: at("2026-10-19", "10:00") });
    expect(all[all.length - 2]).toMatchObject({
      kind: "review",
      day: 11,
      at: at("2026-10-30", "14:00"),
    });
    expect(all[all.length - 1]).toMatchObject({
      kind: "retro",
      day: 11,
      at: at("2026-10-30", "15:30"),
    });
    // Time order throughout.
    for (let i = 1; i < all.length; i++) {
      expect(all[i].at.getTime()).toBeGreaterThanOrEqual(all[i - 1].at.getTime());
    }
  });

  it("skips the daily on days the team doesn't hold it", () => {
    const cadence = { ...DEFAULT_CADENCE, dailyWeekdays: [1, 3, 5] }; // Mon, Wed, Fri
    const dailies = ceremonyDates(SPRINT, cadence).filter((o) => o.kind === "daily");
    expect(dailies.map((d) => d.at.getDay())).toEqual([3, 5, 1, 3, 5]);
  });

  it("has no refinement when the team has no fixed day", () => {
    const cadence = { ...DEFAULT_CADENCE, refinement: null };
    expect(ceremonyDates(SPRINT, cadence).some((o) => o.kind === "refinement")).toBe(false);
  });

  it("is empty for a sprint without real dates", () => {
    expect(
      ceremonyDates({ ...SPRINT, startDate: "2020-01-05", endDate: "2020-01-15" }, DEFAULT_CADENCE)
    ).toEqual([]);
  });
});

describe("nextCeremonies", () => {
  it("returns the next two from now on", () => {
    const next = nextCeremonies(SPRINT, DEFAULT_CADENCE, at("2026-10-22", "09:00"));
    expect(next.map((o) => [o.kind, o.at])).toEqual([
      ["daily", at("2026-10-22", "09:30")],
      ["daily", at("2026-10-23", "09:30")],
    ]);
  });

  it("ends with the retro and is empty afterwards", () => {
    expect(nextCeremonies(SPRINT, DEFAULT_CADENCE, at("2026-10-30", "14:30"))).toMatchObject([
      { kind: "retro" },
    ]);
    expect(nextCeremonies(SPRINT, DEFAULT_CADENCE, at("2026-10-30", "16:00"))).toEqual([]);
  });
});

describe("whenLabel", () => {
  const now = at("2026-10-22", "08:00");
  it("says today, tomorrow or the day", () => {
    expect(whenLabel(at("2026-10-22", "09:30"), now)).toBe("Today 09:30");
    expect(whenLabel(at("2026-10-23", "09:30"), now)).toBe("Tomorrow 09:30");
    expect(whenLabel(at("2026-10-30", "14:00"), now)).toBe("Fri 30 Oct 14:00");
  });
});

describe("normalizeCadence", () => {
  it("falls back to the defaults for anything unusable", () => {
    expect(normalizeCadence(undefined)).toEqual(DEFAULT_CADENCE);
    expect(normalizeCadence("junk")).toEqual(DEFAULT_CADENCE);
    expect(
      normalizeCadence({ dailyTime: "25:00", sprintLengthDays: 0, dailyWeekdays: [9, "x"] })
    ).toEqual(DEFAULT_CADENCE);
  });

  it("keeps valid values, dedupes weekdays and respects an explicit no-refinement", () => {
    const c = normalizeCadence({
      sprintLengthDays: 7,
      dailyTime: "08:45",
      dailyWeekdays: [5, 1, 1, 3],
      refinement: null,
    });
    expect(c).toMatchObject({
      sprintLengthDays: 7,
      dailyTime: "08:45",
      dailyWeekdays: [1, 3, 5],
      refinement: null,
    });
    expect(normalizeCadence({ refinement: { weekday: 2 } }).refinement).toEqual({
      weekday: 2,
      time: "11:00",
    });
  });
});
