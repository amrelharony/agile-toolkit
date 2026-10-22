import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { StoryMap, StoryMapSlice, StoryMapStep } from "@/lib/stores/workspace-types";

/**
 * Story Mapper gap-filling: Markdown edges, the toolbar counts, adding
 * cards / steps / slices, renaming, the card edit dialog, Move up and the
 * menu's disabled moves, the JSON and clipboard exports, Reset without a
 * prompt on an untouched map, and Undo of a card whose cell is gone.
 */

const undo = vi.hoisted(() => ({
  all: [] as { label: string; apply: () => void; revert: () => void }[],
}));
const exported = vi.hoisted(() => ({
  props: {} as { markdown?: string; jsonData?: unknown; clipboardText?: string },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.all.push(a);
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: (p: { markdown?: string; jsonData?: unknown; clipboardText?: string }) => {
    exported.props = p;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { StoryMapperClient } from "@/app/(tools)/story-mapper/story-mapper-client";
import { toMarkdown } from "@/app/(tools)/story-mapper/markdown";

const SM_ID = "story-mapper:current";
const NOW = new Date(2026, 9, 18);
const card = (id: string, title: string, description = "") => ({
  id,
  title,
  description,
  color: "#00f0ff",
});

const map = () => useWorkspaceStore.getState().storyMaps?.find((m) => m.id === SM_ID);
const setMap = (m: Omit<StoryMap, "id">) =>
  useWorkspaceStore.setState({ storyMaps: [{ id: SM_ID, ...m }] });
const cell = (sliceIdx: number, stepId: string) =>
  map()!.slices[sliceIdx].cards[stepId]?.map((c) => c.title);

const twoByTwo = () =>
  setMap({
    steps: [
      { id: "s1", name: "Discover" },
      { id: "s2", name: "Use" },
    ],
    slices: [
      {
        id: "a",
        name: "Walking Skeleton",
        cards: { s1: [card("c1", "Browse"), card("c2", "Search")], s2: [card("c3", "Buy")] },
      },
      { id: "b", name: "MVP", cards: { s1: [], s2: [] } },
    ],
  });

/** The toolbar's "N steps · N slices · N stories" line. */
const toolbar = () => screen.getByText(/^\d+ steps? · /).textContent;

beforeEach(() => {
  undo.all = [];
  exported.props = {};
  useWorkspaceStore.setState({ storyMaps: [] });
});

describe("story map toMarkdown edges", () => {
  const steps: StoryMapStep[] = [
    { id: "s1", name: "Discover" },
    { id: "s2", name: "Use" },
  ];

  it("joins a cell's stories with <br>, marks empty cells, and lists empty slices", () => {
    const slices: StoryMapSlice[] = [
      {
        id: "a",
        name: "Release 1",
        cards: {
          s1: [card("c1", "Browse", "See the catalog"), card("c2", "Search")],
          // A cell for a step that's gone is ignored.
          gone: [card("c9", "Orphan")],
        },
      },
      { id: "b", name: "Later", cards: { s1: [], s2: [] } },
    ];
    const lines = toMarkdown({ steps, slices }, NOW).split("\n");
    expect(lines).toContain("2 steps · 2 slices · 2 stories");
    expect(lines).toContain("| **Release 1** | Browse<br>Search | — |");
    expect(lines).toContain("| **Later** | — | — |");
    expect(lines).toContain("## 1. Release 1 (2 stories)");
    expect(lines).toContain("- **Discover:** Browse — See the catalog");
    expect(lines).toContain("- **Discover:** Search");
    expect(lines).toContain("## 2. Later (0 stories)");
    expect(lines).toContain("_No stories yet._");
    expect(lines.join("\n")).not.toContain("Orphan");
  });

  it("uses the singular for one of each", () => {
    const md = toMarkdown(
      {
        steps: [steps[0]],
        slices: [{ id: "a", name: "MVP", cards: { s1: [card("c1", "Browse")] } }],
      },
      NOW
    );
    expect(md).toContain("1 step · 1 slice · 1 story");
    expect(md).toContain("## 1. MVP (1 story)");
    expect(md).toContain("**Journey:** Discover\n");
  });

  it("collapses newlines in step and slice names outside the table", () => {
    const md = toMarkdown(
      {
        steps: [{ id: "s1", name: "Dis\ncover" }],
        slices: [{ id: "a", name: "Re\r\nlease", cards: { s1: [card("c1", "Browse")] } }],
      },
      NOW
    );
    expect(md).toContain("**Journey:** Dis cover");
    expect(md).toContain("## 1. Re lease (1 story)");
    expect(md).toContain("- **Dis cover:** Browse");
  });
});

describe("Story Mapper toolbar and cells", () => {
  it("counts steps, slices and stories", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    expect(toolbar()).toBe("2 steps · 2 slices · 3 stories");
  });

  // Bug: the toolbar always said "steps", "slices", "stories", even for one.
  it("uses the singular for one step, one slice and one story", () => {
    setMap({
      steps: [{ id: "s1", name: "Discover" }],
      slices: [{ id: "a", name: "MVP", cards: { s1: [card("c1", "Browse")] } }],
    });
    render(<StoryMapperClient />);
    expect(toolbar()).toBe("1 step · 1 slice · 1 story");
  });

  it("adds a New Story to the cell whose Add card was pressed", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    // Cells render slice by slice, step by step: MVP × Use is the 4th.
    fireEvent.click(screen.getAllByRole("button", { name: "Add card" })[3]);
    expect(cell(1, "s2")).toEqual(["New Story"]);
    expect(cell(0, "s2")).toEqual(["Buy"]);
    expect(map()!.slices[1].cards.s2[0]).toMatchObject({ description: "", color: "#00f0ff" });
    expect(toolbar()).toBe("2 steps · 2 slices · 4 stories");
  });

  it("adds a step with an empty cell in every slice, and a slice with a cell per step", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    const added = map()!.steps[2];
    expect(added.name).toBe("New Step");
    expect(map()!.slices.map((sl) => sl.cards[added.id])).toEqual([[], []]);

    fireEvent.click(screen.getByRole("button", { name: "Add Slice" }));
    const slice = map()!.slices[2];
    expect(slice.name).toBe("New Slice");
    expect(Object.keys(slice.cards).sort()).toEqual(["s1", "s2", added.id].sort());
    expect(screen.getByText("Slice 3")).toBeInTheDocument();
  });

  it("builds a map from empty: a step, then a slice, then a card", () => {
    setMap({ steps: [], slices: [] });
    render(<StoryMapperClient />);
    expect(toolbar()).toBe("0 steps · 0 slices · 0 stories");
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Slice" }));
    fireEvent.click(screen.getByRole("button", { name: "Add card" }));
    expect(toolbar()).toBe("1 step · 1 slice · 1 story");
  });

  it("renames a step and a slice in place", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    const step = screen.getByRole("textbox", { name: "Rename Discover" });
    fireEvent.change(step, { target: { value: "  Find  " } });
    fireEvent.keyDown(step, { key: "Enter" });
    expect(map()!.steps.map((s) => s.name)).toEqual(["Find", "Use"]);

    fireEvent.click(screen.getByRole("button", { name: "MVP" }));
    const slice = screen.getByRole("textbox", { name: "Rename MVP" });
    fireEvent.change(slice, { target: { value: "Release 2" } });
    fireEvent.blur(slice);
    expect(map()!.slices.map((s) => s.name)).toEqual(["Walking Skeleton", "Release 2"]);
  });

  it("won't remove the last step or the last slice", () => {
    setMap({
      steps: [{ id: "s1", name: "Discover" }],
      slices: [{ id: "a", name: "MVP", cards: { s1: [] } }],
    });
    render(<StoryMapperClient />);
    expect(screen.queryByRole("button", { name: /^Remove step/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove slice/ })).toBeNull();
  });
});

