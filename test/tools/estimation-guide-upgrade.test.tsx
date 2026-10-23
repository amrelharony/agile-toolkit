import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";

/**
 * Estimation Guide's upgrade (tool UX contract, Phase 2):
 *   - Reset covers the scale on screen only, asks first and offers Undo;
 *   - each card suggests done stories with that many points, to pin as
 *     reference stories (a new store field; old saved guides still load);
 *   - an example fills only empty cards and clears without touching the
 *     team's own words;
 *   - a one-sentence verdict and a Markdown export.
 */

const h = vi.hoisted(() => ({
  markdown: undefined as string | undefined,
  undo: null as null | { label: string; revert: () => void },
}));
const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    h.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  // Radix Select calls these; jsdom doesn't implement them.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

import { EstimationGuideClient } from "@/app/(tools)/estimation-guide/estimation-guide-client";
import { useEstimationGuideStore, initialState } from "@/app/(tools)/estimation-guide/store";
import {
  MAX_REFERENCE_STORIES,
  cardReference,
  guideScaleFor,
  pinnedIds,
  pointsOf,
  resolveReferenceStories,
  suggestReferenceStories,
  withPin,
  withoutPin,
} from "@/app/(tools)/estimation-guide/references";
import {
  isScaleAtDefaults,
  restoreScale,
  withScaleReset,
} from "@/app/(tools)/estimation-guide/scale-reset";
import {
  EXAMPLE_NOTES,
  EXAMPLE_REFERENCE_STORIES,
  hasExample,
  withExample,
  withoutExample,
} from "@/app/(tools)/estimation-guide/example";
import { guideCoverage, guideVerdict } from "@/app/(tools)/estimation-guide/verdict";
import { toMarkdown } from "@/app/(tools)/estimation-guide/markdown";
import { scales, defaultDescriptions } from "@/lib/constants/scales";

const KEY = "agile-toolkit:estimation-guide";
const FIB = scales.find((s) => s.name === "Fibonacci")!;
const TSHIRT = scales.find((s) => s.name === "T-Shirt")!;
const POW2 = scales.find((s) => s.name === "Powers of 2")!;

const done = (id: string, points: number | undefined, doneAt?: string, title = id): Story => ({
  id,
  title,
  points,
  status: "done",
  ...(doneAt ? { doneAt } : {}),
});

const guide = () => useEstimationGuideStore.getState();
const maps = () => ({
  descriptions: guide().descriptions,
  examples: guide().examples,
  referenceStoryIds: guide().referenceStoryIds,
});

beforeEach(() => {
  localStorage.clear();
  toastSpy.mockReset();
  h.undo = null;
  h.markdown = undefined;
  useEstimationGuideStore.setState({ ...initialState });
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [] });
});

// ─── Reference stories (logic) ───────────────────────────────────────────

