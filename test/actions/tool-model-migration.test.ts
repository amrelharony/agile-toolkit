/**
 * tool.model_migration.* coverage (singleton doc).
 *
 *   1. registration — list_state read; set_details/add_step/toggle_step
 *      write + mcpHandler + no confirm.
 *   2. list_state — empty (exists:false, 0 steps) before any write. Note the
 *      DEFAULT_STEPS seeding is client-only; the agent sees only persisted data.
 *   3. set_details — merges overview fields.
 *   4. add_step / toggle_step — append + flip; unknown step → {updated:false}.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { ModelMigration } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/model-migration";

const MIGRATION_ID = "modelMigration:current";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.model_migration — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.model_migration.list_state")?.category).toBe("read");
    for (const verb of ["set_details", "add_step", "toggle_step"]) {
      expect(registry.get(`tool.model_migration.${verb}`)?.category).toBe("write");
      expect(registry.get(`tool.model_migration.${verb}`)?.mcpHandler).toBeTypeOf("function");
      expect(registry.get(`tool.model_migration.${verb}`)?.requiresConfirmation).toBe(false);
    }
  });
});

describe("tool.model_migration.list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ modelMigrations: [] }));

  it("is empty before any write", async () => {
    const r = (await registry.get("tool.model_migration.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      totalSteps: number;
      doneSteps: number;
      completeness: number;
    };
    expect(r.exists).toBe(false);
    expect(r.totalSteps).toBe(0);
    expect(r.completeness).toBe(0);
  });
});

describe("tool.model_migration.set_details + add_step", () => {
  beforeEach(() => useWorkspaceStore.setState({ modelMigrations: [] }));

  it("merges details and appends steps", async () => {
    await registry
      .get("tool.model_migration.set_details")!
      .handler({ fromModel: "gpt-4", toModel: "gpt-5", evalDeltaPct: "+2.1" }, ctx());
    const added = (await registry
      .get("tool.model_migration.add_step")!
      .handler({ text: "Run baseline evals" }, ctx())) as { added: boolean; id: string };
    expect(added.added).toBe(true);

    const migs = useWorkspaceStore.getState().modelMigrations ?? [];
    expect(migs).toHaveLength(1);
    expect(migs[0].id).toBe(MIGRATION_ID);

    const r = (await registry.get("tool.model_migration.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      fromModel: string;
      toModel: string;
      evalDeltaPct: string;
      totalSteps: number;
    };
    expect(r.exists).toBe(true);
    expect(r.fromModel).toBe("gpt-4");
    expect(r.toModel).toBe("gpt-5");
    expect(r.evalDeltaPct).toBe("+2.1");
    expect(r.totalSteps).toBe(1);
  });
});

describe("tool.model_migration.toggle_step", () => {
  beforeEach(() =>
    useWorkspaceStore.setState({
      modelMigrations: [
        {
          id: MIGRATION_ID,
          fromModel: "",
          toModel: "",
          evalDeltaPct: "",
          costDeltaPct: "",
          steps: [{ id: "s1", text: "baseline", done: false }],
        } as ModelMigration,
      ],
    })
  );

  it("flips done, sets it explicitly, and bumps completeness", async () => {
    const r = (await registry
      .get("tool.model_migration.toggle_step")!
      .handler({ stepId: "s1" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(true);
    expect((useWorkspaceStore.getState().modelMigrations ?? [])[0].steps[0].done).toBe(true);

    const state = (await registry.get("tool.model_migration.list_state")!.handler({}, ctx())) as {
      doneSteps: number;
      completeness: number;
    };
    expect(state.doneSteps).toBe(1);
    expect(state.completeness).toBe(1); // 1/1

    // Explicit set back to false.
    await registry
      .get("tool.model_migration.toggle_step")!
      .handler({ stepId: "s1", done: false }, ctx());
    expect((useWorkspaceStore.getState().modelMigrations ?? [])[0].steps[0].done).toBe(false);
  });

  it("returns updated:false for an unknown step id", async () => {
    const r = (await registry
      .get("tool.model_migration.toggle_step")!
      .handler({ stepId: "nope" }, ctx())) as { updated: boolean };
    expect(r.updated).toBe(false);
  });
});
