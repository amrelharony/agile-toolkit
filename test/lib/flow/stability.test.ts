/**
 * lib/flow/stability: who was in each finished sprint against the one
 * before, from both sprints' own capacity plans, else from the story owners
 * (rough); a joiner and a leaver; no own plans.
 */

import { describe, expect, it } from "vitest";
import type { CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { capacityPlanIdFor, CAPACITY_PLAN_ID } from "@/lib/sprints/capacity";
import { changedRecently, finishedSprints, teamStability } from "@/lib/flow/stability";
import { addDays } from "@/lib/flow";
import { local, sprint, story } from "./fixtures";

const sprintN = (n: number, patch: Partial<Sprint> = {}): Sprint => {
  const start = addDays("2026-03-02", (n - 1) * 14) as string;
  return sprint({
    id: `s${n}`,
    name: `Sprint ${n}`,
    startDate: start,
    endDate: addDays(start, 11) as string,
    status: "completed",
    pointsCompleted: 10 * n,
    ...patch,
  });
};

const plan = (sprintId: string | null, people: [string, string?][]): CapacityPlan => ({
  id: sprintId ? capacityPlanIdFor(sprintId) : CAPACITY_PLAN_ID,
  ...(sprintId ? { sprintId } : {}),
  members: people.map(([name, teamMemberId], i) => ({
    id: `m${i}-${name}`,
    name,
    role: "Dev",
    availability: 100,
    daysOff: 0,
    ...(teamMemberId ? { teamMemberId } : {}),
  })),
  config: {
    sprintDays: 10,
    ceremonyOverhead: 10,
    focusFactor: 0.8,
    hoursPerDay: 6,
    pointsCommitted: "",
  },
});

const owned = (id: string, sprintId: string, owner: string): Story =>
  story(id, { sprintId, owner, status: "done", doneAt: local("2026-03-05") });

describe("team stability", () => {
  it("compares the sprints' own capacity plans, matching by roster id, else by name", () => {
    const sprints = [sprintN(1), sprintN(2), sprintN(3)];
    const plans = [
      plan("s1", [["Ana", "tm1"], ["Ben", "tm2"], ["Cy"]]),
      plan("s2", [["Ana Lima", "tm1"], ["Ben", "tm2"], ["cy "]]),
      plan("s3", [["Ana", "tm1"], ["Dee", "tm4"], ["Cy"]]),
    ];
    const { rows, lastChange } = teamStability(sprints, plans, []);
    expect(rows[0]).toMatchObject({
      people: 3,
      pct: null,
      joined: [],
      left: [],
      source: "capacity",
    });
    expect(rows[1]).toMatchObject({ people: 3, stayed: 3, joined: [], left: [], pct: 100 });
    expect(rows[2]).toMatchObject({
      people: 3,
      stayed: 2,
      joined: ["Dee"],
      left: ["Ben"],
      pct: 50,
      source: "capacity",
      rough: false,
      pointsCompleted: 30,
    });
    expect(lastChange?.sprintId).toBe("s3");
    expect(changedRecently({ rows, lastChange })).toBe(true);
  });

  it("falls back to the story owners, marked rough, when a sprint has no plan of its own", () => {
    const sprints = [sprintN(1), sprintN(2)];
    const plans = [plan("s1", [["Ana"], ["Ben"]]), plan(null, [["Ana"], ["Ben"], ["Cy"]])];
    const stories = [
      owned("a", "s1", "Ana"),
      owned("b", "s1", "Ben"),
      owned("c", "s2", "Ana"),
      owned("d", "s2", "Eve"),
    ];
    const { rows } = teamStability(sprints, plans, stories);
    expect(rows[1]).toMatchObject({
      source: "owners",
      rough: true,
      joined: ["Eve"],
      left: ["Ben"],
      stayed: 1,
      pct: 33,
    });
  });

  it("reads a sprint plan that names nobody as no plan, not as everyone leaving", () => {
    const sprints = [sprintN(1), sprintN(2)];
    const plans = [plan("s1", [["Ana"], ["Ben"], ["Cy"], ["Dee"], ["Eve"]]), plan("s2", [])];
    // With owners on both sides, the pair falls back to them.
    const stories = [owned("a", "s1", "Ana"), owned("b", "s2", "Ana")];
    const { rows, lastChange } = teamStability(sprints, plans, stories);
    expect(rows[1]).toMatchObject({
      source: "owners",
      people: 1,
      stayed: 1,
      joined: [],
      left: [],
      pct: 100,
    });
    expect(lastChange).toBeNull();
    // With nobody owning a story either, the pair isn't compared.
    const none = teamStability(sprints, plans, []);
    expect(none.rows[1]).toMatchObject({ people: 0, left: [], pct: null });
    expect(none.lastChange).toBeNull();
  });

  it("compares nothing when one sprint's stories name nobody", () => {
    const sprints = [sprintN(1), sprintN(2)];
    const stories = [owned("a", "s2", "Ana")];
    const { rows, lastChange } = teamStability(sprints, [], stories);
    expect(rows[1]).toMatchObject({ people: 1, joined: [], left: [], pct: null });
    expect(lastChange).toBeNull();
  });

  it("reads only finished sprints, oldest first, without examples", () => {
    const sprints = [
      sprintN(2),
      sprintN(1),
      sprintN(3, { status: "active" }),
      sprintN(4, { id: "example-s4" }),
    ];
    expect(finishedSprints(sprints).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(finishedSprints(sprints, true).map((s) => s.id)).toEqual(["s1", "s2", "example-s4"]);
  });
});
