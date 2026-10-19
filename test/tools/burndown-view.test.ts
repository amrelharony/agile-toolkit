import { describe, expect, it } from "vitest";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { scopeAt } from "@/lib/sprints/series";
import { burndownView } from "@/app/(tools)/burndown/view";
import { burnupView } from "@/app/(tools)/burnup/view";
import { scopeFromRise, withBurndownDay } from "@/app/(tools)/burndown/series-writes";

/**
 * The view adapters turn a shared sprint and its daily log into the shapes
 * the charts, Markdown and AI prompts take, keeping what was typed apart from
 * what was worked out from the other tool. And a Burndown scope change keeps
 * Burnup's scope line right.
 */

const NOW = "2026-10-19T09:00:00.000Z";
const sprint: Sprint = {
  id: "s1",
  name: "Sprint 7",
  startDate: "2026-10-05",
  endDate: "2026-10-15",
  pointsPlanned: 40,
  status: "active",
};

describe("burndownView", () => {
  it("maps the sprint to the old config and keeps typed and worked-out numbers apart", () => {
    const series: SprintSeries = {
      id: "s1",
      days: [
        { day: 1, remaining: 36, note: "Kick-off" },
        { day: 2, completed: 10 }, // Burnup's
        { day: 3, scope: 44 }, // Burnup added scope, no reading yet
        { day: 12, remaining: 2 }, // logged before the sprint was shortened
      ],
    };
    const view = burndownView(sprint, series);
    expect(view.config).toEqual({ totalPoints: 40, sprintDays: 10, sprintStartDate: "2026-10-05" });
    // Days 0..10, plus the stored day past the end.
    expect(view.entries.map((e) => e.day)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);

    const [d0, d1, d2, d3] = view.entries;
    expect(d0).toMatchObject({
      remaining: 40,
      typed: null,
      derived: null,
      source: "plan",
      stored: false,
    });
    expect(d1).toMatchObject({
      remaining: 36,
      typed: 36,
      source: "typed",
      description: "Kick-off",
    });
    expect(d2).toMatchObject({ remaining: 30, typed: null, derived: 30, source: "derived" });
    expect(d3).toMatchObject({ remaining: null, source: null, stored: true });
    expect(view.entries[view.entries.length - 1]).toMatchObject({
      day: 12,
      remaining: 2,
      afterEnd: true,
    });
    // Burnup's scope move shows as a scope-change marker.
    expect(view.scopeChangeDays).toEqual([3]);
  });
});

describe("burnupView", () => {
  it("works out points done from Burndown's remaining, against the scope that day", () => {
    const series: SprintSeries = {
      id: "s1",
      days: [
        { day: 2, remaining: 31 },
        { day: 3, remaining: 36, scope: 48, scopeChange: true },
        { day: 4, completed: 20, note: "Demo" },
      ],
    };
    const view = burnupView(sprint, series);
    expect(view.config).toEqual({ sprintDays: 10, sprintStartDate: "2026-10-05" });
    const [d0, , d2, d3, d4, d5] = view.entries;
    expect(d0).toMatchObject({ scope: 40, completed: 0, typedScope: null, scopeInForce: 40 });
    expect(d2).toMatchObject({ completed: 9, typedCompleted: null, derivedCompleted: 9 });
    expect(d3).toMatchObject({ scope: 48, typedScope: 48, completed: 12, derivedCompleted: 12 });
    expect(d4).toMatchObject({ completed: 20, typedCompleted: 20, derivedCompleted: null });
    expect(d4.description).toBe("Demo");
    expect(d5).toMatchObject({ scope: null, scopeInForce: 48, completed: null, stored: false });
  });
});

describe("a Burndown scope change", () => {
  const base: SprintSeries = {
    id: "s1",
    days: [
      { day: 1, remaining: 36 },
      { day: 2, completed: 12 }, // Burnup: remaining works out to 28
    ],
  };

  it("adds the rise in remaining to the scope, so Burnup's scope line rises too", () => {
    let s = withBurndownDay(sprint, base, 3, { remaining: 36 }, NOW);
    expect(s.days?.find((d) => d.day === 3)).toEqual({ day: 3, remaining: 36 });

    s = withBurndownDay(sprint, s, 3, { scopeChange: true }, NOW);
    // Remaining rose 8 (28 → 36) on top of the 40 planned.
    expect(s.days?.find((d) => d.day === 3)).toEqual({
      day: 3,
      remaining: 36,
      scopeChange: true,
      scope: 48,
    });
    expect(scopeAt(sprint, s, 5)).toBe(48);
    expect(burnupView(sprint, s).entries[3].scopeInForce).toBe(48);

    // A new reading on the flagged day moves the scope with it.
    s = withBurndownDay(sprint, s, 3, { remaining: 38 }, NOW);
    expect(s.days?.find((d) => d.day === 3)?.scope).toBe(50);

    // Unflagging takes the scope back off.
    s = withBurndownDay(sprint, s, 3, { scopeChange: false }, NOW);
    expect(s.days?.find((d) => d.day === 3)).toEqual({ day: 3, remaining: 38 });
  });

  it("stores no scope when remaining didn't rise", () => {
    const s = withBurndownDay(sprint, base, 3, { remaining: 25, scopeChange: true }, NOW);
    expect(s.days?.find((d) => d.day === 3)).toEqual({ day: 3, remaining: 25, scopeChange: true });
    expect(scopeFromRise(sprint, s, 3)).toBeNull();
  });

  it("never touches a scope Burnup typed", () => {
    const typed: SprintSeries = {
      id: "s1",
      days: [...(base.days ?? []), { day: 3, remaining: 36, scope: 45 }],
    };
    let s = withBurndownDay(sprint, typed, 3, { scopeChange: true }, NOW);
    expect(s.days?.find((d) => d.day === 3)?.scope).toBe(45);
    s = withBurndownDay(sprint, s, 3, { scopeChange: false }, NOW);
    expect(s.days?.find((d) => d.day === 3)?.scope).toBe(45);
  });
});