describe("reference stories", () => {
  it("pins once each, up to the cap, and Undo can put one back in its place", () => {
    let map = withPin({}, "Fibonacci", 8, "a");
    map = withPin(map, "Fibonacci", 8, "a");
    map = withPin(map, "Fibonacci", "8", "b");
    expect(pinnedIds(map, "Fibonacci", 8)).toEqual(["a", "b"]);
    map = withPin(map, "Fibonacci", 8, "c");
    expect(withPin(map, "Fibonacci", 8, "d")).toBe(map); // full at MAX_REFERENCE_STORIES
    expect(MAX_REFERENCE_STORIES).toBe(3);
    // Per scale: Linear's 8 is a different card.
    expect(pinnedIds(map, "Linear", 8)).toEqual([]);

    const without = withoutPin(map, "Fibonacci", 8, "b");
    expect(pinnedIds(without, "Fibonacci", 8)).toEqual(["a", "c"]);
    expect(pinnedIds(withPin(without, "Fibonacci", 8, "b", 1), "Fibonacci", 8)).toEqual([
      "a",
      "b",
      "c",
    ]);
    const empty = withoutPin({ "Fibonacci:1": ["x"] }, "Fibonacci", 1, "x");
    expect(empty).toEqual({});
  });

  it("reads malformed stored pins as none", () => {
    expect(pinnedIds(undefined, "Fibonacci", 8)).toEqual([]);
    expect(pinnedIds([], "Fibonacci", 8)).toEqual([]);
    expect(pinnedIds({ "Fibonacci:8": "a" }, "Fibonacci", 8)).toEqual([]);
    expect(pinnedIds({ "Fibonacci:8": ["a", 3, "", null] }, "Fibonacci", 8)).toEqual(["a"]);
  });

  it("suggests done stories with that many points, newest first, never the pinned or example ones", () => {
    const stories: Story[] = [
      done("old", 8, "2026-01-01T00:00:00Z"),
      done("new", 8, "2026-09-01T00:00:00Z"),
      done("undated", 8),
      done("pinned", 8, "2026-10-01T00:00:00Z"),
      done("example-x", 8, "2026-10-02T00:00:00Z"),
      done("five", 5, "2026-10-01T00:00:00Z"),
      { id: "todo", title: "todo", points: 8, status: "todo" },
      done("blank", 8, "2026-10-03T00:00:00Z", "  "),
    ];
    expect(suggestReferenceStories(stories, 8, ["pinned"]).map((s) => s.id)).toEqual([
      "new",
      "old",
      "undated",
    ]);
    expect(suggestReferenceStories(stories, "8", [], 1).map((s) => s.id)).toEqual(["pinned"]);
    expect(suggestReferenceStories(stories, "M", [])).toEqual([]);
    expect(suggestReferenceStories(stories, 13, [])).toEqual([]);
    expect(pointsOf("8")).toBe(8);
    expect(pointsOf("XL")).toBeNull();
    expect(pointsOf("")).toBeNull();
  });

  it("resolves pins in order, skipping stories that are gone, and knows the example's", () => {
    const stories = [done("a", 3, undefined, "Saved cards")];
    const exampleId = EXAMPLE_REFERENCE_STORIES[0].id;
    expect(resolveReferenceStories(["gone", "a", exampleId], stories)).toEqual([
      { id: "a", title: "Saved cards", points: 3, example: false },
      {
        id: exampleId,
        title: EXAMPLE_REFERENCE_STORIES[0].title,
        points: EXAMPLE_REFERENCE_STORIES[0].points,
        example: true,
      },
    ]);
  });

  it("finds the guide scale for a card, preferring the deck's own", () => {
    expect(guideScaleFor("8", ["Fibonacci", "Linear"])).toBe("Fibonacci");
    expect(guideScaleFor("4", ["Fibonacci", "Linear"])).toBe("Linear");
    expect(guideScaleFor("16", [null, undefined])).toBe("Powers of 2");
    expect(guideScaleFor("M", [null])).toBe("T-Shirt");
    expect(guideScaleFor("?", ["Fibonacci"])).toBeNull();
    expect(guideScaleFor("banana", [])).toBeNull();
  });

  it("describes a card with the default meaning, a legacy bare entry, and its pins", () => {
    const ref = cardReference(
      { descriptions: {}, examples: { "8": "Legacy example" }, referenceStoryIds: {} },
      "Fibonacci",
      "8",
      []
    );
    expect(ref).toEqual({
      scale: "Fibonacci",
      value: "8",
      description: defaultDescriptions["8"],
      example: "Legacy example",
      stories: [],
    });
  });
});

// ─── Reset one scale (logic) ─────────────────────────────────────────────

