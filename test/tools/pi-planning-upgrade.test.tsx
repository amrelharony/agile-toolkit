import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DependencyEdge, DependencyMap } from "@/lib/stores/workspace-types";

/**
 * PI Planning on the one dependency model: dependency items link to
 * Dependency Map edges and show their live status; items move between
 * cells from a keyboard menu; objectives carry business value; teams,
 * items and iterations come off with a confirm and Undo (no
 * window.confirm); load is plain planned-vs-capacity, with no Monte Carlo
 * and no history counter; old boards keep loading.
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

import { PiPlanningClient } from "@/app/(tools)/pi-planning/pi-planning-client";
import {
  DEFAULT_PI_STATE,
  PI_STORAGE_KEY,
  normalizePiState,
  type PiItem,
  type PiState,
} from "@/app/(tools)/pi-planning/store";
import { cellLoad, overloads, teamLoad } from "@/app/(tools)/pi-planning/load";
import { piVerdict } from "@/app/(tools)/pi-planning/verdict";
import { toMarkdown } from "@/app/(tools)/pi-planning/markdown";
import { buildExample, withoutExample } from "@/app/(tools)/pi-planning/example";
import {
  EMPTY_ITEM,
  EMPTY_OBJECTIVE,
  EMPTY_TEAM,
  validateItem,
  validateObjective,
  validateTeam,
} from "@/app/(tools)/pi-planning/forms";
import { syncDependencyEdge } from "@/app/(tools)/pi-planning/dependency-link";
import { DEPENDENCY_MAP_ID } from "@/app/(tools)/dependency-map/link";

const TODAY = "2026-10-23";
const ws = () => useWorkspaceStore.getState();
const map = (): DependencyMap =>
  (ws().dependencyMaps ?? []).find((d) => d.id === DEPENDENCY_MAP_ID) ?? {
    id: DEPENDENCY_MAP_ID,
    nodes: [],
    edges: [],
  };
const stored = (): PiState => normalizePiState(JSON.parse(localStorage.getItem(PI_STORAGE_KEY)!));
const seedBoard = (s: unknown) => localStorage.setItem(PI_STORAGE_KEY, JSON.stringify(s));

const board = (over: Partial<PiState> = {}): PiState => ({
  teams: [
    { id: "t1", name: "Checkout", velocity: 10 },
    { id: "t2", name: "Payments", velocity: 8 },
  ],
  items: [],
  iterations: 3,
  objectives: [],
  ...over,
});
const item = (id: string, extra: Partial<PiItem> = {}): PiItem => ({
  id,
  title: id,
  teamId: "t1",
  iteration: 0,
  kind: "feature",
  points: 3,
  ...extra,
});

const renderBoard = () =>
  render(
    <TooltipProvider>
      <PiPlanningClient />
    </TooltipProvider>
  );
const lastToast = () => toastSpy.mock.calls[toastSpy.mock.calls.length - 1];
// Undo writes the persisted board (React state), so flush it like a click.
const undoLast = () => act(() => lastToast()[1].action.onClick());
const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });

beforeEach(() => {
  toastSpy.mockReset();
  localStorage.clear();
  useWorkspaceStore.setState({ dependencyMaps: [], teamMembers: [] });
});

/* ── Stored boards ────────────────────────────────────────────────────── */

describe("old boards", () => {
  it("load as they were, with a 0 velocity read as not set", () => {
    const legacy = {
      teams: [{ id: "t", name: "A", velocity: 0, extra: "kept" }],
      items: [
        { id: "i1", title: "x", teamId: "t", iteration: 1, points: 3, kind: "feature" },
        { id: "i2", title: "dep", teamId: "t", iteration: 0, points: 3, kind: "dependency" },
        { id: "i3", title: "odd", teamId: "t", iteration: 0, points: Number.NaN, kind: "weird" },
        { title: "no id" },
      ],
      iterations: 4,
    };
    const s = normalizePiState(legacy);
    expect(s.teams).toEqual([{ id: "t", name: "A", extra: "kept" }]);
    expect(s.items.map((i) => [i.id, i.kind, i.points])).toEqual([
      ["i1", "feature", 3],
      ["i2", "dependency", 3],
      ["i3", "feature", undefined],
    ]);
    expect(s.iterations).toBe(4);
    expect(s.objectives).toEqual([]);
  });

  it("survive garbage", () => {
    expect(normalizePiState(null)).toEqual(DEFAULT_PI_STATE);
    expect(normalizePiState({ iterations: 99 }).iterations).toBe(10);
    expect(normalizePiState({ iterations: 0 }).iterations).toBe(1);
    expect(normalizePiState({ iterations: "3" }).iterations).toBe(5);
  });
});

