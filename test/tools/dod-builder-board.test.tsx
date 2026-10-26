import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { DodCriterion, Sprint, Story } from "@/lib/stores/workspace-types";
import { DOD_DOC_ID } from "@/lib/dod/model";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

/**
 * The Definition of Done on the Sprint board: each card carries a compact
 * checklist (collapsed, "DoD 1 of 3"), ticked through setStoryDodCheck, a
 * closed sprint's cards read-only, and a move to Done with required
 * criteria open says so without blocking the move. The example board ticks
 * in memory.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn(() => "t"),
    { dismiss: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() }
  )
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => undefined }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => undefined, toolRunId: "test" }),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { KanbanClient } from "@/app/(tools)/kanban/kanban-client";
import { dodNudge, moveMessage } from "@/app/(tools)/kanban/sprint-view";
import {
  createExampleBoardStore,
  exampleSprintWriter,
  liveSprintWriter,
} from "@/app/(tools)/kanban/sprint-writer";
import { buildSprintExample } from "@/app/(tools)/kanban/example";

const CRITERIA: DodCriterion[] = [
  { id: "rev", label: "Code reviewed", category: "code", required: true },
  { id: "ci", label: "Tests pass in CI", category: "testing", required: true },
  { id: "doc", label: "Docs updated", category: "docs", required: false },
];

const SPRINT: Sprint = {
  id: "s7",
  name: "Sprint 7",
  startDate: "2026-10-12",
  endDate: "2026-10-25",
  pointsPlanned: 10,
  status: "active",
};

const story = (id: string, title: string, patch: Partial<Story> = {}): Story => ({
  id,
  title,
  status: "review",
  sprintId: "s7",
  ...patch,
});

const storyById = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id)!;
const live = () => screen.getByTestId("live-polite");
const openMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });

function seed(sprint: Sprint = SPRINT, stories: Story[] = [story("a", "Pay by card")]) {
  useWorkspaceStore.setState({
    sprints: [sprint],
    stories,
    teamMembers: [],
    kanbanBoards: [],
    definitionsOfDone: [{ id: DOD_DOC_ID, items: CRITERIA, history: [] }],
  });
}

const renderBoard = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <KanbanClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

beforeEach(() => {
  toastSpy.mockClear();
  localStorage.clear();
  resetSelectedSprint();
  window.history.replaceState(null, "", "/kanban?board=sprint");
});

describe("the DoD on a Sprint board card", () => {
  it("is collapsed with a count, and ticks write the story through setStoryDodCheck", () => {
    seed();
    renderBoard();
    const toggle = screen.getByRole("button", {
      name: /^DoD 0 of 3 · 2 required open: Pay by card/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: /Code reviewed for Pay by card/ })).toBeNull();
    fireEvent.click(toggle);
    const list = screen.getByRole("list", { name: "Definition of Done: Pay by card" });
    // Required first, optional after.
    expect(
      within(list)
        .getAllByRole("checkbox")
        .map((c) => c.getAttribute("aria-label"))
    ).toEqual([
      "Code reviewed for Pay by card",
      "Tests pass in CI for Pay by card",
      "Docs updated (optional) for Pay by card",
    ]);
    fireEvent.click(within(list).getByRole("checkbox", { name: /Code reviewed/ }));
    fireEvent.click(within(list).getByRole("checkbox", { name: /Tests pass in CI/ }));
    expect(storyById("a").dodChecks?.checked).toEqual(["rev", "ci"]);
    expect(
      screen.getByRole("button", { name: /^DoD 2 of 3 · met: Pay by card/ })
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("checkbox", { name: /Code reviewed/ }));
    expect(storyById("a").dodChecks?.checked).toEqual(["ci"]);
  });

  it("nudges when a story goes to Done with required criteria open, and still moves it", async () => {
    seed(SPRINT, [story("a", "Pay by card", { dodChecks: { checked: ["rev"], updatedAt: "t" } })]);
    renderBoard();
    openMenu("Move to…: Pay by card");
    fireEvent.click(screen.getByRole("menuitem", { name: "Done" }));
    expect(storyById("a").status).toBe("done");
    await waitFor(() =>
      expect(live()).toHaveTextContent(
        "Moved “Pay by card” to Done. DoD not met: Tests pass in CI is still open."
      )
    );
    const call = toastSpy.mock.calls.at(-1) as unknown as [string, { description?: string }];
    expect(call[1].description).toBe("DoD not met: Tests pass in CI is still open.");
  });

  it("shows a closed sprint's ticks read-only, and nothing without a DoD", () => {
    seed({ ...SPRINT, status: "completed" }, [story("a", "Pay by card", { status: "done" })]);
    const { unmount } = renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /^DoD 0 of 3/ }));
    expect(screen.getByRole("checkbox", { name: /Code reviewed for Pay by card/ })).toBeDisabled();
    unmount();
    act(() => useWorkspaceStore.setState({ definitionsOfDone: [] }));
    renderBoard();
    expect(screen.queryByRole("button", { name: /^DoD / })).toBeNull();
  });
});

describe("the writers and the move message", () => {
  it("the live writer ticks through the store; the example writer in memory only", () => {
    seed();
    liveSprintWriter.setDodCheck("a", "rev", true);
    expect(storyById("a").dodChecks?.checked).toEqual(["rev"]);
    const example = buildSprintExample("2026-10-20", new Date("2026-10-20T12:00:00Z"));
    const store = createExampleBoardStore(example);
    const writer = exampleSprintWriter(store);
    const id = example.stories[0].id;
    writer.setDodCheck(id, "x", true);
    expect(writer.story(id)?.dodChecks?.checked).toEqual(["x"]);
    expect(useWorkspaceStore.getState().stories.map((s) => s.id)).toEqual(["a"]);
  });

  it("adds the DoD nudge only to a move to Done", () => {
    expect(moveMessage("Pay", "done", undefined, ["A", "B"])).toBe(
      "Moved “Pay” to Done. DoD not met: A and B are still open."
    );
    expect(moveMessage("Pay", "review", undefined, ["A"])).toBe("Moved “Pay” to Review.");
    expect(moveMessage("Pay", "done", undefined, [])).toBe("Moved “Pay” to Done.");
    expect(dodNudge(["A", "B", "C"])).toBe("DoD not met: A, B and C are still open.");
  });
});
