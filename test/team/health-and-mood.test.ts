/**
 * The shared health-check score (lib/health-check/score) and the team's
 * mood over a window (lib/team/mood).
 */

import { describe, expect, it } from "vitest";
import type { HealthCheck, MoodEntry, Sprint } from "@/lib/stores/workspace-types";
import {
  LIGHT_VALUE,
  QUALITY_DIMENSIONS,
  healthCheckFor,
  healthShare,
  latestSavedCheck,
} from "@/lib/health-check/score";
import { moodDuring } from "@/lib/team/mood";

const sprint = (id: string, name: string, start: string, end: string): Sprint => ({
  id,
  name,
  startDate: start,
  endDate: end,
  pointsPlanned: 10,
  status: "completed",
  pointsCompleted: 10,
});

describe("healthShare", () => {
  it("counts yellow as half and leaves unscored dimensions out", () => {
    expect(LIGHT_VALUE).toEqual({ green: 1, yellow: 0.5, red: 0 });
    expect(
      healthShare({
        "Health of Codebase": { light: "green", trend: "same" },
        "Easy to Release": { light: "yellow", trend: "down" },
        Fun: { light: "red", trend: "same" },
      })
    ).toBeCloseTo(0.5);
    expect(
      healthShare(
        {
          "Health of Codebase": { light: "green", trend: "same" },
          "Easy to Release": { light: "yellow", trend: "down" },
        },
        QUALITY_DIMENSIONS
      )
    ).toBeCloseTo(0.75);
    expect(healthShare(undefined)).toBeNull();
  });
});

describe("saved checks", () => {
  const entry = (id: string, sprintName: string, date: string) => ({
    id,
    sprintName,
    date,
    scores: {} as HealthCheck["history"][number]["scores"],
  });
  const doc: HealthCheck = {
    id: "healthCheck:current",
    current: { sprintName: "Draft", scores: {} as HealthCheck["current"]["scores"] },
    history: [
      entry("h1", "Sprint 1", "2026-10-02"),
      entry("h2", " sprint 2 ", "2026-10-16"),
      entry("h3", "", "2026-10-27"),
      entry("example-h", "Sprint 3", "2026-10-30"),
    ],
  };
  const sprints = [
    sprint("s1", "Sprint 1", "2026-09-21", "2026-10-02"),
    sprint("s2", "Sprint 2", "2026-10-05", "2026-10-16"),
    sprint("s3", "Sprint 3", "2026-10-19", "2026-10-30"),
  ];

  it("finds the newest saved check, never the draft or an example", () => {
    expect(latestSavedCheck(doc)?.id).toBe("h3");
    expect(latestSavedCheck(undefined)).toBeNull();
  });

  it("matches a sprint by name, else by the retro window of the day it was taken", () => {
    expect(healthCheckFor(doc, sprints[1], sprints)?.id).toBe("h2");
    expect(healthCheckFor(doc, sprints[2], sprints)?.id).toBe("h3");
    expect(
      healthCheckFor(doc, sprint("s9", "Sprint 9", "2027-01-01", "2027-01-12"), sprints)
    ).toBeUndefined();
  });
});

describe("moodDuring", () => {
  const mood = (
    id: string,
    memberId: string,
    date: string,
    score: MoodEntry["score"],
    over: Partial<MoodEntry> = {}
  ): MoodEntry => ({
    id,
    memberId,
    date,
    score,
    ...over,
  });

  it("averages the window's check-ins from MIN_SAMPLE.average, without placeholders or examples", () => {
    const entries = [
      mood("m1", "a", "2026-10-05", 4),
      mood("m2", "b", "2026-10-06", 2),
      mood("m3", "a", "2026-10-07", 3),
      mood("m4", "c", "2026-10-08", 5, { isPlaceholder: true }),
      mood("example-m", "d", "2026-10-08", 1),
      mood("m5", "a", "2026-11-01", 1),
    ];
    expect(moodDuring(entries, "2026-10-05", "2026-10-16")).toEqual({
      average: 3,
      checkIns: 3,
      people: 2,
    });
    expect(moodDuring(entries.slice(0, 2), "2026-10-05", "2026-10-16")).toEqual({
      average: null,
      checkIns: 2,
      people: 2,
    });
  });
});
