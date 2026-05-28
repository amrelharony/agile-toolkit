/**
 * tool.test_pyramid.* coverage (singleton doc, S10).
 *
 *   1. registration — list_state read; set_counts write + mcpHandler + no confirm.
 *   2. list_state — percentages + healthy/inverted shape analysis.
 *   3. set_counts — creates + merges (omitted layers untouched).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

import "@/lib/actions/tools/test-pyramid";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.test_pyramid — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.test_pyramid.list_state")?.category).toBe("read");
    expect(registry.get("tool.test_pyramid.set_counts")?.category).toBe("write");
    expect(registry.get("tool.test_pyramid.set_counts")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.test_pyramid.set_counts")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.test_pyramid.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ testPyramids: [] }));

  it("is empty before any write", async () => {
    const r = (await registry.get("tool.test_pyramid.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      healthy: boolean;
    };
    expect(r.exists).toBe(false);
    expect(r.total).toBe(0);
    expect(r.healthy).toBe(false);
  });

  it("flags a healthy pyramid", async () => {
    await registry
      .get("tool.test_pyramid.set_counts")!
      .handler({ unit: 70, integration: 20, e2e: 10 }, ctx());
    const r = (await registry.get("tool.test_pyramid.list_state")!.handler({}, ctx())) as {
      total: number;
      pctUnit: number;
      healthy: boolean;
      inverted: boolean;
    };
    expect(r.total).toBe(100);
    expect(r.pctUnit).toBe(70);
    expect(r.healthy).toBe(true);
    expect(r.inverted).toBe(false);
  });

  it("flags an inverted (ice-cream-cone) pyramid", async () => {
    await registry
      .get("tool.test_pyramid.set_counts")!
      .handler({ unit: 5, integration: 10, e2e: 20 }, ctx());
    const r = (await registry.get("tool.test_pyramid.list_state")!.handler({}, ctx())) as {
      healthy: boolean;
      inverted: boolean;
    };
    expect(r.inverted).toBe(true);
    expect(r.healthy).toBe(false);
  });
});

describe("tool.test_pyramid.set_counts", () => {
  beforeEach(() => useWorkspaceStore.setState({ testPyramids: [] }));

  it("merges — omitted layers are preserved", async () => {
    await registry
      .get("tool.test_pyramid.set_counts")!
      .handler({ unit: 50, integration: 10, e2e: 5 }, ctx());
    await registry.get("tool.test_pyramid.set_counts")!.handler({ unit: 70 }, ctx());
    const r = (await registry.get("tool.test_pyramid.list_state")!.handler({}, ctx())) as {
      unit: number;
      integration: number;
      e2e: number;
    };
    expect(r.unit).toBe(70);
    expect(r.integration).toBe(10); // preserved
    expect(r.e2e).toBe(5); // preserved
  });
});
