/**
 * The cadence's optional working week and holidays: kept only when set,
 * validated for agents (a bad weekday or date is rejected, not defaulted),
 * round-tripped by tool.ceremony_cadence.set, and honoured by the ceremony
 * dates (no Daily Scrum or refinement on a holiday).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { CEREMONY_CADENCE_ID, type Sprint } from "@/lib/stores/workspace-types";
import {
  DEFAULT_CADENCE,
  cadenceCalendar,
  ceremonyDates,
  normalizeCadence,
  type CeremonyCadence,
} from "@/lib/sprints/cadence";
import { CeremonyCadencePatchSchema, CeremonyCadenceSchema } from "@/lib/sprints/cadence-schema";
import { DEFAULT_CALENDAR } from "@/lib/sprints/calendar";

import "@/lib/actions/tools/ceremony-cadence";
import "@/lib/actions/workspace/index";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

// Monday 19 Oct to Friday 30 Oct 2026.
const SPRINT: Sprint = {
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-10-19",
  endDate: "2026-10-30",
  pointsPlanned: 30,
  status: "active",
};

beforeEach(() => {
  useWorkspaceStore.setState({ ceremonyCadences: [] });
});

describe("normalizeCadence: working week and holidays", () => {
  it("has neither by default, so older documents read and save as before", () => {
    expect("workingDays" in DEFAULT_CADENCE).toBe(false);
    expect("holidays" in normalizeCadence(undefined)).toBe(false);
    expect(cadenceCalendar(DEFAULT_CADENCE)).toEqual(DEFAULT_CALENDAR);
  });

  it("keeps valid values, sorted and unique, and drops the rest", () => {
    const c = normalizeCadence({
      workingDays: [4, 0, 1, 2, 3, 3],
      holidays: ["2026-12-25", "2026-12-24", "2026-12-25", "2026-02-30"],
    });
    expect(c.workingDays).toEqual([0, 1, 2, 3, 4]);
    expect(c.holidays).toEqual(["2026-12-24", "2026-12-25"]);
    expect(cadenceCalendar(c)).toEqual({
      workingDays: [0, 1, 2, 3, 4],
      holidays: ["2026-12-24", "2026-12-25"],
    });
  });

  it("leaves out an empty or wholly invalid list", () => {
    const c = normalizeCadence({ workingDays: [9], holidays: [] });
    expect("workingDays" in c).toBe(false);
    expect("holidays" in c).toBe(false);
  });
});

describe("ceremonyDates on holidays", () => {
  it("skips the Daily Scrum and refinement on a holiday", () => {
    const cadence: CeremonyCadence = { ...DEFAULT_CADENCE, holidays: ["2026-10-21"] }; // a Wednesday
    const all = ceremonyDates(SPRINT, cadence);
    expect(all.filter((o) => o.kind === "daily")).toHaveLength(8);
    expect(all.filter((o) => o.kind === "refinement")).toHaveLength(1);
    expect(all.some((o) => o.at.getDate() === 21 && o.kind === "daily")).toBe(false);
  });
});

describe("schemas", () => {
  const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
    schema.safeParse(v).success;

  it("accepts a working week and holidays, and a cadence without them", () => {
    expect(accepts(CeremonyCadenceSchema, DEFAULT_CADENCE)).toBe(true);
    expect(
      accepts(CeremonyCadenceSchema, {
        ...DEFAULT_CADENCE,
        workingDays: [0, 1, 2, 3, 4],
        holidays: ["2026-12-25"],
      })
    ).toBe(true);
    expect(accepts(CeremonyCadencePatchSchema, { holidays: [] })).toBe(true);
  });

  it("rejects no working days, bad weekdays and dates that aren't real", () => {
    expect(accepts(CeremonyCadencePatchSchema, { workingDays: [] })).toBe(false);
    expect(accepts(CeremonyCadencePatchSchema, { workingDays: [1, 7] })).toBe(false);
    expect(accepts(CeremonyCadencePatchSchema, { holidays: ["2026-02-30"] })).toBe(false);
    expect(accepts(CeremonyCadencePatchSchema, { holidays: ["25/12/2026"] })).toBe(false);
    expect(accepts(CeremonyCadencePatchSchema, { holidays: ["2026-12-25T00:00"] })).toBe(false);
  });
});

describe("tool.ceremony_cadence: working week and holidays", () => {
  const set = () => registry.get("tool.ceremony_cadence.set")!;
  const get = () => registry.get("tool.ceremony_cadence.get")!;

  it("sets them, keeps the other fields, and [] clears the holidays", async () => {
    await set().handler({ dailyTime: "08:45" }, ctx());
    const written = (await set().handler(
      { workingDays: [1, 2, 3, 4], holidays: ["2026-12-25", "2026-12-24"] },
      ctx()
    )) as { cadence: CeremonyCadence };
    expect(written.cadence).toMatchObject({
      dailyTime: "08:45",
      workingDays: [1, 2, 3, 4],
      holidays: ["2026-12-24", "2026-12-25"],
    });
    const doc = useWorkspaceStore
      .getState()
      .ceremonyCadences?.find((d) => d.id === CEREMONY_CADENCE_ID);
    expect(doc?.holidays).toEqual(["2026-12-24", "2026-12-25"]);

    await set().handler({ holidays: [] }, ctx());
    const read = (await get().handler({}, ctx())) as { cadence: CeremonyCadence };
    expect(read.cadence.holidays).toBeUndefined();
    expect(read.cadence.workingDays).toEqual([1, 2, 3, 4]);
  });

  it("workspace.ceremony_cadence.update keeps them through a patch", async () => {
    await set().handler({ holidays: ["2026-12-25"] }, ctx());
    await registry
      .get("workspace.ceremony_cadence.update")!
      .handler({ id: CEREMONY_CADENCE_ID, patch: { dailyTime: "10:15" } }, ctx());
    const doc = useWorkspaceStore
      .getState()
      .ceremonyCadences?.find((d) => d.id === CEREMONY_CADENCE_ID);
    expect(doc).toMatchObject({ dailyTime: "10:15", holidays: ["2026-12-25"] });
  });
});