/* ── Load ─────────────────────────────────────────────────────────────── */

describe("load vs capacity", () => {
  const s = board({
    items: [
      item("a", { points: 6 }),
      item("b", { points: 5 }), // 11 > 10: over
      item("c", { points: undefined }), // not sized
      item("d", { kind: "risk", points: 40 }), // risks don't count
      item("e", { iteration: 1, points: 10 }), // exactly at capacity: not over
      item("f", { iteration: 7, points: 99 }), // past the last iteration
    ],
  });

  it("sums sized features per cell and flags only cells over 100%", () => {
    expect(cellLoad(s, s.teams[0], 0)).toEqual({
      planned: 11,
      unsized: 1,
      capacity: 10,
      over: true,
    });
    expect(cellLoad(s, s.teams[0], 1).over).toBe(false);
    expect(overloads(s)).toEqual([{ teamId: "t1", iteration: 0, planned: 11, capacity: 10 }]);
  });

  it("compares a team's PI total with velocity × iterations", () => {
    expect(teamLoad(s, s.teams[0])).toMatchObject({ planned: 21, capacity: 30, pct: 70 });
    expect(teamLoad(s, s.teams[1])).toMatchObject({ planned: 0, capacity: 24, pct: 0 });
  });

  it("never calls a team without a velocity overloaded", () => {
    const none = board({
      teams: [{ id: "t1", name: "Checkout" }],
      items: [item("a", { points: 1000 })],
    });
    expect(cellLoad(none, none.teams[0], 0)).toMatchObject({ capacity: null, over: false });
    expect(teamLoad(none, none.teams[0]).pct).toBeNull();
    expect(overloads(none)).toEqual([]);
  });
});

describe("verdict", () => {
  it("states planned against capacity, overloads and open dependencies", () => {
    expect(piVerdict(board({ teams: [] }), { nodes: [], edges: [] }, TODAY)).toBe(
      "No teams on the board yet."
    );
    const s = board({
      items: [item("a", { points: 11 }), item("d", { kind: "dependency", dependsOn: "Payments" })],
    });
    expect(piVerdict(s, { nodes: [], edges: [] }, TODAY)).toBe(
      "2 teams plan 11 feature points against a capacity of 54 (20%); over capacity: Checkout in iteration 1; 1 open dependency."
    );
    const noVelocity = board({
      teams: [
        { id: "t1", name: "Checkout" },
        { id: "t2", name: "B", velocity: 5 },
      ],
    });
    expect(piVerdict(noVelocity, { nodes: [], edges: [] }, TODAY)).toBe(
      "2 teams plan 0 feature points (1 team without a velocity yet); no team is over capacity."
    );
  });

  it("reads dependency status from the map edge", () => {
    const s = board({ items: [item("d", { kind: "dependency", edgeId: "e1" })] });
    const graph = {
      nodes: [
        { id: "n1", label: "Checkout" },
        { id: "n2", label: "Payments" },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2", kind: "needs", status: "resolved" } as DependencyEdge,
      ],
    };
    expect(piVerdict(s, graph, TODAY)).toMatch(/; every dependency is resolved\.$/);
    graph.edges[0] = { ...graph.edges[0], status: "open", due: "2026-10-01" };
    expect(piVerdict(s, graph, TODAY)).toMatch(/; 1 open dependency \(1 overdue\)\.$/);
  });
});

