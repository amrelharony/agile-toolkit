import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Story Mapper: deleting a card, step or slice offers Undo, which puts it back
 * where it was; Reset asks first, with counts, and is undoable too.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { StoryMapperClient } from "@/app/(tools)/story-mapper/story-mapper-client";

const SM_ID = "story-mapper:current";
const card = (id: string, title: string) => ({ id, title, description: "", color: "#00f0ff" });

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    storyMaps: [
      {
        id: SM_ID,
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
      },
    ],
  });
});

const map = () => useWorkspaceStore.getState().storyMaps?.find((m) => m.id === SM_ID);
const titles = (sliceIdx: number, stepId: string) =>
  map()?.slices[sliceIdx].cards[stepId].map((c) => c.title);

describe("Story Mapper undo", () => {
  it("puts a deleted card back in its cell, at its old position", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Browse" }));

    expect(titles(0, "s1")).toEqual(["Search"]);
    expect(screen.queryByRole("button", { name: "Delete Browse" })).toBeNull();
    expect(undo.last?.label).toBe("Deleted “Browse”");

    act(() => undo.last!.revert());
    expect(titles(0, "s1")).toEqual(["Browse", "Search"]);
    expect(screen.getByRole("button", { name: "Delete Browse" })).toBeInTheDocument();

    // A second revert (or one after something else restored it) can't duplicate it.
    act(() => undo.last!.revert());
    expect(titles(0, "s1")).toEqual(["Browse", "Search"]);
  });

  it("puts a removed step back with its cards", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove step Discover" }));

    expect(map()?.steps.map((s) => s.name)).toEqual(["Use"]);
    expect(undo.last?.label).toBe("Removed step “Discover” and 2 cards");

    act(() => undo.last!.revert());
    expect(map()?.steps.map((s) => s.name)).toEqual(["Discover", "Use"]);
    expect(titles(0, "s1")).toEqual(["Browse", "Search"]);
    expect(titles(1, "s1")).toEqual([]);
  });

  it("puts a removed slice back in its row", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove slice Walking Skeleton" }));

    expect(map()?.slices.map((s) => s.name)).toEqual(["MVP"]);
    expect(undo.last?.label).toBe("Removed slice “Walking Skeleton”");

    act(() => undo.last!.revert());
    expect(map()?.slices.map((s) => s.name)).toEqual(["Walking Skeleton", "MVP"]);
    expect(titles(0, "s2")).toEqual(["Buy"]);
  });

  it("confirms Reset with counts, and Undo restores the map", () => {
    render(<StoryMapperClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset the story map?");
    expect(dialog).toHaveTextContent("Its 3 stories, 2 steps and 2 slices are replaced");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset map" }));
    expect(map()?.steps.map((s) => s.name)).toEqual(["Discover", "Learn", "Use"]);

    act(() => undo.last!.revert());
    expect(map()?.steps.map((s) => s.name)).toEqual(["Discover", "Use"]);
    expect(titles(0, "s1")).toEqual(["Browse", "Search"]);
  });
});
