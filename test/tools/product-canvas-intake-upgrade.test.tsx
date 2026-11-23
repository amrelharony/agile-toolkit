import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  ProductCanvas,
  ProductIdeaIntake,
  ProductPitchBet,
} from "@/lib/stores/workspace-types";

/**
 * Product Canvas, P2.3b: the idea inbox (quick capture with look-alikes,
 * the ideas by demand and status, asked again, triage, accept and hand on,
 * merges with Undo, a straw poll, the export with and without who asked),
 * the lean business case (the verdict, its milestone, the Decision Log),
 * and the Shape Up pitch (appetite, nice-to-have scopes and their sends,
 * placing a bet in a new or known cycle, a conflict refused, the circuit
 * breaker with Undo, the betting table, a cycle's dates with one Undo, the
 * export and the phone layout). The example is never sent nor logged.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const cheerSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: cheerSpy }));
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
    toolRunId: "t",
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/product-canvas",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => null,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

import { ProductCanvasClient } from "@/app/(tools)/product-canvas/product-canvas-client";
import { buildExample } from "@/app/(tools)/product-canvas/example";
import { useProductCanvasPrefs } from "@/app/(tools)/product-canvas/store";
import { useProductGoalPrefs } from "@/app/(tools)/product-goal/store";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import { readCanvas } from "@/lib/product-canvas/model";
import { cycleEnd } from "@/lib/product-canvas/fields";
import { readPollLink } from "@/lib/quick-vote/link";
import { todayIso } from "@/lib/sprints/series";
import { addDays } from "@/lib/flow/days";

/** jsdom has no ResizeObserver; the send menu's popper measures with one. */
function stubResizeObserver() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

beforeAll(async () => {
  // The format panels and the two views load when needed (next/dynamic): warm them.
  await Promise.all([
    import("@/app/(tools)/product-canvas/panels/inbox-panel"),
    import("@/app/(tools)/product-canvas/panels/intake-panel"),
    import("@/app/(tools)/product-canvas/panels/decision-panel"),
    import("@/app/(tools)/product-canvas/panels/appetite-panel"),
    import("@/app/(tools)/product-canvas/panels/bet-panel"),
    import("@/app/(tools)/product-canvas/panels/betting-table"),
  ]);
});

const ws = () => useWorkspaceStore.getState();
const stored = () => ws().productCanvases ?? [];
const byId = (id: string) => readCanvas(stored().find((c) => c.id === id));
const actions = () => logs.map((l) => l.action);

function undoLast() {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  if (!opts?.action) throw new Error("no Undo toast");
  act(() => opts.action!.onClick());
}

const STAMP = "2026-11-20T09:00:00.000Z";
const TODAY = todayIso();
const day = (n: number) => addDays(TODAY, n)!;

