/**
 * tool.model_comparison.* coverage.
 *
 *   1. registration — list_state read; add_model/set_status write +
 *      mcpHandler + no confirm.
 *   2. list_state — byStatus/byVendor counts + best-in-class picks (null
 *      when no entry carries the metric).
 *   3. add_model — appends; schema defaults status to "evaluation".
 *   4. set_status — updates; {updated:false} on unknown id.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelEntry } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/model-comparison";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

function model(p: Partial<ModelEntry> & Pick<ModelEntry, "id" | "name" | "vendor">): ModelEntry {
  return { status: "production", ...p };
}

describe("tool.model_comparison — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.model_comparison.list_state")?.category).toBe("read");
    expect(registry.get("tool.model_comparison.add_model")?.category).toBe("write");
    expect(registry.get("tool.model_comparison.add_model")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.model_comparison.add_model")?.requiresConfirmation).toBe(false);
    expect(registry.get("tool.model_comparison.set_status")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.model_comparison.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ models: [] }));

  it("is empty with null picks when no models", async () => {
    const r = (await registry.get("tool.model_comparison.list_state")!.handler({}, ctx())) as {
      total: number;
      cheapestInput: unknown;
      highestEval: unknown;
    };
    expect(r.total).toBe(0);
    expect(r.cheapestInput).toBeNull();
    expect(r.highestEval).toBeNull();
  });

  it("counts by status/vendor and picks best-in-class only over entries with the metric", async () => {
    const u = useWorkspaceStore.getState().upsertModel;
    u(
      model({
        id: "m1",
        name: "opus",
        vendor: "anthropic",
        status: "production",
        inputCostPer1k: 15,
        evalScore: 0.9,
      })
    );
    u(
      model({
        id: "m2",
        name: "haiku",
        vendor: "anthropic",
        status: "evaluation",
        inputCostPer1k: 0.25,
        evalScore: 0.7,
      })
    );
    // No metrics at all — must not become the cheapest/highest by default.
    u(model({ id: "m3", name: "mystery", vendor: "acme", status: "experimental" }));

    const r = (await registry.get("tool.model_comparison.list_state")!.handler({}, ctx())) as {
      total: number;
      byStatus: Record<string, number>;
      byVendor: Record<string, number>;
      cheapestInput: { name: string; value: number } | null;
      highestEval: { name: string; value: number } | null;
      fastestP50: unknown;
    };
    expect(r.total).toBe(3);
    expect(r.byStatus.production).toBe(1);
    expect(r.byStatus.evaluation).toBe(1);
    expect(r.byVendor.anthropic).toBe(2);
    expect(r.cheapestInput).toEqual({ name: "haiku", value: 0.25 });
    expect(r.highestEval).toEqual({ name: "opus", value: 0.9 });
    // No model carries latencyP50Ms → null, not "mystery".
    expect(r.fastestP50).toBeNull();
  });
});

describe("tool.model_comparison.add_model", () => {
  beforeEach(() => useWorkspaceStore.setState({ models: [] }));

  it("appends a model with auto id", async () => {
    const r = (await registry
      .get("tool.model_comparison.add_model")!
      .handler({ name: "sonnet", vendor: "anthropic", status: "production" }, ctx())) as {
      added: boolean;
      id: string;
    };
    expect(r.added).toBe(true);
    const stored = useWorkspaceStore.getState().models ?? [];
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("sonnet");
  });

  it("schema defaults status to 'evaluation'", () => {
    const parsed = registry
      .get("tool.model_comparison.add_model")!
      .paramsSchema.parse({ name: "x", vendor: "y" }) as { status: string };
    expect(parsed.status).toBe("evaluation");
  });
});

describe("tool.model_comparison.set_status", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      models: [model({ id: "m1", name: "opus", vendor: "anthropic", status: "evaluation" })],
    })
  );

  it("promotes a model and returns updated:true", async () => {
    const r = (await registry
      .get("tool.model_comparison.set_status")!
      .handler({ id: "m1", status: "production" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    expect((useWorkspaceStore.getState().models ?? [])[0].status).toBe("production");
  });

  it("returns updated:false for an unknown id", async () => {
    const r = (await registry
      .get("tool.model_comparison.set_status")!
      .handler({ id: "nope", status: "deprecated" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
