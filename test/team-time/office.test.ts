/**
 * Office days: people grouped by office (their zone when they name none),
 * who is in each weekday, the anchor day (most people in, the week's first
 * working day breaking ties), the pairs who never meet in the office and
 * who is never in.
 */

import { describe, expect, it } from "vitest";
import { anchorDaysBySite, officeGroups, weekStart } from "@/lib/team-time/office";
import { person } from "./fixtures";

const inLondon = (id: string, officeDays: number[], site = "London office") =>
  person({ id, timeZone: "Europe/London", site, officeDays });

describe("officeGroups", () => {
  it("counts who is in each day and finds the anchor day per office", () => {
    const [g] = officeGroups([inLondon("a", [2, 4]), inLondon("b", [3, 4]), inLondon("c", [4])]);
    expect(g).toMatchObject({
      key: "site:london office",
      label: "London office",
      site: "London office",
    });
    expect(g.inOn[4]).toEqual(["a", "b", "c"]);
    expect(g.inOn[2]).toEqual(["a"]);
    expect(g.anchorDays).toEqual([4]);
    expect(g.neverMeet).toEqual([]);
  });

  it("lists every tied day, the week's first working day first", () => {
    const [g] = officeGroups([inLondon("a", [1, 3]), inLondon("b", [3, 1])]);
    expect(g.anchorDays).toEqual([1, 3]);
    const sunThu = [0, 1, 2, 3, 4];
    const [cairo] = officeGroups([
      person({ id: "x", workingDays: sunThu, officeDays: [0, 3], site: "HQ" }),
      person({ id: "y", workingDays: sunThu, officeDays: [3, 0], site: "hq" }),
    ]);
    expect(cairo.anchorDays).toEqual([0, 3]);
  });

  it("names the pairs who never share an office day, and who is never in", () => {
    const [g] = officeGroups([
      inLondon("a", [1]),
      inLondon("b", [2]),
      inLondon("c", [1, 2]),
      inLondon("d", []),
    ]);
    expect(g.neverMeet).toEqual([["a", "b"]]);
    expect(g.remote).toEqual(["d"]);
  });

  it("groups by zone without an office, and skips a lone person or a group nobody visits", () => {
    const groups = officeGroups([
      person({ id: "t1", timeZone: "Asia/Tokyo", officeDays: [1] }),
      person({ id: "t2", timeZone: "Asia/Tokyo", officeDays: [1] }),
      inLondon("solo", [2], "Leeds"),
      person({ id: "n1", timeZone: "America/New_York" }),
      person({ id: "n2", timeZone: "America/New_York" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Tokyo"]);
    expect(groups[0].key).toBe("zone:Asia/Tokyo");
  });

  it("ignores office days that aren't working days", () => {
    const [g] = officeGroups([inLondon("a", [6]), inLondon("b", [2])]);
    expect(g.inOn[6]).toEqual([]);
    expect(g.remote).toEqual(["a"]);
  });

  it("gives the anchor days by office for the charter", () => {
    expect(anchorDaysBySite([inLondon("a", [4]), inLondon("b", [4])])).toEqual([
      { site: "London office", days: [4] },
    ]);
  });
});

describe("weekStart", () => {
  it("starts a Monday-to-Friday week on Monday and a Sunday-to-Thursday one on Sunday", () => {
    expect(weekStart([1, 2, 3, 4, 5])).toBe(1);
    expect(weekStart([0, 1, 2, 3, 4])).toBe(0);
    expect(weekStart([6, 0, 1, 2, 3])).toBe(6);
    expect(weekStart([])).toBe(1);
  });
});
