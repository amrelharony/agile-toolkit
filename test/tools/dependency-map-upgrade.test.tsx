import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyEdge, DependencyMap, DependencyNode } from "@/lib/stores/workspace-types";

/**
 * Dependency Map, the one dependency model: a layered graph, edit in place,
 * a critical path that reads due dates, status filters, safe removal (a
 * node takes its edges, with a confirm and Undo), and the link helpers PI
 * Planning and Scrum of Scrums build on.
 */

const toastSpy = vi.hoisted(() => Object.assign(vi.fn(), { dismiss: vi.fn() }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { DependencyMapClient } from "@/app/(tools)/dependency-map/dependency-map-client";
import {
  cleanEdges,
  criticalPath,
  detectCycles,
  flow,
  layoutGraph,
} from "@/app/(tools)/dependency-map/graph";
import { dependencyVerdict } from "@/app/(tools)/dependency-map/verdict";
import { toMarkdown } from "@/app/(tools)/dependency-map/markdown";
import { buildExample, withExample, withoutExample } from "@/app/(tools)/dependency-map/example";
import {
  EMPTY_EDGE,
  EMPTY_NODE,
  validateEdge,
  validateNode,
} from "@/app/(tools)/dependency-map/forms";
import {
  DEPENDENCY_MAP_ID,
  findLinkedEdge,
  linkDependency,
  setEdgeStatus,
  unlink,
} from "@/app/(tools)/dependency-map/link";
import { dayFrom, dayLabel } from "@/app/(tools)/dependency-map/format";

const TODAY = "2026-10-23";

const n = (id: string, label = id.toUpperCase(), extra: Partial<DependencyNode> = {}) => ({
  id,
  label,
  ...extra,
});
const e = (
  id: string,
  from: string,
  to: string,
  kind: DependencyEdge["kind"] = "needs",
  extra: Partial<DependencyEdge> = {}
): DependencyEdge => ({ id, from, to, kind, ...extra });

const ws = () => useWorkspaceStore.getState();
const map = (): DependencyMap =>
  (ws().dependencyMaps ?? []).find((d) => d.id === DEPENDENCY_MAP_ID) ?? {
    id: DEPENDENCY_MAP_ID,
    nodes: [],
    edges: [],
  };
const seed = (nodes: DependencyNode[], edges: DependencyEdge[] = []) =>
  useWorkspaceStore.setState({ dependencyMaps: [{ id: DEPENDENCY_MAP_ID, nodes, edges }] });

const renderMap = () =>
  render(
    <TooltipProvider>
      <DependencyMapClient />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
const undoLast = () => lastToast()[1].action.onClick();

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ dependencyMaps: [], teamMembers: [] });
});

/* ── Graph logic ──────────────────────────────────────────────────────── */

describe("which edges count", () => {
  it("drops dangling, self and unknown-kind edges but keeps old status-less ones", () => {
    const nodes = [n("a"), n("b")];
    const edges = [
      e("ok", "a", "b"),
      e("gone", "a", "zzz"),
      e("self", "a", "a"),
      e("odd", "a", "b", "weird" as never),
    ];
    expect(cleanEdges({ nodes, edges }).map((x) => x.id)).toEqual(["ok"]);
  });

  it("reads needs edges in delivery order and blocks edges as written", () => {
    expect(flow(e("x", "checkout", "payments", "needs"))).toEqual({
      provider: "payments",
      consumer: "checkout",
    });
    expect(flow(e("y", "auth", "checkout", "blocks"))).toEqual({
      provider: "auth",
      consumer: "checkout",
    });
  });
});

describe("cycles", () => {
  const nodes = [n("a"), n("b"), n("c")];

  it("reports each circular wait once, whichever node DFS starts from", () => {
    const edges = [e("1", "a", "b"), e("2", "b", "c"), e("3", "c", "a")];
    const cycles = detectCycles(nodes, edges);
    expect(cycles).toHaveLength(1);
    expect(cycles[0][0]).toBe(cycles[0][cycles[0].length - 1]);
    expect(cycles[0]).toHaveLength(4);
  });

  it("ignores informs edges and resolved links: they don't hold work up", () => {
    expect(detectCycles(nodes, [e("1", "a", "b"), e("2", "b", "a", "informs")])).toEqual([]);
    expect(
      detectCycles(nodes, [e("1", "a", "b"), e("2", "b", "a", "needs", { status: "resolved" })])
    ).toEqual([]);
  });
});

