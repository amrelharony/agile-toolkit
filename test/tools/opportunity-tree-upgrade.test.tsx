import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Hypothesis, JobStory, TreeNode } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";
import { OPPORTUNITY_TREE_ID } from "@/lib/opportunity-tree/model";
import { registry } from "@/lib/actions/registry";
import { OPPORTUNITIES } from "../stores/phase8-fixtures";

/**
 * Opportunity Tree, upgraded (Phase 8): nodes are saved only with their
 * text; an opportunity holds sub-opportunities and solutions; one target
 * opportunity per outcome; deleting a branch asks first and Undo brings
 * it back with its ids (JTBD links resolve again); an experiment becomes
 * a hypothesis and shows where its test stands; theme tones instead of
 * hex colours; an example, a verdict and a Markdown export, with the
 * agent following the same rules.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { OpportunityTreeClient } from "@/app/(tools)/opportunity-tree/opportunity-tree-client";
import { buildExample } from "@/app/(tools)/opportunity-tree/example";
import { treeToMarkdown } from "@/app/(tools)/opportunity-tree/markdown";
import { validateNode } from "@/app/(tools)/opportunity-tree/form";
import {
  deleteNote,
  deleteQuestion,
  drawTree,
  subtreeSummary,
  treeVerdict,
} from "@/app/(tools)/opportunity-tree/view";
import { resolveOpportunity } from "@/app/(tools)/jtbd-mapper/opportunities";
import "@/lib/actions/tools/opportunity-tree";

const TODAY = todayLocalISO();

const node = (
  id: string,
  kind: TreeNode["kind"],
  text: string,
  parentId: string | null,
  over: Partial<TreeNode> = {}
): TreeNode => ({ id, kind, text, parentId, ...over });

const TREE: TreeNode[] = [
  node("o1", "outcome", "Blockers seen sooner", null),
  node("op1", "opportunity", "Leads can't see blocked work", "o1"),
  node("op2", "opportunity", "Status is rebuilt by hand", "op1"),
  node("s1", "solution", "A Monday digest", "op2"),
  node("e1", "experiment", "Email five leads a digest", "s1", { description: "Two weeks" }),
  node("o2", "outcome", "Fewer handoff stalls", null),
  node("op3", "opportunity", "Waiting on other teams", "o2", { target: true }),
];

const ws = () => useWorkspaceStore.getState();
const nodes = () =>
  (ws().opportunityTrees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID)?.nodes ?? [];
const one = (id: string) => nodes().find((n) => n.id === id);
const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const seed = (list: TreeNode[], hs: Hypothesis[] = [], jobs: JobStory[] = []) =>
  useWorkspaceStore.setState({
    opportunityTrees: list.length > 0 ? [{ id: OPPORTUNITY_TREE_ID, nodes: list }] : [],
    hypothesisTrackers: hs.length > 0 ? [{ id: HYPOTHESIS_TRACKER_ID, hypotheses: hs }] : [],
    jobStories: jobs,
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <OpportunityTreeClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const card = (text: string) => screen.getByRole("article", { name: new RegExp(`^${text}`) });
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const run = <T,>(verb: string, params: Record<string, unknown> = {}) => {
  const action = registry.get(`tool.opportunity_tree.${verb}`)!;
  return action.handler(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

beforeEach(() => {
  toastSpy.mockReset();
  seed([]);
});

/* ── The rules ──────────────────────────────────────────────────────── */

