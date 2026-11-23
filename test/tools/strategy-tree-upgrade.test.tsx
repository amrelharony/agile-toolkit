/**
 * Strategy Tree (shelved, on the full contract) against the tool UX
 * contract: an empty state whose example loads a tree of each shape (never
 * logged, cleared exactly); a new tree from a shape and its root; each
 * level with its own label, hint and fields; the status on every part and
 * Hoshin's catchball, with the milestone and Amr's cheer only on the
 * change that agrees the whole tree, in every shape; bets to test and
 * initiatives or priorities to the roadmap, each with Undo and where it
 * stands; deletes with Undo; the draft with and without AI, never with
 * owners, up to the cap; the Markdown with Hoshin's table; ?tree= links.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { WORKSPACE_LOADING_RESERVE } from "@/components/shared/workspace-loading";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HypothesisTracker, StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { HYPOTHESIS_TRACKER_ID, TRACKER_FULL } from "@/lib/hypotheses/model";
import { STRATEGY_TREE_ACTIONS } from "@/lib/history/event-actions";
import { VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION } from "@/lib/visitor-ai/consent";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
const cheers = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({
  cheer: (toolId: string, reason: string) => cheers.push(`${toolId}:${reason}`),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));

import { StrategyTreeClient } from "@/app/(tools)/strategy-tree/strategy-tree-client";
import { buildExamples } from "@/app/(tools)/strategy-tree/example";
import { strategyTreeMarkdown } from "@/app/(tools)/strategy-tree/markdown";
import { strategyMapProblems } from "@/lib/strategy-map/rules";
import { TOO_BIG } from "@/lib/strategy-map/model";
import { ENTITY_ROW_MAX_BYTES } from "@/lib/stores/workspace-types";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { nearlyFull } from "../strategy-map/near-full";

const AT = "2026-11-20T09:00:00.000Z";
const node = (
  id: string,
  parentId: string | null,
  level: StrategyMapNode["level"],
  text: string,
  extra: Partial<StrategyMapNode> = {}
): StrategyMapNode => ({ id, parentId, level, text, status: "proposed", ...extra });

const tree = (
  format: StrategyMap["format"],
  nodes: StrategyMapNode[],
  over: Partial<StrategyMap> = {}
): StrategyMap => ({
  id: "strategyMap_t",
  format,
  title: nodes[0]?.text ?? "Tree",
  nodes,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
/** A Lean Value Tree: vision, goal, bet, initiative. */
const lvt = (over: Partial<StrategyMap> = {}) =>
  tree(
    "lean-value-tree",
    [
      node("v", null, 0, "Good dinners without the planning", { status: "agreed" }),
      node("g", "v", 1, "Customers order again", { measure: "Repeat rate", status: "agreed" }),
      node("b", "g", 2, "Favourites make reordering easy", { measure: "Reorders a week" }),
      node("in", "b", 3, "Favourites on the home screen", { owner: "App team" }),
    ],
    over
  );
const dibb = () =>
  tree("dibb", [
    node("da", null, 0, "4 in 10 cancel after a price change"),
    node("ins", "da", 1, "The price surprises them"),
    node("bel", "ins", 2, "Warning ahead keeps more of them"),
    node("bet", "bel", 3, "Email two weeks before", { measure: "Cancellations that week" }),
  ]);
const hoshin = () =>
  tree("hoshin", [
    node("aim", null, 0, "Half of orders from repeat customers"),
    node("ann", "aim", 1, "A third by December", { measure: "Repeat share" }),
    node("pri", "ann", 2, "Make skipping easy", { owner: "Product team" }),
    node("tgt", "pri", 3, "Fewer leave the cancel page", {
      measure: "Cancel page exits",
      owner: "Product team",
    }),
  ]);

const ws = () => useWorkspaceStore.getState();
const trees = () => ws().strategyMaps ?? [];
const stored = (id = "strategyMap_t") => trees().find((m) => m.id === id);
const nodeOf = (id: string) => stored()?.nodes.find((n) => n.id === id);
const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === "hypothesisTracker:current")?.hypotheses ??
  [];
const seed = (strategyMaps: StrategyMap[]) =>
  useWorkspaceStore.setState({
    strategyMaps,
    stories: [],
    epicRoadmaps: [],
    hypothesisTrackers: [],
  });

