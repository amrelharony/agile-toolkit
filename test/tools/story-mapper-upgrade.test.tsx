import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StoryMap, StoryMapCard } from "@/lib/stores/workspace-types";

/**
 * Story Mapper, Phase 2 of the tool upgrade: cards, steps and slices are
 * added by typing a name and pressing Enter; cards are edited in place with
 * a points picker (custom estimates kept); each slice shows its points; a
 * slice goes to the backlog as stories with one Undo, or to Release
 * Planner; a one-sentence verdict and a Markdown export with points.
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

import { StoryMapperClient } from "@/app/(tools)/story-mapper/story-mapper-client";
import { buildExampleSlices, buildExampleSteps } from "@/app/(tools)/story-mapper/example";
import { toMarkdown } from "@/app/(tools)/story-mapper/markdown";
import {
  POINT_STEPS,
  estimateKind,
  estimatePoints,
  sliceSummary,
  sliceTotals,
  storyMapVerdict,
} from "@/app/(tools)/story-mapper/estimate";
import { cardDraftFrom, validateCard } from "@/app/(tools)/story-mapper/card-editor";
import { cardColor } from "@/app/(tools)/story-mapper/card-colors";
import { validateName } from "@/app/(tools)/story-mapper/inline-add";

const SM_ID = "story-mapper:current";
const NOW = new Date(2026, 9, 23);
const card = (id: string, title: string, extra: Partial<StoryMapCard> = {}): StoryMapCard => ({
  id,
  title,
  description: "",
  color: "#00f0ff",
  ...extra,
});

const ws = () => useWorkspaceStore.getState();
const map = () => ws().storyMaps?.find((m) => m.id === SM_ID);
const setMap = (m: Omit<StoryMap, "id">) =>
  useWorkspaceStore.setState({ storyMaps: [{ id: SM_ID, ...m }] });
const cardById = (id: string) =>
  map()
    ?.slices.flatMap((sl) => Object.values(sl.cards).flat())
    .find((c) => c.id === id);
const titlesIn = (sliceIdx: number, stepId: string) =>
  map()?.slices[sliceIdx].cards[stepId].map((c) => c.title);
/** The Undo of the last toast. */
const undoLast = () => act(() => toastSpy.mock.calls.at(-1)![1].action.onClick());

const twoByTwo = () =>
  setMap({
    steps: [
      { id: "s1", name: "Discover" },
      { id: "s2", name: "Use" },
    ],
    slices: [
      {
        id: "a",
        name: "Release 1",
        cards: {
          s1: [card("c1", "Browse", { estimate: "3" })],
          s2: [card("c2", "Buy", { estimate: "5" }), card("c3", "Refund")],
        },
      },
      { id: "b", name: "Release 2", cards: { s1: [], s2: [card("c4", "Wishlist")] } },
    ],
  });

beforeEach(() => {
  toastSpy.mockReset();
  useWorkspaceStore.setState({ storyMaps: [], stories: [], pokerEstimationLogs: [] });
});

