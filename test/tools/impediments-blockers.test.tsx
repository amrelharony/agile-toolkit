/**
 * Impediments' blockers (tools plan, phase 2): the Cluster field on the
 * form, kept when untouched and taking its side with it when cleared; the
 * "Blockers: where the time goes" section (the verdict, the window, the
 * clusters to raise, the blockers to cluster with Undo, Amr's clusters
 * without AI, blocked work and blocks from before tracking); the Markdown's
 * optional Blockers section; and the pure cluster writes under them.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type Impediment,
  type KanbanBoard,
  type KanbanCard,
  type Story,
} from "@/lib/stores/workspace-types";
import { addDays } from "@/lib/impediments/model";
import { LEGACY_IMPEDIMENTS_KEY } from "@/lib/impediments/legacy-key";
import { IMPEDIMENT_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() })
);
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => (
    <pre data-testid="export-markdown">{markdown}</pre>
  ),
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
// Recharts has nothing to measure in jsdom; the charts' text is tested directly.
vi.mock("@/app/(tools)/impediments/charts", () => ({ WeeklyImpedimentsChart: () => null }));
vi.mock("@/app/(tools)/impediments/blockers-chart", () => ({ BlockersParetoChart: () => null }));

import { ImpedimentsClient } from "@/app/(tools)/impediments/impediments-client";
import { buildExample } from "@/app/(tools)/impediments/example";
import { toMarkdown } from "@/app/(tools)/impediments/markdown";
import { applyValues, draftFrom, validateImpediment } from "@/app/(tools)/impediments/form";
import { validateClusterName } from "@/app/(tools)/impediments/blockers-section";
import { clusterWrite, sameCluster, undoChanges } from "@/app/(tools)/impediments/blocker-writes";
import { clusterPareto, blockerRows, lastDays } from "@/lib/impediments/blockers";

const TODAY = todayLocalISO();
const ago = (n: number) => addDays(TODAY, -n);
const stamp = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const imp = (id: string, title: string, extra: Partial<Impediment> = {}): Impediment => ({
  id,
  title,
  severity: "medium",
  raisedAt: ago(2),
  source: "manual",
  ...extra,
});
const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "in_progress",
  sprintId: "s1",
  ...patch,
});
const card = (id: string, patch: Partial<KanbanCard> = {}): KanbanCard => ({
  id,
  title: `Card ${id}`,
  column: "in_progress",
  class: "standard",
  createdAt: ago(5),
  ...patch,
});
const board = (cards: KanbanCard[]): KanbanBoard => ({
  id: KANBAN_BOARD_ID,
  cards,
  wipLimits: { backlog: 0, ready: 0, in_progress: 3, review: 2, done: 0 },
});

const ws = () => useWorkspaceStore.getState();
const renderPage = () =>
  render(
    <LiveAnnouncerProvider>
      <TooltipProvider>
        <ImpedimentsClient />
      </TooltipProvider>
    </LiveAnnouncerProvider>
  );
const undoLast = () => {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  expect(opts?.action).toBeTruthy();
  act(() => opts?.action?.onClick());
};

beforeEach(() => {
  toastSpy.mockReset();
  logs.length = 0;
  window.localStorage.removeItem(LEGACY_IMPEDIMENTS_KEY);
  useWorkspaceStore.setState({
    impediments: [],
    stories: [],
    kanbanBoards: [],
    whiteboardObjects: [],
  });
});

/* ── The form's Cluster field ───────────────────────────────────────── */