describe("critical path", () => {
  const nodes = [n("fraud"), n("pay"), n("checkout"), n("mobile"), n("side")];

  it("follows the longest open blocking chain in delivery order with each due date flagged", () => {
    const edges = [
      e("e2", "pay", "fraud", "needs", { status: "at-risk", due: "2026-10-27" }),
      e("e1", "checkout", "pay", "needs", { due: "2026-10-20" }),
      e("e3", "mobile", "checkout", "needs", { due: "2026-11-04" }),
      e("e4", "side", "checkout", "informs"),
    ];
    const path = criticalPath(nodes, edges, TODAY);
    expect(path.nodes).toEqual(["fraud", "pay", "checkout", "mobile"]);
    expect(path.steps.map((s) => [s.edge.id, s.overdue, s.atRisk, s.dueBeforeUpstream])).toEqual([
      ["e2", false, true, false],
      // Due 20 Oct: already late, and before the 27 Oct link it waits on.
      ["e1", true, false, true],
      ["e3", false, false, false],
    ]);
  });

  it("leaves resolved links out, and is empty with only informs edges or a cycle", () => {
    const resolved = [
      e("e1", "checkout", "pay", "needs", { status: "resolved" }),
      e("e2", "mobile", "checkout"),
    ];
    expect(criticalPath(nodes, resolved, TODAY).nodes).toEqual(["checkout", "mobile"]);
    expect(criticalPath(nodes, [e("i", "pay", "checkout", "informs")], TODAY).steps).toEqual([]);
    expect(
      criticalPath(nodes, [e("1", "pay", "checkout"), e("2", "checkout", "pay")], TODAY).steps
    ).toEqual([]);
    expect(criticalPath([], [], TODAY).nodes).toEqual([]);
  });

  it("breaks a tie between equally long chains by the earlier due date", () => {
    const edges = [
      e("late", "pay", "fraud", "needs", { due: "2026-12-01" }),
      e("soon", "checkout", "side", "needs", { due: "2026-11-01" }),
    ];
    expect(criticalPath(nodes, edges, TODAY).steps.map((s) => s.edge.id)).toEqual(["soon"]);
  });
});

describe("layout", () => {
  it("puts providers left of the work that waits on them, cycles included", () => {
    const nodes = [n("mobile"), n("checkout"), n("pay"), n("x"), n("y")];
    const edges = [
      e("1", "checkout", "pay"),
      e("2", "mobile", "checkout"),
      e("3", "x", "y"),
      e("4", "y", "x"),
    ];
    const { columns, position } = layoutGraph(nodes, edges);
    expect(position.get("pay")!.col).toBe(0);
    expect(position.get("checkout")!.col).toBe(1);
    expect(position.get("mobile")!.col).toBe(2);
    // Every node is placed exactly once, the cycle's two as well.
    expect(columns.flat().sort()).toEqual(["checkout", "mobile", "pay", "x", "y"]);
    expect(layoutGraph([], []).columns).toEqual([]);
  });
});

/* ── Verdict, export, example ─────────────────────────────────────────── */

describe("verdict", () => {
  it("names the most overdue dependency, provider first", () => {
    const nodes = [n("pay", "Payments API"), n("checkout", "Checkout"), n("m", "Mobile")];
    const edges = [
      e("1", "checkout", "pay", "needs", { due: "2026-11-02" }),
      e("2", "m", "checkout", "needs", { status: "at-risk", due: "2026-10-30" }),
      e("3", "m", "pay", "needs", { status: "resolved", due: "2026-10-01" }),
    ];
    expect(dependencyVerdict({ nodes, edges }, "2026-11-05")).toBe(
      "2 open dependencies (1 at risk), 2 overdue, the oldest: Checkout → Mobile, due 30 Oct."
    );
    expect(dependencyVerdict({ nodes, edges: [edges[0]] }, TODAY)).toBe(
      "1 open dependency, none overdue; next due: Payments API → Checkout, 2 Nov."
    );
  });

  it("covers an empty map, no edges, no due dates and everything resolved", () => {
    expect(dependencyVerdict({ nodes: [], edges: [] }, TODAY)).toBe("Nothing on the map yet.");
    expect(dependencyVerdict({ nodes: [n("a"), n("b")], edges: [] }, TODAY)).toBe(
      "2 nodes on the map, with no dependencies between them yet."
    );
    expect(dependencyVerdict({ nodes: [n("a"), n("b")], edges: [e("1", "a", "b")] }, TODAY)).toBe(
      "1 open dependency, none with a due date yet."
    );
    expect(
      dependencyVerdict(
        { nodes: [n("a"), n("b")], edges: [e("1", "a", "b", "needs", { status: "resolved" })] },
        TODAY
      )
    ).toBe("The one dependency on the map is resolved.");
  });
});

