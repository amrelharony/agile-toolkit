import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SizingBoard } from "@/lib/relative-sizing/state";

/**
 * "Ask the room" lives in the board shown, so whatever changes the board
 * shown would end it for every phone in it. While a room is live its board
 * stays on screen: Amr's create_board (or another tab, or a sync) moving
 * the store's active board waits, with an offer to show it, and the host's
 * own switch, delete or Clear example asks first, as Kickoff does.
 *
 * The room is a stand-in here: it goes live and tells the page as the real
 * one does (`onLiveChange`, false when it ends or unmounts).
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(vi.fn(), { dismiss: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() })
);
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "t" }),
}));
vi.mock("@/lib/celebrate/cheer", () => ({ cheer: () => {} }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/relative-sizing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/auth/auth-provider", () => ({ useAuthOptional: () => null }));

/** How many times a room mounted, by board: a remount would end the room. */
const mounts = vi.hoisted(() => [] as string[]);

function FakeLive({ onLiveChange }: { onLiveChange?: (live: boolean) => void }) {
  const report = useRef(onLiveChange);
  report.current = onLiveChange;
  useEffect(() => {
    report.current?.(true);
    return () => report.current?.(false);
  }, []);
  return <span>The room is live</span>;
}

function FakeRound({
  board,
  onLiveChange,
}: {
  board: SizingBoard;
  onLiveChange?: (live: boolean) => void;
}) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    mounts.push(board.id);
  }, [board.id]);
  return (
    <div data-testid="room" data-board={board.id}>
      {live ? (
        <>
          <button type="button" onClick={() => setLive(false)}>
            End room
          </button>
          <FakeLive onLiveChange={onLiveChange} />
        </>
      ) : (
        <button type="button" onClick={() => setLive(true)}>
          Go live
        </button>
      )}
    </div>
  );
}

vi.mock("@/app/(tools)/relative-sizing/live-round", () => ({
  LiveRound: (props: { board: SizingBoard; onLiveChange?: (live: boolean) => void }) => (
    <FakeRound {...props} />
  ),
}));

import { RelativeSizingClient } from "@/app/(tools)/relative-sizing/relative-sizing-client";
import { bucketsFor, newBoard, planCreateBoard } from "@/lib/relative-sizing/model";
import { RELATIVE_SIZING_INITIAL, type RelativeSizingState } from "@/lib/relative-sizing/state";
import {
  hydrateRelativeSizing,
  relativeSizingState,
  updateRelativeSizing,
  useRelativeSizing,
} from "@/lib/relative-sizing/store";

const NOW = "2026-11-23T10:00:00.000Z";
const board = (id: string, title: string): SizingBoard =>
  newBoard(
    {
      title,
      bucketSet: "fibonacci",
      buckets: bucketsFor("fibonacci"),
      items: [{ title: `${title} story` }],
    },
    id,
    NOW,
    (i) => `${id}_c${i + 1}`
  );

const renderPage = () =>
  render(
    <TooltipProvider>
      <LiveAnnouncerProvider>
        <RelativeSizingClient />
      </LiveAnnouncerProvider>
    </TooltipProvider>
  );

/** The board the page shows, by its heading. */
const shown = () => document.getElementById("board-title")?.textContent;
const pick = (title: string) =>
  fireEvent.change(screen.getByLabelText("Board"), {
    target: { value: relativeSizingState().boards.find((b) => b.title === title)?.id },
  });