const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <StrategyTreeClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );

const logged = (action: string) => logs.filter((l) => l.action === action);
const lastToast = () => {
  const [label, opts] = toastSpy.mock.calls.at(-1) as [
    string,
    { action?: { onClick: () => void } },
  ];
  return { label, undo: () => act(() => opts.action?.onClick()) };
};
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const group = (name: string | RegExp) => screen.getByRole("group", { name });
const agree = (title: string) =>
  fireEvent.click(screen.getByRole("button", { name: `Agree: ${title}` }));

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  window.history.replaceState(null, "", "/strategy-tree");
  seed([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("empty state and examples", () => {
  it("shows a loading card, and no New button, until the workspace has loaded", () => {
    let finish = () => {};
    const hasHydrated = vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(false);
    const onFinish = vi
      .spyOn(useWorkspaceStore.persist, "onFinishHydration")
      .mockImplementation((fn) => {
        finish = () => fn(useWorkspaceStore.getState());
        return () => {};
      });
    try {
      renderPage();
      const loading = screen.getByRole("status");
      expect(loading).toHaveTextContent("Loading the trees…");
      // It holds the page's room on a phone, so the swap doesn't push what's below.
      expect(loading).toHaveClass(WORKSPACE_LOADING_RESERVE);
      expect(screen.queryByRole("button", { name: "New tree" })).toBeNull();
      expect(screen.queryByText(/No strategy trees yet/)).toBeNull();
      act(() => finish());
      expect(screen.getByText(/No strategy trees yet/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New tree" })).toBeEnabled();
      expect(screen.queryByText("Loading the trees…")).toBeNull();
    } finally {
      hasHydrated.mockRestore();
      onFinish.mockRestore();
    }
  });

  it("loads a tree of each shape without logging, and clears exactly them", async () => {
    const own: StrategyMap = {
      ...tree("impact-map", [{ id: "g", parentId: null, level: 0, text: "Goal" }]),
      id: "example-impact-map",
    };
    seed([own]);
    renderPage();
    expect(await screen.findByText(/No strategy trees yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(trees().map((t) => t.format)).toEqual([
      "impact-map",
      "dibb",
      "lean-value-tree",
      "hoshin",
    ]);
    const chips = within(screen.getByRole("navigation", { name: "Your strategy trees" }));
    expect(chips.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "DIBBWhy people cancel after a price change",
      "Lean Value TreeGood dinners without the planning",
      "Hoshin KanriHalf of all orders from repeat customers",
    ]);
    expect(logs).toEqual([]);
    expect(cheers).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    // The Impact Map's example is that tool's to clear.
    expect(trees().map((t) => t.id)).toEqual(["example-impact-map"]);
  });

  it("clears the example with Undo, and focus lands on Load an example", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Load an example/ }));
    const loaded = trees().map((t) => t.id);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(trees()).toEqual([]);
    expect(lastToast().label).toBe("Cleared the example");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Load an example/ })).toHaveFocus()
    );
    lastToast().undo();
    expect(
      trees()
        .map((t) => t.id)
        .sort()
    ).toEqual([...loaded].sort());
  });

  it("builds three examples that keep the rules, in example ids", () => {
    const ex = buildExamples(new Date("2026-11-20T00:00:00Z"));
    expect(ex.map((t) => t.format)).toEqual(["dibb", "lean-value-tree", "hoshin"]);
    for (const t of ex) {
      expect(strategyMapProblems(t, undefined), t.id).toEqual([]);
      expect([t.id, ...t.nodes.map((n) => n.id)].every((id) => id.startsWith("example-"))).toBe(
        true
      );
      expect(t.nodes.every((n) => n.status)).toBe(true);
    }
    expect(ex[0].nodes[0].text).toBe("4 in 10 cancellations come in the week after a price change");
  });

  it("sends nothing from an example tree", async () => {
    seed(buildExamples());
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    for (const b of screen.getAllByRole("button", { name: /^Test as a hypothesis: / })) {
      expect(b).toBeDisabled();
    }
  });
});