const idea = (
  id: string,
  title: string,
  intake: Partial<ProductIdeaIntake> = {},
  over: Partial<ProductCanvas> = {}
): ProductCanvas => ({
  id,
  format: "idea",
  title,
  sections: {},
  intake: { requesters: [], source: "customer", demand: 1, status: "new", ...intake },
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
const pitch = (
  id: string,
  bet?: ProductPitchBet,
  over: Partial<ProductCanvas> = {}
): ProductCanvas => ({
  id,
  format: "shape-up",
  title: `Pitch ${id}`,
  sections: {},
  ...(bet ? { bet } : {}),
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});
const bizCase = (id: string, over: Partial<ProductCanvas> = {}): ProductCanvas => ({
  id,
  format: "business-case",
  title: "Card-free shops",
  sections: {
    epic: [{ id: "e", text: "Every payment on the owner's phone" }],
    expect: [{ id: "x", text: "Shops stop renting card machines." }],
  },
  createdAt: STAMP,
  updatedAt: STAMP,
  ...over,
});

function seed(...canvases: ProductCanvas[]) {
  useWorkspaceStore.setState({ productCanvases: canvases });
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <ProductCanvasClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** The inbox's quick capture: its idea field (the open idea's own field has no placeholder). */
const capture = () => screen.getByPlaceholderText("Split a bill between two cards");

/** Open a "Send to…" menu by its trigger's name and pick an item. */
function send(trigger: RegExp, itemName: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: trigger }), { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitem", { name: itemName }));
}

beforeEach(() => {
  stubResizeObserver();
  logs.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  cheerSpy.mockClear();
  window.history.replaceState(null, "", "/product-canvas");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useWorkspaceStore.setState({
    productCanvases: [],
    productGoals: [],
    hypothesisTrackers: [],
    stories: [],
    decisions: [],
    opportunityTrees: [],
  });
  useProductCanvasPrefs.setState({ lastFormat: "", inboxFilter: "open", withRequesters: false });
  useProductGoalPrefs.setState({ vision: "" });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the idea inbox", () => {
  it("opens from the empty state's Log an idea, and logs an idea with who asked and where from", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Log an idea" }));
    const field = await screen.findByLabelText(/^The idea/);
    expect(useProductCanvasPrefs.getState().lastFormat).toBe("idea");
    fireEvent.change(field, { target: { value: "Split a bill between two cards" } });
    fireEvent.change(screen.getByLabelText(/^Who asked/), { target: { value: "Support inbox" } });
    fireEvent.change(screen.getByLabelText("Where it came from"), {
      target: { value: "stakeholder" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log the idea" }));
    expect(stored()).toHaveLength(1);
    const c = stored()[0];
    expect(c).toMatchObject({
      format: "idea",
      title: "Split a bill between two cards",
      intake: { requesters: ["Support inbox"], source: "stakeholder", demand: 1, status: "new" },
    });
    // History holds ids and kinds, never who asked.
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.IDEA_LOGGED,
      payload: { canvasId: c.id, source: "stakeholder" },
    });
    // The quick capture is ready for the next idea.
    expect(capture()).toHaveValue("");
    expect(
      within(screen.getByRole("list", { name: "Ideas" })).getByRole("button", {
        name: /Split a bill between two cards/,
      })
    ).toBeInTheDocument();
  });

  it("refuses an idea with no words", async () => {
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Log the idea" }));
    expect(screen.getByText("Write the idea first.")).toBeInTheDocument();
    expect(stored()).toEqual([]);
  });

  it("shows the open ideas that look like one being typed, and opens one", async () => {
    seed(
      idea("pcanvas_split", "Split a bill between two cards", { demand: 2 }),
      idea("pcanvas_tips", "Tips on the payment screen")
    );
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    await screen.findByRole("list", { name: "Ideas" });
    fireEvent.change(capture(), { target: { value: "split the bill between cards" } });
    const alike = screen.getByRole("list", { name: "Ideas that look like it" });
    expect(within(alike).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(
      within(alike).getByRole("button", { name: "Open “Split a bill between two cards”" })
    );
    expect(screen.getByLabelText("The idea", { selector: "#pc-title-pcanvas_split" })).toHaveValue(
      "Split a bill between two cards"
    );
  });

  it("lists ideas most asked for first, and filters them by status", async () => {
    seed(
      idea("pcanvas_a", "Receipts", { demand: 1 }),
      idea("pcanvas_b", "Tips", { demand: 4, status: "assessing" }),
      idea("pcanvas_c", "Two cards", { status: "merged", mergedInto: "pcanvas_b" })
    );
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    const list = await screen.findByRole("list", { name: "Ideas" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual([expect.stringContaining("Tips"), expect.stringContaining("Receipts")]);
    expect(within(list).getByLabelText("Asked for 4 times")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Merged 1/ }));
    expect(useProductCanvasPrefs.getState().inboxFilter).toBe("merged");
    expect(
      within(screen.getByRole("list", { name: "Ideas" })).getByRole("button", { name: /Two cards/ })
    ).toBeInTheDocument();
  });

  it("counts another ask, with who asked, and logs it without the name", async () => {
    seed(idea("pcanvas_a", "Tips", { requesters: ["Support inbox"] }));
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    fireEvent.change(await screen.findByLabelText(/^Who asked again/), {
      target: { value: "Market organiser" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Asked again" }));
    expect(byId("pcanvas_a")!.intake).toMatchObject({
      demand: 2,
      requesters: ["Support inbox", "Market organiser"],
    });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { canvasId: "pcanvas_a", field: "demand" },
    });
    expect(screen.getByText(/asked for 2 times/)).toBeInTheDocument();
  });

  it("assesses and accepts an idea, and needs a note to decline one", async () => {
    seed(idea("pcanvas_a", "Tips"));
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assess it" }));
    expect(byId("pcanvas_a")!.intake?.status).toBe("assessing");
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.IDEA_TRIAGED,
      payload: { canvasId: "pcanvas_a", status: "assessing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decline…" }));
    fireEvent.click(screen.getByRole("button", { name: "Decline the idea" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Say why it's declined");
    expect(byId("pcanvas_a")!.intake?.status).toBe("assessing");
    fireEvent.change(screen.getByLabelText(/^Why not/), {
      target: { value: "Card rules forbid it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decline the idea" }));
    expect(byId("pcanvas_a")!.intake).toMatchObject({
      status: "declined",
      note: "Card rules forbid it",
    });
  });

  it("hands an accepted idea to the backlog and the Opportunity Tree, with its problem and never who asked", async () => {
    seed(
      idea(
        "pcanvas_a",
        "Split a bill",
        { status: "accepted", requesters: ["Priya Shah"] },
        { sections: { problem: [{ id: "p", text: "Two friends want to pay half each" }] } }
      )
    );
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    await screen.findByText("Hand it on:");
    send(/^Send to… Split a bill/, "Backlog story");
    const story = (ws().stories ?? [])[0];
    expect(story).toMatchObject({
      title: "Split a bill",
      notes: "Two friends want to pay half each",
      sourceRef: { tool: "product-canvas", id: "pcanvas_a", doc: "pcanvas_a" },
    });
    expect(JSON.stringify(story)).not.toContain("Priya");
    expect(byId("pcanvas_a")!.sentTo).toEqual([
      expect.objectContaining({ route: "backlog-story", targetId: story.id }),
    ]);
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.ITEM_SENT,
      payload: { canvasId: "pcanvas_a", route: "backlog-story" },
    });
    send(/^Send to… Split a bill/, "Opportunity");
    const nodes = ws().opportunityTrees?.[0]?.nodes ?? [];
    expect(nodes.at(-1)).toMatchObject({ text: "Split a bill" });
    expect(
      byId("pcanvas_a")!
        .sentTo?.map((l) => l.route)
        .sort()
    ).toEqual(["backlog-story", "opportunity"]);
  });

  it("offers no hand-on until the idea is accepted", async () => {
    seed(idea("pcanvas_a", "Tips", { status: "assessing" }));
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    await screen.findByRole("button", { name: "Accept" });
    expect(screen.queryByText("Hand it on:")).toBeNull();
  });

  it("merges an idea into the one it repeats, with Undo", async () => {
    seed(
      idea("pcanvas_split", "Split a bill", { demand: 2, requesters: ["Support"] }),
      idea(
        "pcanvas_cards",
        "Pay with two cards",
        { requesters: ["Sales"] },
        { updatedAt: "2026-11-21T09:00:00.000Z" }
      )
    );
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    fireEvent.click(
      within(await screen.findByRole("list", { name: "Ideas" })).getByRole("button", {
        name: /Pay with two cards/,
      })
    );
    fireEvent.change(screen.getByLabelText("A repeat of"), { target: { value: "pcanvas_split" } });
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(byId("pcanvas_split")!.intake).toMatchObject({
      demand: 3,
      requesters: ["Support", "Sales"],
    });
    expect(byId("pcanvas_cards")!.intake).toMatchObject({
      status: "merged",
      mergedInto: "pcanvas_split",
    });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.IDEAS_MERGED,
      payload: { canvasId: "pcanvas_split", merged: 1 },
    });
    undoLast();
    expect(byId("pcanvas_split")!.intake?.demand).toBe(2);
    expect(byId("pcanvas_cards")!.intake?.status).toBe("new");
  });

  it("finds ideas that look alike, and merges one into the one asked for more", async () => {
    seed(
      idea("pcanvas_split", "Split a bill between two cards", { demand: 3 }),
      idea("pcanvas_cards", "Split the bill between two cards", { demand: 1 })
    );
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Merge “Split the bill between two cards” into “Split a bill between two cards”",
      })
    );
    expect(byId("pcanvas_split")!.intake?.demand).toBe(4);
    expect(byId("pcanvas_cards")!.intake?.status).toBe("merged");
    expect(screen.queryByRole("heading", { name: "These look alike" })).toBeNull();
  });

  it("opens a straw poll in Quick Vote with each open idea numbered, the numbers beside the titles", async () => {
    seed(
      idea("pcanvas_a", "Tips on the payment screen for food stalls", { demand: 4 }),
      idea("pcanvas_b", "Tips on the payment screen for food stalls and cafes", { demand: 2 }),
      idea("pcanvas_c", "Declined one", { status: "declined", note: "x" })
    );
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    const link = await screen.findByRole("link", { name: "Vote in Quick Vote" });
    const poll = readPollLink(link.getAttribute("href")!.split("?")[1]);
    expect(poll?.question).toBe("Which idea should we look at first?");
    expect(poll?.options).toHaveLength(2);
    expect(poll?.options[0].startsWith("1 ")).toBe(true);
    const rows = within(screen.getByRole("list", { name: "Ideas" })).getAllByRole("button");
    expect(rows[0]).toHaveTextContent(/^1/);
    expect(rows[1]).toHaveTextContent(/^2/);
  });

  it("exports the inbox without who asked, unless Include who asked is ticked", async () => {
    seed(idea("pcanvas_a", "Tips", { requesters: ["Market organiser"], demand: 3 }));
    useProductCanvasPrefs.setState({ lastFormat: "idea" });
    renderPage();
    await screen.findByRole("list", { name: "Ideas" });
    expect(exported.markdown).toContain("# Idea inbox");
    expect(exported.markdown).toContain("- Tips (asked for 3 times; from a customer)");
    expect(exported.markdown).not.toContain("Market organiser");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include who asked in the export" }));
    expect(useProductCanvasPrefs.getState().withRequesters).toBe(true);
    expect(exported.markdown).toContain("asked by Market organiser");
  });

  it("keeps ideas out of All, and opens one by link in the inbox", () => {
    seed(idea("pcanvas_a", "Tips"), pitch("pcanvas_p"));
    window.history.replaceState(null, "", "/product-canvas?canvas=pcanvas_a");
    renderPage();
    expect(useProductCanvasPrefs.getState().lastFormat).toBe("idea");
    cleanup();
    useProductCanvasPrefs.setState({ lastFormat: "" });
    window.history.replaceState(null, "", "/product-canvas");
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Canvases" });
    expect(within(nav).getByRole("button", { name: /^All 1/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /^Idea intake 1/ })).toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: /^Tips/ })).toBeNull();
  });
});