describe("the Cluster field", () => {
  it("is read into the draft and kept when untouched, with its side", () => {
    const stored = imp("a", "CI down", {
      cluster: "Test or build environment",
      blockSide: "internal",
    });
    const v = validateImpediment(draftFrom(stored), TODAY, { stored: draftFrom(stored) });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(applyValues(stored, v.values)).toBe(stored);
  });

  it("takes the side with it when cleared, and refuses a long one", () => {
    const stored = imp("a", "CI down", { cluster: "Another team", blockSide: "external" });
    const d = { ...draftFrom(stored), cluster: "" };
    const v = validateImpediment(d, TODAY);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const next = applyValues(stored, v.values);
    expect(next).not.toHaveProperty("cluster");
    expect(next).not.toHaveProperty("blockSide");
    const long = validateImpediment({ ...d, cluster: "x".repeat(61) }, TODAY);
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors.cluster).toMatch(/60 characters/);
  });

  it("saves a cluster logged with a new impediment", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Log impediment" }));
    fireEvent.change(screen.getByLabelText(/^Impediment/), { target: { value: "Staging down" } });
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    fireEvent.change(screen.getByLabelText("Cluster"), {
      target: { value: "  Test or build   environment " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log impediment" }));
    expect(ws().impediments[0]).toMatchObject({ cluster: "Test or build environment" });
  });
});

/* ── The section ────────────────────────────────────────────────────── */

describe("Blockers: where the time goes", () => {
  it("ranks the example's clusters by impediments raised, with nothing blocked yet", async () => {
    useWorkspaceStore.setState({ impediments: buildExample(TODAY) });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    expect(
      s.getByText(/^Test or build environment comes up most: 3 impediments/)
    ).toBeInTheDocument();
    const raise = within(s.getByRole("list", { name: "Clusters to raise" }));
    // Its impediments are still open, so the cluster is already raised: the page links to which.
    expect(raise.getByRole("button", { name: "Open “Build server down”" })).toHaveTextContent(
      "“Build server down”"
    );
    expect(raise.getAllByText(/^Raised as/).length).toBeGreaterThan(0);
    expect(raise.queryByRole("button", { name: /Raise “Test or build environment”/ })).toBeNull();
    expect(s.getByText(/Blocked time counts from/)).toBeInTheDocument();
  });

  it("takes the person to the raised impediment's card, clearing a filter that hides it", async () => {
    useWorkspaceStore.setState({
      impediments: [
        imp("i1", "Keeps blocking us: Another team", { cluster: "Another team" }),
        imp("i2", "Old one", { resolvedAt: ago(1) }),
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /^Resolved/ }));
    expect(
      screen.queryByRole("button", { name: "Edit Keeps blocking us: Another team" })
    ).toBeNull();
    const s = within(screen.getByRole("region", { name: "Blockers: where the time goes" }));
    fireEvent.click(s.getByRole("button", { name: "Open “Keeps blocking us: Another team”" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Keeps blocking us: Another team" })
      ).toHaveFocus()
    );
    expect(screen.getByRole("radio", { name: /^All/ })).toHaveAttribute("aria-checked", "true");
  });

  it("shows the blocked work and its export before any impediment is logged", async () => {
    useWorkspaceStore.setState({
      stories: [
        story("a", {
          blockLog: [{ from: stamp(6), to: stamp(4), cluster: "Waiting for a review" }],
        }),
        story("b", { title: "Refund flow", blocked: true, blockLog: [{ from: stamp(1) }] }),
      ],
    });
    renderPage();
    expect(await screen.findByText(/^No impediments logged\./)).toBeInTheDocument();
    const s = within(screen.getByRole("region", { name: "Blockers: where the time goes" }));
    expect(s.getByText(/^Waiting for a review cost the most: 2 blocked days/)).toBeInTheDocument();
    expect(s.getByRole("list", { name: "Clusters to raise" })).toBeInTheDocument();
    expect(s.getByRole("combobox", { name: "Cluster for Refund flow" })).toBeInTheDocument();
    const md = s.getByTestId("export-markdown").textContent ?? "";
    expect(md).toContain("No impediments logged yet.");
    expect(md).toContain("## Blockers (last 90 days)");
  });

  it("keeps to the empty state with nothing blocked and nothing logged", async () => {
    renderPage();
    expect(await screen.findByText(/^No impediments logged\./)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Blockers: where the time goes" })).toBeNull();
  });

  it("clusters a blocked story's spell from the list, with Undo", async () => {
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Release waiting", { cluster: "A decision or approval" })],
      stories: [
        story("s", {
          title: "Pay with a saved card",
          blocked: true,
          blockLog: [{ from: stamp(2) }],
        }),
      ],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    const list = within(s.getByRole("list", { name: "Blockers to cluster" }));
    fireEvent.change(list.getByRole("combobox", { name: "Cluster for Pay with a saved card" }), {
      target: { value: "Another team" },
    });
    expect(ws().stories[0].blockLog?.[0]).toMatchObject({
      cluster: "Another team",
      side: "external",
    });
    expect(logs.at(-1)).toEqual({
      action: IMPEDIMENT_ACTIONS.BLOCKERS_CLUSTERED,
      payload: { blockers: 1, clusters: 1, source: "manual" },
    });
    expect(s.getByText("Put “Pay with a saved card” under Another team.")).toBeInTheDocument();
    undoLast();
    expect(ws().stories[0].blockLog?.[0]).not.toHaveProperty("cluster");
    expect(ws().stories[0].blockLog?.[0]).not.toHaveProperty("side");
  });

  it("names a new cluster with its side, written on the card's spell", async () => {
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Anything")],
      kanbanBoards: [
        board([
          card("c", { title: "Export orders", blocked: true, blockLog: [{ from: stamp(1) }] }),
        ]),
      ],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    fireEvent.change(s.getByRole("combobox", { name: "Cluster for Export orders" }), {
      target: { value: "__new__" },
    });
    fireEvent.click(s.getByRole("button", { name: "Save cluster" }));
    expect(s.getByRole("alert")).toHaveTextContent("Name the cluster.");
    fireEvent.change(s.getByLabelText("New cluster"), { target: { value: "Waiting on legal" } });
    fireEvent.click(s.getByRole("radio", { name: "Outside" }));
    fireEvent.click(s.getByRole("button", { name: "Save cluster" }));
    expect(ws().kanbanBoards?.[0].cards[0].blockLog?.[0]).toMatchObject({
      cluster: "Waiting on legal",
      side: "external",
    });
  });

  it("gives a cluster the team named its side again when it is picked for another blocker", async () => {
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Anything", { cluster: "Another team" })],
      stories: [
        story("a", { title: "Contract wording", blocked: true, blockLog: [{ from: stamp(2) }] }),
        story("b", { title: "Data retention", blocked: true, blockLog: [{ from: stamp(1) }] }),
      ],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    fireEvent.change(s.getByRole("combobox", { name: "Cluster for Contract wording" }), {
      target: { value: "__new__" },
    });
    fireEvent.change(s.getByLabelText("New cluster"), { target: { value: "Legal sign-off" } });
    fireEvent.click(s.getByRole("radio", { name: "Outside" }));
    fireEvent.click(s.getByRole("button", { name: "Save cluster" }));
    const select = s.getByRole("combobox", { name: "Cluster for Data retention" });
    expect(within(select).getByRole("group", { name: "Your clusters" })).toHaveTextContent(
      "Legal sign-off"
    );
    fireEvent.change(select, { target: { value: "Legal sign-off" } });
    const spell = (id: string) => ws().stories.find((x) => x.id === id)?.blockLog?.[0];
    expect(spell("a")).toMatchObject({ cluster: "Legal sign-off", side: "external" });
    expect(spell("b")).toMatchObject({ cluster: "Legal sign-off", side: "external" });
  });

  it("raises a cluster as one impediment, with Undo, and then says it is raised", async () => {
    useWorkspaceStore.setState({
      impediments: [
        imp("i1", "Platform team slow", { cluster: "Another team", resolvedAt: ago(1) }),
      ],
      stories: [
        story("a", { blockLog: [{ from: stamp(5), to: stamp(3), cluster: "Another team" }] }),
        story("b", { blockLog: [{ from: stamp(4), to: stamp(1), cluster: "Another team" }] }),
      ],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    fireEvent.click(s.getByRole("button", { name: "Raise “Another team” as an impediment" }));
    const raised = ws().impediments.find((i) => i.title === "Keeps blocking us: Another team");
    expect(raised).toMatchObject({
      category: "external",
      blockSide: "external",
      severity: "medium",
    });
    expect(logs.at(-1)).toMatchObject({
      action: IMPEDIMENT_ACTIONS.CLUSTER_RAISED,
      // Two blocked spells and the resolved impediment in the cluster.
      payload: { impedimentId: raised?.id, size: 3 },
    });
    expect(
      await screen.findByRole("button", { name: "Open “Keeps blocking us: Another team”" })
    ).toBeInTheDocument();
    undoLast();
    expect(ws().impediments.some((i) => i.title.startsWith("Keeps blocking us"))).toBe(false);
  });

  it("wraps a long cluster's raise button inside the card, never wider than a phone", async () => {
    const long = "Unclear or changing requirement";
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Scope moved", { cluster: long, resolvedAt: ago(1) })],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    const button = s.getByRole("button", { name: `Raise “${long}” as an impediment` });
    // Button is whitespace-nowrap by default: at 375 px this label alone is wider than the card.
    expect(button.className).toMatch(/\bwhitespace-normal\b/);
    expect(button.className).toMatch(/\bmax-w-full\b/);
    expect(button.className).toMatch(/\bh-auto\b/);
  });

  it("clusters by keywords without AI, accepted in one write per collection", async () => {
    useWorkspaceStore.setState({
      impediments: [
        imp("i1", "Staging environment down"),
        imp("i2", "CI pipeline red"),
        imp("i3", "No access to the logs"),
      ],
      stories: [
        story("s", {
          blocked: true,
          blockLog: [{ from: stamp(1), cause: "Pipeline flaky again" }],
        }),
      ],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    fireEvent.click(s.getByRole("button", { name: "Group by keywords" }));
    const list = within(await screen.findByTestId("ai-suggestions"));
    expect(list.getByText(/Suggested without AI/)).toBeInTheDocument();
    let impWrites = 0;
    let storyWrites = 0;
    const unsub = useWorkspaceStore.subscribe((st, prev) => {
      if (st.impediments !== prev.impediments) impWrites++;
      if (st.stories !== prev.stories) storyWrites++;
    });
    fireEvent.click(list.getByRole("button", { name: /^Accept: Test or build environment/ }));
    unsub();
    expect(impWrites).toBe(1);
    expect(storyWrites).toBe(1);
    expect(ws().impediments.filter((i) => i.cluster === "Test or build environment")).toHaveLength(
      2
    );
    expect(ws().stories[0].blockLog?.[0].cluster).toBe("Test or build environment");
    expect(logs.at(-1)).toMatchObject({
      action: IMPEDIMENT_ACTIONS.BLOCKERS_CLUSTERED,
      payload: { blockers: 3, clusters: 1, source: "fallback" },
    });
    undoLast();
    expect(ws().impediments.some((i) => i.cluster)).toBe(false);
  });

  it("shows 20 blockers to cluster, then all of them, the newest first", async () => {
    useWorkspaceStore.setState({
      impediments: Array.from({ length: 24 }, (_, n) =>
        imp(`i${n}`, `Impediment ${n}`, { raisedAt: ago(3 + n) })
      ),
      stories: [
        story("s", { title: "Today's block", blocked: true, blockLog: [{ from: stamp(0) }] }),
      ],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    expect(s.getByRole("heading", { name: "Not clustered yet (25)" })).toBeInTheDocument();
    const rows = () =>
      within(s.getByRole("list", { name: "Blockers to cluster" })).getAllByRole("listitem");
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toHaveTextContent("Today's block");
    expect(rows()[1]).toHaveTextContent("Impediment 0");
    fireEvent.click(s.getByRole("button", { name: "Show all 25" }));
    expect(rows()).toHaveLength(25);
    expect(rows()[24]).toHaveTextContent("Impediment 23");
    fireEvent.click(s.getByRole("button", { name: "Show fewer" }));
    expect(rows()).toHaveLength(20);
  });

  it("switches the window and shows the top clusters by month", async () => {
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Old one", { cluster: "Another team", raisedAt: ago(60) })],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    fireEvent.click(s.getByRole("radio", { name: "30 days" }));
    expect(s.getByText(/Nothing was blocked in the last 30 days/)).toBeInTheDocument();
    fireEvent.click(s.getByRole("radio", { name: "By month" }));
    expect(
      within(s.getByRole("list", { name: "Top clusters per month" })).getByText(/Another team 1/)
    ).toBeInTheDocument();
  });

  it("counts blocks from before tracking apart", async () => {
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Anything")],
      stories: [story("s", { blocked: true })],
    });
    renderPage();
    const s = within(await screen.findByRole("region", { name: "Blockers: where the time goes" }));
    expect(s.getByText(/1 item was blocked before tracking began/)).toBeInTheDocument();
  });

  it("adds a Blockers section to the export, from the stories too", async () => {
    useWorkspaceStore.setState({
      impediments: [imp("i1", "Anything", { cluster: "Another team" })],
      stories: [
        story("s", { blockLog: [{ from: stamp(4), to: stamp(2), cluster: "Another team" }] }),
      ],
    });
    renderPage();
    const md = (await screen.findByTestId("export-markdown")).textContent ?? "";
    expect(md).toContain("## Blockers (last 90 days)");
    expect(md).toContain("| Cluster | Inside/outside | Blocked days | Impediments | Share |");
    expect(md).toContain("| Another team | Outside | 2 | 1 | 100% |");
    expect(md).toContain("Outside the team: 100% of blocked days.");
  });
});

/* ── Pure pieces ────────────────────────────────────────────────────── */

describe("the Markdown's Blockers section", () => {
  it("stays out with two arguments, and with nothing blocked", () => {
    const list = buildExample(TODAY);
    expect(toMarkdown(list, TODAY)).not.toContain("## Blockers");
    expect(
      toMarkdown([imp("a", "x", { raisedAt: ago(200) })], TODAY, {
        stories: [],
        cards: [],
        now: Date.now(),
      })
    ).not.toContain("## Blockers");
    const md = toMarkdown(list, TODAY, { stories: [], cards: [], now: Date.now() });
    expect(md).toContain("of impediments raised");
    expect(md).toContain("| Test or build environment | Inside | 0 | 3 |");
  });

  it("adds the blocked stories and cards with no impediment logged yet", () => {
    const blocked = {
      stories: [
        story("s", { blockLog: [{ from: stamp(4), to: stamp(2), cluster: "Another team" }] }),
      ],
      cards: [],
      now: Date.now(),
    };
    const md = toMarkdown([], TODAY, blocked);
    expect(md).toContain("No impediments logged yet.");
    expect(md).toContain("## Blockers (last 90 days)");
    expect(md).toContain("| Another team | Outside | 2 | 0 | 100% |");
    // Nothing blocked: the two-line export as before.
    expect(toMarkdown([], TODAY, { stories: [], cards: [], now: Date.now() })).toBe(
      toMarkdown([], TODAY)
    );
  });
});

describe("cluster writes", () => {
  const data = {
    impediments: [
      imp("i1", "A"),
      imp("i2", "B", { cluster: "Old", blockSide: "internal" as const }),
    ],
    stories: [story("s", { blocked: true, blockLog: [{ from: stamp(1) }] })],
    board: board([card("c", { blockLog: [{ from: stamp(3), to: stamp(2) }] })]),
  };

  it("writes one cluster on many blockers, one list per collection", () => {
    const w = clusterWrite(
      data,
      sameCluster(
        [
          { kind: "impediment", id: "i1" },
          { kind: "impediment", id: "i2" },
          { kind: "story", id: "s" },
          { kind: "card", id: "c", spellFrom: data.board.cards[0].blockLog![0].from },
        ],
        "Another team",
        "external"
      )
    );
    expect(w.impediments.map((i) => [i.id, i.cluster, i.blockSide])).toEqual([
      ["i1", "Another team", "external"],
      ["i2", "Another team", "external"],
    ]);
    expect(w.stories[0].blockLog?.[0]).toMatchObject({ cluster: "Another team", side: "external" });
    expect(w.board?.cards[0].blockLog?.[0].cluster).toBe("Another team");
    expect(w.before.find((b) => b.id === "i2")).toMatchObject({ cluster: "Old", side: "internal" });
  });

  it("puts back only what still holds the written cluster", () => {
    const w = clusterWrite(
      data,
      sameCluster(
        [
          { kind: "impediment", id: "i1" },
          { kind: "impediment", id: "i2" },
        ],
        "X"
      )
    );
    const after = {
      ...data,
      impediments: data.impediments.map((i) => ({
        ...(w.impediments.find((n) => n.id === i.id) ?? i),
        ...(i.id === "i1" ? { cluster: "Changed since" } : {}),
      })),
    };
    expect(undoChanges(w.before, after)).toEqual([
      { kind: "impediment", id: "i2", cluster: "Old", side: "internal" },
    ]);
  });

  it("checks a new cluster's name", () => {
    expect(validateClusterName("  Waiting   on legal ")).toEqual({
      ok: true,
      values: "Waiting on legal",
    });
    expect(validateClusterName("   ").ok).toBe(false);
    expect(validateClusterName("x".repeat(61)).ok).toBe(false);
  });

  it("ranks the example's clusters by impediments", () => {
    const rows = blockerRows([], [], buildExample(TODAY), lastDays(90, TODAY, Date.now()), {
      includeExamples: true,
    });
    const p = clusterPareto(rows);
    expect(p.measure).toBe("impediments");
    expect(p.clusters[0]).toMatchObject({ cluster: "Test or build environment", impediments: 3 });
  });
});
