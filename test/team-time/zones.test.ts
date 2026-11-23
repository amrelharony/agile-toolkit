/**
 * Team Time's clocks: offsets, local days and minutes, and wall times to
 * instants across clock changes. Every case passes its zone and a fixed
 * instant, and only zones with long-stable rules are asserted (London, New
 * York, Sydney, Kolkata, Kathmandu, Tokyo): the machine's own zone never
 * matters, and Cairo appears in the example but never here.
 */

import { describe, expect, it } from "vitest";
import {
  allZones,
  canonicalZone,
  currentZoneName,
  localClock,
  offsetLabel,
  offsetMinutes,
  wallToUtc,
  zoneLabel,
} from "@/lib/team-time/zones";

const at = (s: string) => Date.parse(s);
const utc = (d: Date | null) => d?.toISOString() ?? null;

describe("offsetMinutes", () => {
  it.each([
    ["Europe/London", "2026-01-15T12:00:00Z", 0],
    ["Europe/London", "2026-07-15T12:00:00Z", 60],
    ["America/New_York", "2026-01-15T12:00:00Z", -300],
    ["America/New_York", "2026-07-15T12:00:00Z", -240],
    ["Australia/Sydney", "2026-01-15T12:00:00Z", 660],
    ["Australia/Sydney", "2026-07-15T12:00:00Z", 600],
    ["Asia/Kolkata", "2026-03-01T00:00:00Z", 330],
    ["Asia/Kathmandu", "2026-03-01T00:00:00Z", 345],
    ["Asia/Tokyo", "2026-01-15T12:00:00Z", 540],
    ["Asia/Tokyo", "2026-07-15T12:00:00Z", 540],
    ["UTC", "2026-07-15T12:00:00Z", 0],
  ])("%s at %s is %i", (zone, when, offset) => {
    expect(offsetMinutes(zone, at(when))).toBe(offset);
  });

  it("changes in London at 01:00 UTC on the last Sunday of March and of October", () => {
    expect(offsetMinutes("Europe/London", at("2026-03-29T00:59:00Z"))).toBe(0);
    expect(offsetMinutes("Europe/London", at("2026-03-29T01:00:00Z"))).toBe(60);
    expect(offsetMinutes("Europe/London", at("2026-10-25T00:59:00Z"))).toBe(60);
    expect(offsetMinutes("Europe/London", at("2026-10-25T01:00:00Z"))).toBe(0);
  });
});

describe("localClock", () => {
  it("reads the day, the minute and the weekday on the zone's clock", () => {
    expect(localClock("Asia/Tokyo", at("2026-11-17T20:30:00Z"))).toEqual({
      day: "2026-11-18",
      minute: 5 * 60 + 30,
      weekday: 3,
    });
    expect(localClock("America/New_York", at("2026-11-17T03:15:00Z"))).toEqual({
      day: "2026-11-16",
      minute: 22 * 60 + 15,
      weekday: 1,
    });
    expect(localClock("Asia/Kathmandu", at("2026-03-01T00:00:00Z")).minute).toBe(5 * 60 + 45);
  });
});

describe("wallToUtc", () => {
  it("turns a wall time on a real day into its instant", () => {
    expect(utc(wallToUtc("2026-11-17", "09:00", "Europe/London"))).toBe("2026-11-17T09:00:00.000Z");
    expect(utc(wallToUtc("2026-07-17", "09:00", "Europe/London"))).toBe("2026-07-17T08:00:00.000Z");
    expect(utc(wallToUtc("2026-11-17", "07:00", "Australia/Sydney"))).toBe(
      "2026-11-16T20:00:00.000Z"
    );
    expect(utc(wallToUtc("2026-11-17", "11:00", "Asia/Kolkata"))).toBe("2026-11-17T05:30:00.000Z");
    expect(utc(wallToUtc("2026-11-17", "12:00", "Asia/Kathmandu"))).toBe(
      "2026-11-17T06:15:00.000Z"
    );
  });

  it("moves a time in the spring-forward gap on to the first minute that exists", () => {
    // London skips 01:00–02:00 on 29 March 2026; New York 02:00–03:00 on 8 March.
    expect(utc(wallToUtc("2026-03-29", "01:30", "Europe/London"))).toBe("2026-03-29T01:00:00.000Z");
    expect(utc(wallToUtc("2026-03-08", "02:30", "America/New_York"))).toBe(
      "2026-03-08T07:00:00.000Z"
    );
    // Sydney skips 02:00–03:00 on 4 October 2026.
    expect(utc(wallToUtc("2026-10-04", "02:15", "Australia/Sydney"))).toBe(
      "2026-10-03T16:00:00.000Z"
    );
  });

  it("takes the earlier instant of a time that happens twice when the clocks go back", () => {
    expect(utc(wallToUtc("2026-10-25", "01:30", "Europe/London"))).toBe("2026-10-25T00:30:00.000Z");
    expect(utc(wallToUtc("2026-11-01", "01:30", "America/New_York"))).toBe(
      "2026-11-01T05:30:00.000Z"
    );
    // Sydney repeats 02:00–03:00 on 5 April 2026.
    expect(utc(wallToUtc("2026-04-05", "02:30", "Australia/Sydney"))).toBe(
      "2026-04-04T15:30:00.000Z"
    );
  });

  it("is null for a day, time or zone that isn't one", () => {
    expect(wallToUtc("2026-02-30", "09:00", "UTC")).toBeNull();
    expect(wallToUtc("2026-11-17", "25:00", "UTC")).toBeNull();
    expect(wallToUtc("2026-11-17", "09:00", "Mars/Base")).toBeNull();
  });
});

describe("zone names", () => {
  it("canonicalises a legacy name to whatever this runtime calls it, and keeps it stable", () => {
    const calcutta = canonicalZone("Asia/Calcutta");
    expect(calcutta).not.toBeNull();
    expect(canonicalZone(calcutta!)).toBe(calcutta);
    expect(offsetMinutes(calcutta!, at("2026-03-01T00:00:00Z"))).toBe(330);
  });

  it("lists every zone once, canonical and sorted, with UTC and the stable ones in it", () => {
    const zones = allZones();
    expect(new Set(zones).size).toBe(zones.length);
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
    for (const z of ["UTC", "Europe/London", "Asia/Tokyo", "America/New_York"]) {
      expect(zones).toContain(canonicalZone(z));
    }
    for (const z of zones.slice(0, 20)) expect(canonicalZone(z)).toBe(z);
  });

  it("names a zone by today's city and name, whatever spelling the runtime keeps", () => {
    for (const [zone, city] of [
      ["Asia/Kolkata", "Kolkata"],
      ["Europe/Kyiv", "Kyiv"],
      ["Asia/Kathmandu", "Kathmandu"],
      ["Asia/Ho_Chi_Minh", "Ho Chi Minh"],
    ]) {
      const canonical = canonicalZone(zone)!;
      expect(zoneLabel(canonical)).toBe(city);
      expect(currentZoneName(canonical)).toBe(zone);
    }
    expect(currentZoneName("Europe/London")).toBe("Europe/London");
  });

  it("names a zone by its city, and an offset as people read it", () => {
    expect(zoneLabel("America/Toronto")).toBe("Toronto");
    expect(zoneLabel("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneLabel("UTC")).toBe("UTC");
    expect(offsetLabel(0)).toBe("UTC");
    expect(offsetLabel(60)).toBe("UTC+1");
    expect(offsetLabel(330)).toBe("UTC+5:30");
    expect(offsetLabel(-240)).toBe("UTC-4");
  });
});
