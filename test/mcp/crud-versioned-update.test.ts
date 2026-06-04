/**
 * Regression guard for the MCP CRUD `update` write path.
 *
 * `workspace.model` (ModelEntry) carries a monotonic `version` and is
 * edited by both the browser (version-guarded `upsertModel`) and agents
 * (`tool.model_registry.*`, which writes via `serverVersionedUpdate`). The
 * generic `workspace.model.update` MUST use the same compare-and-set, or a
 * stale blind read-modify-write silently clobbers a concurrent field change
 * in the DB (lost update). It opts in via `versioned: true`.
 *
 * Collections WITHOUT a version field (e.g. `workspace.sprint`) keep the
 * blind read → merge → upsert path.
 *
 * server-store is mocked so we can assert which write primitive each
 * update handler reaches for, without touching Supabase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual, // keep kindFromToolId + constants real
    serverGetEntity: vi.fn(async () => null),
    serverUpsertEntity: vi.fn(async () => {}),
    serverVersionedUpdate: vi.fn(async () => null),
  };
});

import { registry } from "@/lib/actions/registry";
import { makeContext } from "@/lib/actions/context";
import * as serverStore from "@/lib/actions/server-store";
// Side-effect import: registers all workspace.* CRUD actions.
import "@/lib/actions/workspace";

const get = vi.mocked(serverStore.serverGetEntity);
const upsert = vi.mocked(serverStore.serverUpsertEntity);
const versioned = vi.mocked(serverStore.serverVersionedUpdate);

const ctx = () => makeContext("user-1", "mcp");

beforeEach(() => {
  get.mockReset();
  upsert.mockReset();
  versioned.mockReset();
  get.mockResolvedValue(null);
  upsert.mockResolvedValue();
  versioned.mockResolvedValue(null);
});

describe("workspace.model.update — optimistic concurrency (versioned)", () => {
  it("routes through serverVersionedUpdate, not a blind get+upsert", async () => {
    // Make the CAS apply the mutate against a real base + return a row so the
    // handler reports updated:true (and we exercise the patch validation).
    versioned.mockImplementation(
      async (_u, _k, _id, mutate) =>
        (mutate as (c: unknown) => unknown)({
          id: "m1",
          name: "claude",
          vendor: "anthropic",
          status: "experimental",
          version: 1,
        }) as never
    );

    const action = registry.resolve("workspace.model.update");
    const res = (await action!.mcpHandler!(
      { id: "m1", patch: { status: "production" } },
      ctx()
    )) as { updated: boolean };

    expect(res.updated).toBe(true);
    expect(versioned).toHaveBeenCalledTimes(1);
    expect(versioned.mock.calls[0][1]).toBe("workspace:model"); // kind
    expect(versioned.mock.calls[0][2]).toBe("m1"); // id
    // Blind write primitives are NOT used on the versioned path.
    expect(get).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports updated:false when the row is missing (CAS returns null)", async () => {
    versioned.mockResolvedValue(null);
    const action = registry.resolve("workspace.model.update");
    const res = (await action!.mcpHandler!(
      { id: "ghost", patch: { status: "production" } },
      ctx()
    )) as { updated: boolean };
    expect(res.updated).toBe(false);
  });
});

describe("workspace.*.create — duplicate explicit-id guard", () => {
  const sprint = (over: Record<string, unknown> = {}) => ({
    name: "Sprint",
    startDate: "2026-01-01",
    endDate: "2026-01-14",
    pointsPlanned: 10,
    status: "planned",
    ...over,
  });

  it("rejects an explicit id that already exists (never overwrites)", async () => {
    get.mockResolvedValueOnce({ id: "s1", ...sprint() } as never);
    const action = registry.resolve("workspace.sprint.create");
    await expect(
      action!.mcpHandler!({ entity: sprint({ id: "s1" }) } as never, ctx())
    ).rejects.toThrow(/already exists/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows an explicit id that is free", async () => {
    get.mockResolvedValue(null);
    const action = registry.resolve("workspace.sprint.create");
    const res = (await action!.mcpHandler!({ entity: sprint({ id: "s2" }) } as never, ctx())) as {
      id: string;
    };
    expect(res.id).toBe("s2");
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("auto-generates an id with NO existence probe (single write)", async () => {
    const action = registry.resolve("workspace.sprint.create");
    const res = (await action!.mcpHandler!({ entity: sprint() } as never, ctx())) as { id: string };
    expect(res.id).toMatch(/^sprint_/);
    expect(get).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe("workspace.sprint.update — blind write (not versioned)", () => {
  it("uses serverGetEntity + serverUpsertEntity, never serverVersionedUpdate", async () => {
    get.mockResolvedValueOnce({
      id: "s1",
      name: "Sprint 1",
      startDate: "2026-01-01",
      endDate: "2026-01-14",
      pointsPlanned: 10,
      status: "planned",
    } as never);

    const action = registry.resolve("workspace.sprint.update");
    const res = (await action!.mcpHandler!({ id: "s1", patch: { pointsPlanned: 20 } }, ctx())) as {
      updated: boolean;
    };

    expect(res.updated).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).toBe("workspace:sprint");
    expect((upsert.mock.calls[0][2] as unknown as { pointsPlanned: number }).pointsPlanned).toBe(
      20
    );
    expect(versioned).not.toHaveBeenCalled();
  });
});
