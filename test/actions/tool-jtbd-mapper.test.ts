/**
 * tool.jtbd_mapper.* action coverage.
 *
 *   1. list_state (read) + add_job (write, mcpHandler, no confirm)
 *   2. list_state counts roots (no parent) and leaves (no children)
 *   3. add_job appends a story; parentJobId nests it
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { JobStory } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/jtbd-mapper";

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

function job(partial: Partial<JobStory> & Pick<JobStory, "id">): JobStory {
  return { situation: "s", motivation: "m", outcome: "o", ...partial };
}

describe("tool.jtbd_mapper — registration", () => {
  it("registers list_state (read) and add_job (write, mcpHandler, no confirm)", () => {
    expect(registry.get("tool.jtbd_mapper.list_state")?.category).toBe("read");
    expect(registry.get("tool.jtbd_mapper.add_job")?.category).toBe("write");
    expect(registry.get("tool.jtbd_mapper.add_job")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.jtbd_mapper.add_job")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.jtbd_mapper.list_state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ jobStories: [] });
  });

  it("returns zeros for an empty workspace", async () => {
    const action = registry.get("tool.jtbd_mapper.list_state");
    const r = (await action!.handler({}, ctx())) as { total: number; rootCount: number };
    expect(r.total).toBe(0);
    expect(r.rootCount).toBe(0);
  });

  it("counts roots and leaves of the hierarchy", async () => {
    // root -> child -> grandchild ; plus a second root
    for (const j of [
      job({ id: "root" }),
      job({ id: "child", parentJobId: "root" }),
      job({ id: "grandchild", parentJobId: "child" }),
      job({ id: "root2" }),
    ]) {
      useWorkspaceStore.getState().upsertJobStory(j);
    }

    const action = registry.get("tool.jtbd_mapper.list_state");
    const r = (await action!.handler({}, ctx())) as {
      total: number;
      rootCount: number;
      leafCount: number;
    };
    expect(r.total).toBe(4);
    expect(r.rootCount).toBe(2); // root, root2
    expect(r.leafCount).toBe(2); // grandchild, root2
  });
});

describe("tool.jtbd_mapper.add_job", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ jobStories: [] });
  });

  it("appends a job story and nests under a parent", async () => {
    const action = registry.get("tool.jtbd_mapper.add_job");
    const parent = (await action!.handler(
      { situation: "onboarding", motivation: "see value fast", outcome: "activate" },
      ctx()
    )) as { id: string };
    await action!.handler(
      {
        situation: "first run",
        motivation: "skip setup",
        outcome: "start in 1 click",
        parentJobId: parent.id,
      },
      ctx()
    );

    const stored = useWorkspaceStore.getState().jobStories ?? [];
    expect(stored).toHaveLength(2);
    expect(stored.find((j) => j.parentJobId === parent.id)).toBeTruthy();
  });
});
