/**
 * tool.working_agreement.* coverage (singleton doc, S11).
 *
 *   1. registration — list_state read; add_rule write + mcpHandler.
 *   2. add_rule + list_state — byCategory tally + adoption counts.
 *   3. a new agreement starts unpublished at version 0, like the page; the
 *      MCP path writes the same document to the server store.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { WorkingAgreement } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/working-agreement";

function ctx() {
  return { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
}

describe("tool.working_agreement — registration", () => {
  it("read/write categories + write hardening", () => {
    expect(registry.get("tool.working_agreement.list_state")?.category).toBe("read");
    expect(registry.get("tool.working_agreement.add_rule")?.category).toBe("write");
    expect(registry.get("tool.working_agreement.add_rule")?.mcpHandler).toBeTypeOf("function");
    expect(registry.get("tool.working_agreement.add_rule")?.requiresConfirmation).toBe(false);
  });
});

describe("tool.working_agreement.add_rule + list_state", () => {
  beforeEach(() => useWorkspaceStore.setState({ workingAgreements: [] }));

  it("appends rules and tallies by category", async () => {
    await registry
      .get("tool.working_agreement.add_rule")!
      .handler(
        { category: "communication", text: "Reply within a day", agreedBy: ["alice"] },
        ctx()
      );
    await registry
      .get("tool.working_agreement.add_rule")!
      .handler({ category: "meetings", text: "No-meeting Wednesdays" }, ctx());

    const r = (await registry.get("tool.working_agreement.list_state")!.handler({}, ctx())) as {
      total: number;
      byCategory: Record<string, number>;
    };
    expect(r.total).toBe(2);
    expect(r.byCategory.communication).toBe(1);
    expect(r.byCategory.meetings).toBe(1);
  });
});

describe("tool.working_agreement — documents", () => {
  const WA_ID = "workingAgreement:current";
  const KIND = "workspace:workingAgreement";

  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({ workingAgreements: [] });
  });

  it("reports an absent agreement as empty, unpublished v0", async () => {
    const r = (await registry.get("tool.working_agreement.list_state")!.handler({}, ctx())) as {
      exists: boolean;
      total: number;
      meta: { version: number; publishedAt?: string };
    };
    expect(r.exists).toBe(false);
    expect(r.total).toBe(0);
    expect(r.meta).toEqual({ version: 0 });
  });

  // Bug: the agent created the agreement at version 1, so the page read
  // "v1 · unpublished" and offered "Publish v2" for a never-published charter.
  it("creates a new agreement unpublished at version 0, like the page", async () => {
    await registry
      .get("tool.working_agreement.add_rule")!
      .handler({ category: "work", text: "Pair on hard bugs" }, ctx());
    const doc = (useWorkspaceStore.getState().workingAgreements ?? [])[0];
    expect(doc.id).toBe(WA_ID);
    expect(doc.meta).toEqual({ version: 0 });
  });

  it("appends to an existing agreement, keeping its meta and rules", async () => {
    useWorkspaceStore.setState({
      workingAgreements: [
        {
          id: WA_ID,
          rules: [{ id: "r1", category: "work", text: "Old", agreedBy: [], stillWorking: true }],
          meta: { version: 3, teamName: "Otters", publishedAt: "2026-10-01T09:00:00.000Z" },
        },
      ],
    });
    const added = (await registry
      .get("tool.working_agreement.add_rule")!
      .handler(
        { category: "conflict", text: "Critique the work", description: "Not people" },
        ctx()
      )) as { added: boolean; id: string };
    expect(added.added).toBe(true);
    const doc = (useWorkspaceStore.getState().workingAgreements ?? [])[0];
    expect(doc.meta).toEqual({
      version: 3,
      teamName: "Otters",
      publishedAt: "2026-10-01T09:00:00.000Z",
    });
    expect(doc.rules.map((r) => r.id)).toEqual(["r1", added.id]);
    expect(doc.rules[1]).toMatchObject({
      category: "conflict",
      text: "Critique the work",
      agreedBy: [],
      description: "Not people",
    });
  });

  it("tallies the still-working check-ins", async () => {
    useWorkspaceStore.setState({
      workingAgreements: [
        {
          id: WA_ID,
          rules: [
            { id: "r1", category: "work", text: "A", agreedBy: [], stillWorking: true },
            { id: "r2", category: "work", text: "B", agreedBy: [], stillWorking: true },
            { id: "r3", category: "other", text: "C", agreedBy: [], stillWorking: false },
            { id: "r4", category: "other", text: "D", agreedBy: [] },
          ],
          meta: { version: 1 },
        },
      ],
    });
    const r = (await registry.get("tool.working_agreement.list_state")!.handler({}, ctx())) as {
      total: number;
      byCategory: Record<string, number>;
      stillWorkingCount: number;
      notWorkingCount: number;
    };
    expect(r.total).toBe(4);
    expect(r.byCategory).toMatchObject({ work: 2, other: 2, communication: 0 });
    expect(r.stillWorkingCount).toBe(2);
    expect(r.notWorkingCount).toBe(1);
  });

  it("writes through the server store on the MCP path", async () => {
    const tool = registry.get("tool.working_agreement.add_rule")!;
    await tool.mcpHandler!({ category: "meetings", text: "Cameras optional" }, ctx());
    await tool.mcpHandler!({ category: "meetings", text: "Agenda first" }, ctx());
    const row = rows.get(`${KIND}/${WA_ID}`) as WorkingAgreement;
    expect(row.meta).toEqual({ version: 0 });
    expect(row.rules.map((r) => r.text)).toEqual(["Cameras optional", "Agenda first"]);
    // The browser store is untouched.
    expect(useWorkspaceStore.getState().workingAgreements).toEqual([]);

    const r = (await registry.get("tool.working_agreement.list_state")!.mcpHandler!({}, ctx())) as {
      exists: boolean;
      total: number;
      byCategory: { meetings: number };
    };
    expect(r.exists).toBe(true);
    expect(r.total).toBe(2);
    expect(r.byCategory.meetings).toBe(2);
  });
});
