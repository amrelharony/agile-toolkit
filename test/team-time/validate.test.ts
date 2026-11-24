/**
 * What Team Time checks before it saves: a person (a known zone, stored
 * canonical; distinct hours; working days; office days among them; one row
 * per person; the caps), a poll (15–480 minutes, 1–20 different times,
 * "in the future" only for the times being added) and a rotation (2–4
 * different times, each with a known zone, every 1–4 weeks, a real start).
 */

import { describe, expect, it } from "vitest";
import {
  validatePerson,
  validatePoll,
  validateRotation,
  type PersonDraft,
} from "@/lib/team-time/validate";
import { TEAM_TIME_MAX, TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import { canonicalZone } from "@/lib/team-time/zones";
import { person, t } from "./fixtures";

const draft = (over: Partial<PersonDraft> = {}): PersonDraft => ({
  name: "Lee",
  timeZone: "asia/tokyo",
  start: "09:00",
  end: "17:00",
  workingDays: [5, 1, 2, 3, 4, 1],
  officeDays: [],
  site: "",
  note: "",
  ...over,
});

describe("validatePerson", () => {
  it("accepts a person, with the zone canonical and the days in order", () => {
    const r = validatePerson(draft({ officeDays: [3], site: " Tokyo office " }));
    expect(r).toEqual({
      ok: true,
      values: {
        name: "Lee",
        timeZone: canonicalZone("Asia/Tokyo"),
        start: "09:00",
        end: "17:00",
        workingDays: [1, 2, 3, 4, 5],
        officeDays: [3],
        site: "Tokyo office",
      },
    });
  });

  it("accepts a night shift that ends before it starts", () => {
    expect(validatePerson(draft({ start: "22:00", end: "06:00" })).ok).toBe(true);
  });

  it.each([
    ["no name", { name: " " }, "name"],
    ["an unknown zone", { timeZone: "Mars/Base" }, "timeZone"],
    ["no zone", { timeZone: "" }, "timeZone"],
    ["a bad start", { start: "9am" }, "start"],
    ["a bad end", { end: "25:00" }, "end"],
    ["a day that ends when it starts", { end: "09:00" }, "end"],
    ["no working day", { workingDays: [] }, "workingDays"],
    ["an office day off", { officeDays: [6] }, "officeDays"],
    ["a long name", { name: "x".repeat(TOOL_TEXT_MAX.short + 1) }, "name"],
    ["a long office", { site: "x".repeat(TEAM_TIME_MAX.site + 1) }, "site"],
    ["a long note", { note: "x".repeat(TOOL_TEXT_MAX.text + 1) }, "note"],
  ] as const)("refuses %s", (_label, over, field) => {
    const r = validatePerson(draft(over as Partial<PersonDraft>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field as keyof typeof r.errors]).toBeTruthy();
  });

  it("allows one row per person", () => {
    const saved = [
      person({ id: "p1", name: "lee" }),
      person({ id: "p2", name: "Ana", teamMemberId: "m2" }),
    ];
    expect(validatePerson(draft(), saved).ok).toBe(false);
    expect(validatePerson(draft({ name: "Ana B", teamMemberId: "m2" }), saved).ok).toBe(false);
    expect(validatePerson(draft({ name: "Sam" }), saved).ok).toBe(true);
  });

  it("keeps to the people cap", () => {
    const full = Array.from({ length: TEAM_TIME_MAX.people }, (_, i) => person({ id: `p${i}` }));
    const r = validatePerson(draft({ name: "One more" }), full);
    expect(r.ok).toBe(false);
  });
});

describe("validatePoll", () => {
  const now = t("2026-11-16T12:00:00Z");
  const future = ["2026-11-18T15:00:00Z", "2026-11-17T15:00:00Z"];

  it("accepts a poll, its times sorted", () => {
    expect(
      validatePoll({ title: " Review ", minutes: "60", starts: future }, { now, added: future })
    ).toEqual({
      ok: true,
      values: {
        title: "Review",
        minutes: 60,
        starts: ["2026-11-17T15:00:00.000Z", "2026-11-18T15:00:00.000Z"],
      },
    });
  });

  it.each([
    ["no title", { title: "" }, "title"],
    ["too short", { minutes: 10 }, "minutes"],
    ["too long", { minutes: 481 }, "minutes"],
    ["blank minutes", { minutes: "" }, "minutes"],
    ["no times", { starts: [] }, "slots"],
    ["a repeated time", { starts: ["2026-11-17T15:00:00Z", "2026-11-17T15:00:00.000Z"] }, "slots"],
    ["a bad time", { starts: ["soon"] }, "slots"],
    [
      "too many times",
      {
        starts: Array.from(
          { length: 21 },
          (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}T10:00:00Z`
        ),
      },
      "slots",
    ],
  ] as const)("refuses %s", (_label, over, field) => {
    const r = validatePoll({ title: "Review", minutes: 60, starts: future, ...over }, { now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field as keyof typeof r.errors]).toBeTruthy();
  });

  it("asks for the future only of the times being added", () => {
    const past = ["2026-11-10T15:00:00Z"];
    expect(validatePoll({ title: "R", minutes: 60, starts: past }, { now, added: past }).ok).toBe(
      false
    );
    // Answering or choosing on a poll whose times have passed still checks out.
    expect(validatePoll({ title: "R", minutes: 60, starts: past }, { now }).ok).toBe(true);
  });
});

describe("validateRotation", () => {
  const options = [
    { label: "Europe morning", weekday: 2, time: "09:00", timeZone: "europe/london" },
    { label: "", weekday: 2, time: "15:00", timeZone: "America/New_York" },
  ];
  const ok = {
    meeting: "Retro",
    minutes: 60,
    everyWeeks: 2,
    startDate: "2026-11-16",
    mode: "in-turn",
    options,
  };

  it("accepts a rotation, the zones canonical", () => {
    const r = validateRotation(ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.values.options[0].timeZone).toBe(canonicalZone("Europe/London"));
  });

  it.each([
    ["no meeting", { meeting: "" }, "meeting"],
    ["a bad length", { minutes: 5 }, "minutes"],
    ["every 5 weeks", { everyWeeks: 5 }, "everyWeeks"],
    ["a bad start date", { startDate: "2026-02-30" }, "startDate"],
    ["a bad mode", { mode: "random" }, "mode"],
    ["one time", { options: options.slice(0, 1) }, "options"],
    [
      "five times",
      { options: [...options, ...options, options[0]].map((o, i) => ({ ...o, weekday: i % 7 })) },
      "options",
    ],
    [
      "the same time twice",
      { options: [options[0], { ...options[0], timeZone: "Europe/London" }] },
      "options",
    ],
    [
      "an unknown zone",
      { options: [options[0], { ...options[1], timeZone: "Mars/Base" }] },
      "options",
    ],
    ["a bad time", { options: [options[0], { ...options[1], time: "3pm" }] }, "options"],
    [
      "too many attendees",
      { attendees: Array.from({ length: 51 }, (_, i) => `p${i}`) },
      "attendees",
    ],
    ["nobody attending", { attendees: [] }, "attendees"],
  ] as const)("refuses %s", (_label, over, field) => {
    const r = validateRotation({ ...ok, ...over } as typeof ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field as keyof typeof r.errors]).toBeTruthy();
  });
});