describe("the business case", () => {
  it("cheers a go and logs it as the milestone; any other verdict is logged as decided", async () => {
    seed(bizCase("pcanvas_case"));
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: "Go" }));
    expect(byId("pcanvas_case")!.decision).toMatchObject({ verdict: "go" });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CASE_APPROVED,
      payload: { canvasId: "pcanvas_case" },
    });
    expect(cheerSpy).toHaveBeenCalledWith("product-canvas", "milestone");
    expect(screen.getByText(/^Decided on \d{4}-\d{2}-\d{2}\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Change and come back" }));
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CASE_DECIDED,
      payload: { canvasId: "pcanvas_case", verdict: "change" },
    });
    expect(cheerSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a note on why when its field is left", async () => {
    seed(bizCase("pcanvas_case", { decision: { verdict: "no-go" } }));
    renderPage();
    const note = await screen.findByLabelText("Why");
    fireEvent.change(note, { target: { value: "Card schemes may stop phone payments" } });
    fireEvent.blur(note);
    expect(byId("pcanvas_case")!.decision).toMatchObject({
      verdict: "no-go",
      note: "Card schemes may stop phone payments",
    });
  });

  it("records the case in the Decision Log as a proposal, with its options and verdict", async () => {
    seed(bizCase("pcanvas_case", { decision: { verdict: "go" } }));
    renderPage();
    await screen.findByRole("radio", { name: "Go" });
    send(/^Send to… Business case: Every payment/, "Record in the Decision Log");
    const record = (ws().decisions ?? [])[0];
    expect(record).toMatchObject({
      title: "Business case: Every payment on the owner's phone",
      context: "Shops stop renting card machines.",
      status: "proposed",
      recommendation: "Go",
      sourceRef: { tool: "product-canvas", id: "pcanvas_case", doc: "pcanvas_case" },
    });
    expect(record.options?.map((o) => o.text)).toEqual(["Go", "No go", "Change and come back"]);
    expect(byId("pcanvas_case")!.sentTo).toEqual([
      expect.objectContaining({ route: "decision", targetId: record.id }),
    ]);
    expect(actions()).toContain(PRODUCT_CANVAS_ACTIONS.ITEM_SENT);
  });

  it("asks for early signs and the smallest version in its Check panel", async () => {
    seed(bizCase("pcanvas_case"));
    renderPage();
    await screen.findByRole("radio", { name: "Go" });
    const check = screen.getByRole("list", { name: "What the canvas still lacks" });
    expect(within(check).getByText(/No early signs yet/)).toBeInTheDocument();
    expect(
      within(check).getByText("Say the smallest version you could build to test it.")
    ).toBeInTheDocument();
  });
});