describe("a new tree", () => {
  it("asks for a shape and a root, naming the root by the shape", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New tree" }));
    const form = group("New strategy tree");
    fireEvent.click(within(form).getByRole("button", { name: "Start the tree" }));
    expect(within(form).getByText("Pick a shape for the tree.")).toBeInTheDocument();
    expect(within(form).getByText("Say what the tree starts from.")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("radio", { name: "Lean Value Tree" }));
    expect(within(form).getByLabelText(/^Vision/)).toBeInTheDocument();
    expect(
      within(form).getByText("Where the product is heading, in one line.")
    ).toBeInTheDocument();
    type(within(form).getByLabelText(/^Vision/), "Good dinners without the planning");
    fireEvent.click(within(form).getByRole("button", { name: "Start the tree" }));
    expect(trees()).toHaveLength(1);
    const t = trees()[0];
    expect(t).toMatchObject({
      format: "lean-value-tree",
      title: "Good dinners without the planning",
    });
    expect(t.nodes).toEqual([expect.objectContaining({ level: 0, status: "proposed" })]);
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_CREATED)).toEqual([
      { action: "tree_created", payload: { treeId: t.id, format: "lean-value-tree" } },
    ]);
  });

  it("names each level by the shape, with the fields that level has", async () => {
    seed([tree("hoshin", [node("aim", null, 0, "Half of orders repeat")])]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add annual objective under Half of orders repeat",
      })
    );
    const annual = group("New annual objective under “Half of orders repeat”");
    expect(
      within(annual).getByText("What must be true by the end of this year.")
    ).toBeInTheDocument();
    expect(within(annual).getByLabelText(/^Measure/)).toBeInTheDocument();
    expect(within(annual).getByText("This level asks for a measure.")).toBeInTheDocument();
    expect(within(annual).queryByLabelText(/^Owner/)).toBeNull();
    expect(within(annual).getByRole("radiogroup", { name: "Status" })).toBeInTheDocument();
    type(within(annual).getByLabelText(/^Annual objective/), "A third by December");
    type(within(annual).getByLabelText(/^Measure/), "Repeat share");
    fireEvent.click(within(annual).getByRole("button", { name: "Add annual objective" }));
    expect(stored()!.nodes[1]).toMatchObject({
      level: 1,
      text: "A third by December",
      measure: "Repeat share",
      status: "proposed",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Add improvement priority under A third by December" })
    );
    const priority = group("New improvement priority under “A third by December”");
    expect(within(priority).queryByLabelText(/^Measure/)).toBeNull();
    expect(within(priority).getByLabelText(/^Owner/)).toBeInTheDocument();
    expect(within(priority).getByText("This level asks for an owner.")).toBeInTheDocument();
    expect(logged(STRATEGY_TREE_ACTIONS.NODE_ADDED).map((l) => l.payload?.level)).toEqual([1]);
  });

  it("shows no measure or owner on a DIBB insight, and nothing under a bet", async () => {
    seed([dibb()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Add insight under 4 in 10 cancel after a price change",
      })
    );
    const form = group(/^New insight under/);
    expect(within(form).queryByLabelText(/^Measure/)).toBeNull();
    expect(within(form).queryByLabelText(/^Owner/)).toBeNull();
    expect(screen.queryByRole("button", { name: /under Email two weeks before/ })).toBeNull();
  });
});

