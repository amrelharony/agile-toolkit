/**
 * tool.raci.* coverage (singleton doc, Phase 6).
 *
 *   1. registration — list_state read; writes with MCP handlers; reset confirms.
 *   2. add_role / add_activity — roster people linked, duplicates refused.
 *   3. set_cell — letters normalised as on the page; unknown ids refused.
 *   4. rename / remove_role / remove_activity / reset.
 *   5. list_state — the page's checks (lib/raci/model), on both transports.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RaciMatrix } from "@/lib/stores/workspace-types";
import {
  RACI_ID,
  RACI_KIND,
  RACI_LEGACY_KEY,
  activityIssues,
  loadWarnings,
  normalizeRaci,
  raciVerdict,
} from "@/lib/raci/model";

import "@/lib/actions/tools/raci";

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T>(
  path: "handler" | "mcpHandler",
  verb: string,
  params: Record<string, unknown> = {}
) => {
  const action = registry.get(`tool.raci.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};
const call = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("handler", verb, params);
const callMcp = <T>(verb: string, params: Record<string, unknown> = {}) =>
  run<T>("mcpHandler", verb, params);
const doc = () =>
  normalizeRaci((useWorkspaceStore.getState().raciMatrices ?? []).find((d) => d.id === RACI_ID));

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({
    raciMatrices: [],
    teamMembers: [
      { id: "m1", name: "Ann" },
      { id: "m2", name: "Sam" },
    ],
  });
});

describe("tool.raci — registration", () => {
  it("read/write categories; reset asks for confirmation", () => {
    expect(registry.get("tool.raci.list_state")?.category).toBe("read");
    for (const verb of [
      "add_role",
      "add_activity",
      "set_cell",
      "rename",
      "remove_role",
      "remove_activity",
    ]) {
      const a = registry.get(`tool.raci.${verb}`);
      expect(a?.category, verb).toBe("write");
      expect(a?.mcpHandler, verb).toBeTypeOf("function");
      expect(a?.requiresConfirmation, verb).toBe(false);
    }
    expect(registry.get("tool.raci.reset")?.requiresConfirmation).toBe(true);
  });
});

describe("columns, rows and cells", () => {
  it("links roster people, keeps group roles, refuses duplicates", async () => {
    expect(await call("add_role", { name: "ann" })).toMatchObject({
      added: true,
      name: "Ann",
      memberId: "m1",
    });
    expect(await call("add_role", { name: "x", memberId: "m2" })).toMatchObject({
      name: "Sam",
      memberId: "m2",
    });
    expect(await call("add_role", { name: "Dev Team" })).toMatchObject({
      added: true,
      memberId: null,
    });
    expect(await call("add_role", { name: "DEV TEAM" })).toEqual({
      added: false,
      reason: "duplicate",
    });
    expect(await call("add_role", { name: "Ann" })).toEqual({ added: false, reason: "duplicate" });
    expect(await call("add_role", { name: "x", memberId: "nope" })).toEqual({
      added: false,
      reason: "unknown_member",
    });
    expect(await call("add_activity", { name: "Release" })).toMatchObject({ added: true });
    expect(await call("add_activity", { name: "release" })).toEqual({
      added: false,
      reason: "duplicate",
    });
  });

  it("normalises the letters and reports the activity's remaining issues", async () => {
    const role = await call<{ id: string }>("add_role", { name: "Ann" });
    const act = await call<{ id: string }>("add_activity", { name: "Release" });
    const r = await call<{ letters: string[]; issues: string[] }>("set_cell", {
      activityId: act.id,
      roleId: role.id,
      letters: ["R", "C", "A"],
    });
    expect(r).toEqual({ updated: true, letters: ["A", "R"], issues: [] });
    const c = await call<{ letters: string[]; issues: string[] }>("set_cell", {
      activityId: act.id,
      roleId: role.id,
      letters: ["C"],
    });
    expect(c.letters).toEqual(["C"]);
    expect(c.issues).toHaveLength(2);
    expect(await call("set_cell", { activityId: "x", roleId: role.id, letters: [] })).toEqual({
      updated: false,
      reason: "unknown_activity",
    });
    expect(await call("set_cell", { activityId: act.id, roleId: "x", letters: [] })).toEqual({
      updated: false,
      reason: "unknown_role",
    });
    await call("set_cell", { activityId: act.id, roleId: role.id, letters: [] });
    expect(doc().cells).toEqual({});
  });

  it("renames (a column follows the roster by name), removes and resets", async () => {
    const role = await call<{ id: string }>("add_role", { name: "Ann" });
    const act = await call<{ id: string }>("add_activity", { name: "Release" });
    await call("set_cell", { activityId: act.id, roleId: role.id, letters: ["A"] });
    expect(await call("rename", { kind: "role", id: role.id, name: "Platform team" })).toEqual({
      renamed: true,
      memberId: null,
    });
    expect(doc().roles[0]).toEqual({ id: role.id, name: "Platform team" });
    expect(await call("rename", { kind: "role", id: role.id, name: "sam" })).toEqual({
      renamed: true,
      memberId: "m2",
    });
    expect(await call("rename", { kind: "activity", id: act.id, name: "Ship" })).toEqual({
      renamed: true,
    });
    expect(await call("rename", { kind: "activity", id: "nope", name: "x" })).toEqual({
      renamed: false,
      reason: "not_found",
    });
    expect(await call("remove_role", { id: role.id })).toEqual({ removed: true });
    expect(doc().cells).toEqual({});
    expect(await call("remove_activity", { id: act.id })).toEqual({ removed: true });
    expect(await call("remove_activity", { id: act.id })).toEqual({
      removed: false,
      reason: "not_found",
    });
    await call("add_role", { name: "Ann" });
    expect(await call("reset")).toEqual({ reset: true, roles: 1, activities: 0 });
    expect(doc()).toEqual({ id: RACI_ID, roles: [], activities: [], cells: {} });
  });
});

describe("list_state", () => {
  it("gives the page's checks, on the browser and the server alike", async () => {
    const seedVia = async (c: typeof call) => {
      const a = await c<{ id: string }>("add_role", { name: "Ann" });
      const b = await c<{ id: string }>("add_role", { name: "Dev Team" });
      const ids: string[] = [];
      for (const name of ["One", "Two", "Three", "Four"]) {
        ids.push((await c<{ id: string }>("add_activity", { name })).id);
      }
      for (const id of ids.slice(0, 3)) {
        await c("set_cell", { activityId: id, roleId: a.id, letters: ["A"] });
        await c("set_cell", { activityId: id, roleId: b.id, letters: ["R"] });
      }
      await c("set_cell", { activityId: ids[3], roleId: b.id, letters: ["C"] });
    };
    type Listed = {
      exists: boolean;
      issues: { kind: string }[];
      loadWarnings: { kind: string; count: number; of: number }[];
      verdict: string;
      roles: { name: string; onTeam?: boolean }[];
    };

    await seedVia(call);
    const listed = await call<Listed>("list_state");
    const d = doc();
    expect(listed.issues.map((i) => i.kind)).toEqual(activityIssues(d).map((i) => i.kind));
    expect(listed.loadWarnings).toMatchObject([{ kind: "accountable_load", count: 3, of: 4 }]);
    expect(listed.loadWarnings).toHaveLength(loadWarnings(d).length);
    // The activities the role is Accountable for, as the page names them.
    expect(listed.loadWarnings[0]).toMatchObject({
      activityIds: loadWarnings(d)[0].activityIds,
      message: loadWarnings(d)[0].message,
    });
    expect(listed.verdict).toBe(raciVerdict(d));
    expect(listed.roles[0]).toMatchObject({ name: "Ann", onTeam: true });

    rows.set("workspace:teamMember/m1", { id: "m1", name: "Ann" });
    await seedVia(callMcp);
    const server = await callMcp<Listed>("list_state");
    const stored = normalizeRaci(rows.get(`${RACI_KIND}/${RACI_ID}`) as RaciMatrix);
    expect(server.verdict).toBe(raciVerdict(stored));
    expect(server.issues.map((i) => i.kind)).toEqual(listed.issues.map((i) => i.kind));
  });
});

describe("the old local matrix in this browser", () => {
  const old = (cells: Record<string, Record<string, string>>) =>
    JSON.stringify({
      state: {
        roles: [{ id: "r1", name: "Lead" }],
        activities: [{ id: "a1", name: "Ship" }],
        matrix: cells,
      },
      version: 0,
    });

  beforeEach(() => window.localStorage.clear());

  it("refuses a browser write that would create the matrix before the page moves it in", async () => {
    window.localStorage.setItem(RACI_LEGACY_KEY, old({ a1: { r1: "A" } }));
    await expect(call("add_activity", { name: "Plan" })).rejects.toThrow(
      /hasn't moved into the workspace yet/
    );
    expect(useWorkspaceStore.getState().raciMatrices).toEqual([]);
    // The server writes its own rows: the browser's old store is not its concern.
    expect(await callMcp("add_activity", { name: "Plan" })).toMatchObject({ added: true });
  });

  it("writes once the workspace has a matrix, or when the old store holds nothing to move", async () => {
    window.localStorage.setItem(RACI_LEGACY_KEY, old({}));
    useWorkspaceStore.setState({ raciMatrices: [] });
    // Lead/Ship with nothing assigned is still the team's data: it waits.
    await expect(call("add_activity", { name: "Plan" })).rejects.toThrow();
    window.localStorage.setItem(RACI_LEGACY_KEY, "not json");
    expect(await call("add_activity", { name: "Plan" })).toMatchObject({ added: true });
    window.localStorage.setItem(RACI_LEGACY_KEY, old({ a1: { r1: "A" } }));
    expect(await call("add_activity", { name: "Review" })).toMatchObject({ added: true });
  });
});