describe("the Shape Up pitch", () => {
  it("sets the appetite with a chip or in other weeks, refuses one out of range, and clears it", async () => {
    seed(pitch("pcanvas_p"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "2 weeks" }));
    expect(byId("pcanvas_p")!.appetiteWeeks).toBe(2);
    expect(screen.getByRole("button", { name: "2 weeks" })).toHaveAttribute("aria-pressed", "true");
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { canvasId: "pcanvas_p", field: "appetite" },
    });
    const other = screen.getByLabelText(/^Other, in weeks/);
    fireEvent.change(other, { target: { value: "4" } });
    fireEvent.blur(other);
    expect(byId("pcanvas_p")!.appetiteWeeks).toBe(4);
    fireEvent.change(other, { target: { value: "20" } });
    fireEvent.blur(other);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Set the appetite in whole weeks, 1 to 12."
    );
    expect(byId("pcanvas_p")!.appetiteWeeks).toBe(4);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(byId("pcanvas_p")!).not.toHaveProperty("appetiteWeeks");
  });

  it("marks a scope nice to have with a ~, and sends a scope to the backlog", async () => {
    seed(
      pitch("pcanvas_p", undefined, {
        sections: { scopes: [{ id: "s1", text: "Refund a whole payment" }] },
      })
    );
    renderPage();
    fireEvent.click(await screen.findByRole("checkbox", { name: /^Nice to have/ }));
    expect(byId("pcanvas_p")!.sections.scopes[0]).toMatchObject({ niceToHave: true });
    expect(screen.getByTitle("Nice to have")).toHaveTextContent("~");
    send(/^Send to… Refund a whole payment/, "Backlog story");
    expect((ws().stories ?? [])[0]).toMatchObject({
      title: "Refund a whole payment",
      sourceRef: { tool: "product-canvas", id: "s1", doc: "pcanvas_p" },
    });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.ITEM_SENT,
      payload: { canvasId: "pcanvas_p", section: "scopes", route: "backlog-story" },
    });
  });

  it("places a pitch in a new cycle and logs the bet with its cycle and weeks", async () => {
    seed(pitch("pcanvas_p"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Place in a cycle" }));
    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Starts on"), { target: { value: "2026-12-07" } });
    fireEvent.change(screen.getByLabelText(/^Weeks/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Place the bet" }));
    expect(byId("pcanvas_p")!.bet).toMatchObject({
      status: "bet",
      cycle: 4,
      start: "2026-12-07",
      weeks: 2,
    });
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.BET_PLACED,
      payload: { canvasId: "pcanvas_p", cycle: 4, weeks: 2 },
    });
    expect(screen.getByText("Bet in Cycle 4, 2026-12-07 to 2026-12-20")).toBeInTheDocument();
  });

  it("places a pitch in a known cycle with its dates, and refuses a new one that clashes", async () => {
    seed(
      pitch("pcanvas_known", {
        status: "bet",
        cycle: 4,
        start: day(1),
        weeks: 6,
        decidedAt: STAMP,
      }),
      pitch("pcanvas_p", undefined, { updatedAt: "2026-11-22T09:00:00.000Z" })
    );
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Place in a cycle" }));
    expect(screen.getByLabelText("Cycle")).toHaveValue("4");
    fireEvent.change(screen.getByLabelText("Cycle"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText(/^Number/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Weeks/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Place the bet" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/^Cycle 4 runs from/);
    expect(byId("pcanvas_p")!.bet).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Cycle"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Place the bet" }));
    expect(byId("pcanvas_p")!.bet).toMatchObject({ cycle: 4, start: day(1), weeks: 6 });
  });

  it("offers Ship, Cut and Reshape once the cycle has ended, each with Undo", async () => {
    const start = day(-20);
    seed(pitch("pcanvas_p", { status: "bet", cycle: 3, start, weeks: 2, decidedAt: STAMP }));
    renderPage();
    await screen.findByRole("button", { name: "Ship what’s done" });
    expect(
      screen.getByText(
        `Cycle 3 ended on ${cycleEnd(start, 2)}. Out of time: ship what's done or cut it. Bets don't roll over by default.`
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ship what’s done" }));
    expect(byId("pcanvas_p")!.bet).toMatchObject({ status: "shipped", cycle: 3 });
    undoLast();
    expect(byId("pcanvas_p")!.bet).toMatchObject({ status: "bet", cycle: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Reshape it" }));
    expect(byId("pcanvas_p")!).not.toHaveProperty("bet");
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { canvasId: "pcanvas_p", field: "bet", status: "table" },
    });
  });

  it("bets a pitch passed on in a cycle back in that cycle from the select", async () => {
    seed(
      pitch("pcanvas_p", { status: "passed", cycle: 4, start: day(2), weeks: 6, decidedAt: STAMP })
    );
    renderPage();
    fireEvent.change(await screen.findByLabelText("Where it stands"), { target: { value: "bet" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(byId("pcanvas_p")!.bet).toMatchObject({
      status: "bet",
      cycle: 4,
      start: day(2),
      weeks: 6,
    });
    // Bet on again, in the cycle it was passed on in: logged as a bet.
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.BET_PLACED,
      payload: { canvasId: "pcanvas_p", cycle: 4, weeks: 6 },
    });
  });

  it("moves a pitch with its status select, asking for a cycle before a bet", async () => {
    seed(pitch("pcanvas_p"));
    renderPage();
    const select = await screen.findByLabelText("Where it stands");
    fireEvent.change(select, { target: { value: "passed" } });
    expect(byId("pcanvas_p")!.bet).toMatchObject({ status: "passed" });
    fireEvent.change(screen.getByLabelText("Where it stands"), { target: { value: "bet" } });
    // No cycle yet: the cycle form opens instead.
    expect(screen.getByRole("button", { name: "Place the bet" })).toBeInTheDocument();
    expect(byId("pcanvas_p")!.bet?.status).toBe("passed");
  });
});

describe("the betting table", () => {
  const pitches = () => [
    pitch("pcanvas_a", {
      status: "bet",
      cycle: 4,
      start: "2026-10-05",
      weeks: 6,
      decidedAt: STAMP,
    }),
    pitch("pcanvas_b", {
      status: "shipped",
      cycle: 4,
      start: "2026-10-05",
      weeks: 6,
      decidedAt: STAMP,
    }),
    pitch("pcanvas_c", undefined, { appetiteWeeks: 6 }),
    pitch("pcanvas_d", undefined, { appetiteWeeks: 2 }),
    pitch("pcanvas_e", { status: "passed" }),
  ];

  it("shows every pitch in its column, stacked on a phone", async () => {
    seed(...pitches());
    useProductCanvasPrefs.setState({ lastFormat: "shape-up" });
    const { container } = renderPage();
    const table = await screen.findByRole("region", { name: /^On the table 2/ });
    expect(within(table).getByRole("button", { name: /Pitch pcanvas_c/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^Bet 1/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^Not this time 1/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^Done 1/ })).toBeInTheDocument();
    const columns = table.parentElement!;
    expect(columns.className).toContain("md:grid-cols-2");
    expect(container.querySelectorAll(".grid-cols-2, .grid-cols-4")).toHaveLength(0);
  });

  it("changes a cycle's dates for every bet in it, with one Undo", async () => {
    seed(...pitches());
    useProductCanvasPrefs.setState({ lastFormat: "shape-up" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Change Cycle 4's dates" }));
    const cyclesRegion = screen.getByRole("region", { name: "Cycles" });
    fireEvent.change(within(cyclesRegion).getByLabelText("Starts on"), {
      target: { value: "2026-10-12" },
    });
    fireEvent.change(within(cyclesRegion).getByLabelText(/^Weeks/), { target: { value: "4" } });
    fireEvent.click(within(cyclesRegion).getByRole("button", { name: "Save the dates" }));
    for (const id of ["pcanvas_a", "pcanvas_b"]) {
      expect(byId(id)!.bet).toMatchObject({ start: "2026-10-12", weeks: 4 });
    }
    expect(logs.at(-1)).toEqual({
      action: PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED,
      payload: { field: "cycle", cycle: 4, count: 2 },
    });
    undoLast();
    for (const id of ["pcanvas_a", "pcanvas_b"]) {
      expect(byId(id)!.bet).toMatchObject({ start: "2026-10-05", weeks: 6 });
    }
  });

  it("opens a straw poll over the pitches on the table, numbered beside their titles", async () => {
    seed(...pitches());
    useProductCanvasPrefs.setState({ lastFormat: "shape-up" });
    renderPage();
    const link = await screen.findByRole("link", { name: "Straw poll in Quick Vote" });
    const poll = readPollLink(link.getAttribute("href")!.split("?")[1]);
    expect(poll?.question).toBe("Which pitch should we bet on?");
    expect(poll?.options).toHaveLength(2);
    const table = screen.getByRole("region", { name: /^On the table/ });
    expect(within(table).getByLabelText("Poll option 1")).toBeInTheDocument();
    expect(within(table).getByLabelText("Poll option 2")).toBeInTheDocument();
  });

  it("exports the betting table with each cycle's dates, then the pitch beside it", async () => {
    seed(...pitches());
    useProductCanvasPrefs.setState({ lastFormat: "shape-up" });
    renderPage();
    await screen.findByRole("region", { name: /^On the table/ });
    expect(exported.markdown).toContain("# Betting table");
    expect(exported.markdown).toContain("## Cycle 4 (2026-10-05 to 2026-11-15, 6 weeks)");
    expect(exported.markdown).toContain("- Pitch pcanvas_a (Bet)");
    expect(exported.markdown).toContain("## On the table");
    expect(exported.markdown).toContain("- Pitch pcanvas_d (On the table, appetite 2 weeks)");
    expect(exported.markdown).toContain("Format: Shape Up pitch");
  });
});

describe("the example", () => {
  it("never sends and never logs, and its out-of-time pitch shows the circuit breaker", async () => {
    seed(...buildExample());
    useProductCanvasPrefs.setState({ lastFormat: "business-case" });
    renderPage();
    await screen.findByRole("radio", { name: "Go" });
    expect(screen.getByRole("button", { name: /^Send to… Business case/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Go" }));
    expect(actions()).toEqual([]);
    expect(cheerSpy).not.toHaveBeenCalled();
    cleanup();
    useProductCanvasPrefs.setState({ lastFormat: "shape-up" });
    renderPage();
    expect(
      (await screen.findAllByRole("button", { name: "Ship what’s done" })).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/This is the example’s table\./)).toBeInTheDocument();
  });

  it("keeps its ideas in the inbox, with one merged into another", async () => {
    seed(...buildExample());
    useProductCanvasPrefs.setState({ lastFormat: "idea", inboxFilter: "all" });
    renderPage();
    const list = await screen.findByRole("list", { name: "Ideas" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);
    expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Tips on the payment screen");
    expect(within(list).getByRole("button", { name: /Pay with two cards/ })).toHaveTextContent(
      /Merged/
    );
  });
});