describe("status and the catchball", () => {
  it("opens the question when a part has questions, and logs the status move", async () => {
    seed([hoshin()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Make skipping easy" }));
    const form = group("Edit improvement priority “Make skipping easy”");
    expect(within(form).queryByLabelText(/^The question/)).toBeNull();
    fireEvent.click(within(form).getByRole("radio", { name: "Has questions" }));
    type(within(form).getByLabelText(/^The question/), "Who owns win-back emails?");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(nodeOf("pri")).toMatchObject({
      status: "questioned",
      note: "Who owns win-back emails?",
    });
    expect(logged(STRATEGY_TREE_ACTIONS.STATUS_CHANGED)).toEqual([
      {
        action: "status_changed",
        payload: { treeId: "strategyMap_t", nodeId: "pri", status: "questioned" },
      },
    ]);
    expect(logged(STRATEGY_TREE_ACTIONS.NODE_UPDATED)).toHaveLength(1);
    expect(screen.getByText(": Who owns win-back emails?")).toBeInTheDocument();
  });

  it("marks the tree agreed once, on the change that agrees its last part", async () => {
    seed([lvt()]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    agree("Favourites make reordering easy");
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_AGREED)).toEqual([]);
    agree("Favourites on the home screen");
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_AGREED)).toEqual([
      { action: "tree_agreed", payload: { treeId: "strategyMap_t", nodes: 4 } },
    ]);
    expect(cheers).toEqual(["strategy-tree:agreed"]);
    expect(logged(STRATEGY_TREE_ACTIONS.STATUS_CHANGED)).toHaveLength(2);
    // Editing an agreed part's text never counts again.
    fireEvent.click(screen.getByRole("button", { name: "Edit Favourites on the home screen" }));
    type(screen.getByLabelText(/^Initiative/), "Favourites first on the home screen");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_AGREED)).toHaveLength(1);
    expect(cheers).toHaveLength(1);
  });

  it.each([
    ["dibb", dibb],
    ["hoshin", hoshin],
  ] as const)("agrees a %s tree when its last holdout is dropped", async (_, make) => {
    const t = make();
    seed([
      { ...t, nodes: t.nodes.map((n, i) => (i < 3 ? { ...n, status: "agreed" as const } : n)) },
    ]);
    renderPage();
    const last = t.nodes[3];
    fireEvent.click(await screen.findByRole("button", { name: `Edit ${last.text}` }));
    fireEvent.click(screen.getByRole("radio", { name: "Dropped" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(nodeOf(last.id)?.status).toBe("dropped");
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_AGREED)).toHaveLength(1);
  });

  it("loading a tree that is already agreed logs nothing", async () => {
    seed([lvt({ nodes: lvt().nodes.map((n) => ({ ...n, status: "agreed" as const })) })]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    expect(logs).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Agree: / })).toBeNull();
  });
});

describe("sends, each with Undo", () => {
  it("tests a DIBB bet against the belief above it, and shows where the test stands", async () => {
    seed([dibb()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Test as a hypothesis: Email two weeks before" })
    );
    expect(hypotheses()).toEqual([
      expect.objectContaining({
        status: "drafted",
        willDo: "Email two weeks before",
        successMetric: "Cancellations that week",
        sourceRef: { tool: "strategy-tree", id: "bet", doc: "strategyMap_t" },
      }),
    ]);
    expect(hypotheses()[0].believe).toMatch(/Warning ahead keeps more of them/);
    expect(logged(STRATEGY_TREE_ACTIONS.BET_SENT)).toEqual([
      {
        action: "bet_sent",
        payload: { treeId: "strategyMap_t", nodeId: "bet", route: "hypothesis" },
      },
    ]);
    expect(screen.getByRole("link", { name: /Testing: drafted · Open/ })).toBeInTheDocument();
    lastToast().undo();
    expect(hypotheses()).toEqual([]);
    expect(nodeOf("bet")?.sentTo).toBeUndefined();
  });

  it("puts a Lean Value Tree initiative on the roadmap with its path and owner", async () => {
    seed([lvt()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Put on the roadmap: Favourites on the home screen",
      })
    );
    const epic = (ws().epicRoadmaps ?? [])[0]?.epics[0];
    expect(epic).toMatchObject({
      title: "Favourites on the home screen",
      owner: "App team",
      description:
        "Part of: Good dinners without the planning → Customers order again → Favourites make reordering easy",
      sourceRef: { tool: "strategy-tree", id: "in", doc: "strategyMap_t" },
    });
    expect(screen.getByRole("link", { name: /On the roadmap · Open/ })).toHaveAttribute(
      "href",
      `/epic-roadmap?epic=${encodeURIComponent(epic!.id)}`
    );
    expect(logged(STRATEGY_TREE_ACTIONS.BET_SENT)[0].payload?.route).toBe("epic");
    lastToast().undo();
    expect((ws().epicRoadmaps ?? [])[0]?.epics ?? []).toEqual([]);
  });

  it("offers each send only on the levels and shapes that take it", async () => {
    seed([hoshin()]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    expect(
      screen.getByRole("button", { name: "Put on the roadmap: Make skipping easy" })
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Test as a hypothesis: / })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Put on the roadmap: / })).toHaveLength(1);
  });

  it("never sends a dropped part", async () => {
    seed([
      {
        ...dibb(),
        nodes: dibb().nodes.map((n) => (n.id === "bet" ? { ...n, status: "dropped" as const } : n)),
      },
    ]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    expect(screen.queryByRole("button", { name: /^Test as a hypothesis: / })).toBeNull();
  });

  it("makes no hypothesis or epic when the tree's row can't hold the link", async () => {
    const full = nearlyFull(lvt());
    seed([full]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Test as a hypothesis: Favourites make reordering easy",
      })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Put on the roadmap: Favourites on the home screen" })
    );
    expect(hypotheses()).toEqual([]);
    expect(ws().epicRoadmaps).toEqual([]);
    expect(screen.getByText(TOO_BIG)).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(logged(STRATEGY_TREE_ACTIONS.BET_SENT)).toEqual([]);
    expect(stored()).toEqual(full);
  });

  it("says the Hypothesis Tracker is full instead of a click that does nothing", async () => {
    const filler = (believe: string): HypothesisTracker => ({
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: [
        {
          id: "h0",
          believe,
          willDo: "",
          toLearn: "",
          successMetric: "",
          status: "running",
          raisedAt: "2026-10-01",
        },
      ],
    });
    // Ten bytes short of the tracker's row: no new hypothesis fits beside it.
    const tracker = filler("x".repeat(ENTITY_ROW_MAX_BYTES - jsonBytes(filler("")) - 10));
    seed([dibb()]);
    useWorkspaceStore.setState({ hypothesisTrackers: [tracker] });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Test as a hypothesis: Email two weeks before" })
    );
    expect(screen.getByText(TRACKER_FULL, { selector: "p[role=status]" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(TRACKER_FULL));
    expect(hypotheses().map((h) => h.id)).toEqual(["h0"]);
    expect(nodeOf("bet")?.sentTo).toBeUndefined();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(logged(STRATEGY_TREE_ACTIONS.BET_SENT)).toEqual([]);
  });
});

