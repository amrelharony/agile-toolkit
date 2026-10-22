import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { TreeNode } from "@/lib/stores/workspace-types";

/**
 * Opportunity Solution Tree: outcome → opportunity → solution → experiment,
 * edit on blur, cascading delete, defensive rendering of corrupted trees,
 * and the CSV export.
 */

const h = vi.hoisted(() => ({
  log: vi.fn(),
  exported: {} as { csvData?: { headers: string[]; rows: unknown[][] }; jsonData?: unknown },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (props: {
    csvData?: { headers: string[]; rows: unknown[][] };
    jsonData?: unknown;
  }) => {
    h.exported.csvData = props.csvData;
    h.exported.jsonData = props.jsonData;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: h.log }),
}));

import { OpportunityTreeClient } from "@/app/(tools)/opportunity-tree/opportunity-tree-client";

const OT_ID = "opportunityTree:current";

const node = (
  id: string,
  kind: TreeNode["kind"],
  parentId: string | null,
  patch: Partial<TreeNode> = {}
): TreeNode => ({ id, kind, text: `${kind} ${id}`, parentId, ...patch });

const seed = (...nodes: TreeNode[]) =>
  useWorkspaceStore.setState({ opportunityTrees: [{ id: OT_ID, nodes }] });

const stored = () =>
  (useWorkspaceStore.getState().opportunityTrees ?? []).find((d) => d.id === OT_ID)?.nodes ?? [];

/** The text area holding a node's main text. */
const textOf = (text: string) => screen.getByDisplayValue(text) as HTMLTextAreaElement;

beforeEach(() => {
  h.log.mockClear();
  h.exported.csvData = undefined;
  h.exported.jsonData = undefined;
  useWorkspaceStore.setState({ opportunityTrees: [] });
});

describe("Opportunity Tree — empty state", () => {
  it("prompts for a first outcome", () => {
    render(<OpportunityTreeClient />);
    expect(screen.getByText(/No outcomes yet/)).toBeInTheDocument();
    expect(h.exported.csvData?.rows).toEqual([]);
  });
});

describe("Opportunity Tree — building the tree", () => {
  it("adds a root outcome to the synced tree doc", () => {
    render(<OpportunityTreeClient />);
    fireEvent.click(screen.getByRole("button", { name: /Add Outcome/ }));
    const [root] = stored();
    expect(stored()).toHaveLength(1);
    expect(root).toMatchObject({ kind: "outcome", text: "", parentId: null });
    expect(screen.getByPlaceholderText("outcome...")).toBeInTheDocument();
    expect(screen.queryByText(/No outcomes yet/)).not.toBeInTheDocument();
    expect(h.log).toHaveBeenCalledWith("node_added", { nodeId: root.id, kind: "outcome" });
  });

  it("adds each child one level down: opportunity → solution → experiment, then stops", () => {
    seed(node("o1", "outcome", null));
    render(<OpportunityTreeClient />);

    fireEvent.click(screen.getByRole("button", { name: "Add opportunity" }));
    const opp = stored()[1];
    expect(opp).toMatchObject({ kind: "opportunity", parentId: "o1", text: "" });
    expect(h.log).toHaveBeenLastCalledWith("node_added", {
      nodeId: opp.id,
      kind: "opportunity",
      parentId: "o1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Add solution" }));
    const sol = stored()[2];
    expect(sol).toMatchObject({ kind: "solution", parentId: opp.id });

    fireEvent.click(screen.getByRole("button", { name: "Add experiment" }));
    const exp = stored()[3];
    expect(exp).toMatchObject({ kind: "experiment", parentId: sol.id });

    // An experiment is a leaf: four nodes, three "Add …" buttons.
    expect(
      screen.getAllByRole("button", { name: /^Add (opportunity|solution|experiment)$/ })
    ).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(4);
  });

  it("renders children under their own parent", () => {
    seed(
      node("o1", "outcome", null),
      node("o2", "outcome", null),
      node("p1", "opportunity", "o2"),
      node("p2", "opportunity", "o1")
    );
    render(<OpportunityTreeClient />);
    // A node's block = its card plus its children; each outcome holds only its own opportunity.
    const block = (text: string) => textOf(text).closest("div.rounded-lg")!.parentElement!;
    expect(block("outcome o1")).toContainElement(textOf("opportunity p2"));
    expect(block("outcome o1")).not.toContainElement(textOf("opportunity p1"));
    expect(block("outcome o2")).toContainElement(textOf("opportunity p1"));
  });

  it("offers an evidence field only on opportunities and experiments", () => {
    seed(
      node("o1", "outcome", null),
      node("p1", "opportunity", "o1"),
      node("s1", "solution", "p1"),
      node("e1", "experiment", "s1")
    );
    render(<OpportunityTreeClient />);
    expect(screen.getAllByPlaceholderText("Evidence / data...")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("Description (optional)...")).toHaveLength(4);
  });
});