/* ── Validation ───────────────────────────────────────────────────────── */

describe("validation", () => {
  it("needs a unique team name and treats a blank velocity as not set", () => {
    const teams = board().teams;
    expect(validateTeam(EMPTY_TEAM, teams)).toMatchObject({ errors: { name: "Name the team." } });
    expect(validateTeam({ ...EMPTY_TEAM, name: "checkout" }, teams)).toMatchObject({
      errors: { name: "“checkout” is already on the board." },
    });
    expect(validateTeam({ ...EMPTY_TEAM, name: "Mobile", velocity: "-2" }, teams)).toMatchObject({
      errors: { velocity: "Enter points per iteration (0 or more), or leave it blank." },
    });
    expect(validateTeam({ ...EMPTY_TEAM, name: " Mobile " }, teams)).toEqual({
      ok: true,
      values: { name: "Mobile" },
    });
    expect(validateTeam({ ...EMPTY_TEAM, name: "Checkout", velocity: "12" }, teams, "t1")).toEqual({
      ok: true,
      values: { name: "Checkout", velocity: 12 },
    });
  });

  it("needs a title and a kind, and a dependency names another team", () => {
    expect(validateItem(EMPTY_ITEM, "Checkout")).toMatchObject({
      errors: { title: "Name the item.", kind: "Pick a kind." },
    });
    expect(
      validateItem({ ...EMPTY_ITEM, title: "x", kind: "dependency" }, "Checkout")
    ).toMatchObject({ errors: { dependsOn: "Name the team it waits on." } });
    expect(
      validateItem(
        { ...EMPTY_ITEM, title: "x", kind: "dependency", dependsOn: "checkout" },
        "Checkout"
      )
    ).toMatchObject({ errors: { dependsOn: "Pick another team: a team can't wait on itself." } });
    expect(
      validateItem({ ...EMPTY_ITEM, title: "x", kind: "feature", points: "abc" }, "C")
    ).toMatchObject({ ok: false });
    // Blank points are "not sized", never 0; a feature drops dependency fields.
    expect(
      validateItem(
        { ...EMPTY_ITEM, title: " x ", kind: "feature", dependsOn: "B", due: "2026-11-01" },
        "C"
      )
    ).toEqual({ ok: true, values: { title: "x", kind: "feature", due: "" } });
    expect(
      validateItem({ ...EMPTY_ITEM, title: "x", kind: "feature", points: "0" }, "C")
    ).toMatchObject({ values: { points: 0 } });
  });

  it("needs a team, a title and a commitment; business value may wait", () => {
    expect(validateObjective(EMPTY_OBJECTIVE)).toEqual({
      ok: false,
      errors: {
        teamId: "Choose the team.",
        title: "Write the objective.",
        commitment: "Say whether the team commits to it.",
      },
    });
    expect(
      validateObjective({
        teamId: "t1",
        title: "Refunds",
        businessValue: null,
        commitment: "uncommitted",
      })
    ).toEqual({ ok: true, values: { teamId: "t1", title: "Refunds", committed: false } });
  });
});

/* ── The map link ─────────────────────────────────────────────────────── */