describe("the node check and the tree as drawn", () => {
  it("needs text and a place the kind may go", () => {
    const draft = { text: "  ", description: "", evidence: "" };
    expect(validateNode(draft, "outcome", { parent: null })).toMatchObject({ ok: false });
    expect(
      validateNode({ ...draft, text: "Ship it" }, "experiment", { parent: null })
    ).toMatchObject({ ok: false, errors: { text: "A experiment can't go there." } });
    expect(validateNode({ ...draft, text: " Sub " }, "opportunity", { parent: TREE[1] })).toEqual({
      ok: true,
      values: { text: "Sub", description: undefined, evidence: undefined },
    });
  });

  it("draws a node whose parent is gone, and one a cycle cuts off, at the top", () => {
    const { roots } = drawTree([
      node("a", "outcome", "A", null),
      node("lost", "opportunity", "Lost", "gone"),
      node("x", "opportunity", "X", "y"),
      node("y", "opportunity", "Y", "x"),
    ]);
    expect(roots.map((n) => n.id)).toEqual(["a", "lost", "x"]);
  });

  it("names what a delete takes, linked jobs and the hypotheses that stay", () => {
    const tree = TREE.map((n) =>
      n.id === "e1"
        ? { ...n, sentTo: [{ route: "hypothesis" as const, targetId: "h1", at: "2026-10-01" }] }
        : n
    );
    const s = subtreeSummary(tree, "op1", [{ opportunityId: "op2" }, { opportunityId: "op3" }]);
    expect(s.ids).toEqual(new Set(["op1", "op2", "s1", "e1"]));
    expect(deleteQuestion(tree[1], s)).toBe(
      "Delete “Leads can't see blocked work” with 1 opportunity, 1 solution and 1 experiment?"
    );
    expect(deleteNote(s)).toBe(
      "The hypothesis sent from its experiments stays in the Hypothesis Tracker. 1 job story links to it and will read “Opportunity removed”. Undo puts everything back."
    );
  });

  it("sums up targets and tests in one sentence", () => {
    expect(treeVerdict([], [])).toBe("No outcomes yet.");
    const tree = TREE.map((n) =>
      n.id === "e1"
        ? { ...n, sentTo: [{ route: "hypothesis" as const, targetId: "h1", at: "x" }] }
        : n
    );
    expect(treeVerdict(tree, [{ id: "h1", status: "validated" }])).toBe(
      "2 outcomes, 3 opportunities; pursuing “Waiting on other teams” for “Fewer handoff stalls”; 1 of 1 experiment tested."
    );
  });
});

/* ── The page ───────────────────────────────────────────────────────── */

