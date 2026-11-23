/**
 * Impact Map against the tool UX contract: an empty state with the example
 * (never logged, cleared exactly); a new map from a typed goal or from the
 * Product Goal (linked, and its line saying when that goal closed); the
 * tree one level at a time with the persona select; edits and deletes with
 * Undo (a branch asks first and comes back in place); the one focus impact
 * (the milestone and Amr's cheer only on the first); the checks and the
 * deliverable ideas without AI; sends to the backlog and the roadmap, and
 * an impact to test, each with Undo and a dead link sent again; the draft
 * with and without AI, accepted one or all up to the cap; the Markdown;
 * and ?map= links, the page already open included.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Persona,
  ProductGoal,
  StrategyMap,
  StrategyMapNode,
} from "@/lib/stores/workspace-types";
import { IMPACT_MAP_ACTIONS } from "@/lib/history/event-actions";
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

import { ImpactMapClient } from "@/app/(tools)/impact-map/impact-map-client";
import { buildExample, EXAMPLE_MAP_ID } from "@/app/(tools)/impact-map/example";
import { buildExamples as buildTreeExamples } from "@/app/(tools)/strategy-tree/example";
import { impactMapMarkdown } from "@/app/(tools)/impact-map/markdown";
import { focusFirst, goalClosedLine, impactPaths } from "@/app/(tools)/impact-map/view";
import { validateNewMap } from "@/app/(tools)/impact-map/form";
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
): StrategyMapNode => ({ id, parentId, level, text, ...extra });

/** Goal → Busy parents → two impacts, one with a deliverable. */
const map = (over: Partial<StrategyMap> = {}): StrategyMap => ({
  id: "strategyMap_1",
  format: "impact-map",
  title: "Grow repeat orders",
  nodes: [
    node("g", null, 0, "Grow repeat orders", { measure: "Repeat rate" }),
    node("a", "g", 1, "Busy parents"),
    node("i", "a", 2, "Skip a week instead of cancelling"),
    node("i2", "a", 2, "Reorder in two taps"),
    node("d", "i", 3, "Pause instead of cancel"),
  ],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const goal = (over: Partial<ProductGoal> = {}): ProductGoal => ({
  id: "goal_1",
  statement: "Families eat well without planning",
  measures: ["Weekly active families"],
  targetDate: "2027-06-30",
  status: "active",
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
const persona = (over: Partial<Persona> = {}): Persona => ({
  id: "persona_1",
  name: "Maya",
  role: "Shift worker",
  tier: "primary",
  evidence: "some",
  goals: [],
  pains: [],
  behaviours: [],
  tags: [],
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const maps = () => ws().strategyMaps ?? [];
const stored = (id = "strategyMap_1") => maps().find((m) => m.id === id);
const nodeOf = (id: string, mapId = "strategyMap_1") =>
  stored(mapId)?.nodes.find((n) => n.id === id);
const hypotheses = () =>
  (ws().hypothesisTrackers ?? []).find((d) => d.id === "hypothesisTracker:current")?.hypotheses ??
  [];
const seed = (strategyMaps: StrategyMap[], more: Record<string, unknown> = {}) =>
  useWorkspaceStore.setState({ strategyMaps, ...more });

const page = () => (
  <LiveAnnouncerProvider>
    <TooltipProvider>
      <ImpactMapClient />
    </TooltipProvider>
  </LiveAnnouncerProvider>
);
const renderPage = () => render(page());

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
const openSendTo = (name: RegExp) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
/** The cards' titles in the order the tree draws them. */
const drawn = () =>
  Array.from(document.querySelectorAll("article h3")).map((h) =>
    (h.firstChild?.textContent ?? "").trim()
  );

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  cheers.length = 0;
  localStorage.clear();
  window.history.replaceState(null, "", "/impact-map");
  seed([], {
    personas: [],
    productGoals: [],
    stories: [],
    epicRoadmaps: [],
    hypothesisTrackers: [],
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("empty state and example", () => {
  it("says how to start, loads the example without logging it, and clears exactly it", async () => {
    seed([map({ id: "strategyMap_own" })]);
    ws().removeStrategyMap("strategyMap_own");
    renderPage();
    expect(await screen.findByText(/No impact maps yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(maps().map((m) => m.id)).toEqual([EXAMPLE_MAP_ID]);
    expect(screen.getByText("Example data.")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Grow repeat orders by 20% by June" })
    ).toBeInTheDocument();
    // Editing the example isn't the team's history.
    fireEvent.click(
      screen.getByRole("button", { name: /^Work on this first: Reorder a favourite box/ })
    );
    expect(logs).toEqual([]);
    expect(cheers).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(maps()).toEqual([]);
    expect(await screen.findByText(/No impact maps yet/)).toBeInTheDocument();
  });

  it("clears only its own example, leaving the Strategy Tree's examples in the shared rows", async () => {
    const treeExamples = buildTreeExamples();
    seed(treeExamples);
    renderPage();
    expect(await screen.findByText(/No impact maps yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(maps().map((m) => m.id)).toEqual([...treeExamples.map((t) => t.id), EXAMPLE_MAP_ID]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(maps().map((m) => m.id)).toEqual(treeExamples.map((t) => t.id));
  });

  it("builds an example that keeps the rules, in example ids, with one focus and no persona", () => {
    const ex = buildExample(new Date("2026-11-20T00:00:00Z"));
    expect(strategyMapProblems(ex, undefined)).toEqual([]);
    expect(ex.id).toBe(EXAMPLE_MAP_ID);
    expect(ex.nodes.every((n) => n.id.startsWith("example-"))).toBe(true);
    expect(ex.nodes.filter((n) => n.focus).map((n) => n.text)).toEqual([
      "Skip a week instead of cancelling",
    ]);
    expect(ex.nodes.some((n) => n.personaId)).toBe(false);
    expect(ex.targetDate).toBe("2027-06-30");
  });

  it("never sends or adds under an example part", async () => {
    seed([buildExample()]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    expect(
      screen.getByRole("button", { name: /^Send to… Pause instead of cancel/ })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Test this impact: Skip a week/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Add actor under Grow repeat orders/ })
    ).toBeDisabled();
  });
});

describe("a new map", () => {
  it("says what is missing, saves nothing until the goal is in, then starts the map", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New impact map" }));
    const form = group("New impact map");
    fireEvent.click(within(form).getByRole("button", { name: "Start the map" }));
    expect(within(form).getByText("Say the change the business wants.")).toBeInTheDocument();
    expect(maps()).toEqual([]);
    type(within(form).getByLabelText(/^Goal/), "  Grow repeat orders by 20%  ");
    type(within(form).getByLabelText(/^Measure/), "Repeat rate");
    type(within(form).getByLabelText(/^Due/), "2027-06-30");
    fireEvent.click(within(form).getByRole("button", { name: "Start the map" }));
    expect(maps()).toHaveLength(1);
    const m = maps()[0];
    expect(m).toMatchObject({
      format: "impact-map",
      title: "Grow repeat orders by 20%",
      targetDate: "2027-06-30",
    });
    expect(m.id).toMatch(/^strategyMap_/);
    expect(m.nodes).toEqual([
      expect.objectContaining({
        parentId: null,
        level: 0,
        text: "Grow repeat orders by 20%",
        measure: "Repeat rate",
      }),
    ]);
    expect(logged(IMPACT_MAP_ACTIONS.MAP_CREATED)).toEqual([
      { action: "map_created", payload: { mapId: m.id } },
    ]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Grow repeat orders by 20%" })
    ).toBeInTheDocument();
  });

  it("checks a typed day exists (a browser's date field never holds one that doesn't)", () => {
    expect(
      validateNewMap({ goal: "Grow", measure: "", targetDate: "2027-02-30", productGoalId: "" })
    ).toMatchObject({ ok: false, errors: { targetDate: "Pick a day that exists." } });
    expect(
      validateNewMap({ goal: "x".repeat(201), measure: "", targetDate: "", productGoalId: "" })
    ).toMatchObject({ ok: false, errors: { goal: "Keep it to 200 characters or fewer." } });
  });

  it("starts from the Product Goal, linked, and shows that goal above the tree", async () => {
    seed([], { productGoals: [goal()] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New impact map" }));
    const form = group("New impact map");
    fireEvent.click(within(form).getByRole("button", { name: "Start from the Product Goal" }));
    expect(within(form).getByLabelText(/^Goal/)).toHaveValue("Families eat well without planning");
    expect(within(form).getByLabelText(/^Measure/)).toHaveValue("Weekly active families");
    expect(within(form).getByText("Linked to the Product Goal.")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Start the map" }));
    expect(maps()[0]).toMatchObject({ productGoalId: "goal_1", targetDate: "2027-06-30" });
    expect(logged(IMPACT_MAP_ACTIONS.MAP_CREATED)[0].payload).toMatchObject({
      productGoalId: "goal_1",
    });
    const line = document.querySelector('[data-field="product-goal"]');
    expect(line?.textContent).toContain("Families eat well without planning");
  });

  it("shows the map's own Product Goal, says when it closed, and nothing once it is gone", async () => {
    const linked = goal({ id: "goal_old", statement: "Launch the meal kit", status: "achieved" });
    seed([map({ productGoalId: "goal_old" })], { productGoals: [goal(), linked] });
    const view = renderPage();
    await screen.findByRole("heading", { level: 2 });
    const line = () => document.querySelector('[data-field="product-goal"]');
    expect(line()?.textContent).toContain("Launch the meal kit");
    expect(line()?.textContent).not.toContain("Families eat well");
    expect(screen.getByText("This Product Goal was achieved.")).toBeInTheDocument();
    act(() => useWorkspaceStore.setState({ productGoals: [goal()] }));
    view.rerender(page());
    expect(line()).toBeNull();
    expect(goalClosedLine(goal({ status: "abandoned" }))).toBe("This Product Goal was dropped.");
    expect(goalClosedLine(goal())).toBeNull();
  });
});

describe("the tree, one level at a time", () => {
  it("adds an actor, an impact and a deliverable, and a deliverable holds nothing", async () => {
    seed([map({ nodes: [node("g", null, 0, "Grow repeat orders")] })]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Add actor under Grow repeat orders" })
    );
    const actorForm = group("New actor under “Grow repeat orders”");
    type(within(actorForm).getByLabelText(/^Actor/), "Office lunch buyers");
    fireEvent.click(within(actorForm).getByRole("button", { name: "Add actor" }));
    const actor = stored()!.nodes[1];
    expect(actor).toMatchObject({ parentId: "g", level: 1, text: "Office lunch buyers" });

    fireEvent.click(screen.getByRole("button", { name: "Add impact under Office lunch buyers" }));
    const impactForm = group("New impact under “Office lunch buyers”");
    type(within(impactForm).getByLabelText(/^Impact/), "Order for the whole team on Fridays");
    fireEvent.click(within(impactForm).getByRole("button", { name: "Add impact" }));
    const impact = stored()!.nodes[2];
    expect(impact).toMatchObject({ parentId: actor.id, level: 2 });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add deliverable under Order for the whole team on Fridays",
      })
    );
    const deliverableForm = group("New deliverable under “Order for the whole team on Fridays”");
    type(within(deliverableForm).getByLabelText(/^Deliverable/), "A team order link");
    fireEvent.click(within(deliverableForm).getByRole("button", { name: "Add deliverable" }));
    expect(stored()!.nodes[3]).toMatchObject({ parentId: impact.id, level: 3 });
    expect(screen.queryByRole("button", { name: /under A team order link/ })).toBeNull();
    expect(logged(IMPACT_MAP_ACTIONS.NODE_ADDED).map((l) => l.payload?.level)).toEqual([1, 2, 3]);
    expect(strategyMapProblems(stored()!, undefined)).toEqual([]);
  });

  it("holds the caps the CRUD holds, saving nothing over them", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Busy parents" }));
    type(screen.getByLabelText(/^Actor/), "x".repeat(201));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Keep it to 200 characters or fewer.")).toBeInTheDocument();
    expect(nodeOf("a")?.text).toBe("Busy parents");
  });

  it("picks an actor's persona, filling a blank name, and links the persona both ways", async () => {
    seed([map({ nodes: [node("g", null, 0, "Grow repeat orders")] })], {
      personas: [persona(), persona({ id: "persona_2", name: "Sam", role: "Office manager" })],
    });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Add actor under Grow repeat orders" })
    );
    const form = group("New actor under “Grow repeat orders”");
    const select = within(form).getByLabelText("Persona");
    expect(
      within(select as HTMLElement)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["No persona", "Maya, Shift worker", "Sam, Office manager"]);
    fireEvent.change(select, { target: { value: "persona_1" } });
    expect(within(form).getByLabelText(/^Actor/)).toHaveValue("Maya");
    fireEvent.click(within(form).getByRole("button", { name: "Add actor" }));
    expect(stored()!.nodes[1]).toMatchObject({ text: "Maya", personaId: "persona_1" });
    expect(screen.getByRole("link", { name: "Maya, Shift worker" })).toHaveAttribute(
      "href",
      "/persona-library?persona=persona_1"
    );
    expect(screen.queryByRole("link", { name: "Make a persona for this actor" })).toBeNull();
  });

  it("shows a deleted persona as the plain actor, with a link to make one by ids only", async () => {
    seed([
      map({
        nodes: [
          node("g", null, 0, "Grow repeat orders"),
          node("a", "g", 1, "Busy parents", { personaId: "persona_gone" }),
        ],
      }),
    ]);
    renderPage();
    await screen.findByRole("heading", { level: 3, name: "Busy parents" });
    expect(screen.getByRole("link", { name: "Make a persona for this actor" })).toHaveAttribute(
      "href",
      "/persona-library?fromMap=strategyMap_1&actor=a"
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit Busy parents" }));
    expect(screen.getByLabelText("Persona")).toHaveValue("");
  });

  it("edits a part, the map's name following its goal", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Grow repeat orders" }));
    type(screen.getByLabelText(/^Goal/), "Grow repeat orders by a fifth");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored()).toMatchObject({ title: "Grow repeat orders by a fifth" });
    expect(nodeOf("g")).toMatchObject({
      text: "Grow repeat orders by a fifth",
      measure: "Repeat rate",
    });
    expect(logged(IMPACT_MAP_ACTIONS.NODE_UPDATED)).toEqual([
      { action: "node_updated", payload: { mapId: "strategyMap_1", nodeId: "g" } },
    ]);
  });

  it("renames the map and its date in the map's details", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Edit the map's name and date: Grow repeat orders",
      })
    );
    const form = group("The map's name and date");
    type(within(form).getByLabelText(/^Name/), "Repeat orders");
    type(within(form).getByLabelText(/^Due/), "2027-03-31");
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(stored()).toMatchObject({ title: "Repeat orders", targetDate: "2027-03-31" });
    expect(logged(IMPACT_MAP_ACTIONS.MAP_UPDATED)).toHaveLength(1);
  });
});

describe("deleting, with Undo", () => {
  it("deletes a part with nothing under it at once, and Undo puts it back in place", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Pause instead of cancel" }));
    expect(nodeOf("d")).toBeUndefined();
    expect(logged(IMPACT_MAP_ACTIONS.NODE_REMOVED)[0].payload).toEqual({
      mapId: "strategyMap_1",
      nodeId: "d",
      removed: 1,
    });
    lastToast().undo();
    expect(stored()!.nodes.map((n) => n.id)).toEqual(["g", "a", "i", "i2", "d"]);
  });

  it("asks before a part with others under it goes, saying what goes with it", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Busy parents" }));
    const dialog = screen.getByRole("dialog", {
      name: "Delete “Busy parents” with 2 impacts and 1 deliverable?",
    });
    expect(stored()!.nodes).toHaveLength(5);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(stored()!.nodes.map((n) => n.id)).toEqual(["g"]);
    expect(logged(IMPACT_MAP_ACTIONS.NODE_REMOVED)[0].payload).toMatchObject({ removed: 4 });
    lastToast().undo();
    expect(stored()!.nodes.map((n) => n.id)).toEqual(["g", "a", "i", "i2", "d"]);
  });

  it("deletes the whole map from its heading, with Undo", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete the map Grow repeat orders" })
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(maps()).toEqual([]);
    expect(logged(IMPACT_MAP_ACTIONS.MAP_REMOVED)[0].payload).toEqual({
      mapId: "strategyMap_1",
      nodes: 5,
    });
    lastToast().undo();
    expect(stored()).toEqual(map());
  });

  it("deletes a map with no parts (an agent can make one) from its heading, with Undo", async () => {
    const empty = map({ title: "No goal yet", nodes: [] });
    seed([empty]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete the map No goal yet" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(maps()).toEqual([]);
    expect(logged(IMPACT_MAP_ACTIONS.MAP_REMOVED)[0].payload).toEqual({
      mapId: "strategyMap_1",
      nodes: 0,
    });
    lastToast().undo();
    expect(stored()).toEqual(empty);
  });
});

describe("the focus impact", () => {
  it("logs the milestone and cheers only on the first focus; moving or clearing it doesn't", async () => {
    seed([map()]);
    renderPage();
    const pick = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
    await screen.findByRole("heading", { level: 2 });
    pick(/^Work on this first: Skip a week/);
    expect(nodeOf("i")?.focus).toBe(true);
    expect(logged(IMPACT_MAP_ACTIONS.FOCUS_SET)).toEqual([
      { action: "focus_set", payload: { mapId: "strategyMap_1", nodeId: "i" } },
    ]);
    expect(cheers).toEqual(["impact-map:agreed"]);
    pick(/^Work on this first: Reorder in two taps/);
    expect(
      stored()!
        .nodes.filter((n) => n.focus)
        .map((n) => n.id)
    ).toEqual(["i2"]);
    pick(/^Work on this first: Reorder in two taps/);
    expect(stored()!.nodes.some((n) => n.focus)).toBe(false);
    expect(logged(IMPACT_MAP_ACTIONS.FOCUS_CHANGED).map((l) => l.payload?.nodeId)).toEqual([
      "i2",
      null,
    ]);
    expect(logged(IMPACT_MAP_ACTIONS.FOCUS_SET)).toHaveLength(1);
    expect(cheers).toHaveLength(1);
  });

  it("draws the focus path first, in the tree and in the paths", async () => {
    const m = map({
      nodes: [
        node("g", null, 0, "Grow repeat orders"),
        node("a", "g", 1, "Busy parents"),
        node("i", "a", 2, "Skip a week"),
        node("b", "g", 1, "Office buyers"),
        node("j", "b", 2, "Order on Fridays", { focus: true }),
        node("k", "j", 3, "Team order link"),
      ],
    });
    seed([m]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    expect(drawn()).toEqual([
      "Grow repeat orders",
      "Office buyers",
      "Order on Fridays",
      "Team order link",
      "Busy parents",
      "Skip a week",
    ]);
    expect(focusFirst(m)(m.nodes.filter((n) => n.level === 1)).map((n) => n.id)).toEqual([
      "b",
      "a",
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Paths" }));
    const rows = within(screen.getByRole("list", { name: "Paths" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Office buyers → Order on Fridays → Team order link");
    expect(rows[0]).toHaveTextContent("Not sent yet");
    expect(rows[1]).toHaveTextContent("Busy parents → Skip a week");
    expect(rows[1]).toHaveTextContent("No deliverable yet");
  });

  it("keeps one focus when Undo brings back a branch after another was picked", async () => {
    seed([
      map({
        nodes: [
          node("g", null, 0, "Grow repeat orders"),
          node("a", "g", 1, "Busy parents"),
          node("i", "a", 2, "Skip a week", { focus: true }),
          node("b", "g", 1, "Office buyers"),
          node("j", "b", 2, "Order on Fridays"),
        ],
      }),
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Busy parents" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    const undo = lastToast().undo;
    fireEvent.click(screen.getByRole("button", { name: /^Work on this first: Order on Fridays/ }));
    undo();
    expect(
      stored()!
        .nodes.filter((n) => n.focus)
        .map((n) => n.id)
    ).toEqual(["j"]);
    expect(strategyMapProblems(stored()!, undefined)).toEqual([]);
  });
});

describe("checks and ideas without AI", () => {
  it("lists what the map still misses", async () => {
    seed([
      map({
        nodes: [
          node("g", null, 0, "Grow repeat orders"),
          node("a", "g", 1, "Busy parents"),
          node("i", "a", 2, "Build a skip button"),
          node("i2", "a", 2, "Reorder in two taps"),
          node("o", "g", 1, "Office buyers"),
        ],
      }),
    ]);
    renderPage();
    const checks = await screen.findByRole("region", { name: "What's missing" });
    // The first five show; the rest open on request, so a phone isn't one long list.
    fireEvent.click(within(checks).getByRole("button", { name: "Show all 6" }));
    for (const text of [
      "“Grow repeat orders” needs a measure.",
      "“Office buyers” has no impacts yet.",
      "“Build a skip button” reads like a feature: what will Busy parents do differently?",
      "Pick the impact to work on first.",
    ]) {
      expect(within(checks).getByText(text)).toBeInTheDocument();
    }
  });

  it("suggests deliverables that fill the add form, saving nothing until Add", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Suggest deliverables for Reorder in two taps" })
    );
    const use = screen.getAllByRole("button", { name: /^Use: / });
    expect(use.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Use: A change in the product that makes it easier for busy parents to reorder in two taps",
      "Use: A message, guide or training that shows busy parents how",
      "Use: A small test to see whether busy parents really does it",
    ]);
    fireEvent.click(use[1]);
    expect(stored()!.nodes).toHaveLength(5);
    const field = screen.getByLabelText(/^Deliverable/);
    expect(field).toHaveValue("A message, guide or training that shows busy parents how");
    fireEvent.click(screen.getByRole("button", { name: "Add deliverable" }));
    expect(stored()!.nodes.at(-1)).toMatchObject({
      parentId: "i2",
      level: 3,
      text: "A message, guide or training that shows busy parents how",
    });
    expect(screen.getAllByRole("button", { name: /^Use: / })).toHaveLength(2);
  });

  it("keeps a cancelled idea closed when the card is drawn again, and a new Use still opens it", async () => {
    seed([map()]);
    renderPage();
    const addForm = () => screen.queryByRole("group", { name: /^New deliverable under/ });
    fireEvent.click(
      await screen.findByRole("button", { name: "Suggest deliverables for Reorder in two taps" })
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Use: / })[0]);
    fireEvent.click(within(addForm()!).getByRole("button", { name: "Cancel" }));
    expect(addForm()).toBeNull();
    // Paths and back draws every card anew.
    fireEvent.click(screen.getByRole("radio", { name: "Paths" }));
    fireEvent.click(screen.getByRole("radio", { name: "Tree" }));
    expect(addForm()).toBeNull();
    expect(stored()!.nodes).toHaveLength(5);
    fireEvent.click(screen.getAllByRole("button", { name: /^Use: / })[1]);
    expect(screen.getByLabelText(/^Deliverable/)).toHaveValue(
      "A message, guide or training that shows busy parents how"
    );
  });
});

describe("sends, each with Undo", () => {
  it("puts a deliverable on the backlog with a link back, and Undo takes both back", async () => {
    seed([map()]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    openSendTo(/^Send to… Pause instead of cancel/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    expect(ws().stories).toEqual([
      expect.objectContaining({
        title: "Pause instead of cancel",
        status: "backlog",
        sourceRef: { tool: "impact-map", id: "d", doc: "strategyMap_1" },
      }),
    ]);
    expect(nodeOf("d")?.sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", targetId: ws().stories[0].id }),
    ]);
    expect(logged(IMPACT_MAP_ACTIONS.DELIVERABLE_SENT)).toEqual([
      {
        action: "deliverable_sent",
        payload: { mapId: "strategyMap_1", nodeId: "d", route: "backlog-story" },
      },
    ]);
    lastToast().undo();
    expect(ws().stories).toEqual([]);
    expect(nodeOf("d")?.sentTo).toBeUndefined();
    expect(logged(IMPACT_MAP_ACTIONS.DELIVERABLE_SENT)).toHaveLength(1);
  });

  it("puts a deliverable on the roadmap as an epic", async () => {
    seed([map()]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    openSendTo(/^Send to… Pause instead of cancel/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Epic on the roadmap" }));
    const doc = (ws().epicRoadmaps ?? []).find((d) => d.id === "epicRoadmap:current");
    expect(doc?.epics).toEqual([
      expect.objectContaining({
        title: "Pause instead of cancel",
        sourceRef: { tool: "impact-map", id: "d", doc: "strategyMap_1" },
      }),
    ]);
    expect(logged(IMPACT_MAP_ACTIONS.DELIVERABLE_SENT)[0].payload?.route).toBe("epic");
  });

  it("sends a deliverable again once its story is gone, and an Undo then logs nothing", async () => {
    seed([
      map({
        nodes: map().nodes.map((n) =>
          n.id === "d"
            ? {
                ...n,
                sentTo: [{ route: "backlog-story" as const, targetId: "story_gone", at: AT }],
              }
            : n
        ),
      }),
    ]);
    renderPage();
    await screen.findByRole("heading", { level: 2 });
    openSendTo(/^Send to… Pause instead of cancel/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    expect(ws().stories).toHaveLength(1);
    expect(nodeOf("d")?.sentTo).toEqual([
      expect.objectContaining({ targetId: ws().stories[0].id }),
    ]);
    lastToast().undo();
    // The dead link comes back; that is no send.
    expect(nodeOf("d")?.sentTo).toEqual([expect.objectContaining({ targetId: "story_gone" })]);
    expect(logged(IMPACT_MAP_ACTIONS.DELIVERABLE_SENT)).toHaveLength(1);
  });

  it("tests an impact in the Hypothesis Tracker and shows where the test stands", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Test this impact: Skip a week/ }));
    expect(hypotheses()).toEqual([
      expect.objectContaining({
        status: "drafted",
        willDo: "Pause instead of cancel",
        successMetric: "Repeat rate",
        sourceRef: { tool: "impact-map", id: "i", doc: "strategyMap_1" },
      }),
    ]);
    expect(logged(IMPACT_MAP_ACTIONS.IMPACT_TESTED)).toEqual([
      { action: "impact_tested", payload: { mapId: "strategyMap_1", nodeId: "i" } },
    ]);
    expect(logged(IMPACT_MAP_ACTIONS.DELIVERABLE_SENT)).toEqual([]);
    expect(screen.getByRole("link", { name: /Testing: drafted · Open/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Test this impact: Skip a week/ })).toBeNull();
    lastToast().undo();
    expect(hypotheses()).toEqual([]);
    expect(screen.getByRole("button", { name: /^Test this impact: Skip a week/ })).toBeEnabled();
  });

  it("leaves no story, epic or hypothesis and logs no send when the row can't hold the link", async () => {
    const full = nearlyFull(map());
    seed([full]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^Test this impact: Skip a week/ }));
    expect(hypotheses()).toEqual([]);
    expect(screen.getByText(TOO_BIG)).toBeInTheDocument();
    expect(toastSpy).not.toHaveBeenCalled();
    // Send to… asks the page first (canLink): nothing is made, and no "Added" toast shows.
    openSendTo(/^Send to… Pause instead of cancel/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    expect(ws().stories).toEqual([]);
    openSendTo(/^Send to… Pause instead of cancel/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Epic on the roadmap" }));
    expect((ws().epicRoadmaps ?? []).flatMap((d) => d.epics)).toEqual([]);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.getByText(TOO_BIG)).toBeInTheDocument();
    expect(logged(IMPACT_MAP_ACTIONS.IMPACT_TESTED)).toEqual([]);
    expect(logged(IMPACT_MAP_ACTIONS.DELIVERABLE_SENT)).toEqual([]);
    expect(stored()).toEqual(full);
  });
});

describe("drafting the map", () => {
  it("drafts without AI from a template, adding a branch with Undo", async () => {
    seed([map({ nodes: [node("g", null, 0, "Grow repeat orders")] })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start from a template" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested without AI. Check before you add.")
    ).toBeInTheDocument();
    expect(stored()!.nodes).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: "Add: People who use it every day" }));
    const added = stored()!.nodes.slice(1);
    expect(added.map((n) => n.level)).toEqual([1, 2, 2, 2]);
    expect(added[1].text).toBe("Start doing what “grow repeat orders” needs");
    expect(logged(IMPACT_MAP_ACTIONS.DRAFT_ACCEPTED)).toEqual([
      { action: "draft_accepted", payload: { mapId: "strategyMap_1", source: "rules", nodes: 4 } },
    ]);
    lastToast().undo();
    expect(stored()!.nodes).toHaveLength(1);
  });

  it("starts the template from the library's personas, linked by name", async () => {
    seed([map({ nodes: [node("g", null, 0, "Grow repeat orders")] })], {
      personas: [
        persona(),
        persona({ id: "persona_anti", name: "Bargain hunter", tier: "anti" }),
        persona({ id: "example-p", name: "Example person" }),
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start from a template" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(within(list).queryByText("Bargain hunter")).toBeNull();
    expect(within(list).queryByText("Example person")).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Add: Maya" }));
    expect(stored()!.nodes[1]).toMatchObject({ level: 1, text: "Maya", personaId: "persona_1" });
  });

  it("adds all up to the map's cap and says how many parts were left out", async () => {
    const nodes = [node("g", null, 0, "Grow repeat orders")];
    for (let n = 1; n < 140; n++) nodes.push(node(`x${n}`, "g", 1, `Actor ${n}`));
    seed([map({ nodes })]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start from a template" }));
    const list = await screen.findByTestId("ai-suggestions");
    fireEvent.click(within(list).getByRole("button", { name: "Add all 4" }));
    expect(stored()!.nodes).toHaveLength(150);
    expect(screen.getByText("6 parts were left out: a map holds at most 150.")).toBeInTheDocument();
    expect(strategyMapProblems(stored()!, undefined)).toEqual([]);
  });

  it("adds nothing, says nothing was added and logs nothing when the draft won't fit the row", async () => {
    // Room for a link, not for a drafted actor.
    const full = nearlyFull(map({ nodes: [node("g", null, 0, "Grow repeat orders")] }), 120);
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
    expect(logged(IMPACT_MAP_ACTIONS.DRAFT_ACCEPTED)).toEqual([]);
  });

  it("shows Amr's draft as his, linking a persona only on its exact name", async () => {
    vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "1");
    localStorage.setItem(VISITOR_AI_CONSENT_KEY, VISITOR_AI_CONSENT_VERSION);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            source: "ai",
            data: {
              actors: [
                {
                  name: "Night-shift cooks",
                  persona: "maya",
                  impacts: [{ text: "Order before a shift", deliverables: ["Shift reminders"] }],
                },
                {
                  name: "Gift buyers",
                  persona: "Maya the second",
                  impacts: [{ text: "Send a box as a gift", deliverables: [] }],
                },
              ],
            },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    seed([map({ nodes: [node("g", null, 0, "Grow repeat orders")] })], {
      personas: [persona()],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Amr to draft the map" }));
    const list = await screen.findByTestId("ai-suggestions");
    expect(
      within(list).getByText("Suggested by Amr's AI. Check before you add.")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stored()!.nodes).toHaveLength(1);
    fireEvent.click(within(list).getByRole("button", { name: "Add all 2" }));
    const actors = stored()!.nodes.filter((n) => n.level === 1);
    expect(actors).toEqual([
      expect.objectContaining({ text: "Night-shift cooks", personaId: "persona_1" }),
      expect.not.objectContaining({ personaId: expect.anything() }),
    ]);
    expect(stored()!.nodes.find((n) => n.level === 3)?.text).toBe("Shift reminders");
    expect(logged(IMPACT_MAP_ACTIONS.DRAFT_ACCEPTED)[0].payload).toMatchObject({ source: "ai" });
  });
});

describe("export and links", () => {
  it("exports the goal line, the tree with the focus, the paths and the open checks", async () => {
    const m = map({
      productGoalId: "goal_1",
      targetDate: "2027-06-30",
      nodes: map().nodes.map((n) =>
        n.id === "i" ? { ...n, focus: true } : n.id === "i2" ? { ...n, text: "Reorder | fast" } : n
      ),
    });
    const md = impactMapMarkdown(m, { goal: goal(), today: "2026-11-20" });
    expect(md.startsWith("# Impact Map — Grow repeat orders — 2026-11-20\n")).toBe(true);
    expect(md).toContain(
      "**Goal:** Grow repeat orders (Measure: Repeat rate · By 2027-06-30 · Product Goal: Families eat well without planning)"
    );
    expect(md).toContain(
      "    - **Impact:** Skip a week instead of cancelling (**work on this first**)"
    );
    expect(md).toContain("| Why | Who | How | What | Where it went |");
    expect(md).toContain(
      "| Grow repeat orders | Busy parents | Skip a week instead of cancelling (focus) | Pause instead of cancel | — |"
    );
    expect(md).toContain("| Reorder \\| fast | — | — |");
    expect(md).toContain("## Open checks\n\n- “Reorder | fast” has no deliverables yet.");
    expect(impactPaths(m)[0].focus).toBe(true);

    seed([m], { productGoals: [goal()] });
    renderPage();
    expect((await screen.findByTestId("export-markdown")).textContent).toContain(
      "# Impact Map — Grow repeat orders — "
    );
  });

  it("opens the map a ?map= link names, and drops the link once open", async () => {
    seed([
      map(),
      map({
        id: "strategyMap_2",
        title: "Fewer late boxes",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    window.history.replaceState(null, "", "/impact-map?map=strategyMap_2");
    renderPage();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Fewer late boxes" })
    ).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("follows a ?map= link to the page that is already open", async () => {
    seed([
      map(),
      map({
        id: "strategyMap_2",
        title: "Fewer late boxes",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    const at = (query: string) => (
      <SearchParamsContext.Provider value={new URLSearchParams(query)}>
        {page()}
      </SearchParamsContext.Provider>
    );
    const view = render(at(""));
    expect(
      await screen.findByRole("heading", { level: 2, name: "Grow repeat orders" })
    ).toBeInTheDocument();
    window.history.replaceState(null, "", "/impact-map?map=strategyMap_2");
    view.rerender(at("map=strategyMap_2"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 2, name: "Fewer late boxes" })
      ).toBeInTheDocument()
    );
    expect(window.location.search).toBe("");
  });

  it("logs ids, levels and routes, never a part's text", async () => {
    seed([map()]);
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: /^Work on this first: Skip a week/ })
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Pause instead of cancel" }));
    for (const l of logs) {
      expect(JSON.stringify(l.payload)).not.toMatch(/Skip a week|Pause instead/);
    }
    expect(logs.length).toBeGreaterThan(1);
  });
});
