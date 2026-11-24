import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";

/**
 * Refinement's sizing help: beside a story with no points, "Like this one"
 * lists finished stories that read alike with their points (Refinement
 * isn't a blind vote, so it shows at once), else the guide's reference
 * stories; a sized story gets none. With five or more unsized backlog
 * stories, a link sizes them together in Relative Sizing.
 */

vi.mock("@/lib/utils/toast", () => ({
  toast: Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

import { RefinementClient } from "@/app/(tools)/refinement/refinement-client";
import { useRefinementStore } from "@/app/(tools)/refinement/store";
import { initialState, useEstimationGuideStore } from "@/app/(tools)/estimation-guide/store";

const backlog = (id: string, title: string, extra: Partial<Story> = {}): Story => ({
  id,
  title,
  status: "backlog",
  ...extra,
});
const done = (id: string, title: string, points: number): Story => ({
  id,
  title,
  points,
  status: "done",
});

const DONE: Story[] = [
  done("d1", "Card refunds for marketplace orders", 5),
  done("d2", "Export the monthly sales report", 3),
];

function seed(stories: Story[]) {
  useWorkspaceStore.setState({
    stories,
    sprints: [],
    pokerEstimationLogs: [],
    whiteboardObjects: [],
  });
}

const renderPage = () =>
  render(
    <TooltipProvider>
      <RefinementClient />
    </TooltipProvider>
  );
const like = () => screen.queryByRole("region", { name: "Like this one" });
const sizingLink = () => screen.queryByRole("link", { name: /in Relative Sizing$/ });

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  useEstimationGuideStore.setState({ ...initialState, referenceStoryIds: {} });
  useRefinementStore.setState({
    criteria: [{ id: "c1", label: "Acceptance criteria defined" }],
    history: [],
    exampleStories: [],
    storyName: "",
    storyDescription: "",
    currentChecks: {},
  });
});

describe("Like this one", () => {
  it("shows finished stories like an unsized story, with their points", () => {
    seed([backlog("a", "Refund a card payment"), ...DONE]);
    renderPage();
    const region = like();
    expect(region).not.toBeNull();
    expect(
      within(region!)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["Card refunds for marketplace orders · 5 ptsBoth mention: card, refund"]);
    // Inside the story being refined.
    expect(screen.getByRole("button", { name: "Mark ready" }).closest("section")).toContainElement(
      region
    );
  });

  it("reads the story's notes too", () => {
    seed([backlog("a", "Monthly figures", { notes: "The sales report." }), ...DONE]);
    renderPage();
    expect(like()).toHaveTextContent("Export the monthly sales report · 3 pts");
  });

  it("falls back to the guide's reference stories on its points scale", () => {
    seed([backlog("a", "Dark mode toggle"), ...DONE]);
    useEstimationGuideStore.setState({ referenceStoryIds: { "Fibonacci:3": ["d2"] } });
    renderPage();
    expect(like()).toHaveTextContent(
      "No finished story reads like this one yet. Your reference stories:"
    );
    expect(like()).toHaveTextContent("3 · Export the monthly sales report");
  });

  it("finds similar without AI from the panel", () => {
    seed([backlog("a", "Refund a card payment"), ...DONE]);
    renderPage();
    fireEvent.click(within(like()!).getByRole("button", { name: "Find similar without AI" }));
    expect(like()).toHaveTextContent("Found without AI, by shared words.");
    expect(like()).toHaveTextContent("Shares: card, refund");
  });

  it("isn't shown for a story that has points", () => {
    seed([backlog("a", "Refund a card payment", { points: 3 }), ...DONE]);
    renderPage();
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeInTheDocument();
    expect(like()).toBeNull();
  });

  it("isn't shown with nothing to compare with", () => {
    seed([backlog("a", "Refund a card payment")]);
    renderPage();
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeInTheDocument();
    expect(like()).toBeNull();
  });
});

describe("Size them together in Relative Sizing", () => {
  const unsized = (n: number) =>
    Array.from({ length: n }, (_, i) => backlog(`u${i}`, `Unsized story ${i + 1}`));

  it("links to Relative Sizing with five unsized backlog stories", () => {
    seed(unsized(5));
    renderPage();
    expect(sizingLink()).toHaveAttribute("href", "/relative-sizing?stories=unsized");
    expect(sizingLink()).toHaveTextContent("Size 5 unsized stories together in Relative Sizing");
  });

  it("has no link under five, and counts only the backlog's own unsized stories", () => {
    seed([
      ...unsized(4),
      backlog("sized", "Sized", { points: 3 }),
      backlog("planned", "Planned", { sprintId: "sp1" }),
      backlog("example-1", "Example story"),
      done("d", "Done", 3),
    ]);
    renderPage();
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeInTheDocument();
    expect(sizingLink()).toBeNull();
  });
});