describe("dependency items on the map", () => {
  const dep = (extra: Partial<PiItem> = {}) =>
    item("d1", { kind: "dependency", title: "Refund API", dependsOn: "Payments", ...extra });
  const sides = { teamName: "Checkout", dependsOn: "Payments", title: "Refund API" };

  it("draws this team needing that one, and keeps the same edge for the same sides", () => {
    const edgeId = syncDependencyEdge(null, dep(), { ...sides, due: "2026-11-02" })!;
    const edge = map().edges.find((e) => e.id === edgeId)!;
    expect(edge).toMatchObject({
      kind: "needs",
      status: "open",
      due: "2026-11-02",
      note: "Refund API",
      sourceRef: { tool: "pi-planning", id: "d1" },
    });
    const label = (id: string) => map().nodes.find((n) => n.id === id)?.label;
    expect([label(edge.from), label(edge.to)]).toEqual(["Checkout", "Payments"]);

    const linked = dep({ edgeId });
    expect(syncDependencyEdge(linked, linked, { ...sides, dependsOn: "payments", due: null })).toBe(
      edgeId
    );
    expect(map().edges).toHaveLength(1);
    expect(map().edges[0].due).toBeUndefined();
  });

  it("moves its own edge to a new other side, keeping owner and at-risk", () => {
    const edgeId = syncDependencyEdge(null, dep(), sides)!;
    useWorkspaceStore.getState().upsertDependencyMap({
      ...map(),
      edges: map().edges.map((e) => ({ ...e, owner: "Ana", status: "at-risk" as const })),
    });
    const linked = dep({ edgeId });
    const next = syncDependencyEdge(
      linked,
      { ...linked, dependsOn: "Platform" },
      {
        ...sides,
        dependsOn: "Platform",
      }
    )!;
    expect(next).not.toBe(edgeId);
    expect(map().edges).toHaveLength(1);
    expect(map().edges[0]).toMatchObject({ id: next, owner: "Ana", status: "at-risk" });
  });

  it("leaves an edge someone else drew alone, and takes its own off when it stops being a dependency", () => {
    useWorkspaceStore.getState().upsertDependencyMap({
      id: DEPENDENCY_MAP_ID,
      nodes: [
        { id: "c", label: "Checkout" },
        { id: "p", label: "Payments" },
      ],
      edges: [
        {
          id: "theirs",
          from: "c",
          to: "p",
          kind: "needs",
          sourceRef: { tool: "scrum-of-scrums", id: "s" },
        },
      ],
    });
    const reused = syncDependencyEdge(null, dep(), sides)!;
    expect(reused).toBe("theirs");
    const linked = dep({ edgeId: reused });
    expect(syncDependencyEdge(linked, { ...linked, kind: "feature" }, sides)).toBeUndefined();
    expect(map().edges.map((e) => e.id)).toEqual(["theirs"]);

    const own = syncDependencyEdge(null, dep({ id: "d2" }), { ...sides, dependsOn: "Data" })!;
    const mine = dep({ id: "d2", edgeId: own });
    syncDependencyEdge(mine, { ...mine, kind: "risk" }, sides);
    expect(map().edges.map((e) => e.id)).toEqual(["theirs"]);
  });
});

/* ── Export and example ───────────────────────────────────────────────── */

describe("Markdown export and example", () => {
  it("exports load, the board, objectives and dependencies", () => {
    const { state } = buildExample(new Date(2026, 9, 23));
    const md = toMarkdown(state, { nodes: [], edges: [] }, TODAY);
    expect(md).toContain("# PI Planning — 23 Oct 2026");
    expect(md).toContain("| Checkout | 62 | 150 | 41% |");
    expect(md).toContain("- Iteration 2 (33 / 30 pts, over capacity): One-page checkout (20 pts)");
    expect(md).toContain(
      "| Payments | Finance sees payouts without a spreadsheet | Not scored | Committed |"
    );
    expect(md).toContain("| Mobile | Guest checkout endpoint | Checkout | Not on the map | — |");
    expect(toMarkdown(board({ teams: [] }), { nodes: [], edges: [] }, TODAY)).toContain(
      "No teams on the board yet."
    );
  });

  it("uses example ids, and clearing keeps the user's own teams", () => {
    const { state } = buildExample();
    expect(
      [...state.teams, ...state.items, ...(state.objectives ?? [])].every((x) =>
        x.id.startsWith("example-")
      )
    ).toBe(true);
    const mixed: PiState = {
      ...state,
      teams: [...state.teams, { id: "mine", name: "Mine" }],
      items: [
        ...state.items,
        item("x", { teamId: "mine" }),
        item("y", { teamId: state.teams[0].id }),
      ],
    };
    const cleared = withoutExample(mixed);
    expect(cleared.teams.map((t) => t.id)).toEqual(["mine"]);
    expect(cleared.items.map((i) => i.id)).toEqual(["x"]);
  });
});

/* ── The page ─────────────────────────────────────────────────────────── */