describe("Markdown export", () => {
  it("lists dependencies, the critical path and the nodes", () => {
    const now = new Date(2026, 9, 23);
    const md = toMarkdown(buildExample(now), TODAY);
    expect(md).toContain("# Dependency Map — 23 Oct 2026");
    expect(md).toContain(
      "| Checkout | needs | Payments API | Open | Priya | 20 Oct 2026 (overdue) | Refund endpoint contract |"
    );
    expect(md).toContain("## Critical path (3 links)");
    expect(md).toContain(
      "2. Payments API → Checkout, due 20 Oct 2026 (overdue, due before the link it waits on)"
    );
    expect(md).toContain("- Fraud scoring (Risk)");
    expect(toMarkdown({ nodes: [], edges: [] }, TODAY)).toContain("Nothing on the map yet.");
  });

  it("reports circular waits instead of a critical path", () => {
    const md = toMarkdown(
      { nodes: [n("a", "A"), n("b", "B")], edges: [e("1", "a", "b"), e("2", "b", "a")] },
      TODAY
    );
    expect(md).toContain("## Circular waits");
    expect(md).not.toContain("## Critical path");
  });
});

describe("example", () => {
  it("uses example ids, and clearing it keeps the user's own nodes and edges", () => {
    const mine = {
      nodes: [n("mine", "Mine"), n("other", "Other")],
      edges: [e("m1", "mine", "other")],
    };
    const loaded = withExample(withExample(mine));
    expect(loaded.nodes).toHaveLength(8); // a second load replaces the first
    expect(loaded.nodes.slice(2).every((x) => x.id.startsWith("example-"))).toBe(true);
    // A user edge drawn to an example node goes with the example.
    loaded.edges.push(e("m2", "mine", loaded.nodes[2].id));
    expect(withoutExample(loaded)).toEqual(mine);
  });
});

/* ── Validation and the link helpers ──────────────────────────────────── */

describe("validation", () => {
  it("needs a name the map doesn't already have", () => {
    const nodes = [n("a", "Payments")];
    expect(validateNode(EMPTY_NODE, nodes)).toEqual({
      ok: false,
      errors: { label: "Name the team, service or deliverable." },
    });
    expect(validateNode({ ...EMPTY_NODE, label: " payments " }, nodes)).toEqual({
      ok: false,
      errors: { label: "“Payments” is already on the map." },
    });
    expect(validateNode({ label: " Payments ", team: " ", description: "" }, nodes, "a")).toEqual({
      ok: true,
      values: { label: "Payments" },
    });
  });

  it("needs two different sides and a type, and refuses a second copy", () => {
    const edges = [e("1", "a", "b"), e("2", "a", "c", "needs", { status: "resolved" })];
    expect(validateEdge(EMPTY_EDGE, edges)).toEqual({
      ok: false,
      errors: {
        from: "Choose the first side.",
        to: "Choose the second side.",
        kind: "Pick a type.",
      },
    });
    expect(validateEdge({ ...EMPTY_EDGE, from: "a", to: "a", kind: "needs" }, edges)).toMatchObject(
      {
        ok: false,
        errors: { to: "Choose a different side: a node can't depend on itself." },
      }
    );
    expect(validateEdge({ ...EMPTY_EDGE, from: "a", to: "b", kind: "needs" }, edges)).toMatchObject(
      {
        errors: { kind: "This dependency is already on the map." },
      }
    );
    expect(validateEdge({ ...EMPTY_EDGE, from: "a", to: "c", kind: "needs" }, edges)).toMatchObject(
      {
        errors: { kind: "This dependency is already on the map, resolved. Reopen it instead." },
      }
    );
    // Editing an edge doesn't clash with itself; a past due date is allowed.
    expect(
      validateEdge(
        { ...EMPTY_EDGE, from: "a", to: "b", kind: "needs", due: "2020-01-01", owner: " Ana " },
        edges,
        "1"
      )
    ).toEqual({
      ok: true,
      values: {
        from: "a",
        to: "b",
        kind: "needs",
        status: "open",
        owner: "Ana",
        due: "2020-01-01",
      },
    });
  });
});

