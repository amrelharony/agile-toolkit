/**
 * tool.feature_flag_tracker.* coverage (workspace.featureFlags collection).
 *
 *   1. registration — list_state read; every write verb a write with an mcpHandler.
 *   2. add_flag — name and purpose required; createdAt backdatable, never the future.
 *   3. update_flag — edits in place; null clears; dates checked.
 *   4. set_status / retire_flag — on/off, retired on a day, brought back.
 *   5. remove_flag; list_state equals flagSummary.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { FeatureFlag } from "@/lib/stores/workspace-types";
import { RELEASE_DOC_ID } from "@/lib/releases/gates";
import { flagSummary } from "@/lib/flags/model";
import { addDays } from "@/lib/flow/days";
import { todayIso } from "@/lib/sprints/series";

import "@/lib/actions/tools/feature-flag-tracker";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const TODAY = todayIso();
const on = (n: number) => addDays(TODAY, n) as string;
const run = <T>(verb: string, params: Record<string, unknown>) =>
  registry.get(`tool.feature_flag_tracker.${verb}`)!.handler(params, ctx()) as Promise<T>;
const flags = () => useWorkspaceStore.getState().featureFlags ?? [];
const one = (id: string) => flags().find((f) => f.id === id) as FeatureFlag;

beforeEach(() => useWorkspaceStore.setState({ featureFlags: [], releaseReadinesses: [] }));

describe("tool.feature_flag_tracker — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.feature_flag_tracker.list_state")?.category).toBe("read");
    for (const verb of ["add_flag", "update_flag", "set_status", "retire_flag", "remove_flag"]) {
      const a = registry.get(`tool.feature_flag_tracker.${verb}`);
      expect(a?.category, verb).toBe("write");
      expect(a?.mcpHandler, verb).toBeTypeOf("function");
      expect(a?.requiresConfirmation, verb).toBe(false);
    }
  });

  it("requires a purpose and real days in the schema", () => {
    const schema = registry.get("tool.feature_flag_tracker.add_flag")!.paramsSchema;
    expect(schema.safeParse({ name: "x" }).success).toBe(false);
    expect(
      schema.safeParse({ name: "x", purpose: "rollout", createdAt: "yesterday" }).success
    ).toBe(false);
    expect(
      schema.safeParse({ name: "x", purpose: "rollout", createdAt: "2026-01-02" }).success
    ).toBe(true);
  });
});

describe("tool.feature_flag_tracker — the lifecycle", () => {
  it("adds a backdated flag, refusing a future created day and an unknown release", async () => {
    expect(
      await run("add_flag", { name: "x", purpose: "rollout", createdAt: on(1) })
    ).toMatchObject({
      added: false,
      reason: "It can't be created in the future.",
    });
    expect(
      await run("add_flag", { name: "x", purpose: "rollout", releaseId: "nope" })
    ).toMatchObject({
      added: false,
    });
    expect(await run("add_flag", { name: "x" })).toMatchObject({ added: false });
    const a = await run<{
      added: boolean;
      id: string;
      staleness: { stale: boolean; daysOver: number };
    }>("add_flag", {
      name: " checkout_v2 ",
      purpose: "rollout",
      createdAt: on(-40),
      owner: "Priya",
    });
    expect(a).toMatchObject({ added: true, staleness: { stale: true, daysOver: 10 } });
    expect(one(a.id)).toEqual({
      id: a.id,
      name: "checkout_v2",
      status: "on",
      purpose: "rollout",
      createdAt: on(-40),
      owner: "Priya",
    });
  });

  it("edits in place, null clearing an optional field, and links a release", async () => {
    useWorkspaceStore.setState({
      releaseReadinesses: [
        {
          id: RELEASE_DOC_ID,
          releases: [{ id: "r1", name: "v3.4", plannedDate: on(5), status: "planning", gates: {} }],
        },
      ],
    });
    const a = await run<{ id: string }>("add_flag", {
      name: "x",
      purpose: "experiment",
      owner: "Sam",
      environment: "prod",
    });
    expect(
      await run("update_flag", {
        flagId: a.id,
        owner: null,
        environment: null,
        removeBy: on(10),
        releaseId: "r1",
      })
    ).toMatchObject({ updated: true });
    expect(one(a.id)).toMatchObject({ removeBy: on(10), releaseId: "r1" });
    expect(one(a.id).owner).toBeUndefined();
    expect(one(a.id).environment).toBeUndefined();
    expect(await run("update_flag", { flagId: a.id, removeBy: on(-10) })).toMatchObject({
      updated: false,
      reason: "It can't be removed before it was created.",
    });
    expect(await run("update_flag", { flagId: a.id, retiredAt: TODAY })).toMatchObject({
      updated: false,
    });
    expect(await run("update_flag", { flagId: "nope", name: "y" })).toMatchObject({
      updated: false,
    });
    const listed = await run<{ flags: { id: string; releaseName?: string | null }[] }>(
      "list_state",
      {}
    );
    expect(listed.flags[0].releaseName).toBe("v3.4");
  });

  it("turns flags off and on, retires on a day, and brings a retired flag back", async () => {
    const a = await run<{ id: string }>("add_flag", {
      name: "x",
      purpose: "rollout",
      createdAt: on(-20),
    });
    expect(await run("set_status", { flagId: a.id, status: "off" })).toMatchObject({
      updated: true,
    });
    expect(await run("set_status", { flagId: a.id, status: "off" })).toMatchObject({
      updated: false,
    });
    expect(await run("retire_flag", { flagId: a.id, retiredAt: on(-21) })).toMatchObject({
      retired: false,
      reason: "It can't be retired before it was created.",
    });
    expect(await run("retire_flag", { flagId: a.id, retiredAt: on(-2) })).toEqual({
      retired: true,
      retiredAt: on(-2),
    });
    expect(one(a.id)).toMatchObject({ status: "retired", retiredAt: on(-2) });
    expect(await run("retire_flag", { flagId: a.id })).toMatchObject({ retired: false });
    expect(await run("update_flag", { flagId: a.id, retiredAt: on(-3) })).toMatchObject({
      updated: true,
    });
    expect(one(a.id).retiredAt).toBe(on(-3));
    expect(await run("set_status", { flagId: a.id, status: "on" })).toEqual({
      updated: true,
      broughtBack: true,
    });
    expect(one(a.id).status).toBe("on");
    expect(one(a.id).retiredAt).toBeUndefined();
  });

  it("removes a flag, and lists the same summary the page shows", async () => {
    await run("add_flag", { name: "a", purpose: "kill_switch", createdAt: on(-400) });
    const b = await run<{ id: string }>("add_flag", {
      name: "b",
      purpose: "rollout",
      createdAt: on(-3),
      removeBy: on(-1),
    });
    await run("add_flag", { name: "c", purpose: "permission", createdAt: on(-100) });
    const listed = await run<{ total: number; summary: ReturnType<typeof flagSummary> }>(
      "list_state",
      {}
    );
    expect(listed.summary).toEqual(flagSummary(flags(), TODAY));
    expect(listed.summary).toMatchObject({ live: 3, stale: 1, pastRemoval: 1, exempt: 2 });
    expect(await run("remove_flag", { flagId: b.id })).toEqual({ removed: true });
    expect(await run("remove_flag", { flagId: b.id })).toEqual({ removed: false });
    expect((await run<{ total: number }>("list_state", {})).total).toBe(2);
  });

  it("reads the tracker's old row shapes the same way the page does", async () => {
    useWorkspaceStore.setState({
      featureFlags: [
        {
          id: "old",
          name: "legacy",
          status: "deprecated",
          createdAt: on(-90),
          purpose: "rollout",
        } as unknown as FeatureFlag,
      ],
    });
    const listed = await run<{ flags: { status: string; retiredAt?: string }[] }>("list_state", {});
    expect(listed.flags[0].status).toBe("retired");
    expect(listed.flags[0].retiredAt).toBeUndefined();
  });
});