describe("resetting one scale", () => {
  const edited = () => ({
    descriptions: {
      ...initialState.descriptions,
      "Fibonacci:8": "Our 8",
      "Linear:8": "Linear's 8",
    },
    examples: { "Fibonacci:3": "Saved cards", "Powers of 2:4": "Address book", "13": "legacy" },
    referenceStoryIds: { "Fibonacci:5": ["s5"], "Linear:5": ["l5"] },
  });

  it("puts only that scale back to the built-in guide", () => {
    const next = withScaleReset(edited(), FIB);
    expect(next.descriptions["Fibonacci:8"]).toBe(defaultDescriptions["8"]);
    expect(next.descriptions["Linear:8"]).toBe("Linear's 8");
    expect(next.examples["Fibonacci:3"]).toBeUndefined();
    expect(next.examples["Powers of 2:4"]).toBe("Address book");
    // A legacy bare key would show through a deleted entry: it's blanked instead.
    expect(next.examples["Fibonacci:13"]).toBe("");
    expect(next.referenceStoryIds).toEqual({ "Linear:5": ["l5"] });
    expect(isScaleAtDefaults(next, FIB)).toBe(true);
    expect(isScaleAtDefaults(next, POW2)).toBe(false);
    expect(isScaleAtDefaults(initialState, FIB)).toBe(true);
  });

  it("Undo restores that scale's keys and keeps edits made since on other scales", () => {
    const before = edited();
    const reset = withScaleReset(before, FIB);
    const since = { ...reset, examples: { ...reset.examples, "Linear:2": "Typed after" } };
    const back = restoreScale(since, before, FIB);
    expect(back.descriptions["Fibonacci:8"]).toBe("Our 8");
    expect(back.examples["Fibonacci:3"]).toBe("Saved cards");
    expect(back.examples["Fibonacci:13"]).toBeUndefined();
    expect(back.examples["Linear:2"]).toBe("Typed after");
    expect(back.referenceStoryIds).toEqual({ "Fibonacci:5": ["s5"], "Linear:5": ["l5"] });
  });
});

// ─── Example (logic) ─────────────────────────────────────────────────────

describe("the example", () => {
  it("has a note for every value on every scale", () => {
    for (const scale of scales) {
      for (const v of scale.values)
        expect(EXAMPLE_NOTES[String(v)], `${scale.name} ${v}`).toBeTruthy();
    }
  });

  it("fills only empty cards, and clears only what still reads as the example", () => {
    const mine = {
      examples: { "Fibonacci:3": "Our own 3" },
      referenceStoryIds: { "Fibonacci:8": ["mine"] },
    };
    const loaded = withExample(mine, FIB);
    expect(loaded.examples["Fibonacci:3"]).toBe("Our own 3");
    expect(loaded.examples["Fibonacci:5"]).toBe(EXAMPLE_NOTES["5"]);
    expect(loaded.referenceStoryIds["Fibonacci:8"]).toEqual(["mine"]);
    expect(loaded.referenceStoryIds["Fibonacci:13"]).toEqual(["example-guide-ref-13"]);
    expect(hasExample(loaded)).toBe(true);
    expect(hasExample(mine)).toBe(false);

    // The team rewrote the example's 5: that's theirs now.
    const reworded = { ...loaded, examples: { ...loaded.examples, "Fibonacci:5": "Our 5" } };
    const cleared = withoutExample(reworded);
    expect(cleared.examples).toEqual({ "Fibonacci:3": "Our own 3", "Fibonacci:5": "Our 5" });
    expect(cleared.referenceStoryIds).toEqual({ "Fibonacci:8": ["mine"] });
    expect(hasExample(cleared)).toBe(false);
  });

  it("gives a T-shirt scale notes but no pins (stories carry points)", () => {
    const loaded = withExample({ examples: {}, referenceStoryIds: {} }, TSHIRT);
    expect(Object.keys(loaded.examples)).toHaveLength(TSHIRT.values.length);
    expect(loaded.referenceStoryIds).toEqual({});
  });
});

// ─── Verdict and export ──────────────────────────────────────────────────

