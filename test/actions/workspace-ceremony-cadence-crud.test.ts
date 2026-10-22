/**
 * workspace.ceremony_cadence.* CRUD coverage: the singleton document agents
 * see, its server kind matching the synced collection, and a schema that
 * rejects what `normalizeCadence` would otherwise silently default.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { kindFromToolId } from "@/lib/actions/server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { CEREMONY_CADENCE_ID, type CeremonyCadenceDoc } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

import "@/lib/actions/workspace/index";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

const DOC: CeremonyCadenceDoc = { id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE };

const create = () => registry.get("workspace.ceremony_cadence.create")!;
const list = () => registry.get("workspace.ceremony_cadence.list")!;
const update = () => registry.get("workspace.ceremony_cadence.update")!;
const del = () => registry.get("workspace.ceremony_cadence.delete")!;

const accepts = (entity: unknown) =>
  (create().paramsSchema as { safeParse: (v: unknown) => { success: boolean } }).safeParse({
    entity,
  }).success;

beforeEach(() => {
  useWorkspaceStore.setState({ ceremonyCadences: [] });
});

describe("workspace.ceremony_cadence — registration", () => {
  it("registers the four verbs under the synced kind", () => {
    for (const a of [create, list, update, del]) expect(a()).toBeDefined();
    // registerCollection("ceremonyCadence", "ceremonyCadences") in workspace-store.ts.
    expect(kindFromToolId("workspace.ceremony_cadence")).toBe("workspace:ceremonyCadence");
  });

  it("accepts a whole cadence under the singleton id and rejects bad times, weekdays and lengths", () => {
    expect(accepts(DOC)).toBe(true);
    expect(accepts({ ...DOC, refinement: null })).toBe(true);
    expect(accepts({ ...DOC, id: "ceremony-cadence:other" })).toBe(false);
    expect(accepts({ ...DEFAULT_CADENCE })).toBe(false); // no id: the singleton id is required
    expect(accepts({ ...DOC, dailyTime: "25:00" })).toBe(false);
    expect(accepts({ ...DOC, planningTime: "10:60" })).toBe(false);
    expect(accepts({ ...DOC, dailyWeekdays: [1, 7] })).toBe(false);
    expect(accepts({ ...DOC, dailyWeekdays: [] })).toBe(false);
    expect(accepts({ ...DOC, sprintLengthDays: 0 })).toBe(false);
    expect(accepts({ ...DOC, sprintLengthDays: 61 })).toBe(false);
    expect(accepts({ ...DOC, sprintLengthDays: 10.5 })).toBe(false);
    expect(accepts({ ...DOC, refinement: { weekday: 3 } })).toBe(false);
  });
});

describe("workspace.ceremony_cadence — browser path", () => {
  it("creates, lists, updates and deletes the one document", async () => {
    expect(await create().handler({ entity: DOC }, ctx())).toEqual({ id: CEREMONY_CADENCE_ID });
    expect(await list().handler({}, ctx())).toEqual({ items: [DOC] });
    await expect(create().handler({ entity: DOC }, ctx())).rejects.toThrow(/already exists/);

    expect(
      await update().handler({ id: CEREMONY_CADENCE_ID, patch: { dailyTime: "08:45" } }, ctx())
    ).toEqual({ updated: true });
    expect(useWorkspaceStore.getState().ceremonyCadences).toEqual([{ ...DOC, dailyTime: "08:45" }]);

    // A patch that would need a default is an error, and nothing changes.
    await expect(
      update().handler({ id: CEREMONY_CADENCE_ID, patch: { dailyWeekdays: [9] } }, ctx())
    ).rejects.toThrow(/invalid ceremony cadence/);
    expect(useWorkspaceStore.getState().ceremonyCadences).toEqual([{ ...DOC, dailyTime: "08:45" }]);

    expect(await del().handler({ id: CEREMONY_CADENCE_ID }, ctx())).toEqual({ deleted: true });
    expect(await list().handler({}, ctx())).toEqual({ items: [] });
  });
});
