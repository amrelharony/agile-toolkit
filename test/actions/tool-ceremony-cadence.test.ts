/**
 * tool.ceremony_cadence.* coverage.
 *
 *   1. registration — get read; set write without confirmation, with an
 *      MCP handler.
 *   2. get + set round-trip on the browser path (workspace store) and on the
 *      MCP path (server store, mocked in memory), the document landing under
 *      the synced kind and the singleton id.
 *   3. set validates: a bad time or weekday is rejected, not defaulted;
 *      duplicates and order are normalised.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { CEREMONY_CADENCE_ID } from "@/lib/stores/workspace-types";
import { DEFAULT_CADENCE, type CeremonyCadence } from "@/lib/sprints/cadence";

import "@/lib/actions/tools/ceremony-cadence";

const KIND = "workspace:ceremonyCadence";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

type Reading = { exists: boolean; cadence: CeremonyCadence };
type Written = Reading & { updated: boolean };

const get = () => registry.get("tool.ceremony_cadence.get")!;
const set = () => registry.get("tool.ceremony_cadence.set")!;

beforeEach(() => {
  rows.clear();
  vi.mocked(serverStore.serverUpsertEntity).mockClear();
  useWorkspaceStore.setState({ ceremonyCadences: [] });
});

describe("tool.ceremony_cadence — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(get().category).toBe("read");
    expect(set().category).toBe("write");
    expect(set().requiresConfirmation).toBe(false);
    expect(get().mcpHandler).toBeTypeOf("function");
    expect(set().mcpHandler).toBeTypeOf("function");
  });

  it("rejects a bad time or weekday instead of defaulting it", () => {
    const schema = set().paramsSchema as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ dailyTime: "08:45", refinement: null }).success).toBe(true);
    expect(schema.safeParse({ dailyTime: "25:00" }).success).toBe(false);
    expect(schema.safeParse({ dailyTime: "9:30" }).success).toBe(false);
    expect(schema.safeParse({ dailyWeekdays: [7] }).success).toBe(false);
    expect(schema.safeParse({ dailyWeekdays: [] }).success).toBe(false);
    expect(schema.safeParse({ sprintLengthDays: 0 }).success).toBe(false);
    expect(schema.safeParse({ sprintLengthDays: 61 }).success).toBe(false);
    expect(schema.safeParse({ refinement: { weekday: 3 } }).success).toBe(false);
  });
});

describe("tool.ceremony_cadence — browser path", () => {
  it("reads the defaults while unset, then what set wrote, normalised", async () => {
    expect(await get().handler({}, ctx())).toEqual({ exists: false, cadence: DEFAULT_CADENCE });

    const written = (await set().handler(
      { dailyTime: "08:45", dailyWeekdays: [5, 1, 1] },
      ctx()
    )) as Written;
    expect(written).toEqual({
      updated: true,
      exists: true,
      cadence: { ...DEFAULT_CADENCE, dailyTime: "08:45", dailyWeekdays: [1, 5] },
    });
    expect(useWorkspaceStore.getState().ceremonyCadences).toEqual([
      { id: CEREMONY_CADENCE_ID, ...DEFAULT_CADENCE, dailyTime: "08:45", dailyWeekdays: [1, 5] },
    ]);

    // A later patch keeps the earlier fields.
    await set().handler({ refinement: null, sprintLengthDays: 7 }, ctx());
    expect(await get().handler({}, ctx())).toEqual({
      exists: true,
      cadence: {
        ...DEFAULT_CADENCE,
        dailyTime: "08:45",
        dailyWeekdays: [1, 5],
        refinement: null,
        sprintLengthDays: 7,
      },
    });
  });
});

describe("tool.ceremony_cadence — MCP path", () => {
  it("round-trips through the server store under the synced kind and singleton id", async () => {
    expect(await get().mcpHandler!({}, ctx())).toEqual({
      exists: false,
      cadence: DEFAULT_CADENCE,
    });

    const written = (await set().mcpHandler!(
      { reviewTime: "16:00", refinement: { weekday: 2, time: "09:00" } },
      ctx()
    )) as Written;
    expect(written.cadence).toEqual({
      ...DEFAULT_CADENCE,
      reviewTime: "16:00",
      refinement: { weekday: 2, time: "09:00" },
    });
    const upsert = vi.mocked(serverStore.serverUpsertEntity);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toBe(KIND);
    expect(upsert.mock.calls[0][2]).toMatchObject({ id: CEREMONY_CADENCE_ID, reviewTime: "16:00" });

    await set().mcpHandler!({ retroTime: "17:00" }, ctx());
    expect(await get().mcpHandler!({}, ctx())).toEqual({
      exists: true,
      cadence: {
        ...DEFAULT_CADENCE,
        reviewTime: "16:00",
        retroTime: "17:00",
        refinement: { weekday: 2, time: "09:00" },
      },
    });
    // The browser store was never touched by the server path.
    expect(useWorkspaceStore.getState().ceremonyCadences).toEqual([]);
  });
});