describe("deleting, with Undo", () => {
  it("asks before a branch goes, naming what goes by the shape's levels", async () => {
    seed([lvt()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Customers order again" }));
    const dialog = screen.getByRole("dialog", {
      name: "Delete “Customers order again” with 1 bet and 1 initiative?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(stored()!.nodes.map((n) => n.id)).toEqual(["v"]);
    expect(logged(STRATEGY_TREE_ACTIONS.NODE_REMOVED)[0].payload).toEqual({
      treeId: "strategyMap_t",
      nodeId: "g",
      removed: 3,
    });
    lastToast().undo();
    expect(stored()!.nodes.map((n) => n.id)).toEqual(["v", "g", "b", "in"]);
  });

  it("deletes a whole tree from its heading, with Undo", async () => {
    seed([lvt()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Delete the tree Good dinners without the planning",
      })
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(trees()).toEqual([]);
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_REMOVED)[0].payload).toEqual({
      treeId: "strategyMap_t",
      format: "lean-value-tree",
    });
    lastToast().undo();
    expect(stored()).toEqual(lvt());
  });

  it("deletes a tree with no parts (an agent can make one) from its heading, with Undo", async () => {
    const empty = tree("dibb", [], { title: "No root yet" });
    seed([empty]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete the tree No root yet" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trees()).toEqual([]);
    expect(logged(STRATEGY_TREE_ACTIONS.TREE_REMOVED)[0].payload).toEqual({
      treeId: "strategyMap_t",
      format: "dibb",
    });
    lastToast().undo();
    expect(stored()).toEqual(empty);
  });
});

describe("drafting branches", () => {
  it("drafts without AI from bracket templates, with measures where the shape measures", async () => {
    seed([tree("lean-value-tree", [node("v", null, 0, "Good dinners")])]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start from a template" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    fireEvent.click(
      within(list).getByRole("button", { name: "Add: [An outcome that moves: Good dinners]" })
    );
    const added = stored()!.nodes.slice(1);
    expect(added.map((n) => n.level)).toEqual([1, 2, 3, 2, 3]);
    expect(
      added.every((n) => n.status === "proposed" && n.measure === "[How you'll measure it]")
    ).toBe(true);
    expect(added.some((n) => n.owner)).toBe(false);
    expect(logged(STRATEGY_TREE_ACTIONS.DRAFT_ACCEPTED)).toEqual([
      { action: "draft_accepted", payload: { treeId: "strategyMap_t", nodes: 5 } },
    ]);
    lastToast().undo();
    expect(stored()!.nodes).toHaveLength(1);
  });

  it("shows Amr's draft as his and adds it only when accepted", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              branches: [
                {
                  text: "Price changes surprise people",
                  children: [
                    {
                      text: "A warning keeps them",
                      children: [{ text: "Email ahead of a change", measure: "Cancellations" }],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed([dibb()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Amr to draft branches" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested by Amr's AI. Check before you add.")
    ).toBeInTheDocument();
    expect(stored()!.nodes).toHaveLength(4);
    fireEvent.click(
      within(list).getByRole("button", { name: "Add: Price changes surprise people" })
    );
    expect(
      stored()!
        .nodes.slice(4)
        .map((n) => [n.level, n.text, n.measure])
    ).toEqual([
      [1, "Price changes surprise people", undefined],
      [2, "A warning keeps them", undefined],
      [3, "Email ahead of a change", "Cancellations"],
    ]);
  });

  it("adds all up to the cap and says how many parts were left out", async () => {
    const nodes = [node("v", null, 0, "Good dinners")];
    for (let n = 1; n < 145; n++) nodes.push(node(`x${n}`, "v", 1, `Goal ${n}`));
    seed([tree("lean-value-tree", nodes)]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start from a template" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(within(list).getByRole("button", { name: "Add all 2" }));
    expect(stored()!.nodes).toHaveLength(150);
    expect(
      screen.getByText("5 parts were left out: a tree holds at most 150.")
    ).toBeInTheDocument();
    expect(strategyMapProblems(stored()!, undefined)).toEqual([]);
  });

  it("adds nothing, says nothing was added and logs nothing when the draft won't fit the row", async () => {
    // Room for a link, not for a drafted branch.
    const full = nearlyFull(tree("lean-value-tree", [node("v", null, 0, "Good dinners")]), 120);
    expect(jsonBytes(full)).toBeLessThanOrEqual(ENTITY_ROW_MAX_BYTES);
    seed([full]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start from a template" }));
    const list = await screen.findByTestId("ai-suggestions");
    toastSpy.mockReset();
    fireEvent.click(within(list).getByRole("button", { name: /^Add all/ }));
    expect(stored()!.nodes).toHaveLength(full.nodes.length);
    expect(screen.getByText(TOO_BIG)).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(logged(STRATEGY_TREE_ACTIONS.DRAFT_ACCEPTED)).toEqual([]);
  });
});

describe("export and links", () => {
  it("exports the tree with levels, fields and statuses, and Hoshin's targets table", () => {
    const t = {
      ...hoshin(),
      title: "Repeat | customers",
      nodes: hoshin().nodes.map((n) =>
        n.id === "pri" ? { ...n, status: "questioned" as const, note: "Who owns it?" } : n
      ),
    };
    const md = strategyTreeMarkdown(t, { today: "2026-11-20" });
    expect(md.startsWith("# Hoshin Kanri — Repeat | customers — 2026-11-20\n")).toBe(true);
    expect(md).toContain(
      "  - **Annual objective:** A third by December (measure: Repeat share · Proposed)"
    );
    expect(md).toContain(
      "    - **Improvement priority:** Make skipping easy (owner: Product team · Has questions)"
    );
    expect(md).toContain("      - Question: Who owns it?");
    expect(md).toContain(
      "| Breakthrough | Annual objective | Priority | Target | Owner | Status |"
    );
    expect(md).toContain(
      "| Half of orders from repeat customers | A third by December | Make skipping easy | Fewer leave the cancel page (Cancel page exits) | Product team | Proposed |"
    );
    expect(md).toContain("## Open checks");
    expect(strategyTreeMarkdown(dibb(), { today: "2026-11-20" })).not.toContain("## Targets");
  });

  it("hands the open tree's Markdown to the export", async () => {
    seed([dibb()]);
    renderPage();
    expect((await screen.findByTestId("export-markdown")).textContent).toMatch(/^# DIBB — /);
  });

  it("opens the tree a ?tree= link names, and drops the link once open", async () => {
    seed([
      dibb(),
      {
        ...hoshin(),
        id: "strategyMap_h",
        title: "Repeat customers",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    window.history.replaceState(null, "", "/strategy-tree?tree=strategyMap_h");
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Repeat customers" })
    ).toBeInTheDocument();
    expect(window.location.search).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /^DIBB/ }));
    expect(
      screen.getByRole("heading", { level: 2, name: "4 in 10 cancel after a price change" })
    ).toBeInTheDocument();
  });
});
