/**
 * ModelEntry optimistic-concurrency (version guard) — audit MEDIUM.
 *
 * ModelEntry rows are edited by BOTH the user (the /model-comparison UI)
 * and background agents (tool.model_registry.* over MCP). The pre-fix
 * write path was a whole-row read-modify-write with no concurrency token,
 * so a write built from a stale base silently clobbered a concurrent
 * change to a different field — a lost update with no conflict surfaced.
 *
 * The fix gives ModelEntry a monotonic `version` (mirroring the whiteboard
 * object LWW idiom) and makes `upsertModel` a compare-and-set:
 *   - a write that carries an OLDER version than the stored row is a stale
 *     lost-update attempt and is DROPPED (the newer row stands);
 *   - every accepted write bumps `version` so the next stale writer is
 *     detected;
 *   - a write that OMITS `version` is treated as a legacy/blind write —
 *     accepted and stamped — so existing callers keep working (opt-in).
 *
 * These assertions cover the browser write path (synchronous store
 * mutation). The server (MCP) path's compare-and-set against Supabase is
 * exercised by the handlers in model-registry.ts and can't be unit-tested
 * without a live database; see serverVersionedUpdate in server-store.ts.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelEntry } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/model-registry";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function seed(
  partial: Partial<ModelEntry> & Pick<ModelEntry, "id" | "name" | "vendor">
): ModelEntry {
  return { status: "experimental", ...partial };
}

const store = () => useWorkspaceStore.getState();
const findModel = (id: string) => (store().models ?? []).find((m) => m.id === id);

describe("upsertModel — version compare-and-set", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ models: [] });
  });

  it("stamps version=1 on a first insert that omits version", () => {
    store().upsertModel(seed({ id: "m1", name: "claude", vendor: "anthropic" }));
    expect(findModel("m1")?.version).toBe(1);
  });

  it("preserves an explicit version on first insert, treating it as the base", () => {
    store().upsertModel(seed({ id: "m1", name: "claude", vendor: "anthropic", version: 5 }));
    // First write of an id is accepted as-is; the supplied version becomes
    // the base rather than being reset to 1.
    expect(findModel("m1")?.version).toBe(5);
  });

  it("bumps version when an in-sync write (incoming === current) is accepted", () => {
    store().upsertModel(seed({ id: "m1", name: "claude", vendor: "anthropic" })); // v1
    const current = findModel("m1")!;
    store().upsertModel({ ...current, status: "production" }); // carries v1
    expect(findModel("m1")?.status).toBe("production");
    expect(findModel("m1")?.version).toBe(2);
  });

  it("DROPS a write whose version is older than the stored row (lost-update guard)", () => {
    store().upsertModel(seed({ id: "m1", name: "claude", vendor: "anthropic" })); // v1
    const base = findModel("m1")!; // version 1
    // Agent advances the row to v2 (e.g. status flip landed via realtime).
    store().upsertModel({ ...base, status: "production" }); // -> v2
    expect(findModel("m1")?.version).toBe(2);

    // User saves a row built from the STALE v1 base (status still evaluation).
    store().upsertModel({ ...base, status: "evaluation", latencyP50Ms: 42 });

    // Stale write rejected: the newer row stands, agent's change preserved.
    const after = findModel("m1")!;
    expect(after.status).toBe("production");
    expect(after.version).toBe(2);
    expect(after.latencyP50Ms).toBeUndefined();
  });

  it("blind-accepts a legacy write that omits version (and bumps)", () => {
    store().upsertModel(seed({ id: "m1", name: "claude", vendor: "anthropic" })); // v1
    // A caller that never round-trips version (no `version` field) must
    // still be able to write — opt-in semantics for back-compat.
    store().upsertModel(
      seed({ id: "m1", name: "claude", vendor: "anthropic", status: "deprecated" })
    );
    expect(findModel("m1")?.status).toBe("deprecated");
    expect(findModel("m1")?.version).toBe(2);
  });
});

describe("tool.model_registry write verbs bump version (browser path)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ models: [] });
  });

  it("record_eval bumps the target's version", async () => {
    store().upsertModel(seed({ id: "m1", name: "claude", vendor: "anthropic" })); // v1
    const action = registry.get("tool.model_registry.record_eval");
    await action!.handler({ id: "m1", evalScore: 0.9 }, ctx());
    expect(findModel("m1")?.evalScore).toBe(0.9);
    expect(findModel("m1")?.version).toBe(2);
  });

  it("promote_to_production bumps both the promoted target and the demoted peer", async () => {
    store().upsertModel(
      seed({ id: "old", name: "claude-3", vendor: "anthropic", status: "production" })
    ); // v1
    store().upsertModel(
      seed({ id: "new", name: "claude-4", vendor: "anthropic", status: "evaluation" })
    ); // v1

    const action = registry.get("tool.model_registry.promote_to_production");
    await action!.handler({ id: "new" }, ctx());

    expect(findModel("new")?.status).toBe("production");
    expect(findModel("new")?.version).toBe(2);
    expect(findModel("old")?.status).toBe("deprecated");
    expect(findModel("old")?.version).toBe(2);
  });
});