describe("verdict and Markdown", () => {
  it("says how much of the scale is in the team's own terms", () => {
    const none = guideCoverage(initialState, FIB, []);
    expect(guideVerdict(none)).toBe(
      "No card on the Fibonacci scale has a team example or a reference story yet: start with the cards your team plays most."
    );
    const some = guideCoverage(
      {
        ...initialState,
        examples: { "Fibonacci:1": "Typo", "Fibonacci:2": "  " },
        // A pin whose story is gone doesn't count.
        referenceStoryIds: { "Fibonacci:3": ["s3"], "Fibonacci:5": ["gone"] },
      },
      FIB,
      [done("s3", 3)]
    );
    expect(some).toMatchObject({ calibrated: 2, missing: ["2", "5", "8", "13", "21"] });
    expect(guideVerdict(some)).toBe(
      "2 of 7 cards on the Fibonacci scale have a team example or a reference story; still to do: 2, 5, 8, 13 and 21."
    );
    const all = guideCoverage(
      { ...initialState, ...withExample({ examples: {}, referenceStoryIds: {} }, FIB) },
      FIB,
      []
    );
    expect(guideVerdict(all)).toBe(
      "Every card on the Fibonacci scale has a team example or a reference story."
    );
  });

  it("exports the scale as a table, pipes escaped", () => {
    const md = toMarkdown(
      {
        ...initialState,
        descriptions: { ...initialState.descriptions, "Fibonacci:1": "Tiny | trivial" },
        examples: { "Fibonacci:3": "Saved\ncards" },
        referenceStoryIds: { "Fibonacci:3": ["s3"], "Fibonacci:1": ["s1"] },
      },
      FIB,
      [done("s3", 3, undefined, "Show saved cards"), done("s1", 1, undefined, "Rename button")],
      new Date("2026-10-23T12:00:00Z")
    );
    expect(md).toContain("# Estimation Guide — Fibonacci scale — 23 Oct 2026");
    expect(md).toContain("**2 of 7 cards on the Fibonacci scale");
    expect(md).toContain("| 1 | Tiny \\| trivial | — | “Rename button” (1 pt) |");
    expect(md).toContain(
      `| 3 | ${defaultDescriptions["3"]} | Saved cards | “Show saved cards” (3 pts) |`
    );
    expect(md).toContain(`| 21 | ${defaultDescriptions["21"]} | — | — |`);
  });
});

// ─── The page ────────────────────────────────────────────────────────────

const descriptionBoxes = () => screen.getAllByLabelText("Description") as HTMLTextAreaElement[];
const exampleBoxes = () => screen.getAllByLabelText("Example") as HTMLTextAreaElement[];