describe("Story Mapper inline add", () => {
  beforeEach(twoByTwo);

  it("adds a card by typing its title and pressing Enter, and keeps the field open", async () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add card to Discover, Release 2" }));
    const field = screen.getByRole("textbox", { name: "New story in Discover, Release 2" });
    await waitFor(() => expect(field).toHaveFocus());

    // Enter on a blank title saves nothing and says why.
    fireEvent.submit(field.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Type a story title first.");
    expect(titlesIn(1, "s1")).toEqual([]);

    fireEvent.change(field, { target: { value: "  Search by keyword " } });
    fireEvent.submit(field.closest("form")!);
    expect(titlesIn(1, "s1")).toEqual(["Search by keyword"]);
    expect(cardById(map()!.slices[1].cards.s1[0].id)).toMatchObject({
      description: "",
      color: "#00f0ff",
    });
    // Still open and empty for the next one; no "New Story" placeholder anywhere.
    expect(field).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(JSON.stringify(map())).not.toContain("New Story");
  });

  it("closes with Escape and returns focus to the button", async () => {
    render(<StoryMapperClient />);
    const trigger = screen.getByRole("button", { name: "Add card to Use, Release 1" });
    fireEvent.click(trigger);
    const field = screen.getByRole("textbox", { name: "New story in Use, Release 1" });
    fireEvent.change(field, { target: { value: "Half typed" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New story in Use, Release 1" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add card to Use, Release 1" })).toHaveFocus()
    );
    expect(titlesIn(0, "s2")).toEqual(["Buy", "Refund"]);
  });

  it("adds a typed name on Done before closing; a blank Done just closes", async () => {
    render(<StoryMapperClient />);
    const trigger = () => screen.getByRole("button", { name: "Add card to Discover, Release 2" });
    const fieldName = "New story in Discover, Release 2";
    fireEvent.click(trigger());
    fireEvent.change(screen.getByRole("textbox", { name: fieldName }), {
      target: { value: "Search by keyword" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(titlesIn(1, "s1")).toEqual(["Search by keyword"]);
    expect(screen.queryByRole("textbox", { name: fieldName })).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(titlesIn(1, "s1")).toEqual(["Search by keyword"]);
    expect(screen.queryByRole("textbox", { name: fieldName })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a pasted name is too long instead of cutting it short", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    const step = screen.getByRole("textbox", { name: "New step name" });
    expect(step).not.toHaveAttribute("maxlength");
    fireEvent.change(step, { target: { value: "x".repeat(81) } });
    // Done can't add it, so it stays open and says why.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Keep it to 80 characters or fewer.");
    expect(step).toHaveValue("x".repeat(81));
    expect(map()?.steps).toHaveLength(2);
  });

  it("adds steps and slices with the typed name, never a placeholder", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add step" }));
    const step = screen.getByRole("textbox", { name: "New step name" });
    fireEvent.submit(step.closest("form")!);
    expect(map()?.steps).toHaveLength(2);
    fireEvent.change(step, { target: { value: "Pay" } });
    fireEvent.submit(step.closest("form")!);
    expect(map()?.steps.map((s) => s.name)).toEqual(["Discover", "Use", "Pay"]);
    // Every slice gets an empty cell for the new step.
    const payId = map()!.steps[2].id;
    expect(map()?.slices.map((sl) => sl.cards[payId])).toEqual([[], []]);

    fireEvent.click(screen.getByRole("button", { name: "Add slice" }));
    const slice = screen.getByRole("textbox", { name: "New slice name" });
    fireEvent.change(slice, { target: { value: "Later" } });
    fireEvent.submit(slice.closest("form")!);
    expect(map()?.slices.map((s) => s.name)).toEqual(["Release 1", "Release 2", "Later"]);
    expect(Object.keys(map()!.slices[2].cards).sort()).toEqual(["s1", "s2", payId].sort());
  });

  it("caps and requires names", () => {
    const opts = { required: "Type a name.", max: 5 };
    expect(validateName({ name: "   " }, opts)).toEqual({
      ok: false,
      errors: { name: "Type a name." },
    });
    expect(validateName({ name: "toolong" }, opts)).toMatchObject({ ok: false });
    expect(validateName({ name: " ok " }, opts)).toEqual({ ok: true, values: { name: "ok" } });
  });
});

describe("Story Mapper card editor and estimates", () => {
  beforeEach(twoByTwo);

  const editor = () => screen.getByRole("button", { name: "Save" }).closest("form")!;

  it("edits in place: points from the Fibonacci deck, Enter saves", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Refund" }));
    const title = within(editor()).getByRole("textbox", { name: /Title/ });
    expect(title).toHaveFocus();
    const points = within(editor()).getByRole("radiogroup", { name: "Points" });
    expect(
      within(points)
        .getAllByRole("radio")
        .map((r) => r.textContent)
    ).toEqual(["1", "2", "3", "5", "8", "13", "21"]);
    // The options wrap at their own width: no fixed grid tracks to overflow in a narrow cell.
    expect(points.className).not.toMatch(/grid/);

    fireEvent.click(within(editor()).getByRole("radio", { name: "8" }));
    fireEvent.click(within(editor()).getByRole("radio", { name: "Purple" }));
    fireEvent.change(title, { target: { value: "Refund an order" } });
    fireEvent.submit(editor());

    expect(cardById("c3")).toMatchObject({
      title: "Refund an order",
      estimate: "8",
      color: "#a78bfa",
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("refuses a blank title and cancels with Escape", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Buy" }));
    const title = within(editor()).getByRole("textbox", { name: /Title/ });
    fireEvent.change(title, { target: { value: " " } });
    fireEvent.submit(editor());
    expect(within(editor()).getByRole("alert")).toHaveTextContent("Enter a story title.");
    expect(cardById("c2")?.title).toBe("Buy");

    fireEvent.keyDown(title, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(cardById("c2")).toMatchObject({ title: "Buy", estimate: "5" });
  });

  it("clears points back to unestimated", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Buy" }));
    fireEvent.click(within(editor()).getByRole("button", { name: "Clear Points" }));
    fireEvent.submit(editor());
    expect(cardById("c2")).not.toHaveProperty("estimate");
  });

  it("keeps a custom estimate from Planning Poker unless points are picked", () => {
    setMap({
      steps: [{ id: "s1", name: "Use" }],
      slices: [
        {
          id: "a",
          name: "MVP",
          cards: { s1: [card("x", "Export", { estimate: "XL" }), card("y", "Import")] },
        },
      ],
    });
    render(<StoryMapperClient />);
    expect(screen.getByTitle(/Custom estimate/)).toHaveTextContent("Estimate: XLcustom");

    fireEvent.click(screen.getByRole("button", { name: "Edit Export" }));
    expect(within(editor()).getByText(/is kept \(custom, not in points\)/)).toBeInTheDocument();
    fireEvent.submit(editor());
    expect(cardById("x")?.estimate).toBe("XL");

    fireEvent.click(screen.getByRole("button", { name: "Edit Export" }));
    fireEvent.click(within(editor()).getByRole("radio", { name: "3" }));
    fireEvent.submit(editor());
    expect(cardById("x")?.estimate).toBe("3");
  });

  it("drops a custom estimate on Clear", () => {
    setMap({
      steps: [{ id: "s1", name: "Use" }],
      slices: [{ id: "a", name: "MVP", cards: { s1: [card("x", "Export", { estimate: "?" })] } }],
    });
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Export" }));
    fireEvent.click(within(editor()).getByRole("button", { name: "Clear the custom estimate ?" }));
    fireEvent.submit(editor());
    expect(cardById("x")).not.toHaveProperty("estimate");
  });

  it("keeps an off-scale number as a custom option, as stored", () => {
    setMap({
      steps: [{ id: "s1", name: "Use" }],
      slices: [{ id: "a", name: "MVP", cards: { s1: [card("x", "Export", { estimate: "4.0" })] } }],
    });
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Export" }));
    expect(within(editor()).getByRole("radio", { name: "Custom: 4" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    fireEvent.submit(editor());
    // Untouched, it isn't rewritten as "4".
    expect(cardById("x")?.estimate).toBe("4.0");
  });

  it("shows each slice's points and what's unsized", () => {
    render(<StoryMapperClient />);
    expect(screen.getByText("8 pts · 1 unestimated")).toBeInTheDocument();
    expect(screen.getByText("0 pts · 1 unestimated")).toBeInTheDocument();
  });
});

describe("Story Mapper: send a slice to the backlog", () => {
  beforeEach(twoByTwo);

  const stories = () => ws().stories;

  it("creates a story per card with its points, and one Undo takes them all back", async () => {
    render(<StoryMapperClient />);
    const send = screen.getByRole("button", { name: "Send 3 to backlog from Release 1" });
    // It wraps in the narrow slice column instead of running past its border.
    expect(send.className).toMatch(/whitespace-normal/);
    expect(send.className).not.toMatch(/whitespace-nowrap/);
    fireEvent.click(send);

    expect(stories().map((s) => ({ title: s.title, points: s.points, status: s.status }))).toEqual([
      { title: "Browse", points: 3, status: "backlog" },
      { title: "Buy", points: 5, status: "backlog" },
      { title: "Refund", points: undefined, status: "backlog" },
    ]);
    expect(stories()[0].sourceRef).toEqual({ tool: "story-mapper", id: "c1", doc: SM_ID });
    expect(cardById("c1")?.sentTo).toEqual([
      { route: "backlog-story", targetId: stories()[0].id, at: expect.any(String) },
    ]);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Added 3 stories to the backlog");
    expect(toastSpy.mock.calls[0][1].description).toBe("From “Release 1”");

    // Sent: the button gives way to a link, and the cards say so.
    expect(screen.queryByRole("button", { name: /from Release 1/ })).toBeNull();
    expect(screen.getByRole("link", { name: "All in backlog: Release 1" })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );
    expect(screen.getAllByText("In backlog")).toHaveLength(3);
    // Focus follows to that link rather than dropping to <body>.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "All in backlog: Release 1" })).toHaveFocus()
    );

    undoLast();
    expect(stories()).toEqual([]);
    expect(cardById("c1")?.sentTo).toEqual([]);
    expect(screen.getByRole("button", { name: "Send 3 to backlog from Release 1" })).toBeTruthy();
  });

  it("skips cards already in the backlog and re-sends one whose story was deleted", () => {
    render(<StoryMapperClient />);
    // "Browse" goes on its own from the card menu, named for both jobs.
    const menu = screen.getByRole("button", { name: "Send or move Browse" });
    expect(menu).toHaveAttribute("title", "Send or move");
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to the backlog" }));
    expect(stories()).toHaveLength(1);
    expect(stories()[0]).toMatchObject({ title: "Browse", points: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Send 2 to backlog from Release 1" }));
    expect(stories().map((s) => s.title)).toEqual(["Browse", "Buy", "Refund"]);

    // A story deleted from the backlog frees its card to be sent again.
    act(() => ws().removeStory(stories().find((s) => s.title === "Buy")!.id));
    const deadLink = cardById("c2")!.sentTo![0];
    fireEvent.click(screen.getByRole("button", { name: "Send 1 to backlog from Release 1" }));
    const resent = stories().find((s) => s.title === "Buy")!;
    expect(cardById("c2")?.sentTo).toEqual([expect.objectContaining({ targetId: resent.id })]);
    // Undo puts the old (dead) link back, as a single send would.
    undoLast();
    expect(cardById("c2")?.sentTo).toEqual([deadLink]);
  });

  it("never sends example cards", () => {
    const steps = buildExampleSteps();
    setMap({
      steps,
      slices: buildExampleSlices(steps).map((sl, i) =>
        i === 0
          ? {
              ...sl,
              cards: {
                ...sl.cards,
                [steps[0].id]: [...sl.cards[steps[0].id], card("mine", "Landing page")],
              },
            }
          : sl
      ),
    });
    render(<StoryMapperClient />);
    // The MVP slice holds only example cards: nothing to send.
    expect(screen.queryByRole("button", { name: /to backlog from MVP/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Send 1 to backlog from Walking Skeleton" })
    );
    expect(stories().map((s) => s.title)).toEqual(["Landing page"]);

    // An example card's menu offers Planning Poker only.
    fireEvent.keyDown(screen.getByRole("button", { name: "Send or move Search by keyword" }), {
      key: "Enter",
    });
    expect(screen.getByRole("menuitem", { name: "Estimate in Planning Poker" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Add to the backlog" })).toBeNull();
  });

  it("links each slice with stories to Release Planner by its id", () => {
    render(<StoryMapperClient />);
    expect(screen.getByRole("link", { name: "Plan this release: Release 1" })).toHaveAttribute(
      "href",
      "/release-planner?slice=a"
    );
    expect(screen.getByRole("link", { name: "Plan this release: Release 2" })).toHaveAttribute(
      "href",
      "/release-planner?slice=b"
    );
  });
});

describe("Story Mapper focus after a delete", () => {
  beforeEach(twoByTwo);

  it("hands focus to the next card, else the previous one, else the cell's Add card", async () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Refund" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Buy" })).toHaveFocus());
    undoLast();
    expect(titlesIn(0, "s2")).toEqual(["Buy", "Refund"]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Buy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit Refund" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Delete Refund" }));
    expect(titlesIn(0, "s2")).toEqual([]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add card to Use, Release 1" })).toHaveFocus()
    );
  });

  it("focuses a neighbouring header after a step or slice is removed", async () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove step Discover" }));
    expect(map()?.steps.map((s) => s.name)).toEqual(["Use"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Use" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Remove slice Release 2" }));
    expect(map()?.slices.map((s) => s.name)).toEqual(["Release 1"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Release 1" })).toHaveFocus());
  });
});

describe("Story Mapper board and first run", () => {
  it("scrolls the board in its own snapping container, with tokens instead of hex", () => {
    twoByTwo();
    const { container } = render(<StoryMapperClient />);
    const board = screen.getByRole("region", { name: "Story map" });
    expect(board.className).toMatch(/overflow-auto/);
    expect(board.className).toMatch(/snap-x/);
    // Focused cards scroll clear of the sticky step headers, not under them.
    expect(board.className).toMatch(/scroll-pt-12/);
    // Colour is a class now; inline styles only position cards for dragging.
    expect(container.querySelector('[style*="background"]')).toBeNull();
    expect(container.querySelector('[style*="border-color"]')).toBeNull();
  });

  it("opens on the example with a verdict, and shows an empty state once cleared", () => {
    render(<StoryMapperClient />);
    expect(
      screen.getByText(
        "“Walking Skeleton” ships first: 3 stories, 8 points, one for every step. 2 of 7 stories still need an estimate."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(screen.getByText(/No stories yet\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });
});

describe("Story Mapper logic", () => {
  it("reads only numbers of zero or more as points", () => {
    expect(estimatePoints(undefined)).toBeUndefined();
    expect(estimatePoints("")).toBeUndefined();
    expect(estimatePoints("  ")).toBeUndefined();
    expect(estimatePoints("XL")).toBeUndefined();
    expect(estimatePoints("-1")).toBeUndefined();
    expect(estimatePoints("0")).toBe(0);
    expect(estimatePoints(" 5 ")).toBe(5);
    expect(estimatePoints("0.5")).toBe(0.5);
    expect(estimateKind("?")).toBe("custom");
    expect(estimateKind("13")).toBe("points");
    expect(estimateKind(undefined)).toBe("none");
    expect(POINT_STEPS.map((s) => s.value)).toEqual([1, 2, 3, 5, 8, 13, 21]);
  });

  it("reads points as Release Planner sums a slice: plain decimals only", () => {
    // Number() took these; Release Planner doesn't, so neither does the board.
    for (const s of ["0x10", "0b11", "1e3", ".5", "Infinity", "1,000.5", "5 apples"]) {
      expect(estimatePoints(s)).toBeUndefined();
    }
    expect(estimateKind("0x10")).toBe("custom");
    // Values Planning Poker's decks and agents write back.
    expect(estimatePoints("0,5")).toBe(0.5);
    expect(estimatePoints("½")).toBe(0.5);
    expect(estimatePoints("8 pts")).toBe(8);
    expect(estimatePoints("3 points")).toBe(3);
    expect(estimatePoints("13SP")).toBe(13);
    expect(estimatePoints("9".repeat(400))).toBeUndefined();
  });

  it("totals a slice under today's steps only, huge and custom values included", () => {
    const steps = [{ id: "s1", name: "A" }];
    const slice = {
      id: "a",
      name: "R1",
      cards: {
        s1: [
          card("1", "a", { estimate: "1000000" }),
          card("2", "b", { estimate: "XL" }),
          card("3", "c"),
          card("4", "d", { estimate: "0" }),
        ],
        // A key for a removed step isn't on the board.
        gone: [card("5", "e", { estimate: "8" })],
      },
    };
    const t = sliceTotals(slice, steps);
    expect(t).toEqual({ cards: 4, points: 1000000, estimated: 2, unestimated: 1, custom: 1 });
    expect(sliceSummary(t)).toBe("1000000 pts · 1 unestimated · 1 custom");
    expect(sliceSummary(sliceTotals({ id: "b", name: "R2", cards: {} }, steps))).toBe("No stories");
  });

  it("says what ships first, what it misses, and what's unsized", () => {
    const steps = [
      { id: "s1", name: "Find" },
      { id: "s2", name: "Pay" },
    ];
    expect(storyMapVerdict({ steps, slices: [] })).toBe("No stories on the map yet.");
    expect(
      storyMapVerdict({
        steps,
        slices: [
          {
            id: "a",
            name: "R1",
            cards: {
              s1: [card("1", "x", { estimate: "3" })],
              s2: [card("2", "y", { estimate: "2" })],
            },
          },
        ],
      })
    ).toBe("“R1” ships first: 2 stories, 5 points, one for every step.");
    // Several under a step still cover it, but aren't "one for every step".
    expect(
      storyMapVerdict({
        steps,
        slices: [
          {
            id: "a",
            name: "R1",
            cards: {
              s1: [
                card("1", "x", { estimate: "3" }),
                card("2", "y", { estimate: "5" }),
                card("3", "z", { estimate: "1" }),
              ],
              s2: [card("4", "w", { estimate: "1" })],
            },
          },
        ],
      })
    ).toBe("“R1” ships first: 4 stories, 10 points, covering every step.");
    expect(
      storyMapVerdict({
        steps,
        slices: [
          {
            id: "a",
            name: "R1",
            cards: { s1: [card("1", "x", { estimate: "3" }), card("2", "z")] },
          },
        ],
      })
    ).toBe(
      "“R1” ships first: 2 stories, 3 points so far, but nothing for “Pay” yet. 1 of 2 stories still needs an estimate."
    );
    expect(
      storyMapVerdict({
        steps,
        slices: [
          { id: "a", name: "R1", cards: {} },
          { id: "b", name: "R2", cards: { s1: [card("1", "x")] } },
        ],
      })
    ).toBe(
      "“R1” ships first but has no stories yet: give it one thin story per step. 1 of 1 story still needs an estimate."
    );
  });

  it("validates a card draft and keeps the stored estimate's spelling", () => {
    const draft = cardDraftFrom(card("1", "Pay", { estimate: "5.0" }));
    expect(validateCard(draft)).toMatchObject({ ok: true, values: { estimate: "5.0" } });
    expect(validateCard({ ...draft, points: 8 })).toMatchObject({ values: { estimate: "8" } });
    expect(validateCard({ ...draft, title: "" })).toEqual({
      ok: false,
      errors: { title: "Enter a story title." },
    });
    expect(validateCard({ ...draft, points: -3 })).toMatchObject({
      ok: false,
      errors: { points: "Points can't be negative." },
    });
    expect(validateCard({ ...draft, title: "x".repeat(201) })).toMatchObject({ ok: false });
  });

  it("draws stored hex colours with theme tokens, neutral for unknown ones", () => {
    expect(cardColor("#00F0FF").dot).toBe("bg-accent");
    expect(cardColor("#123456")).toMatchObject({ dot: "bg-sub", label: "Other" });
    expect(cardColor(undefined).dot).toBe("bg-sub");
  });

  it("exports points per slice, estimates per story and the verdict", () => {
    const steps = buildExampleSteps();
    const md = toMarkdown({ steps, slices: buildExampleSlices(steps) }, NOW);
    expect(md).toContain("3 steps · 2 slices · 7 stories · 14 points");
    expect(md).toContain("| Slice | Discover | Learn | Use | Points |");
    expect(md).toContain("|---|---|---|---|---:|");
    expect(md).toContain(
      "| **Walking Skeleton** | Browse product catalog | Read product details | Buy a single item | 8 |"
    );
    expect(md).toContain("Pay with a saved card | 6 (2 unestimated) |");
    expect(md).toContain("## 1. Walking Skeleton (3 stories) · 8 points");
    expect(md).toContain("## 2. MVP (4 stories) · 6 points, 2 unestimated");
    expect(md).toContain(
      "- **Discover:** Browse product catalog (2 points) — Users can view available products in a list."
    );
    expect(md).toContain(
      "**“Walking Skeleton” ships first: 3 stories, 8 points, one for every step. 2 of 7 stories still need an estimate.**"
    );

    const custom = toMarkdown(
      {
        steps: [{ id: "s1", name: "Use" }],
        slices: [{ id: "a", name: "R1", cards: { s1: [card("1", "Export", { estimate: "XL" })] } }],
      },
      NOW
    );
    expect(custom).toContain("- **Use:** Export (XL, custom)");
    // A custom estimate is counted as custom, as on the board, not as unestimated.
    expect(custom).toContain("| **R1** | Export | — (1 custom) |");

    const mixed = toMarkdown(
      {
        steps: [{ id: "s1", name: "Use" }],
        slices: [
          {
            id: "a",
            name: "R1",
            cards: {
              s1: [
                card("1", "A", { estimate: "3" }),
                card("2", "B", { estimate: "XL" }),
                card("3", "C"),
              ],
            },
          },
        ],
      },
      NOW
    );
    // Table, heading and verdict agree with the board's "3 pts · 1 unestimated · 1 custom".
    expect(mixed).toContain("| **R1** | A<br>B<br>C | 3 (1 unestimated, 1 custom) |");
    expect(mixed).toContain("## 1. R1 (3 stories) · 3 points, 1 unestimated, 1 custom");
    expect(mixed).toContain("1 of 3 stories still needs an estimate.");
  });
});