beforeEach(async () => {
  mounts.length = 0;
  toastSpy.mockClear();
  window.history.replaceState(null, "", "/relative-sizing");
  vi.spyOn(useWorkspaceStore.persist, "hasHydrated").mockReturnValue(true);
  await hydrateRelativeSizing();
  useRelativeSizing.setState({
    ...RELATIVE_SIZING_INITIAL,
    boards: [board("sizing_a", "Checkout"), board("sizing_b", "Refunds")],
    activeBoardId: "sizing_a",
  } as RelativeSizingState);
  useWorkspaceStore.setState({ stories: [], pokerEstimationLogs: [], teamMembers: [] });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a live room and the board shown", () => {
  it("keeps the live board on screen when Amr makes a board, and offers to show it", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Checkout" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    // Amr's create_board writes the same in-tab store: the new board is the active one.
    act(() => {
      updateRelativeSizing((s) => {
        const plan = planCreateBoard(
          s,
          {
            title: "Unsized stories",
            bucketSet: "fibonacci",
            buckets: bucketsFor("fibonacci"),
            items: [{ title: "One" }],
          },
          { boardId: "sizing_amr", itemId: (i) => `amr_${i}` },
          NOW
        );
        return plan.ok ? plan.state : null;
      });
    });
    expect(relativeSizingState().activeBoardId).toBe("sizing_amr");
    expect(shown()).toBe("Checkout");
    expect(screen.getByText("The room is live")).toBeInTheDocument();
    expect(mounts).toEqual(["sizing_a"]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByText(
        "“Unsized stories” was opened while the room on “Checkout” is live, so this board stays on screen."
      )
    ).toBeInTheDocument();

    // Showing it asks first; Keep the room keeps everything as it was.
    fireEvent.click(screen.getByRole("button", { name: "Show “Unsized stories”" }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    expect(dialog).toHaveTextContent(
      "The room on “Checkout” is still live. Showing another board ends it for every phone in it, and any placements not saved yet are lost."
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect(shown()).toBe("Checkout");
    expect(screen.getByText("The room is live")).toBeInTheDocument();

    // Once the host ends the room, the board stays, and the offer just shows it.
    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    expect(shown()).toBe("Checkout");
    expect(
      screen.getByText("“Unsized stories” was opened while the room on “Checkout” was live.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show “Unsized stories”" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shown()).toBe("Unsized stories");
  });

  it("asks before the Board picker shows another board, and ends the room only on End it", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    pick("Refunds");
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect(shown()).toBe("Checkout");
    expect(relativeSizingState().activeBoardId).toBe("sizing_a");
    expect(screen.getByText("The room is live")).toBeInTheDocument();

    pick("Refunds");
    fireEvent.click(screen.getByRole("button", { name: "End it and switch" }));
    expect(shown()).toBe("Refunds");
    expect(screen.queryByText("The room is live")).toBeNull();
    // No room now: the next switch doesn't ask.
    pick("Checkout");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(shown()).toBe("Checkout");
  });

  it("asks before deleting the board whose room is live", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete the board “Checkout”" }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    expect(dialog).toHaveTextContent("Deleting the board ends it for every phone in it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect(relativeSizingState().boards.map((b) => b.id)).toContain("sizing_a");
    fireEvent.click(screen.getByRole("button", { name: "Delete the board “Checkout”" }));
    fireEvent.click(screen.getByRole("button", { name: "End it and delete" }));
    expect(relativeSizingState().boards.map((b) => b.id)).toEqual(["sizing_b"]);
    expect(shown()).toBe("Refunds");
  });

  it("asks before Clear example ends a room live on the example", async () => {
    useRelativeSizing.setState({
      ...RELATIVE_SIZING_INITIAL,
      boards: [board("example-sizing", "Example board"), board("sizing_b", "Refunds")],
      activeBoardId: "example-sizing",
    } as RelativeSizingState);
    renderPage();
    await screen.findByRole("heading", { name: "Example board" });
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    const dialog = screen.getByRole("dialog", { name: "End the live room?" });
    expect(dialog).toHaveTextContent("Clearing the example ends it for every phone in it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the room" }));
    expect(relativeSizingState().boards.map((b) => b.id)).toContain("example-sizing");
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    fireEvent.click(screen.getByRole("button", { name: "End it and clear" }));
    expect(relativeSizingState().boards.map((b) => b.id)).toEqual(["sizing_b"]);
    expect(shown()).toBe("Refunds");
  });

  it("a room on a team board doesn't hold Clear example back", async () => {
    useRelativeSizing.setState({
      ...RELATIVE_SIZING_INITIAL,
      boards: [board("sizing_a", "Checkout"), board("example-sizing", "Example board")],
      activeBoardId: "sizing_a",
    } as RelativeSizingState);
    renderPage();
    await screen.findByRole("heading", { name: "Checkout" });
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear example/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(relativeSizingState().boards.map((b) => b.id)).toEqual(["sizing_a"]);
    expect(screen.getByText("The room is live")).toBeInTheDocument();
    expect(mounts).toEqual(["sizing_a"]);
  });
});