function chooseScale(name: string) {
  const trigger = screen.getByRole("combobox", { name: "Estimation scale" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
}

describe("the Estimation Guide page", () => {
  it("loads a guide saved before reference stories existed", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          selectedScale: "Fibonacci",
          descriptions: { ...initialState.descriptions },
          examples: { "Fibonacci:8": "Checkout rewrite" },
        },
        version: 0,
      })
    );
    render(<EstimationGuideClient />);
    await waitFor(() => expect(exampleBoxes()[4]).toHaveValue("Checkout rewrite"));
    expect(guide().referenceStoryIds).toEqual({});
    expect(
      screen.getByText(/^1 of 7 cards on the Fibonacci scale have a team example/)
    ).toBeInTheDocument();
  });

  it("resets only the scale on screen, after asking, with Undo", async () => {
    useEstimationGuideStore.setState({
      examples: { "Fibonacci:8": "Our 8", "Powers of 2:8": "Powers 8" },
    });
    render(<EstimationGuideClient />);
    await waitFor(() => expect(exampleBoxes()[4]).toHaveValue("Our 8"));

    fireEvent.click(screen.getByRole("button", { name: "Reset this scale" }));
    const dialog = screen.getByRole("dialog", { name: "Reset the Fibonacci scale?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset scale" }));
    expect(guide().examples["Fibonacci:8"]).toBeUndefined();
    expect(guide().examples["Powers of 2:8"]).toBe("Powers 8");
    expect(screen.getByRole("button", { name: "Reset this scale" })).toBeDisabled();

    const [label, opts] = toastSpy.mock.calls.at(-1)!;
    expect(label).toBe("Reset the Fibonacci scale");
    act(() => opts.action.onClick());
    expect(guide().examples["Fibonacci:8"]).toBe("Our 8");
  });

  it("suggests done stories to pin, and unpins with Undo", async () => {
    useWorkspaceStore.setState({
      stories: [
        done("s8", 8, "2026-10-01T00:00:00Z", "Checkout rewrite"),
        done("s3", 3, "2026-10-01T00:00:00Z", "Saved cards"),
      ],
    });
    render(<EstimationGuideClient />);
    const pin = await screen.findByRole("button", {
      name: "Pin “Checkout rewrite” as a reference for 8",
    });
    fireEvent.click(pin);
    expect(guide().referenceStoryIds).toEqual({ "Fibonacci:8": ["s8"] });
    expect(screen.queryByRole("button", { name: /Pin “Checkout rewrite”/ })).toBeNull();
    expect(screen.getByRole("list", { name: "Reference stories" })).toHaveTextContent(
      "Checkout rewrite"
    );
    expect(h.markdown).toContain("“Checkout rewrite” (8 pts)");

    fireEvent.click(screen.getByRole("button", { name: "Unpin Checkout rewrite" }));
    expect(guide().referenceStoryIds).toEqual({});
    const [label, opts] = toastSpy.mock.calls.at(-1)!;
    expect(label).toBe("Unpinned “Checkout rewrite”");
    act(() => opts.action.onClick());
    expect(guide().referenceStoryIds).toEqual({ "Fibonacci:8": ["s8"] });

    // T-shirt sizes get no suggestions.
    chooseScale("T-Shirt");
    await waitFor(() => expect(descriptionBoxes()).toHaveLength(6));
    expect(screen.getByText(/Stories carry points, not T-shirt sizes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pin / })).toBeNull();
  });

  it("offers the example while a scale has no team notes, and clears only the example", async () => {
    render(<EstimationGuideClient />);
    fireEvent.click(await screen.findByRole("button", { name: "Load an example" }));
    expect(exampleBoxes()[2]).toHaveValue(EXAMPLE_NOTES["3"]);
    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    // The example's reference stories are pinned, marked as the example's.
    expect(
      screen.getByRole("button", { name: "Unpin Show saved cards at checkout" })
    ).toBeInTheDocument();
    expect(screen.getAllByText("(example)")).toHaveLength(6);

    fireEvent.change(exampleBoxes()[0], { target: { value: "Our own 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(maps().examples).toEqual({ "Fibonacci:1": "Our own 1" });
    expect(maps().referenceStoryIds).toEqual({});
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });

  it("points to Planning Poker when stories wait in its queue, else to Sprint Planning", async () => {
    useWorkspaceStore.setState({
      stories: [{ id: "u1", title: "Unsized", status: "backlog" }],
    });
    const view = render(<EstimationGuideClient />);
    expect(await screen.findByRole("link", { name: /Open Sprint Planning/ })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );
    expect(screen.getByText(/1 story has no points yet/)).toBeInTheDocument();
    view.unmount();

    useWorkspaceStore.setState({
      pokerEstimationLogs: [
        {
          id: "pokerEstimationLog:current",
          estimates: [],
          queue: [
            {
              id: "q1",
              title: "Queued",
              sourceRef: { tool: "story", id: "u1" },
              queuedAt: "2026-10-23T00:00:00Z",
            },
          ],
        },
      ],
    });
    render(<EstimationGuideClient />);
    expect(await screen.findByRole("link", { name: /Open Planning Poker/ })).toHaveAttribute(
      "href",
      "/planning-poker"
    );
  });
});
