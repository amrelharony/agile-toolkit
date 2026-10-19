import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Story Mapper: cards can be moved without dragging (WCAG 2.5.7), and the
 * drag handle is a focusable, named keyboard drag activator.
 */

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
            cards: { s1: [card("c1", "Browse"), card("c2", "Search")], s2: [] },
          },
          { id: "b", name: "MVP", cards: { s1: [], s2: [] } },
        ],
      },
    ],
  });
});

const cells = () => useWorkspaceStore.getState().storyMaps?.find((m) => m.id === SM_ID)?.slices;

function openMoveMenu(title: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `Move ${title}` }), { key: "Enter" });
}

describe("Story Mapper card moves", () => {
  it("exposes a focusable, named drag handle per card", () => {
    render(<StoryMapperClient />);
    const handle = screen.getByRole("button", { name: "Drag Browse" });
    expect(handle).not.toHaveAttribute("tabindex", "-1");
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
  });

  it("moves a card down within its cell from the Move menu", () => {
    render(<StoryMapperClient />);
    openMoveMenu("Browse");
    expect(screen.getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(cells()?.[0].cards.s1.map((c) => c.title)).toEqual(["Search", "Browse"]);
  });

  it("moves a card to another slice and step, and keeps focus on it", async () => {
    render(<StoryMapperClient />);
    openMoveMenu("Search");
    const mvp = screen.getByRole("group", { name: "Move to MVP" });
    fireEvent.click(
      Array.from(mvp.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent === "Use")!
    );
    expect(cells()?.[0].cards.s1.map((c) => c.title)).toEqual(["Browse"]);
    expect(cells()?.[1].cards.s2.map((c) => c.title)).toEqual(["Search"]);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Search" }))
    );
  });
});
