import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";

/**
 * Retro: "Load an example" fills the empty board from the format picker,
 * "Clear example" removes only the example cards (and goes back to the picker
 * when nothing of the user's is left), and the Markdown export lists each
 * column most-voted first, then the action items with owners.
 */

const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log, toolRunId: "test-run" }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});

import { RetroClient } from "@/app/(tools)/retro/retro-client";
import { toMarkdown } from "@/app/(tools)/retro/markdown";
import { buildExample } from "@/app/(tools)/retro/example";

const NOW = new Date(2026, 9, 18);
const format = retroFormats[0]; // Start / Stop / Continue

function card(id: string, columnKey: string, overrides: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey,
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...overrides,
  };
}

const current = () =>
  (useWorkspaceStore.getState().retroBoards ?? []).find((b) => b.id === "retro:current");

beforeEach(() => {
  exported.markdown = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ retroBoards: [] });
});

describe("retro toMarkdown", () => {
  it("lists each column most-voted first, then the action items with owners", () => {
    const md = toMarkdown(
      {
        format,
        cards: [
          card("a", "start", { text: "Demo every Friday", votes: 1 }),
          card("b", "start", {
            text: "Pair on flaky tests",
            votes: 3,
            isActionItem: true,
            assignee: "Sam (QA)",
          }),
          card("c", "stop", { text: "Late merges", votes: 2 }),
          card("d", "stop", { text: "Merging after the freeze", groupedWith: "c" }),
          card("e", "stop", { text: "Skipping refinement", isActionItem: true }),
        ],
      },
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Retro — 18 Oct 2026 (Start / Stop / Continue)");
    expect(lines).toContain("## Start");
    expect(lines).toContain("## Stop");
    const pair = lines.indexOf("- Pair on flaky tests (3 votes)");
    const demo = lines.indexOf("- Demo every Friday (1 vote)");
    expect(pair).toBeGreaterThan(0);
    expect(demo).toBeGreaterThan(pair);
    // Grouped cards sit under their parent; no count before anyone voted.
    expect(lines[lines.indexOf("- Late merges (2 votes)") + 1]).toBe(
      "  - Merging after the freeze"
    );
    // An empty column says so.
    expect(lines[lines.indexOf("## Continue") + 2]).toBe("No cards.");
    expect(lines.indexOf("## Action items")).toBeGreaterThan(lines.indexOf("## Continue"));
    expect(lines).toContain("- Pair on flaky tests — Owner: Sam (QA)");
    expect(lines).toContain("- Skipping refinement — No owner yet");
    expect(md.endsWith("No owner yet\n")).toBe(true);
  });

  it("keeps each card on one line; pipes in list items pass through", () => {
    const md = toMarkdown(
      { format, cards: [card("a", "start", { text: "Search | filters\nand sort", votes: 2 })] },
      NOW
    );
    expect(md).toContain("\n- Search | filters and sort (2 votes)\n");
    expect(md).toContain("No action items yet.");
  });

  it("says there's nothing yet when the board is empty", () => {
    expect(toMarkdown({ format, cards: [] }, NOW)).toBe(
      "# Retro — 18 Oct 2026 (Start / Stop / Continue)\n\nNo cards on the board yet.\n"
    );
  });
});

describe("retro example", () => {
  it("is a voted Start / Stop / Continue board with two owned action items", () => {
    const board = buildExample();
    expect(board.format.id).toBe("start-stop-continue");
    expect(["discuss", "actions"]).toContain(board.phase);
    expect(board.cards.length).toBeGreaterThanOrEqual(6);
    expect(board.cards.length).toBeLessThanOrEqual(8);
    expect(board.cards.every((c) => c.id.startsWith("example-"))).toBe(true);
    for (const c of board.cards) {
      if (c.groupedWith) expect(board.cards.some((p) => p.id === c.groupedWith)).toBe(true);
    }
    const actions = board.cards.filter((c) => c.isActionItem);
    expect(actions).toHaveLength(2);
    expect(actions.every((a) => a.assignee.length > 0)).toBe(true);
    // One clear winner, and at least one tie.
    const votes = board.cards.map((c) => c.votes).sort((a, b) => b - a);
    expect(votes[0]).toBeGreaterThan(votes[1]);
    expect(new Set(votes).size).toBeLessThan(votes.length);
  });

  it("loads from the format picker, then clears only the example cards", () => {
    render(<RetroClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByRole("status")).toHaveTextContent("Example data.");
    expect(screen.getByText("Pair on the flaky checkout UI tests")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(history.log).not.toHaveBeenCalled();
    expect(exported.markdown).toContain("- Pair on the flaky checkout UI tests (5 votes)");
    expect(exported.markdown).toContain("- Pair on the flaky checkout UI tests — Owner: Sam (QA)");

    // A card of the user's own lands on the board alongside the example.
    act(() => {
      const board = current()!;
      useWorkspaceStore.getState().upsertRetroBoard({
        ...board,
        cards: [...board.cards, card("mine", "continue", { text: "Keep the Friday demo" })],
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(current()?.cards.map((c) => c.id)).toEqual(["mine"]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Keep the Friday demo")).toBeInTheDocument();
    expect(screen.queryByText("Pair on the flaky checkout UI tests")).toBeNull();
    expect(history.log).not.toHaveBeenCalled();
  });

  it("goes back to the format picker when the board held only the example", () => {
    render(<RetroClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(current()).toBeUndefined();
    expect(screen.getByRole("heading", { name: "Choose a Format" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("New Retro on an example board doesn't keep it under Past retros", () => {
    render(<RetroClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: /New Retro/ }));

    // Nothing of the team's to lose, so no confirmation either.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useWorkspaceStore.getState().retroBoards ?? []).toEqual([]);
    expect(screen.queryByRole("region", { name: "Past retros" })).toBeNull();
  });

  it("isn't offered once the user has a board or past retros", () => {
    const past: RetroBoard = {
      id: "retro:2026-10-04T10:00:00.000Z",
      archivedAt: "2026-10-04T10:00:00.000Z",
      format,
      phase: "actions",
      cards: [card("p1", "start", { text: "Rotate the facilitator" })],
      userVotes: 0,
      timerSeconds: 300,
      timerRunning: false,
      discussingIndex: 0,
    };
    useWorkspaceStore.setState({ retroBoards: [past] });
    const { unmount } = render(<RetroClient />);
    expect(screen.getByRole("heading", { name: "Choose a Format" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    unmount();

    useWorkspaceStore.setState({
      retroBoards: [{ ...past, id: "retro:current", archivedAt: undefined }],
    });
    render(<RetroClient />);
    expect(screen.getByText("Rotate the facilitator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