describe("PI Planning page", () => {
  it("loads the example from the empty state, links its dependencies, and clears them", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(stored().teams).toHaveLength(3);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        "3 teams plan 133 feature points against a capacity of 375 (35%); over capacity: Checkout in iteration 2; 2 open dependencies (1 overdue)."
      )
    ).toBeInTheDocument();
    expect(map().edges).toHaveLength(2);
    expect(map().edges.every((e) => e.id.startsWith("example-pi-"))).toBe(true);
    // No Monte Carlo and no history counter any more.
    expect(screen.queryByText(/P85/)).not.toBeInTheDocument();
    expect(screen.queryByText(/since PI start/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(stored().teams).toEqual([]);
    expect(map().edges).toEqual([]);
    expect(map().nodes).toEqual([]);
  });

  it("adds a team only with a name, and leaves a blank velocity unset", () => {
    renderBoard();
    const name = screen.getByLabelText(/^Team name/);
    fireEvent.submit(name.closest("form")!);
    expect(screen.getByText("Name the team.")).toBeInTheDocument();
    fireEvent.change(name, { target: { value: "Payments" } });
    fireEvent.submit(name.closest("form")!);
    expect(stored().teams).toMatchObject([{ name: "Payments" }]);
    expect(stored().teams[0].velocity).toBeUndefined();
    expect(screen.getByText("No velocity set: load can't be checked")).toBeInTheDocument();
  });

  it("adds a dependency item that goes on the map and resolves from either side", () => {
    seedBoard(board());
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add item to Checkout, iteration 2" }));
    const form = screen.getByRole("button", { name: "Add item" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Item/), { target: { value: "Refund API" } });
    fireEvent.submit(form);
    expect(within(form).getByText("Pick a kind.")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("radio", { name: "Dependency" }));
    fireEvent.submit(form);
    expect(within(form).getByText("Name the team it waits on.")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText(/^Waits on/), { target: { value: "Payments" } });
    fireEvent.submit(form);

    const saved = stored().items[0];
    expect(saved).toMatchObject({ kind: "dependency", iteration: 1, dependsOn: "Payments" });
    expect(saved.points).toBeUndefined();
    expect(map().edges).toMatchObject([{ id: saved.edgeId, status: "open", note: "Refund API" }]);
    expect(screen.getByText("Waits on Payments")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resolve Refund API" }));
    expect(map().edges[0].status).toBe("resolved");
    expect(screen.getByRole("button", { name: "Reopen Refund API" })).toBeInTheDocument();

    // Reopened on the map: the board shows it at once.
    act(() =>
      useWorkspaceStore.getState().upsertDependencyMap({
        ...map(),
        edges: map().edges.map((e) => ({ ...e, status: "open" as const })),
      })
    );
    expect(screen.getByRole("button", { name: "Resolve Refund API" })).toBeInTheDocument();
  });

  it("moves an item to another team's iteration from the Move menu", () => {
    seedBoard(board({ items: [item("a", { title: "Saved cards" })] }));
    renderBoard();
    openMenu("Move Saved cards");
    expect(
      screen.getByRole("menuitem", { name: "Checkout, iteration 1 (here now)" })
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Payments, iteration 3" }));
    expect(stored().items[0]).toMatchObject({ teamId: "t2", iteration: 2 });
  });

  it("edits an item in place without saving a blank title", () => {
    seedBoard(board({ items: [item("a", { title: "Saved cards", points: 5 })] }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Edit Saved cards" }));
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    const title = within(form).getByLabelText(/^Item/);
    expect(title).toHaveFocus();
    fireEvent.change(title, { target: { value: " " } });
    fireEvent.submit(form);
    expect(stored().items[0].title).toBe("Saved cards");
    fireEvent.change(title, { target: { value: "Saved cards v2" } });
    fireEvent.change(within(form).getByLabelText(/^Points/), { target: { value: "" } });
    fireEvent.submit(form);
    expect(stored().items[0]).toMatchObject({ title: "Saved cards v2" });
    expect(stored().items[0].points).toBeUndefined();
  });

  it("deletes an item, and its own edge, with Undo", () => {
    seedBoard(board());
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add item to Checkout, iteration 1" }));
    const form = screen.getByRole("button", { name: "Add item" }).closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Item/), { target: { value: "Refund API" } });
    fireEvent.click(within(form).getByRole("radio", { name: "Dependency" }));
    fireEvent.change(within(form).getByLabelText(/^Waits on/), { target: { value: "Payments" } });
    fireEvent.submit(form);
    expect(map().edges).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Delete Refund API" }));
    expect(stored().items).toEqual([]);
    expect(map().edges).toEqual([]);
    expect(lastToast()[0]).toBe("Deleted “Refund API”");
    undoLast();
    expect(stored().items).toHaveLength(1);
    expect(map().edges).toHaveLength(1);
  });

  it("asks before removing a team with work, then offers Undo", () => {
    seedBoard(
      board({
        items: [item("a"), item("b", { teamId: "t2" })],
        objectives: [{ id: "o1", teamId: "t1", title: "Guest checkout", committed: true }],
      })
    );
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Remove team Checkout" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove team “Checkout”?");
    expect(dialog).toHaveTextContent("Its 1 item and 1 objective go with it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove team" }));
    expect(stored().teams.map((t) => t.id)).toEqual(["t2"]);
    expect(stored().items.map((i) => i.id)).toEqual(["b"]);
    expect(stored().objectives).toEqual([]);
    undoLast();
    expect(stored().teams.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(
      stored()
        .items.map((i) => i.id)
        .sort()
    ).toEqual(["a", "b"]);
    expect(stored().objectives).toHaveLength(1);
  });

  it("cuts iterations with a dialog instead of window.confirm, with Undo", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    seedBoard(board({ items: [item("a"), item("late", { iteration: 2 })] }));
    renderBoard();
    fireEvent.change(screen.getByLabelText(/^Iterations in the PI/), { target: { value: "2" } });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("1 item planned in iteration 3 will be removed.");
    expect(stored().iterations).toBe(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove iterations" }));
    expect(stored()).toMatchObject({ iterations: 2 });
    expect(stored().items.map((i) => i.id)).toEqual(["a"]);
    undoLast();
    expect(stored().iterations).toBe(3);
    expect(stored().items.map((i) => i.id)).toEqual(["a", "late"]);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("offers to move old dependency items onto the map, with Undo", () => {
    seedBoard(board({ items: [item("old", { kind: "dependency", title: "Refund API" })] }));
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Add to the Dependency Map" }));
    expect(map().edges).toHaveLength(1);
    expect(stored().items[0]).toMatchObject({ edgeId: map().edges[0].id, dependsOn: "Refund API" });
    expect(
      screen.queryByRole("button", { name: "Add to the Dependency Map" })
    ).not.toBeInTheDocument();
    undoLast();
    expect(map().edges).toEqual([]);
    expect(stored().items[0].edgeId).toBeUndefined();
  });

  it("adds objectives with business value and a commitment, and deletes them with Undo", () => {
    seedBoard(board());
    renderBoard();
    const title = screen.getByLabelText(/^Objective/);
    const form = title.closest("form")!;
    fireEvent.change(within(form).getByLabelText(/^Team/), { target: { value: "t1" } });
    fireEvent.change(title, { target: { value: "Guest checkout" } });
    fireEvent.submit(form);
    expect(within(form).getByText("Say whether the team commits to it.")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("radio", { name: "Committed" }));
    fireEvent.click(
      within(within(form).getByRole("radiogroup", { name: "Business value" })).getByRole("radio", {
        name: "8",
      })
    );
    fireEvent.submit(form);
    expect(stored().objectives).toMatchObject([
      { teamId: "t1", title: "Guest checkout", businessValue: 8, committed: true },
    ]);
    expect(screen.getByText(/1 committed \(BV 8\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete objective Guest checkout" }));
    expect(stored().objectives).toEqual([]);
    undoLast();
    expect(stored().objectives).toHaveLength(1);
  });
});
