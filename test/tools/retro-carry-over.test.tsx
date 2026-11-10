import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { retroFormats } from "@/lib/constants/retro-formats";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { RetroBoard, RetroCard } from "@/lib/stores/workspace-types";

/**
 * Retro hand-offs: a new retro follows the newest archive; in the Write
 * phase the last retro's actions can be carried over (once, with Undo) or
 * sent to another tool; in the Actions phase an action can be sent to the
 * Impediments tool or the Kanban backlog, and then links to it.
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
vi.mock("@/lib/sonification/emit", () => ({ emit: () => {} }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {}, toolRunId: "test-run" }),
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

const startStop = retroFormats[0]; // Start / Stop / Continue
const madSadGlad = retroFormats.find((f) => f.id === "mad-sad-glad") ?? retroFormats[3];
const ARCHIVE_ID = "retro:2026-10-05T10:00:00.000Z";

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

function board(id: string, overrides: Partial<RetroBoard> = {}): RetroBoard {
  return {
    id,
    format: startStop,
    phase: "write",
    cards: [],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...overrides,
  };
}

const archive = () =>
  board(ARCHIVE_ID, {
    phase: "actions",
    archivedAt: "2026-10-05T10:00:00.000Z",
    cards: [
      card("a1", "start", { text: "Pair on flaky tests", isActionItem: true, assignee: "Sam" }),
      card("a2", "stop", { text: "Stop merging after the freeze", isActionItem: true }),
      card("n1", "continue", { text: "Demo on Fridays" }),
    ],
  });

const ws = () => useWorkspaceStore.getState();
const current = () => ws().retroBoards?.find((b) => b.id === "retro:current");
const archived = () => ws().retroBoards?.find((b) => b.id === ARCHIVE_ID);
const kanbanCards = () => ws().kanbanBoards?.find((b) => b.id === "kanban:current")?.cards ?? [];

function openSendTo(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name }), { key: "Enter" });
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({
    retroBoards: [],
    kanbanBoards: [],
    impediments: [],
    teamMembers: [],
  });
});

describe("starting a retro", () => {
  it("follows the newest archived retro", () => {
    const older = board("retro:2026-09-01T10:00:00.000Z", {
      archivedAt: "2026-09-01T10:00:00.000Z",
      cards: [card("o1", "start", { isActionItem: true })],
    });
    useWorkspaceStore.setState({ retroBoards: [older, archive()] });
    render(<RetroClient />);
    fireEvent.click(screen.getByText(startStop.name));
    expect(current()?.previousRetroId).toBe(ARCHIVE_ID);
  });

  it("follows nothing when there is no archive", () => {
    render(<RetroClient />);
    fireEvent.click(screen.getByText(startStop.name));
    expect(current()).toBeDefined();
    expect(current()?.previousRetroId).toBeUndefined();
    expect(screen.queryByRole("region", { name: "Actions from the last retro" })).toBeNull();
  });
});

describe("the last retro's actions", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      retroBoards: [archive(), board("retro:current", { previousRetroId: ARCHIVE_ID })],
    });
  });

  const panel = () => screen.getByRole("region", { name: "Actions from the last retro" });

  it("lists only the action items, in the Write phase", () => {
    render(<RetroClient />);
    expect(within(panel()).getByText("Pair on flaky tests")).toBeInTheDocument();
    expect(within(panel()).getByText("Stop merging after the freeze")).toBeInTheDocument();
    expect(within(panel()).queryByText("Demo on Fridays")).toBeNull();
  });

  it("is hidden after the Write phase", () => {
    useWorkspaceStore.setState({
      retroBoards: [
        archive(),
        board("retro:current", { previousRetroId: ARCHIVE_ID, phase: "vote" }),
      ],
    });
    render(<RetroClient />);
    expect(screen.queryByRole("region", { name: "Actions from the last retro" })).toBeNull();
  });

  it("carries an action over as an action item, once, and Undo takes it back", () => {
    render(<RetroClient />);
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Carry over Pair on flaky tests" })
    );

    const carried = current()!.cards;
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({
      text: "Pair on flaky tests",
      columnKey: "start",
      isActionItem: true,
      assignee: "Sam",
      carriedFrom: "a1",
      votes: 0,
    });
    expect(carried[0].id).not.toBe("a1");
    expect(undo.last!.label).toBe("Carried over “Pair on flaky tests”");
    // The row now says so, and offers no second carry-over.
    expect(within(panel()).getByText("Carried over")).toBeInTheDocument();
    expect(
      within(panel()).queryByRole("button", { name: "Carry over Pair on flaky tests" })
    ).toBeNull();
    // The card is on the board.
    expect(screen.getAllByText("Pair on flaky tests")).toHaveLength(2);

    act(() => undo.last!.revert());
    expect(current()!.cards).toEqual([]);
    expect(
      within(panel()).getByRole("button", { name: "Carry over Pair on flaky tests" })
    ).toBeInTheDocument();
  });

  it("puts an action whose column this format lacks in the first column", () => {
    useWorkspaceStore.setState({
      retroBoards: [
        archive(),
        board("retro:current", { previousRetroId: ARCHIVE_ID, format: madSadGlad }),
      ],
    });
    render(<RetroClient />);
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Carry over Stop merging after the freeze" })
    );
    expect(current()!.cards[0].columnKey).toBe(madSadGlad.columns[0].key);
  });

  it("sends an action to Kanban and records it on the archived card", () => {
    render(<RetroClient />);
    openSendTo(/^Send to… Pair on flaky tests/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Kanban card" }));

    const [kanban] = kanbanCards();
    expect(kanban).toMatchObject({
      title: "Pair on flaky tests",
      column: "backlog",
      sourceRef: { tool: "retro", id: "a1", doc: ARCHIVE_ID },
    });
    const a1 = archived()!.cards.find((c) => c.id === "a1")!;
    expect(a1.sentTo).toEqual([{ route: "kanban", targetId: kanban.id, at: expect.any(String) }]);

    // Reopened, the menu links to the card instead of sending again.
    openSendTo(/^Send to… Pair on flaky tests \(sent\)/);
    const sent = screen.getByRole("menuitem", { name: /Kanban card.*Sent · Open/ });
    expect(sent).toHaveAttribute("href", "/kanban?board=flow");
  });

  it("keeps where a carried action was sent, so it isn't sent twice", () => {
    useWorkspaceStore.setState({
      retroBoards: [
        board(ARCHIVE_ID, {
          ...archive(),
          cards: [
            card("a1", "start", {
              text: "Pair on flaky tests",
              isActionItem: true,
              sentTo: [{ route: "kanban", targetId: "k1", at: "2026-10-05T10:00:00.000Z" }],
            }),
          ],
        }),
        board("retro:current", { previousRetroId: ARCHIVE_ID }),
      ],
    });
    render(<RetroClient />);
    fireEvent.click(
      within(panel()).getByRole("button", { name: "Carry over Pair on flaky tests" })
    );
    expect(current()!.cards[0].sentTo).toEqual([
      { route: "kanban", targetId: "k1", at: "2026-10-05T10:00:00.000Z" },
    ]);
  });
});

describe("sending an action in the Actions phase", () => {
  it("raises it as an impediment, links to it, and Undo removes both", () => {
    useWorkspaceStore.setState({
      retroBoards: [
        board("retro:current", {
          phase: "actions",
          cards: [
            card("c1", "stop", { text: "Flaky deploys", isActionItem: true, assignee: "Bo" }),
            card("c2", "start", { text: "Not an action" }),
          ],
        }),
      ],
    });
    render(<RetroClient />);
    // Only action items offer it.
    expect(screen.getAllByRole("button", { name: /^Send to…/ })).toHaveLength(1);

    openSendTo(/^Send to… Flaky deploys/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Impediment" }));

    const [local] = ws().impediments;
    expect(local).toMatchObject({
      title: "Flaky deploys",
      owner: "Bo",
      source: "retro",
      sourceRef: { tool: "retro", id: "c1", doc: "retro:current" },
    });
    expect(ws().impediments.map((i) => i.id)).toEqual([local.id]);
    const c1 = () => current()!.cards.find((c) => c.id === "c1")!;
    expect(c1().sentTo).toEqual([
      { route: "impediment", targetId: local.id, at: expect.any(String) },
    ]);

    openSendTo(/^Send to… Flaky deploys \(sent\)/);
    expect(screen.getByRole("menuitem", { name: /Impediment.*Sent · Open/ })).toHaveAttribute(
      "href",
      "/impediments"
    );
    // Kanban is still on offer.
    expect(screen.getByRole("menuitem", { name: "Kanban card" })).toBeInTheDocument();

    act(() => undo.last!.revert());
    expect(ws().impediments).toEqual([]);
    expect(c1().sentTo).toEqual([]);
  });

  it("adds it to the backlog as a story that links back, and Undo removes both", () => {
    useWorkspaceStore.setState({
      stories: [],
      retroBoards: [
        board("retro:current", {
          phase: "actions",
          cards: [
            card("c1", "stop", { text: "Flaky deploys", isActionItem: true, assignee: "Bo" }),
          ],
        }),
      ],
    });
    render(<RetroClient />);
    openSendTo(/^Send to… Flaky deploys/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));

    const [story] = ws().stories;
    expect(story).toMatchObject({
      title: "Flaky deploys",
      status: "backlog",
      owner: "Bo",
      sourceRef: { tool: "retro", id: "c1", doc: "retro:current" },
    });
    expect(story.sprintId).toBeUndefined();
    const c1 = () => current()!.cards.find((c) => c.id === "c1")!;
    expect(c1().sentTo).toEqual([
      { route: "backlog-story", targetId: story.id, at: expect.any(String) },
    ]);
    expect(undo.last!.label).toBe("Added to the backlog");

    openSendTo(/^Send to… Flaky deploys \(sent\)/);
    expect(screen.getByRole("menuitem", { name: /Backlog story.*Sent · Open/ })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );

    act(() => undo.last!.revert());
    expect(ws().stories).toEqual([]);
    expect(c1().sentTo).toEqual([]);
  });

  it("offers the last retro's actions the same story route", () => {
    useWorkspaceStore.setState({
      stories: [],
      retroBoards: [archive(), board("retro:current", { previousRetroId: ARCHIVE_ID })],
    });
    render(<RetroClient />);
    openSendTo(/^Send to… Pair on flaky tests/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Backlog story" }));
    const [story] = ws().stories;
    expect(story.sourceRef).toEqual({ tool: "retro", id: "a1", doc: ARCHIVE_ID });
    expect(archived()!.cards.find((c) => c.id === "a1")!.sentTo).toEqual([
      { route: "backlog-story", targetId: story.id, at: expect.any(String) },
    ]);
  });
});
