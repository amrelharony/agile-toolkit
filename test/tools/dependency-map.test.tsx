import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useHistoryStore } from "@/lib/history/history-store";
import type { HistoryEvent } from "@/lib/history/types";
import type { DependencyEdge, DependencyNode } from "@/lib/stores/workspace-types";

/**
 * Dependency Map: a synced singleton graph. Covers adding / removing nodes
 * and edges (validation, de-duplication), cycle detection (direction of
 * "blocks" vs "needs", de-duplicated rotations, informs ignored), the
 * critical path, orphan-edge hygiene, the KPI strip, the recent-blockers
 * callout and the CSV export.
 */

const exported = vi.hoisted(() => ({
  csv: undefined as { headers: string[]; rows: (string | number)[][] } | undefined,
}));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ csvData }: { csvData?: typeof exported.csv }) => {
    exported.csv = csvData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { DependencyMapClient } from "@/app/(tools)/dependency-map/dependency-map-client";

const DM_ID = "dependency-map:current";

const node = (id: string, label = id.toUpperCase(), team?: string): DependencyNode => ({
  id,
  label,
  ...(team ? { team } : {}),
});
const edge = (
  id: string,
  from: string,
  to: string,
  kind: DependencyEdge["kind"] = "blocks"
): DependencyEdge => ({ id, from, to, kind });

function seed(nodes: DependencyNode[], edges: DependencyEdge[] = []) {
  useWorkspaceStore.setState({ dependencyMaps: [{ id: DM_ID, nodes, edges }] });
}
const doc = () => (useWorkspaceStore.getState().dependencyMaps ?? []).find((d) => d.id === DM_ID);

function kpi(label: string): string {
  const el = screen.getByText(label, { selector: "span" });
  return el.parentElement!.parentElement!.children[1].textContent ?? "";
}

function choose(trigger: string, option: string) {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

function blockerEvent(id: string, daysAgo: number): HistoryEvent {
  return {
    id,
    clientEventId: id,
    clientId: "c",
    toolRunId: "r",
    userId: null,
    toolId: "impediments",
    action: "impediment_raised",
    payload: {},
    occurredAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  } as HistoryEvent;
}

const cycleCallout = () => screen.queryByText(/Circular dependencies detected/);
const criticalCallout = () => screen.queryByText(/^Critical path \(/);

beforeEach(() => {
  history.log.mockClear();
  exported.csv = undefined;
  useWorkspaceStore.setState({ dependencyMaps: [] });
  useHistoryStore.setState({ events: [] });
});

describe("Dependency Map: nodes", () => {
  it("starts with zeroed KPIs and no callouts", () => {
    render(<DependencyMapClient />);
    expect(kpi("Nodes")).toBe("0");
    expect(kpi("Edges")).toBe("0");
    expect(kpi("Cycles")).toBe("0");
    expect(cycleCallout()).toBeNull();
    expect(criticalCallout()).toBeNull();
  });

  it("adds a trimmed node, dropping a blank team / description, and resets the form", () => {
    render(<DependencyMapClient />);
    fireEvent.change(screen.getByLabelText("New node label"), {
      target: { value: "  Checkout API  " },
    });
    fireEvent.change(screen.getByLabelText("New node team (optional)"), {
      target: { value: "   " },
    });
    fireEvent.change(screen.getByLabelText("New node description"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add node" }));

    const nodes = doc()!.nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe("Checkout API");
    expect(nodes[0].team).toBeUndefined();
    expect(nodes[0].description).toBeUndefined();
    expect(kpi("Nodes")).toBe("1");
    expect(history.log).toHaveBeenCalledWith(
      "node_added",
      expect.objectContaining({ label: "Checkout API" })
    );
    expect(screen.getByLabelText("New node label")).toHaveValue("");
  });

  it("keeps the team and description, capping the label at 240 characters", () => {
    render(<DependencyMapClient />);
    fireEvent.change(screen.getByLabelText("New node label"), {
      target: { value: "L".repeat(300) },
    });
    fireEvent.change(screen.getByLabelText("New node team (optional)"), {
      target: { value: " Payments " },
    });
    fireEvent.change(screen.getByLabelText("New node description"), {
      target: { value: "Owns the PSP integration" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add node" }));
    const n = doc()!.nodes[0];
    expect(n.label).toHaveLength(240);
    expect(n.team).toBe("Payments");
    expect(n.description).toBe("Owns the PSP integration");
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByText("Owns the PSP integration")).toBeInTheDocument();
  });

  it("ignores a blank label and adds with Ctrl+Enter from the description", () => {
    render(<DependencyMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add node" }));
    expect(doc()).toBeUndefined();

    fireEvent.change(screen.getByLabelText("New node label"), { target: { value: "Search" } });
    fireEvent.keyDown(screen.getByLabelText("New node description"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(doc()!.nodes.map((n) => n.label)).toEqual(["Search"]);
  });

  it("removing a node also removes every edge touching it", () => {
    seed(
      [node("a"), node("b"), node("c")],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a", "informs")]
    );
    render(<DependencyMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove node A" }));
    expect(doc()!.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(doc()!.edges.map((e) => e.id)).toEqual(["e2"]);
    expect(history.log).toHaveBeenCalledWith("node_removed", { nodeId: "a", label: "A" });
  });
});

describe("Dependency Map: edges", () => {
  beforeEach(() => seed([node("a", "Alpha"), node("b", "Beta")]));

  it("adds a dependency picked from the selects", () => {
    render(<DependencyMapClient />);
    choose("Dependency from", "Alpha");
    choose("Dependency type", "needs");
    choose("Dependency to", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    const edges = doc()!.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: "a", to: "b", kind: "needs" });
    expect(kpi("Edges")).toBe("1");
    expect(
      screen.getByRole("button", { name: "Remove dependency: Alpha needs Beta" })
    ).toBeInTheDocument();
    expect(history.log).toHaveBeenCalledWith(
      "edge_added",
      expect.objectContaining({ from: "a", to: "b", kind: "needs" })
    );
  });

  it("refuses duplicates, self-edges and missing endpoints", () => {
    render(<DependencyMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    expect(doc()!.edges).toEqual([]);

    choose("Dependency from", "Alpha");
    choose("Dependency to", "Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    expect(doc()!.edges).toEqual([]);

    choose("Dependency to", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    expect(doc()!.edges).toHaveLength(1);
  });

  // Bug: the picked endpoints were not re-checked against the live nodes, so
  // deleting a picked node and pressing Add stored an edge to nothing.
  it("does not add an edge to a node deleted after it was picked", () => {
    render(<DependencyMapClient />);
    choose("Dependency from", "Alpha");
    choose("Dependency to", "Beta");
    fireEvent.click(screen.getByRole("button", { name: "Remove node Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Add dependency" }));
    expect(doc()!.edges).toEqual([]);
    expect(history.log).not.toHaveBeenCalledWith("edge_added", expect.anything());
  });

  it("removes exactly the clicked dependency", () => {
    seed(
      [node("a", "Alpha"), node("b", "Beta")],
      [edge("e1", "a", "b", "blocks"), edge("e2", "a", "b", "informs")]
    );
    render(<DependencyMapClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove dependency: Alpha informs Beta" }));
    expect(doc()!.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(history.log).toHaveBeenCalledWith("edge_removed", { edgeId: "e2" });
  });
});

describe("Dependency Map: cycles and critical path", () => {
  it("reports a three-node cycle once, starting from the smallest id", () => {
    seed(
      [node("b", "Beta"), node("c", "Gamma"), node("a", "Alpha")],
      [edge("e1", "b", "c"), edge("e2", "c", "a"), edge("e3", "a", "b")]
    );
    render(<DependencyMapClient />);
    expect(kpi("Cycles")).toBe("1");
    expect(cycleCallout()).toBeInTheDocument();
    expect(screen.getByText("Alpha → Beta → Gamma → Alpha")).toBeInTheDocument();
    expect(criticalCallout()).toBeNull();
  });

  it("reads 'A needs B' as B before A: 'A blocks B' plus 'B needs A' is not a cycle", () => {
    seed(
      [node("a", "Alpha"), node("b", "Beta")],
      [edge("e1", "a", "b"), edge("e2", "b", "a", "needs")]
    );
    render(<DependencyMapClient />);
    expect(kpi("Cycles")).toBe("0");
    expect(screen.getByText(/Alpha → Beta$/)).toBeInTheDocument();
  });

  it("'A blocks B' plus 'A needs B' contradict each other and form a cycle", () => {
    seed(
      [node("a", "Alpha"), node("b", "Beta")],
      [edge("e1", "a", "b"), edge("e2", "a", "b", "needs")]
    );
    render(<DependencyMapClient />);
    expect(kpi("Cycles")).toBe("1");
    expect(screen.getByText("Alpha → Beta → Alpha")).toBeInTheDocument();
  });

  it("ignores informs edges for cycles and the critical path", () => {
    seed(
      [node("a"), node("b")],
      [edge("e1", "a", "b", "informs"), edge("e2", "b", "a", "informs")]
    );
    render(<DependencyMapClient />);
    expect(kpi("Cycles")).toBe("0");
    expect(criticalCallout()).toBeNull();
  });

  it("finds the longest blocking chain and marks its nodes", () => {
    seed(
      [node("a", "Design"), node("b", "Build"), node("c", "Test"), node("d", "Docs")],
      [
        edge("e1", "a", "b"),
        edge("e2", "c", "b", "needs"), // Build before Test
        edge("e3", "a", "d"),
      ]
    );
    render(<DependencyMapClient />);
    expect(screen.getByText(/^Critical path \(3 nodes\):$/)).toBeInTheDocument();
    expect(screen.getByText(/Design → Build → Test$/)).toBeInTheDocument();
    expect(screen.getAllByText("(on critical path)")).toHaveLength(3);
  });

  it("strips orphan, self and unknown-kind edges before analysing or listing", () => {
    useWorkspaceStore.setState({
      dependencyMaps: [
        {
          id: DM_ID,
          nodes: [node("a", "Alpha"), node("b", "Beta")],
          edges: [
            edge("ok", "a", "b"),
            edge("self", "a", "a"),
            edge("orphan", "b", "ghost"),
            { id: "weird", from: "b", to: "a", kind: "loves" as DependencyEdge["kind"] },
          ],
        },
      ],
    });
    render(<DependencyMapClient />);
    expect(kpi("Cycles")).toBe("0");
    expect(screen.getAllByRole("button", { name: /^Remove dependency:/ })).toHaveLength(1);
  });

  // Bug: the Edges KPI counted the raw edge list (orphans, self-edges)
  // while the list beside it showed only the valid ones.
  it("counts only the valid, listed edges in the Edges KPI", () => {
    seed([node("a"), node("b")], [edge("ok", "a", "b"), edge("orphan", "b", "ghost")]);
    render(<DependencyMapClient />);
    expect(kpi("Edges")).toBe("1");
  });
});

describe("Dependency Map: callouts and export", () => {
  it("shows the recent-blockers callout from three impediments in 14 days", () => {
    useHistoryStore.setState({
      events: [blockerEvent("1", 1), blockerEvent("2", 5), blockerEvent("3", 13)],
    });
    render(<DependencyMapClient />);
    expect(screen.getByText(/3 blockers raised in last 14 days/)).toBeInTheDocument();
  });

  it("stays quiet with fewer than three recent impediments", () => {
    useHistoryStore.setState({
      events: [blockerEvent("1", 1), blockerEvent("2", 2), blockerEvent("3", 30)],
    });
    render(<DependencyMapClient />);
    expect(screen.queryByText(/blockers raised in last 14 days/)).toBeNull();
  });

  it("exports node rows then edge rows with labels for endpoints", () => {
    seed(
      [{ ...node("a", "Alpha", "Core"), description: "First" }, node("b", "Beta")],
      [edge("e1", "a", "b", "needs")]
    );
    render(<DependencyMapClient />);
    expect(exported.csv?.rows).toEqual([
      ["node", "a", "Alpha", "First", "", "", "Core"],
      ["node", "b", "Beta", "", "", "", ""],
      ["edge", "e1", "needs", "", "Alpha", "Beta", ""],
    ]);
  });
});