describe("Story Mapper card edit dialog", () => {
  it("saves a trimmed title, description and colour", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Search" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Search");
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "  Search by keyword  " },
    });
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "  Name or category  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Purple" }));
    expect(within(dialog).getByRole("button", { name: "Purple" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(map()!.slices[0].cards.s1[1]).toEqual({
      id: "c2",
      title: "Search by keyword",
      description: "Name or category",
      color: "#a78bfa",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Name or category")).toBeInTheDocument();
  });

  it("can't save a blank title; Enter saves; Cancel discards", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Buy" }));
    let dialog = screen.getByRole("dialog");
    const title = within(dialog).getByLabelText("Title");
    fireEvent.change(title, { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.keyDown(title, { key: "Enter" });
    expect(cell(0, "s2")).toEqual(["Buy"]);

    fireEvent.change(title, { target: { value: "Buy now" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(cell(0, "s2")).toEqual(["Buy now"]);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit Buy now" }));
    dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Nope" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(cell(0, "s2")).toEqual(["Buy now"]);

    // Reopening starts from the saved card, not the discarded draft.
    fireEvent.click(screen.getByRole("button", { name: "Edit Buy now" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Title")).toHaveValue("Buy now");
  });
});

describe("Story Mapper move menu", () => {
  const openMenu = (title: string) =>
    fireEvent.keyDown(screen.getByRole("button", { name: `Move ${title}` }), { key: "Enter" });

  it("moves a card up, and disables moves that go nowhere", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    openMenu("Search");
    expect(screen.getByRole("menuitem", { name: "Move down" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    // Its own cell isn't a destination.
    const own = screen.getByRole("group", { name: "Move to Walking Skeleton" });
    const discover = Array.from(own.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent === "Discover"
    )!;
    expect(discover).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(cell(0, "s1")).toEqual(["Search", "Browse"]);
  });

  it("appends to the end of a non-empty cell", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    openMenu("Buy");
    const own = screen.getByRole("group", { name: "Move to Walking Skeleton" });
    fireEvent.click(
      Array.from(own.querySelectorAll('[role="menuitem"]')).find(
        (el) => el.textContent === "Discover"
      )!
    );
    expect(cell(0, "s1")).toEqual(["Browse", "Search", "Buy"]);
    expect(cell(0, "s2")).toEqual([]);
  });
});

describe("Story Mapper exports", () => {
  it("keeps two same-named steps apart in the JSON, in step order", () => {
    setMap({
      steps: [
        { id: "s1", name: "New Step" },
        { id: "s2", name: "New Step" },
      ],
      slices: [
        {
          id: "a",
          name: "MVP",
          cards: { s1: [card("c1", "Browse", "List")], s2: [card("c2", "Buy")] },
        },
      ],
    });
    render(<StoryMapperClient />);
    expect(exported.props.jsonData).toEqual({
      steps: ["New Step", "New Step"],
      slices: [
        {
          name: "MVP",
          stories: [
            { step: "New Step", cards: [{ title: "Browse", description: "List" }] },
            { step: "New Step", cards: [{ title: "Buy", description: "" }] },
          ],
        },
      ],
    });
  });

  it("writes a plain-text map for the clipboard, skipping empty cells", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    expect(exported.props.clipboardText).toBe(
      [
        "User Story Map",
        "",
        "Journey: Discover | Use",
        "=".repeat(60),
        "\n[Walking Skeleton]",
        "  Discover:",
        "    - Browse",
        "    - Search",
        "  Use:",
        "    - Buy",
        "\n[MVP]",
      ].join("\n")
    );
    expect(exported.props.markdown).toContain("| **Walking Skeleton** | Browse<br>Search | Buy |");
  });
});

describe("Story Mapper reset and undo edges", () => {
  it("resets an untouched example map without asking", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(undo.all.map((u) => u.label)).toEqual(["Reset the story map"]);
    expect(map()!.steps.map((s) => s.name)).toEqual(["Discover", "Learn", "Use"]);
  });

  it("resets an empty map to the example without asking", () => {
    setMap({ steps: [], slices: [] });
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(map()!.slices.map((s) => s.name)).toEqual(["Walking Skeleton", "MVP"]);
  });

  it("doesn't bring a card back into a step that was removed since", () => {
    twoByTwo();
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Browse" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove step Discover" }));
    const [deleteCard, removeStep] = undo.all;
    expect(removeStep.label).toBe("Removed step “Discover” and 1 card");

    act(() => deleteCard.revert());
    expect(map()!.steps.map((s) => s.id)).toEqual(["s2"]);
    expect(map()!.slices[0].cards.s1).toBeUndefined();

    // Undoing the step brings back what it held when removed.
    act(() => removeStep.revert());
    expect(cell(0, "s1")).toEqual(["Search"]);
  });
});
