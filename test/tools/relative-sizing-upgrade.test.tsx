import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";

/**
 * Relative Sizing on its tool store: the empty state and the example
 * (loaded, cleared, nothing saved from it), a board from the unsized
 * backlog (and from `?stories=unsized`) or pasted titles (past the cap
 * included), the Move to… menu with what it says, the move limit sending a
 * card to Talk about it, the anchor and the deal, the Estimation Guide's
 * reference cards, the count-entry round turning totals into placements,
 * Save sizes with one Undo, Planning Poker with one Undo (already queued
 * skipped), typed stories added to the backlog then sized, Amr's help
 * without AI, the export, deleting with Undo, and no non-error toasts.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
const lastUndo = () => undo.all[undo.all.length - 1];
const logs = vi.hoisted(() => [] as { action: string; payload?: Record<string, unknown> }[]);
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({
    log: (action: string, payload?: Record<string, unknown>) => logs.push({ action, payload }),
  }),
}));
const cheers = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: (...args: unknown[]) => cheers.push(args) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/relative-sizing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
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
const exported = vi.hoisted(() => ({ markdown: "" }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

import { RelativeSizingClient } from "@/app/(tools)/relative-sizing/relative-sizing-client";
import { useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";
import { RELATIVE_SIZING_ACTIONS } from "@/lib/history/event-actions";
import { currentPokerLog } from "@/lib/handoffs/targets/poker-queue";
import { queuedStoryIds } from "@/lib/estimation/queue-for-poker";
import { bucketsFor, newBoard } from "@/lib/relative-sizing/model";
import {
  RELATIVE_SIZING_INITIAL,
  type RelativeSizingState,
  type SizingBoard,
} from "@/lib/relative-sizing/state";
import {
  hydrateRelativeSizing,
  relativeSizingState,
  useRelativeSizing,
} from "@/lib/relative-sizing/store";

const NOW = "2026-11-23T10:00:00.000Z";
const ws = () => useWorkspaceStore.getState();
const state = () => relativeSizingState();
const theBoard = () => state().boards[0];
const item = (id: string) => theBoard().items.find((i) => i.id === id)!;
const actions = () => logs.map((l) => l.action);
const storyById = (id: string) => ws().stories.find((s) => s.id === id);

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "backlog",
  ...over,
});
const board = (over: Partial<SizingBoard> = {}): SizingBoard => ({
  ...newBoard(
    {
      title: "Checkout",
      bucketSet: "fibonacci",
      buckets: bucketsFor("fibonacci"),
      items: [
        { title: "Story a", storyId: "a" },
        { title: "Story b", storyId: "b" },
        { title: "Typed one" },
      ],
    },
    "sizing_a",
    NOW,
    (i) => `c${i + 1}`
  ),
  ...over,
});
const seedBoard = (b: SizingBoard = board()) =>
  useRelativeSizing.setState({
    ...RELATIVE_SIZING_INITIAL,
    boards: [b],
    activeBoardId: b.id,
  } as RelativeSizingState);

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <RelativeSizingClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
const moveTo = (cardTitle: string, lane: string) => {
  openMenu(`Move to…: ${cardTitle}`);
  fireEvent.click(screen.getByRole("menuitem", { name: lane }));
};
const announced = (text: string | RegExp) =>
  waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent(text));
const statusSays = (re: RegExp) =>
  expect(screen.getAllByRole("status").some((el) => re.test(el.textContent ?? ""))).toBe(true);

beforeEach(async () => {
  undo.all = [];
  logs.length = 0;
  cheers.length = 0;
  exported.markdown = "";
  toastSpy.mockClear();
  toastSpy.success.mockClear();
  toastSpy.info.mockClear();
  window.history.replaceState(null, "", "/relative-sizing");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_AI", "");
  vi.stubEnv("NEXT_PUBLIC_VISITOR_ROOMS", "");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  await hydrateRelativeSizing();
  useRelativeSizing.setState({ ...RELATIVE_SIZING_INITIAL });
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [], teamMembers: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  expect(toastSpy).not.toHaveBeenCalled();
  expect(toastSpy.success).not.toHaveBeenCalled();
  expect(toastSpy.info).not.toHaveBeenCalled();
});

describe("an empty page", () => {
  it("says what a board is for and loads the example, which saves nothing", async () => {
    renderPage();
    expect(await screen.findByText(/No boards yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    const b = theBoard();
    expect(b.items).toHaveLength(12);
    expect(b.items.filter((i) => i.bucketId && !i.contested)).toHaveLength(8);
    expect(b.items.filter((i) => !i.bucketId)).toHaveLength(3);
    expect(b.items.filter((i) => i.contested)).toHaveLength(1);
    expect(b.anchorItemId).toBeTruthy();
    expect(state().rounds).toHaveLength(1);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save sizes" })).toBeNull();
    expect(logs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(state().boards).toEqual([]);
    act(() => lastUndo().revert());
    expect(state().boards).toHaveLength(1);
  });

  it("starts a board from the backlog's unsized stories", async () => {
    useWorkspaceStore.setState({
      stories: [story("a"), story("b", { points: 5 }), story("c"), story("example-x")],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start the board" }));
    expect(theBoard().items.map((i) => i.storyId)).toEqual(["a", "c"]);
    expect(theBoard().title).toBe("Unsized backlog");
    expect(logs[0]).toMatchObject({
      action: RELATIVE_SIZING_ACTIONS.BOARD_CREATED,
      payload: { stories: 2, buckets: 7 },
    });
  });

  it("opens the unsized backlog form from ?stories=unsized", async () => {
    useWorkspaceStore.setState({ stories: [story("a")] });
    seedBoard();
    window.history.replaceState(null, "", "/relative-sizing?stories=unsized");
    renderPage();
    expect(await screen.findByRole("button", { name: "Start the board" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Unsized backlog stories (1)" })).toBeChecked();
    expect(window.location.search).toBe("");
  });

  it("starts a board from pasted titles, saying how many past 100 were left out", async () => {
    renderPage();
    await screen.findByText(/No boards yet/);
    fireEvent.click(screen.getByRole("radio", { name: "Paste titles" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Board name" }), {
      target: { value: "Big" },
    });
    const lines = Array.from({ length: 103 }, (_, i) => `- Story ${i + 1}`).join("\n");
    fireEvent.change(screen.getByRole("textbox", { name: /Story titles, one per line/ }), {
      target: { value: lines },
    });
    expect(screen.getByText(/3 more lines were left out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start the board" }));
    expect(theBoard().items).toHaveLength(100);
    expect(theBoard().items[0].title).toBe("Story 1");
    statusSays(/3 lines were left out/);
  });

  it("refuses buckets that aren't sizes", async () => {
    renderPage();
    await screen.findByText(/No boards yet/);
    fireEvent.click(screen.getByRole("radio", { name: "Paste titles" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Board name" }), {
      target: { value: "X" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Story titles/ }), {
      target: { value: "One" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Buckets" }), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Your buckets/ }), {
      target: { value: "S, ?, L" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start the board" }));
    expect(screen.getByText(/“\?” isn't a size/)).toBeInTheDocument();
    expect(state().boards).toEqual([]);
  });
});

describe("sorting", () => {
  it("moves a card with its Move to… menu and says where it went", async () => {
    seedBoard();
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    moveTo("Story a", "5");
    expect(item("c1").bucketId).toBe("b4");
    await announced("Moved “Story a” to 5.");
    expect(
      within(screen.getByRole("region", { name: "Bucket 5" })).getByText("Story a")
    ).toBeInTheDocument();
  });

  it("sends a card moved three times to Talk about it", async () => {
    seedBoard();
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    moveTo("Story a", "3");
    moveTo("Story a", "5");
    moveTo("Story a", "8");
    moveTo("Story a", "13");
    expect(item("c1")).toMatchObject({ moves: 3, contested: true });
    await announced("“Story a” moved 3 times: it goes to Talk about it.");
    expect(
      within(screen.getByRole("region", { name: "Talk about it" })).getByText("Story a")
    ).toBeInTheDocument();
  });

  it("places an anchor in the middle bucket and deals the rest to the team", async () => {
    seedBoard(board({ mode: "buckets" }));
    useWorkspaceStore.setState({
      teamMembers: [
        { id: "m1", name: "Ana" },
        { id: "m2", name: "Raj" },
      ],
    });
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    fireEvent.change(screen.getByRole("combobox", { name: "Anchor story" }), {
      target: { value: "c1" },
    });
    expect(theBoard()).toMatchObject({ anchorItemId: "c1" });
    expect(item("c1").bucketId).toBe("b4");
    expect(screen.getByRole("textbox", { name: "Deal the cards to" })).toHaveValue("Ana, Raj");
    fireEvent.click(screen.getByRole("button", { name: "Deal the cards" }));
    expect(item("c1").dealtTo).toBeUndefined();
    expect([item("c2").dealtTo, item("c3").dealtTo].sort()).toEqual(["Ana", "Raj"]);
    expect(logs.at(-1)).toMatchObject({
      action: RELATIVE_SIZING_ACTIONS.ROUND_STARTED,
      payload: { mode: "buckets" },
    });
  });

  it("shows the Estimation Guide's reference stories as dashed cards in their bucket", async () => {
    useWorkspaceStore.setState({
      stories: [story("done1", { title: "Search by name", status: "done", points: 5 })],
    });
    useEstimationGuideStore.setState({ referenceStoryIds: { "Fibonacci:5": ["done1"] } });
    seedBoard();
    renderPage();
    const refs = await screen.findByRole("list", { name: "Reference stories for 5" });
    expect(refs).toHaveTextContent("Reference: Search by name");
  });

  it("starts the timebox on the docked timer", async () => {
    seedBoard();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Start the 5-minute timebox" }));
    expect(logs.at(-1)).toMatchObject({
      action: RELATIVE_SIZING_ACTIONS.ROUND_STARTED,
      payload: { mode: "silent", stories: 3 },
    });
  });
});

describe("more of the board", () => {
  it("marks the card's own lane in its Move to… menu", async () => {
    seedBoard();
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    openMenu("Move to…: Story a");
    expect(screen.getByRole("menuitem", { name: "Not placed (here now)" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("settles a card placed from Talk about it: its moves start again", async () => {
    seedBoard({
      ...board(),
      items: board().items.map((i) =>
        i.id === "c1" ? { ...i, bucketId: "b3", moves: 3, contested: true } : i
      ),
    });
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    moveTo("Story a", "5");
    expect(item("c1")).toMatchObject({ bucketId: "b4", moves: 0 });
    expect(item("c1").contested).toBeUndefined();
  });

  it("skips T-shirt buckets with no points when saving, and says why", async () => {
    useWorkspaceStore.setState({ stories: [story("a"), story("b")] });
    seedBoard(board({ bucketSet: "tshirt", buckets: bucketsFor("tshirt") }));
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    moveTo("Story a", "M");
    fireEvent.click(screen.getByRole("button", { name: "Save sizes" }));
    statusSays(/its bucket has no points/);
    expect(storyById("a")?.points).toBeUndefined();
  });

  it("maps T-shirt sizes to points on the board, then saves them", async () => {
    useWorkspaceStore.setState({ stories: [story("a"), story("b")] });
    seedBoard(board({ bucketSet: "tshirt", buckets: bucketsFor("tshirt") }));
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    // No bucket has points yet, so the mapping is open.
    const map = screen.getByRole("button", { name: /^Map sizes to points/ });
    expect(map).toHaveAttribute("aria-expanded", "true");
    expect(
      within(screen.getByRole("region", { name: "Bucket M" })).getByText(/No points yet/)
    ).toBeInTheDocument();
    const m = screen.getByRole("spinbutton", { name: "Points for M" });
    fireEvent.change(m, { target: { value: "5" } });
    fireEvent.blur(m);
    expect(theBoard().buckets.find((b) => b.label === "M")?.points).toBe(5);
    await announced("M is 5 points now.");
    expect(
      within(screen.getByRole("region", { name: "Bucket M" })).getByText(/5 points/)
    ).toBeInTheDocument();
    // Points past 1,000 are refused, and nothing changes.
    const xl = screen.getByRole("spinbutton", { name: "Points for XL" });
    fireEvent.change(xl, { target: { value: "5000" } });
    fireEvent.keyDown(xl, { key: "Enter" });
    expect(screen.getByText("Points go from 0 to 1000.")).toBeInTheDocument();
    expect(theBoard().buckets.find((b) => b.label === "XL")?.points).toBeUndefined();
    moveTo("Story a", "M");
    fireEvent.click(screen.getByRole("button", { name: "Save sizes" }));
    expect(storyById("a")?.points).toBe(5);
    statusSays(/Saved sizes for 1 story\./);
    // An emptied field clears the bucket's points again.
    fireEvent.change(m, { target: { value: "" } });
    fireEvent.blur(m);
    expect(theBoard().buckets.find((b) => b.label === "M")?.points).toBeUndefined();
  });

  it("opens a board from ?board=", async () => {
    useRelativeSizing.setState({
      ...RELATIVE_SIZING_INITIAL,
      boards: [board(), board({ id: "sizing_b", title: "Payments" })],
      activeBoardId: "sizing_a",
    } as RelativeSizingState);
    window.history.replaceState(null, "", "/relative-sizing?board=sizing_b");
    renderPage();
    expect(await screen.findByRole("heading", { name: "Payments" })).toBeInTheDocument();
    expect(state().activeBoardId).toBe("sizing_b");
  });

  it("opens a new board form beside a board, and Cancel puts it away", async () => {
    seedBoard();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "New board" }));
    expect(screen.getByRole("button", { name: "Start the board" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Start the board" })).toBeNull();
  });

  it("asks the room only about cards not placed or to talk about", async () => {
    seedBoard({ ...board(), items: board().items.map((i) => ({ ...i, bucketId: "b2" })) });
    renderPage();
    expect(await screen.findByText(/Every story is placed/)).toBeInTheDocument();
  });
});

describe("a round counted by hand", () => {
  it("turns the totals into placements, sends a spread story to talk, and Undo takes it back", async () => {
    seedBoard();
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    const fill = (title: string, counts: Record<string, string>) => {
      const set = screen.getByRole("group", { name: new RegExp(title) });
      for (const [label, n] of Object.entries(counts)) {
        fireEvent.change(within(set).getByRole("spinbutton", { name: label }), {
          target: { value: n },
        });
      }
    };
    fill("Story a", { "8": "4" });
    fill("Story b", { "1": "2", "13": "2" });
    fireEvent.click(screen.getByRole("button", { name: "Show totals" }));
    expect(
      await screen.findByRole("list", { name: "Where the room placed each story" })
    ).toHaveTextContent("Full consensus: it goes in 8.");
    fireEvent.click(screen.getByRole("button", { name: "Save round" }));
    expect(item("c1")).toMatchObject({ bucketId: "b5", room: { level: "agree" } });
    expect(item("c2")).toMatchObject({ contested: true, room: { counts: [2, 0, 0, 0, 0, 2, 0] } });
    expect(state().rounds).toHaveLength(1);
    expect(logs.at(-1)).toMatchObject({
      action: RELATIVE_SIZING_ACTIONS.ROUND_SAVED,
      payload: { placed: 1, outliers: 1 },
    });
    act(() => lastUndo().revert());
    expect(item("c1").bucketId).toBeNull();
    expect(state().rounds).toHaveLength(0);
  });
});

describe("saving and sending", () => {
  it("saves sizes to the backlog stories with one Undo", async () => {
    useWorkspaceStore.setState({
      stories: [story("a"), story("b", { points: 2, refinedAt: "2026-11-01T00:00:00.000Z" })],
    });
    seedBoard();
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    moveTo("Story a", "5");
    moveTo("Story b", "8");
    fireEvent.click(screen.getByRole("button", { name: "Save sizes" }));
    expect(storyById("a")?.points).toBe(5);
    expect(storyById("b")?.points).toBe(8);
    statusSays(/Saved sizes for 2 stories\. 1 skipped: 1 not in the backlog yet\./);
    expect(theBoard().appliedAt).toBeTruthy();
    expect(actions()).toContain(RELATIVE_SIZING_ACTIONS.SIZES_APPLIED);
    expect(cheers).toEqual([["relative-sizing", "done"]]);
    act(() => lastUndo().revert());
    expect(storyById("a")?.points).toBeUndefined();
    expect(storyById("b")).toMatchObject({ points: 2, refinedAt: "2026-11-01T00:00:00.000Z" });
    expect(theBoard().appliedAt).toBeUndefined();
  });

  it("says when there is nothing to save", async () => {
    useWorkspaceStore.setState({ stories: [story("a"), story("b")] });
    seedBoard();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Save sizes" }));
    statusSays(/^No sizes to save\. 3 skipped/);
    expect(undo.all).toEqual([]);
  });

  it("sends the stories to talk about to Planning Poker with one Undo, skipping queued ones", async () => {
    useWorkspaceStore.setState({ stories: [story("a"), story("b")] });
    seedBoard({
      ...board(),
      items: board().items.map((i) => (i.storyId ? { ...i, contested: true, moves: 3 } : i)),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /to Planning Poker$/ }));
    expect(Array.from(queuedStoryIds(currentPokerLog())).sort()).toEqual(["a", "b"]);
    expect(logs.at(-1)).toMatchObject({
      action: RELATIVE_SIZING_ACTIONS.SENT_TO_POKER,
      payload: { count: 2 },
    });
    fireEvent.click(screen.getByRole("button", { name: /to Planning Poker$/ }));
    statusSays(/already in the Planning Poker queue/);
    act(() => undo.all[0].revert());
    expect(queuedStoryIds(currentPokerLog()).size).toBe(0);
  });

  it("adds typed stories to the backlog, then saves their sizes", async () => {
    useWorkspaceStore.setState({ stories: [story("a"), story("b")] });
    seedBoard();
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    moveTo("Typed one", "3");
    fireEvent.click(screen.getByRole("button", { name: "Add 1 typed story to the backlog" }));
    const linked = item("c3").storyId!;
    expect(storyById(linked)).toMatchObject({
      title: "Typed one",
      points: 3,
      sourceRef: { tool: "relative-sizing", id: "c3", doc: "sizing_a" },
    });
    moveTo("Typed one", "5");
    fireEvent.click(screen.getByRole("button", { name: "Save sizes" }));
    expect(storyById(linked)?.points).toBe(5);
    // Undo of the add unlinks the card.
    act(() => undo.all[0].revert());
    expect(item("c3").storyId).toBeUndefined();
  });
});

describe("talking about a story, the export and deleting", () => {
  it("offers questions and smaller stories without AI; an accepted split is a new card with Undo", async () => {
    seedBoard({
      ...board(),
      items: board().items.map((i) =>
        i.id === "c1"
          ? {
              ...i,
              contested: true,
              moves: 3,
              room: { counts: [0, 0, 2, 0, 3, 1, 0], responses: 6, level: "spread" as const },
            }
          : i
      ),
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Questions to ask" }));
    expect(screen.getByText("What would make it a 3?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Split it without AI" }));
    const add = screen.getAllByRole("button", { name: /^Add: / })[0];
    fireEvent.click(add);
    expect(theBoard().items).toHaveLength(4);
    expect(theBoard().items[3].bucketId).toBeNull();
    act(() => lastUndo().revert());
    expect(theBoard().items).toHaveLength(3);
  });

  it("says a full board has no room for a split, with no Undo claiming an add", async () => {
    const full = board();
    const extra = Array.from({ length: 97 }, (_, i) => ({
      id: `x${i}`,
      title: `Extra ${i}`,
      bucketId: "b2",
      moves: 0,
    }));
    seedBoard({
      ...full,
      items: [
        ...full.items.map((i) => (i.id === "c1" ? { ...i, contested: true, moves: 3 } : i)),
        ...extra,
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Split it without AI" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Add: / })[0]);
    expect(theBoard().items).toHaveLength(100);
    expect(undo.all).toEqual([]);
    statusSays(/A board holds 100 stories at most/);
  });

  it("exports the board as Markdown", async () => {
    seedBoard({
      ...board(),
      items: board().items.map((i) =>
        i.id === "c1"
          ? { ...i, bucketId: "b4" }
          : i.id === "c2"
            ? {
                ...i,
                contested: true,
                moves: 4,
                room: { counts: [0, 0, 2, 0, 3, 1, 0], responses: 6, level: "spread" as const },
              }
            : i
      ),
    });
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    expect(exported.markdown).toContain("# Relative sizing: Checkout");
    expect(exported.markdown).toContain("## 5 (5 points)\n\n- Story a");
    expect(exported.markdown).toContain("- Story b (moved 4 times; the room: 3 ×2, 8 ×3, 13 ×1)");
    expect(exported.markdown).toContain("## Not placed\n\n- Typed one");
  });

  it("deletes a board with Undo", async () => {
    seedBoard();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete the board “Checkout”" }));
    expect(state().boards).toEqual([]);
    expect(actions()).toEqual([RELATIVE_SIZING_ACTIONS.BOARD_REMOVED]);
    act(() => lastUndo().revert());
    expect(state().boards).toHaveLength(1);
  });
});