describe("linking from other tools", () => {
  const ref = { tool: "pi-planning", id: "item-1" };
  let i = 0;
  const makeId = () => `id${++i}`;

  it("adds both sides and the edge, and Undo takes back only what it added", () => {
    seed([n("keep", "Payments")], [e("x", "keep", "keep2")]);
    const result = linkDependency({ from: "Checkout", to: "payments", sourceRef: ref }, makeId);
    expect(result.addedEdge).toBe(true);
    expect(result.addedNodes).toHaveLength(1); // "payments" matched the existing node
    expect(map().edges.find((x) => x.id === result.edgeId)).toMatchObject({
      to: "keep",
      kind: "needs",
      status: "open",
      sourceRef: ref,
    });
    expect(findLinkedEdge(map(), ref)?.id).toBe(result.edgeId);
    unlink(result);
    expect(map().nodes.map((x) => x.id)).toEqual(["keep"]);
    expect(map().edges.map((x) => x.id)).toEqual(["x"]);
  });

  it("reuses an identical open edge, finds it by its sides, and Undo leaves it alone", () => {
    seed([n("c", "Checkout"), n("p", "Payments")], [e("old", "c", "p")]);
    const result = linkDependency({ from: "Checkout", to: "Payments", sourceRef: ref }, makeId);
    expect(result).toEqual({ edgeId: "old", addedEdge: false, addedNodes: [] });
    expect(
      findLinkedEdge(
        map(),
        { tool: "scrum-of-scrums", id: "s" },
        { from: "checkout", to: "PAYMENTS" }
      )?.id
    ).toBe("old");
    unlink(result);
    expect(map().edges.map((x) => x.id)).toEqual(["old"]);
  });

  it("resolves on the map with a stamp, and reopening clears it", () => {
    seed([n("c"), n("p")], [e("old", "c", "p")]);
    setEdgeStatus("old", "resolved", new Date("2026-10-23T09:00:00Z"));
    expect(map().edges[0]).toMatchObject({
      status: "resolved",
      resolvedAt: "2026-10-23T09:00:00.000Z",
    });
    setEdgeStatus("old", "open");
    expect(map().edges[0].resolvedAt).toBeUndefined();
  });
});

describe("date labels", () => {
  it("reads YYYY-MM-DD as a local day", () => {
    expect(dayLabel("2026-11-02")).toBe("2 Nov");
    expect(dayLabel("2026-11-02", true)).toBe("2 Nov 2026");
    expect(dayLabel("not a date")).toBe("not a date");
    expect(dayFrom(new Date(2026, 9, 30), 3)).toBe("2026-11-02");
  });
});

/* ── The page ─────────────────────────────────────────────────────────── */

