/**
 * Follow the sun: places east to west by their offset at noon UTC on a
 * day, and each Standup poster's place by name (roster and stored names),
 * example rows left out, the Standup's own example filled from Team Time's.
 */

import { describe, expect, it } from "vitest";
import { standupPlaces, sunOrder } from "@/lib/team-time/sun";
import { person } from "./fixtures";

describe("sunOrder", () => {
  it("puts the places east to west, keeping the order of a shared offset", () => {
    const places = [
      { zone: "America/New_York", label: "NY" },
      { zone: "Europe/London", label: "London" },
      { zone: "Asia/Tokyo", label: "Tokyo" },
      { zone: "Australia/Sydney", label: "Sydney" },
      { zone: "Asia/Kolkata", label: "Kolkata" },
      { zone: "UTC", label: "UTC" },
    ];
    expect(sunOrder(places, "2026-11-18").map((p) => p.label)).toEqual([
      "Sydney",
      "Tokyo",
      "Kolkata",
      "London",
      "UTC",
      "NY",
    ]);
  });
});

describe("standupPlaces", () => {
  const roster = [{ id: "m1", name: "Lee Chen" }];

  it("keys each person's place by their roster name and their stored name", () => {
    const places = standupPlaces(
      [person({ id: "p1", teamMemberId: "m1", name: "Lee", timeZone: "Australia/Sydney" })],
      roster,
      []
    );
    expect(places.get("lee chen")).toEqual({ label: "Sydney", zone: "Australia/Sydney" });
    expect(places.get("lee")).toEqual({ label: "Sydney", zone: "Australia/Sydney" });
  });

  it("labels a place by the office when there is one, and leaves example rows out", () => {
    const places = standupPlaces(
      [
        person({ id: "p1", name: "Ana", timeZone: "Europe/London", site: "London office" }),
        person({ id: "example-p2", name: "Sam", timeZone: "America/New_York" }),
        { id: "bad", name: "Mars", timeZone: "Mars/Base" },
      ],
      [],
      []
    );
    expect(places.get("ana")?.label).toBe("London office");
    expect(places.has("sam")).toBe(false);
    expect(places.has("mars")).toBe(false);
  });

  it("fills the Standup example's people from Team Time's example, and a real row wins", () => {
    const entries = [
      { id: "example-1", member: "Priya (PM)" },
      { id: "example-2", member: "Lee (iOS)" },
      { id: "e3", member: "Sam (QA)" },
      { id: "example-4", member: "Sam (QA)" },
    ];
    const places = standupPlaces(
      [person({ id: "p1", name: "Lee (iOS)", timeZone: "Asia/Tokyo" })],
      [],
      entries
    );
    expect(places.get("priya (pm)")).toEqual({ label: "London office", zone: "Europe/London" });
    expect(places.get("lee (ios)")?.zone).toBe("Asia/Tokyo");
    // Sam posted a real entry too: no example place for him.
    expect(places.has("sam (qa)")).toBe(false);
  });
});
