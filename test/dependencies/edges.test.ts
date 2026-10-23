import { beforeEach, describe, expect, it } from "vitest";
import {
  edgeStatus,
  edgeSummary,
  findNodeByLabel,
  isOverdue,
  validEdges,
  withDependencyLink,
  withEdgeStatus,
} from "@/lib/dependencies/edges";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyEdge, DependencyMap } from "@/lib/stores/workspace-types";

import "@/lib/actions/tools/dependency-map";

/**
 * The one dependency model: Dependency Map edges with a status, owner and
 * due date, shared by PI Planning, Scrum of Scrums and agents.
 */

const edge = (over: Partial<DependencyEdge> = {}): DependencyEdge => ({
  id: "e",
  from: "a",
  to: "b",
  kind: "needs",
  ...over,
});

describe("edge status", () => {
  it("reads a missing or unknown status as open", () => {
    expect(edgeStatus(edge())).toBe("open");
    expect(edgeStatus(edge({ status: "weird" as never }))).toBe("open");
    expect(edgeStatus(edge({ status: "at-risk" }))).toBe("at-risk");
  });

  it("stamps resolvedAt on resolve, keeps the first stamp, and clears it on reopen", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const resolved = withEdgeStatus(edge(), "resolved", now);
    expect(resolved).toMatchObject({ status: "resolved", resolvedAt: "2026-10-23T10:00:00.000Z" });
    expect(withEdgeStatus(resolved, "resolved", new Date("2027-01-01")).resolvedAt).toBe(
      "2026-10-23T10:00:00.000Z"
    );
    const reopened = withEdgeStatus(resolved, "open");
    expect(reopened.status).toBe("open");
    expect("resolvedAt" in reopened).toBe(false);
  });

  it("is overdue only when unresolved and due before today", () => {
    expect(isOverdue(edge({ due: "2026-10-22" }), "2026-10-23")).toBe(true);
    expect(isOverdue(edge({ due: "2026-10-23" }), "2026-10-23")).toBe(false);
    expect(isOverdue(edge({ due: "2026-10-01", status: "resolved" }), "2026-10-23")).toBe(false);
    expect(isOverdue(edge(), "2026-10-23")).toBe(false);
  });

  it("summarises by status with an overdue count", () => {
    expect(
      edgeSummary(
        [
          edge({ id: "1" }),
          edge({ id: "2", status: "at-risk", due: "2026-01-01" }),
          edge({ id: "3", status: "resolved", due: "2026-01-01" }),
        ],
        "2026-10-23"
      )
    ).toEqual({ open: 1, atRisk: 1, resolved: 1, overdue: 1 });
  });
});

describe("withDependencyLink", () => {
  let n = 0;
  const makeId = () => `id${++n}`;
  beforeEach(() => (n = 0));

  it("adds both sides and an open edge", () => {
    const out = withDependencyLink(
      undefined,
      { from: "Checkout team", to: "Payments API", owner: " Sam ", due: "2026-11-01" },
      makeId
    );
    expect(out.nodes.map((x) => x.label)).toEqual(["Checkout team", "Payments API"]);
    expect(out.edges).toEqual([
      {
        id: out.edgeId,
        from: out.nodes[0].id,
        to: out.nodes[1].id,
        kind: "needs",
        status: "open",
        owner: "Sam",
        due: "2026-11-01",
      },
    ]);
  });

  it("reuses existing nodes by label and an identical open edge", () => {
    const first = withDependencyLink(undefined, { from: "A", to: "B" }, makeId);
    const again = withDependencyLink(first, { from: " a ", to: "b" }, makeId);
    expect(again.nodes).toHaveLength(2);
    expect(again.edges).toHaveLength(1);
    expect(again.edgeId).toBe(first.edgeId);
    expect(findNodeByLabel(again.nodes, "B ")?.id).toBe(first.nodes[1].id);
  });

  it("adds a new edge when the earlier one is resolved", () => {
    const first = withDependencyLink(undefined, { from: "A", to: "B" }, makeId);
    const resolved = { ...first, edges: first.edges.map((e) => withEdgeStatus(e, "resolved")) };
    const again = withDependencyLink(resolved, { from: "A", to: "B" }, makeId);
    expect(again.edges).toHaveLength(2);
    expect(again.edgeId).not.toBe(first.edgeId);
  });

  it("drops edges whose ends were removed", () => {
    expect(
      validEdges({
        nodes: [{ id: "a", label: "A" }],
        edges: [edge({ id: "x", to: "gone" }), edge({ id: "y", from: "a", to: "a" })],
      }).map((e) => e.id)
    ).toEqual(["y"]);
  });
});

describe("tool.dependency_map edge actions", () => {
  const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
  const DM_ID = "dependency-map:current";
  const map = (edges: DependencyEdge[] = []): DependencyMap => ({
    id: DM_ID,
    nodes: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    edges,
  });
  const stored = () => useWorkspaceStore.getState().dependencyMaps?.find((d) => d.id === DM_ID);

  beforeEach(() => useWorkspaceStore.setState({ dependencyMaps: [map()] }));

  it("add_edge takes a status, owner, due date and note", async () => {
    const r = (await registry
      .get("tool.dependency_map.add_edge")!
      .handler(
        { from: "a", to: "b", kind: "needs", status: "at-risk", owner: "Sam", due: "2026-11-01" },
        ctx
      )) as { added: boolean; id: string };
    expect(r.added).toBe(true);
    expect(stored()?.edges).toEqual([
      {
        id: r.id,
        from: "a",
        to: "b",
        kind: "needs",
        status: "at-risk",
        owner: "Sam",
        due: "2026-11-01",
      },
    ]);
  });

  it("update_edge resolves, edits and clears fields; unknown ids change nothing", async () => {
    useWorkspaceStore.setState({
      dependencyMaps: [map([edge({ id: "e1", owner: "Sam", note: "x" })])],
    });
    const update = registry.get("tool.dependency_map.update_edge")!;
    expect(registry.get("tool.dependency_map.update_edge")?.category).toBe("write");

    await update.handler({ id: "e1", status: "resolved", owner: "", due: "2026-12-01" }, ctx);
    const e = stored()!.edges[0];
    expect(e).toMatchObject({ status: "resolved", due: "2026-12-01", note: "x" });
    expect(e.resolvedAt).toEqual(expect.any(String));
    expect("owner" in e).toBe(false);

    expect(await update.handler({ id: "nope", status: "open" }, ctx)).toEqual({ updated: false });
  });

  it("list_state counts by status", async () => {
    useWorkspaceStore.setState({
      dependencyMaps: [map([edge({ id: "1" }), edge({ id: "2", status: "resolved" })])],
    });
    const r = (await registry.get("tool.dependency_map.list_state")!.handler({}, ctx)) as {
      byStatus: Record<string, number>;
    };
    expect(r.byStatus).toEqual({ open: 1, atRisk: 0, resolved: 1, overdue: 0 });
  });
});