describe("Dependency Map page", () => {
  it("loads the example from the empty state and clears only example rows", () => {
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(map().nodes).toHaveLength(6);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `^4 open dependencies \\(1 at risk\\), 1 overdue: Payments API → Checkout, due ${dayLabel(
            dayFrom(new Date(), -3)
          )}\\.$`
        )
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "Dependency graph" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Critical path" }).children).toHaveLength(3);

    ws().upsertDependencyMap({ ...map(), nodes: [...map().nodes, n("mine", "Mine")] });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(map().nodes.map((x) => x.id)).toEqual(["mine"]);
  });

  it("counts only valid edges and loads old status-less edges as open", () => {
    seed([n("a", "A"), n("b", "B")], [e("1", "a", "b"), e("dangling", "a", "gone")]);
    renderMap();
    expect(screen.getByText("Dependencies").closest("div")!.parentElement!).toHaveTextContent("1");
    const list = screen.getByRole("list", { name: "Dependencies" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("Open")).toBeInTheDocument();
  });

  it("adds a node only once it has a name", () => {
    renderMap();
    const name = screen.getByLabelText(/^Name/);
    fireEvent.submit(name.closest("form")!);
    expect(map().nodes).toEqual([]);
    expect(screen.getByText("Name the team, service or deliverable.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Checkout" } });
    fireEvent.change(screen.getByLabelText(/^Owning team/), { target: { value: "Web" } });
    fireEvent.submit(name.closest("form")!);
    expect(map().nodes).toMatchObject([{ label: "Checkout", team: "Web" }]);
  });

  it("adds a dependency only once a type is picked, open by default", () => {
    seed([n("a", "Checkout"), n("b", "Payments")]);
    renderMap();
    const from = screen.getByLabelText(/^From/);
    fireEvent.change(from, { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: "b" } });
    fireEvent.submit(from.closest("form")!);
    expect(map().edges).toEqual([]);
    expect(screen.getByText("Pick a type.")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Type" })).getByRole("radio", { name: "needs" })
    );
    expect(screen.getByText("Reads: Checkout needs Payments.")).toBeInTheDocument();
    fireEvent.submit(from.closest("form")!);
    expect(map().edges).toMatchObject([{ from: "a", to: "b", kind: "needs", status: "open" }]);
  });

  it("edits a dependency in place: status, owner, due date and note", () => {
    seed([n("a", "Checkout"), n("b", "Payments")], [e("1", "a", "b")]);
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Edit Checkout needs Payments" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    fireEvent.click(within(editor).getByRole("radio", { name: "At risk" }));
    fireEvent.change(within(editor).getByLabelText(/^Owner/), { target: { value: "Ana" } });
    fireEvent.change(within(editor).getByLabelText(/^Due/), { target: { value: "2026-10-01" } });
    fireEvent.change(within(editor).getByLabelText(/^Note/), { target: { value: "API keys" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    expect(map().edges[0]).toMatchObject({
      status: "at-risk",
      owner: "Ana",
      due: "2026-10-01",
      note: "API keys",
    });
    const row = within(screen.getByRole("list", { name: "Dependencies" })).getByRole("listitem");
    expect(row).toHaveTextContent("At risk· overdue");
    expect(row).toHaveTextContent("Owner: Ana");
  });

  it("resolves and reopens from the list", () => {
    seed([n("a", "Checkout"), n("b", "Payments")], [e("1", "a", "b")]);
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Resolve Checkout needs Payments" }));
    expect(map().edges[0].status).toBe("resolved");
    expect(map().edges[0].resolvedAt).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reopen Checkout needs Payments" }));
    expect(map().edges[0]).toMatchObject({ status: "open" });
    expect(map().edges[0].resolvedAt).toBeUndefined();
  });

  it("filters by status and overdue", () => {
    const past = dayFrom(new Date(), -2);
    seed(
      [n("a", "A"), n("b", "B"), n("c", "C")],
      [
        e("1", "a", "b", "needs", { due: past }),
        e("2", "a", "c", "needs", { status: "resolved" }),
        e("3", "b", "c", "needs", { status: "at-risk" }),
      ]
    );
    renderMap();
    const list = () =>
      within(screen.getByRole("list", { name: "Dependencies" })).getAllByRole("listitem");
    expect(list()).toHaveLength(3);
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Show dependencies" })).getByRole("radio", {
        name: "Resolved",
      })
    );
    expect(list()).toHaveLength(1);
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Show dependencies" })).getByRole("radio", {
        name: "All",
      })
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Overdue only" }));
    expect(list()).toHaveLength(1);
    expect(list()[0]).toHaveTextContent("A");
  });

  it("asks before removing a node with dependencies, then offers Undo for both", () => {
    seed(
      [n("a", "Checkout"), n("b", "Payments"), n("c", "Mobile")],
      [e("1", "a", "b"), e("2", "c", "b"), e("3", "c", "a")]
    );
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Remove node Payments" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove “Payments”?");
    expect(dialog).toHaveTextContent("Its 2 dependencies go with it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove node" }));
    expect(map().nodes.map((x) => x.id)).toEqual(["a", "c"]);
    expect(map().edges.map((x) => x.id)).toEqual(["3"]);
    expect(lastToast()[0]).toBe("Removed “Payments”");
    undoLast();
    expect(map().nodes.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(map().edges.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("removes a node without dependencies straight away, with Undo, and an edge with Undo", () => {
    seed([n("a", "Checkout"), n("b", "Payments"), n("z", "Lonely")], [e("1", "a", "b")]);
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Remove node Lonely" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(map().nodes).toHaveLength(2);
    undoLast();
    expect(map().nodes.map((x) => x.id)).toEqual(["a", "b", "z"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove dependency Checkout needs Payments" })
    );
    expect(map().edges).toEqual([]);
    expect(lastToast()[0]).toBe("Removed “Checkout needs Payments”");
    undoLast();
    expect(map().edges.map((x) => x.id)).toEqual(["1"]);
  });

  it("renames a node in place and keeps the list order", () => {
    seed([n("a", "Checkout"), n("b", "Payments")]);
    renderMap();
    fireEvent.click(screen.getByRole("button", { name: "Edit Checkout" }));
    const editor = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const name = within(editor).getByLabelText(/^Name/);
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "payments" } });
    fireEvent.submit(editor);
    expect(screen.getByText("“Payments” is already on the map.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Web checkout" } });
    fireEvent.submit(editor);
    expect(map().nodes.map((x) => x.label)).toEqual(["Web checkout", "Payments"]);
  });
});
