// @vitest-environment node
/**
 * Due dates named in meeting notes, counted from the meeting's day (an
 * injected today, never the clock): weekdays, day-month in either order
 * with and without a year, ISO days, tomorrow, today, the end of the week
 * and of the sprint, around month and year ends. Only days on or after the
 * meeting come back.
 */

import { describe, expect, it } from "vitest";
import { dueFromText, isDay, shiftDay } from "@/lib/notes-to-actions/due";

/** Friday 20 Nov 2026. */
const FRI = "2026-11-20";

describe("isDay and shiftDay", () => {
  it("checks real days and moves across month and year ends", () => {
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-13-01")).toBe(false);
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("dueFromText", () => {
  it.each([
    ["Ana to update the copy by Friday", FRI, "2026-11-20"],
    ["Sam will send it by Monday", FRI, "2026-11-23"],
    ["Ship it before Thu", FRI, "2026-11-26"],
    ["Review on next Tuesday", FRI, "2026-11-24"],
    ["Pair on it tomorrow", FRI, "2026-11-21"],
    ["Fix it today", FRI, "2026-11-20"],
    ["Wrap up by end of the week", "2026-11-18", "2026-11-20"],
    ["Start next week", FRI, "2026-11-23"],
    ["Deliver by 12 Dec", FRI, "2026-12-12"],
    ["Deliver by December 12th", FRI, "2026-12-12"],
    ["Deliver by 3rd of March", FRI, "2027-03-03"],
    ["Deliver by Nov 2", FRI, "2027-11-02"],
    ["Deliver by 25 Dec 2026", FRI, "2026-12-25"],
    ["Due 2026-12-01 at the latest", FRI, "2026-12-01"],
    ["Answer by Friday", "2026-12-31", "2027-01-01"],
    ["Pay tomorrow", "2026-12-31", "2027-01-01"],
    ["Close on 1 Jan", "2026-12-31", "2027-01-01"],
    ["File by 28 Feb", "2027-03-01", "2028-02-28"],
    ["Book by 31 Jan", "2027-01-31", "2027-01-31"],
  ])("“%s” on %s → %s", (text, today, due) => {
    expect(dueFromText(text, today)).toBe(due);
  });

  it("reads the end of the sprint only when the page knows it", () => {
    expect(dueFromText("Finish by end of sprint", FRI, { sprintEnd: "2026-11-27" })).toBe(
      "2026-11-27"
    );
    expect(dueFromText("Finish by end of the sprint", FRI)).toBeUndefined();
  });

  it("gives nothing for a line that names no day, or a day before the meeting", () => {
    expect(dueFromText("We talked about the API", FRI)).toBeUndefined();
    expect(dueFromText("It was due 2026-11-01", FRI)).toBeUndefined();
    expect(dueFromText("Released by 2026-02-30", FRI)).toBeUndefined();
    expect(dueFromText("anything", "not a day")).toBeUndefined();
  });

  it("always answers a day on or after the meeting, for every weekday and every day of a year end", () => {
    const words = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    for (let i = 0; i < 14; i++) {
      const today = shiftDay("2026-12-25", i);
      for (const w of words) {
        const due = dueFromText(`by ${w}`, today) as string;
        expect(isDay(due)).toBe(true);
        expect(due >= today).toBe(true);
        expect(due <= shiftDay(today, 6)).toBe(true);
      }
      const tomorrow = dueFromText("tomorrow", today) as string;
      expect(tomorrow).toBe(shiftDay(today, 1));
    }
  });
});