describe("Opportunity Tree — editing", () => {
  it("commits text, description and evidence on blur to the right node", () => {
    seed(node("o1", "outcome", null), node("p1", "opportunity", "o1"));
    render(<OpportunityTreeClient />);

    const text = textOf("opportunity p1");
    fireEvent.change(text, { target: { value: "Setup is confusing" } });
    expect(stored()[1].text).toBe("opportunity p1");
    fireEvent.blur(text);
    expect(stored()[1].text).toBe("Setup is confusing");

    const evidence = screen.getByPlaceholderText("Evidence / data...");
    fireEvent.change(evidence, { target: { value: "6/10 interviews" } });
    fireEvent.blur(evidence);
    const description = screen.getAllByPlaceholderText("Description (optional)...")[1];
    fireEvent.change(description, { target: { value: "seen in onboarding" } });
    fireEvent.blur(description);

    expect(stored()[1]).toMatchObject({
      text: "Setup is confusing",
      evidence: "6/10 interviews",
      description: "seen in onboarding",
    });
    expect(stored()[0]).toEqual(node("o1", "outcome", null));
  });

  it("lets a node's text be cleared", () => {
    seed(node("o1", "outcome", null));
    render(<OpportunityTreeClient />);
    const text = textOf("outcome o1");
    fireEvent.change(text, { target: { value: "" } });
    fireEvent.blur(text);
    expect(stored()[0].text).toBe("");
  });
});

describe("Opportunity Tree — delete", () => {
  it("removes a node with its whole subtree and nothing else", () => {
    seed(
      node("o1", "outcome", null),
      node("p1", "opportunity", "o1"),
      node("s1", "solution", "p1"),
      node("e1", "experiment", "s1"),
      node("p2", "opportunity", "o1"),
      node("s2", "solution", "p2")
    );
    render(<OpportunityTreeClient />);
    // Remove buttons are in render order: o1, p1, s1, e1, p2, s2.
    fireEvent.click(screen.getAllByRole("button", { name: "Remove opportunity" })[0]);
    expect(stored().map((n) => n.id)).toEqual(["o1", "p2", "s2"]);
    expect(h.log).toHaveBeenCalledWith("node_removed", { nodeId: "p1", kind: "opportunity" });
    expect(screen.queryByDisplayValue("experiment e1")).not.toBeInTheDocument();
  });

  it("removing a root clears the tree back to the empty state", () => {
    seed(node("o1", "outcome", null), node("p1", "opportunity", "o1"));
    render(<OpportunityTreeClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove outcome" }));
    expect(stored()).toEqual([]);
    expect(screen.getByText(/No outcomes yet/)).toBeInTheDocument();
  });

  it("terminates on a corrupted tree whose parent links form a cycle", () => {
    seed(
      node("o1", "outcome", null),
      node("p1", "opportunity", "o1"),
      node("x", "solution", "y"),
      node("y", "solution", "x")
    );
    render(<OpportunityTreeClient />);
    // The cycle has no root, so it never renders...
    expect(screen.queryByDisplayValue("solution x")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove outcome" }));
    // ...and deleting the real tree leaves it alone.
    expect(stored().map((n) => n.id)).toEqual(["x", "y"]);
  });
});

describe("Opportunity Tree — defensive rendering", () => {
  it("caps rendering at 31 levels for a pathological chain", () => {
    const chain = Array.from({ length: 40 }, (_, i) =>
      node(`n${i}`, "outcome", i === 0 ? null : `n${i - 1}`)
    );
    seed(...chain);
    render(<OpportunityTreeClient />);
    expect(screen.getAllByPlaceholderText("outcome...")).toHaveLength(31);
  });

  it("renders a node of an unknown kind without an add-child button", () => {
    seed({
      id: "g1",
      kind: "goal" as unknown as TreeNode["kind"],
      text: "legacy goal",
      parentId: null,
    });
    render(<OpportunityTreeClient />);
    expect(textOf("legacy goal")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Add (opportunity|solution|experiment)$/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove goal" })).toBeInTheDocument();
  });
});

describe("Opportunity Tree — export", () => {
  it("exports a CSV row per node with the parent's text instead of its id", () => {
    seed(
      node("o1", "outcome", null, { description: "north star" }),
      node("p1", "opportunity", "o1", { evidence: "interviews" })
    );
    render(<OpportunityTreeClient />);
    expect(h.exported.csvData?.headers).toEqual([
      "Kind",
      "Text",
      "Description",
      "Parent",
      "Evidence",
    ]);
    expect(h.exported.csvData?.rows).toEqual([
      ["outcome", "outcome o1", "north star", "", ""],
      ["opportunity", "opportunity p1", "", "outcome o1", "interviews"],
    ]);
    expect(h.exported.jsonData).toEqual(stored());
  });
});
