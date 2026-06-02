/**
 * Regression guard for the MCP CRUD → user_entities `kind` mapping.
 *
 * `defineCrudActions` derives the server-side `kind` from the toolId via
 * `kindFromToolId` (dotted suffix → camelCase). That kind MUST equal the
 * kind the browser sync engine registered the collection under, or the
 * MCP create/list/update/delete operate on an orphaned `kind` the app
 * never reads — writes vanish and list always returns [].
 *
 * `workspace.psych_safety_log` is the one collection where the derivation
 * is wrong: its suffix camelCases to `psychSafetyLog`, but the collection
 * is registered (and the tool.psych_safety.* verbs write) under
 * `workspace:psychSafety`. The registration supplies an explicit
 * `serverKind` override; this test locks that in.
 *
 * server-store is mocked so we can assert the exact `kind` the handlers
 * pass without touching Supabase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual, // keep kindFromToolId + constants real
    serverUpsertEntity: vi.fn(async () => {}),
    serverListEntities: vi.fn(async () => []),
    serverGetEntity: vi.fn(async () => null),
    serverDeleteEntity: vi.fn(async () => {}),
  };
});

import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import { kindFromToolId } from "@/lib/actions/server-store";
import * as serverStore from "@/lib/actions/server-store";
// Side-effect import: registers all workspace.* CRUD actions.
import "@/lib/actions/workspace";

const upsert = vi.mocked(serverStore.serverUpsertEntity);
const list = vi.mocked(serverStore.serverListEntities);
const get = vi.mocked(serverStore.serverGetEntity);
const del = vi.mocked(serverStore.serverDeleteEntity);

const EXPECTED_KIND = "workspace:psychSafety";
const ctx = () => makeContext("user-1", "mcp");

beforeEach(() => {
  upsert.mockClear();
  list.mockClear();
  get.mockClear();
  del.mockClear();
});

describe("define-crud serverKind derivation", () => {
  it("camelCases the dotted toolId suffix by default", () => {
    expect(kindFromToolId("workspace.sprint")).toBe("workspace:sprint");
    expect(kindFromToolId("workspace.tech_debt")).toBe("workspace:techDebt");
    // The derivation that is WRONG for this collection — hence the override.
    expect(kindFromToolId("workspace.psych_safety_log")).toBe("workspace:psychSafetyLog");
  });
});

describe("workspace.psych_safety_log.* MCP handlers use the synced kind", () => {
  it("create writes to workspace:psychSafety (not the derived psychSafetyLog)", async () => {
    const action = registry.resolve("workspace.psych_safety_log.create");
    expect(action?.mcpHandler).toBeDefined();
    await action!.mcpHandler!({ entity: { id: "psychSafety:current", responses: [] } }, ctx());
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toBe(EXPECTED_KIND);
  });

  it("list reads from workspace:psychSafety", async () => {
    const action = registry.resolve("workspace.psych_safety_log.list");
    await action!.mcpHandler!({}, ctx());
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][1]).toBe(EXPECTED_KIND);
  });

  it("update reads + writes workspace:psychSafety", async () => {
    get.mockResolvedValueOnce({ id: "psychSafety:current", responses: [] } as never);
    const action = registry.resolve("workspace.psych_safety_log.update");
    await action!.mcpHandler!({ id: "psychSafety:current", patch: { responses: [] } }, ctx());
    expect(get.mock.calls[0][1]).toBe(EXPECTED_KIND);
    expect(upsert.mock.calls[0][1]).toBe(EXPECTED_KIND);
  });

  it("delete tombstones workspace:psychSafety", async () => {
    const action = registry.resolve("workspace.psych_safety_log.delete");
    await action!.mcpHandler!({ id: "psychSafety:current" }, ctx());
    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][1]).toBe(EXPECTED_KIND);
  });
});

describe("a normal collection still derives its kind (no override regressions)", () => {
  it("workspace.sprint.create writes to workspace:sprint", async () => {
    const action = registry.resolve("workspace.sprint.create");
    await action!.mcpHandler!(
      {
        entity: {
          id: "sprint_x",
          name: "S",
          startDate: "",
          endDate: "",
          pointsPlanned: 0,
          status: "planned",
        },
      },
      ctx()
    );
    expect(upsert.mock.calls[0][1]).toBe("workspace:sprint");
  });
});
