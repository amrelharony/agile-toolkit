import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Story Mapper: a card's menu queues it for Planning Poker (once, with
 * Undo), and an estimate written back shows on the card.
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
const ws = () => useWorkspaceStore.getState();
const queue = () =>
  ws().pokerEstimationLogs?.find((d) => d.id === "pokerEstimationLog:current")?.queue ?? [];
const cardById = (id: string) =>
  ws()
    .storyMaps?.find((m) => m.id === SM_ID)
    ?.slices.flatMap((sl) => Object.values(sl.cards).flat())
    .find((c) => c.id === id);

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    pokerEstimationLogs: [],
    storyMaps: [
      {
        id: SM_ID,
        steps: [{ id: "s1", name: "Discover" }],
        slices: [
          {
            id: "a",
            name: "MVP",
            cards: {
              s1: [
                { id: "c1", title: "Browse", description: "See the catalog", color: "#00f0ff" },
                { id: "c2", title: "Search", description: "", color: "#00f0ff", estimate: "5" },
              ],
            },
          },
        ],
      },
    ],
  });
});

function openMenu(title: string) {
  fireEvent.keyDown(screen.getByRole("button", { name: `Move ${title}` }), { key: "Enter" });
}

describe("Story Mapper: Estimate in Planning Poker", () => {
  it("queues the card with a link back, and the menu then links to Planning Poker", () => {
    render(<StoryMapperClient />);
    openMenu("Browse");
    fireEvent.click(screen.getByRole("menuitem", { name: "Estimate in Planning Poker" }));

    expect(queue()).toEqual([
      expect.objectContaining({
        title: "Browse",
        description: "See the catalog",
        sourceRef: { tool: "story-mapper", id: "c1", doc: SM_ID },
      }),
    ]);
    expect(cardById("c1")?.sentTo).toEqual([
      { route: "poker-queue", targetId: queue()[0].id, at: expect.any(String) },
    ]);
    expect(undo.last!.label).toBe("Queued for Planning Poker");

    openMenu("Browse");
    expect(
      screen.getByRole("menuitem", { name: /Estimate in Planning Poker.*Sent · Open/ })
    ).toHaveAttribute("href", "/planning-poker");
  });

  it("Undo takes it off the queue and drops the link", () => {
    render(<StoryMapperClient />);
    openMenu("Browse");
    fireEvent.click(screen.getByRole("menuitem", { name: "Estimate in Planning Poker" }));
    act(() => undo.last!.revert());
    expect(queue()).toEqual([]);
    expect(cardById("c1")?.sentTo).toEqual([]);
  });

  it("shows a written-back estimate on the card", () => {
    render(<StoryMapperClient />);
    expect(screen.getByTitle("Estimate from Planning Poker")).toHaveTextContent("Estimate: 5");
    expect(screen.getAllByTitle("Estimate from Planning Poker")).toHaveLength(1);
  });
});