describe("adding and editing nodes", () => {
  it("saves no blank outcome; Enter adds it", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add outcome" }));
    const form = screen.getByRole("group", { name: "New outcome" });
    fireEvent.click(within(form).getByRole("button", { name: "Add outcome" }));
    expect(nodes()).toHaveLength(0);
    expect(within(form).getByRole("alert")).toHaveTextContent("Say the outcome you want to move.");
    const input = within(form).getByLabelText(/^Outcome/);
    fireEvent.change(input, { target: { value: "Faster onboarding" } });
    fireEvent.submit(input.closest("form")!);
    expect(nodes()).toEqual([
      expect.objectContaining({ kind: "outcome", text: "Faster onboarding", parentId: null }),
    ]);
  });

  it("nests a sub-opportunity under an opportunity, and offers each kind it may hold", () => {
    seed(TREE.slice(0, 2));
    renderPage();
    const opp = card("Leads can't see blocked work");
    expect(within(opp).getByRole("button", { name: /^Add solution under/ })).toBeInTheDocument();
    fireEvent.click(within(opp).getByRole("button", { name: /^Add sub-opportunity under/ }));
    const form = screen.getByRole("group", { name: /New opportunity under/ });
    fireEvent.change(within(form).getByLabelText(/^Opportunity/), {
      target: { value: "No one sees stale cards" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add opportunity" }));
    expect(nodes().at(-1)).toMatchObject({ kind: "opportunity", parentId: "op1" });
    // An outcome holds opportunities only; an experiment holds nothing.
    expect(
      within(card("Blockers seen sooner")).getAllByRole("button", { name: /^Add / })
    ).toHaveLength(1);
  });

  it("edits in place and keeps the stored text when it is cleared", () => {
    seed(TREE.slice(0, 1));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Blockers seen sooner" }));
    const group = screen.getByRole("group", { name: /Edit outcome/ });
    const input = within(group).getByLabelText(/^Outcome/);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(within(group).getByRole("button", { name: "Save" }));
    expect(one("o1")?.text).toBe("Blockers seen sooner");
    fireEvent.change(input, { target: { value: "Blocked work seen within a day" } });
    fireEvent.change(within(group).getByLabelText(/^Description/), { target: { value: "median" } });
    fireEvent.click(within(group).getByRole("button", { name: "Save" }));
    expect(one("o1")).toMatchObject({
      text: "Blocked work seen within a day",
      description: "median",
    });
  });

  it("draws a node whose parent is gone instead of losing it", () => {
    seed([node("lost", "opportunity", "An orphan", "gone")]);
    renderPage();
    expect(card("An orphan")).toBeInTheDocument();
  });
});

describe("the target", () => {
  it("allows one per outcome: a second clears the first, another outcome keeps its own", () => {
    seed([...TREE, node("op4", "opportunity", "Too many tools", "o1", { target: true })]);
    renderPage();
    const toggle = within(card("Leads can't see blocked work")).getByRole("button", {
      name: "Target: Leads can't see blocked work",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(one("op1")?.target).toBe(true);
    expect(one("op4")).not.toHaveProperty("target");
    expect(one("op3")?.target).toBe(true);
    // A sub-opportunity serves the same outcome: it takes the target over.
    fireEvent.click(
      within(card("Status is rebuilt by hand")).getByRole("button", { name: /^Target: / })
    );
    expect(one("op2")?.target).toBe(true);
    expect(one("op1")).not.toHaveProperty("target");
    // Off again.
    fireEvent.click(
      within(card("Status is rebuilt by hand")).getByRole("button", { name: /^Target: / })
    );
    expect(one("op2")).not.toHaveProperty("target");
  });
});

describe("deleting", () => {
  it("asks before deleting a branch; Undo brings it back with its ids and a linked job resolves again", () => {
    const job: JobStory = {
      id: "j1",
      situation: "s",
      motivation: "m",
      outcome: "o",
      opportunityId: "op2",
    };
    seed(TREE, [], [job]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Leads can't see blocked work" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Delete “Leads can't see blocked work” with 1 opportunity, 1 solution and 1 experiment?"
    );
    expect(dialog).toHaveTextContent("1 job story links to it");
    expect(nodes()).toHaveLength(7);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(nodes().map((n) => n.id)).toEqual(["o1", "o2", "op3"]);
    const byId = () => new Map(nodes().map((n) => [n.id, n]));
    expect(resolveOpportunity(job, byId()).state).toBe("missing");
    undoLast();
    expect(nodes().map((n) => n.id)).toEqual(TREE.map((n) => n.id));
    expect(resolveOpportunity(job, byId())).toMatchObject({ state: "linked", id: "op2" });
  });

  it("cancelling the dialog deletes nothing", () => {
    seed(TREE);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Blockers seen sooner" }));
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(nodes()).toHaveLength(7);
  });

  it("deletes a leaf at once, with Undo", () => {
    seed(TREE);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Email five leads a digest" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(one("e1")).toBeUndefined();
    undoLast();
    expect(nodes().map((n) => n.id)).toEqual(TREE.map((n) => n.id));
  });
});

describe("an experiment tested as a hypothesis", () => {
  it("makes one drafted hypothesis with the mapping and a link; Undo takes both back", () => {
    seed(TREE);
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: "Test Email five leads a digest as a hypothesis" })
    );
    expect(hypotheses()).toHaveLength(1);
    const h = hypotheses()[0];
    expect(h).toMatchObject({
      status: "drafted",
      believe: "A Monday digest",
      willDo: "Email five leads a digest",
      experiment: "Two weeks",
      toLearn: "Status is rebuilt by hand",
      raisedAt: TODAY,
      sourceRef: { tool: "opportunity-tree", id: "e1", doc: OPPORTUNITY_TREE_ID },
    });
    expect(one("e1")?.sentTo).toEqual([
      expect.objectContaining({ route: "hypothesis", targetId: h.id }),
    ]);
    expect(
      within(card("Email five leads a digest")).getByRole("link", {
        name: /Testing: drafted · Open/,
      })
    ).toHaveAttribute("href", "/hypothesis-tracker");
    undoLast();
    expect(hypotheses()).toHaveLength(0);
    expect(one("e1")?.sentTo ?? []).toEqual([]);
  });

  it("shows the test's result as the tracker records it", () => {
    seed(
      TREE.map((n) =>
        n.id === "e1"
          ? { ...n, sentTo: [{ route: "hypothesis" as const, targetId: "h1", at: "x" }] }
          : n
      ),
      [
        {
          id: "h1",
          believe: "b",
          willDo: "w",
          toLearn: "l",
          successMetric: "s",
          status: "running",
          raisedAt: TODAY,
        },
      ]
    );
    renderPage();
    expect(screen.getByRole("link", { name: /Testing: running · Open/ })).toBeInTheDocument();
    act(() => {
      ws().upsertHypothesisTracker({
        id: HYPOTHESIS_TRACKER_ID,
        hypotheses: [{ ...hypotheses()[0], status: "invalidated", resolvedAt: TODAY }],
      });
    });
    expect(screen.getByRole("link", { name: /Tested: invalidated · Open/ })).toBeInTheDocument();
  });

  it("the agent's send makes the same hypothesis the page does", async () => {
    seed(TREE);
    const sent = await run<{ sent: boolean; hypothesisId: string }>(
      "send_experiment_to_hypothesis",
      {
        nodeId: "e1",
      }
    );
    expect(sent.sent).toBe(true);
    const agent = hypotheses()[0];
    expect(agent).toMatchObject({
      believe: "A Monday digest",
      willDo: "Email five leads a digest",
      experiment: "Two weeks",
      toLearn: "Status is rebuilt by hand",
      sourceRef: { tool: "opportunity-tree", id: "e1", doc: OPPORTUNITY_TREE_ID },
    });
    renderPage();
    // Sent once: the page shows the link, not the button.
    expect(screen.queryByRole("button", { name: /as a hypothesis/ })).toBeNull();
  });

  it("the agent refuses a kind that can't go there", async () => {
    seed(TREE);
    expect(
      await run<{ added: boolean; reason?: string }>("add_node", {
        kind: "outcome",
        text: "x",
        parentId: "e1",
      })
    ).toMatchObject({ added: false, reason: "kind" });
  });
});

describe("first run, example and export", () => {
  it("offers the example from the empty state; its experiments can't be sent; it clears alone", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(nodes().every((n) => isExampleId(n.id))).toBe(true);
    expect(screen.getAllByText("Target opportunity")).toHaveLength(1);
    for (const b of screen.getAllByRole("button", { name: /as a hypothesis/ }))
      expect(b).toBeDisabled();
    act(() => {
      ws().upsertOpportunityTree({
        id: OPPORTUNITY_TREE_ID,
        nodes: [...nodes(), node("mine", "outcome", "Mine", null)],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(nodes().map((n) => n.id)).toEqual(["mine"]);
  });

  it("the example follows the tree's own rules", () => {
    const list = buildExample();
    const byId = new Map(list.map((n) => [n.id, n]));
    for (const n of list) {
      const parent = n.parentId ? (byId.get(n.parentId) ?? null) : null;
      expect(
        validateNode({ text: n.text, description: "", evidence: "" }, n.kind, { parent }).ok,
        n.id
      ).toBe(true);
    }
  });

  it("exports nested Markdown with the target, evidence, source and test states", () => {
    const md = treeToMarkdown(OPPORTUNITIES.nodes, [{ id: "hyp_8", status: "running" }]);
    expect(md).toContain("# Opportunity Solution Tree");
    expect(md).toContain("- **Outcome:** Teams see blockers sooner");
    expect(md).toContain(
      "  - **Opportunity:** I export to a spreadsheet every Friday just to see who's blocked. (**target** · From user interviews)"
    );
    expect(md).toContain("    - Evidence: From an interview on 2026-10-14");
    expect(md).toContain(
      "      - **Experiment:** Email the digest to five teams (Testing: running)"
    );
    expect(treeToMarkdown([], [])).toContain("No outcomes yet.");
  });

  it("shows where a node from an interview came from", () => {
    seed(OPPORTUNITIES.nodes);
    renderPage();
    expect(
      within(card("I export to a spreadsheet")).getByRole("link", { name: /From user interviews/ })
    ).toHaveAttribute("href", "/user-interviews");
  });

  it("uses theme tokens, not hex colours", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../../src/app/(tools)/opportunity-tree");
    for (const f of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/#[0-9a-f]{6}\b/i);
    }
  });
});
