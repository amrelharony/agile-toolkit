import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import type { HistoryLogger } from "@/lib/history/use-history-logger";
import { retroFormats } from "@/lib/constants/retro-formats";
import type { BoardState, RetroCard } from "@/app/(tools)/retro/types";
import type { RoomTimerView } from "@/app/(tools)/retro/room/use-retro-room";
import type { WallRoundScreen } from "@/lib/realtime/wall-room/use-wall-room";

/**
 * Retro's timers, by behaviour: the Board rings the shared alarm once as
 * its timebox crosses zero and counts the overtime; a participant's view
 * of the room timer rings at zero and keeps counting through the host's
 * next snapshot; a promoted host's widget gets the same; and the big
 * screen draws a Retro round (and a wall round) without leaking hidden
 * text.
 */

const alarm = vi.hoisted(() => ({ timesUp: vi.fn() }));
vi.mock("@/lib/celebrate/chime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate/chime")>()),
  timesUp: alarm.timesUp,
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
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

import { Board } from "@/app/(tools)/retro/components/board";
import { RoomTimerReadout, useRoomTimerAlarm } from "@/app/(tools)/retro/room/room-controls";
import { RetroBigScreenRound, useBoardTimer } from "@/app/(tools)/retro/room/big-screen";
import { WallBigScreenRound } from "@/components/collab/wall-room/host-wall-room";
import { useAlarmPrefs } from "@/lib/celebrate/alarm-prefs";

const T0 = Date.parse("2026-11-12T09:00:00Z");
const logger: HistoryLogger = { log: () => {}, toolRunId: "test-run" };
const format = retroFormats[0]; // Start / Stop / Continue

beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  alarm.timesUp.mockClear();
  useAlarmPrefs.setState({ sound: false });
});
afterEach(() => vi.useRealTimers());

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function card(id: string, columnKey: string, o: Partial<RetroCard> = {}): RetroCard {
  return {
    id,
    columnKey,
    text: `Card ${id}`,
    votes: 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
    ...o,
  };
}

function makeBoard(o: Partial<BoardState> = {}): BoardState {
  return {
    format,
    phase: "write",
    cards: [],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...o,
  };
}

describe("the Retro board's timebox", () => {
  function Harness({ initial }: { initial: BoardState }) {
    const [state, setState] = useState(initial);
    return (
      <LiveAnnouncerProvider>
        <Board
          state={state}
          onUpdate={(updater) => setState((prev) => updater(prev))}
          onReset={() => {}}
          logger={logger}
        />
      </LiveAnnouncerProvider>
    );
  }

  it("rings once as it crosses zero, says so, and counts the overtime up", () => {
    render(<Harness initial={makeBoard({ timerSeconds: 2, timerRunning: true })} />);
    advance(1000);
    expect(alarm.timesUp).not.toHaveBeenCalled();
    advance(1000);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Time's up")).toBeInTheDocument();
    advance(100);
    expect(screen.getByTestId("live-assertive")).toHaveTextContent("Time's up.");
    advance(7000);
    expect(screen.getByText("+0:07 over")).toBeInTheDocument();
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
  });

  it("doesn't ring for a board that was already at zero, and a new timebox clears the overtime", () => {
    render(<Harness initial={makeBoard({ timerSeconds: 1, timerRunning: true })} />);
    advance(1000);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    const box = screen.getByRole("group", { name: "Timebox" });
    fireEvent.click(within(box).getAllByRole("button")[0]);
    expect(screen.queryByText(/over$/)).toBeNull();
    expect(screen.queryByText("Time's up")).toBeNull();
  });
});

describe("a Retro participant's view of the room timer", () => {
  const view = (o: Partial<RoomTimerView>): RoomTimerView => ({
    running: true,
    remaining: 3,
    anchoredAt: Date.now(),
    ...o,
  });

  function Readout({ timer }: { timer: RoomTimerView | null }) {
    return (
      <LiveAnnouncerProvider>
        <RoomTimerReadout timer={timer} />
      </LiveAnnouncerProvider>
    );
  }

  it("rings once at zero, and keeps counting the overtime through the host's next snapshot", () => {
    const { rerender } = render(<Readout timer={view({})} />);
    expect(screen.getByRole("timer")).toHaveTextContent("0:03");
    advance(3100);
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
    // The host's tab stopped at zero and says so.
    rerender(<Readout timer={view({ running: false, remaining: 0, anchoredAt: Date.now() })} />);
    advance(10_000);
    expect(screen.getByText("+0:10 over")).toBeInTheDocument();
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
  });

  it("shows time's up without a count for a timer first seen at zero, and doesn't ring", () => {
    render(<Readout timer={view({ running: false, remaining: 0 })} />);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
    advance(5000);
    expect(screen.queryByText(/over$/)).toBeNull();
    expect(alarm.timesUp).not.toHaveBeenCalled();
  });

  it("says politely when the host starts a timebox, as a start rather than a resume", () => {
    const { rerender } = render(<Readout timer={view({ running: false, remaining: 300 })} />);
    rerender(<Readout timer={view({ running: true, remaining: 300, anchoredAt: Date.now() })} />);
    advance(100);
    expect(screen.getByTestId("live-polite")).toHaveTextContent(
      "The host started the timer: 5 minutes left."
    );
  });

  it("says politely when the host pauses the timer", () => {
    const { rerender } = render(<Readout timer={view({ remaining: 120 })} />);
    advance(30_000);
    rerender(<Readout timer={view({ running: false, remaining: 90, anchoredAt: Date.now() })} />);
    advance(100);
    expect(screen.getByTestId("live-polite")).toHaveTextContent(
      "The host paused the timer: 1 minute 30 seconds left."
    );
  });
});

describe("a promoted host's Retro timer", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>
  );

  it("rings once as its countdown crosses zero and says when, for the overtime", () => {
    const timer: RoomTimerView = { running: true, remaining: 1, anchoredAt: T0 };
    const { result, rerender } = renderHook(
      ({ countdown }: { countdown: number }) => useRoomTimerAlarm(timer, countdown),
      { wrapper, initialProps: { countdown: 1 } }
    );
    expect(result.current).toBeNull();
    advance(1000);
    rerender({ countdown: 0 });
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(T0 + 1000);
    rerender({ countdown: 0 });
    expect(alarm.timesUp).toHaveBeenCalledTimes(1);
    // A new timebox clears it.
    rerender({ countdown: 300 });
    expect(result.current).toBeNull();
  });

  it("doesn't ring for a timer already at zero when this person took over", () => {
    const timer: RoomTimerView = { running: false, remaining: 0, anchoredAt: T0 };
    const { result } = renderHook(() => useRoomTimerAlarm(timer, 0), { wrapper });
    expect(result.current).toBeNull();
    expect(alarm.timesUp).not.toHaveBeenCalled();
  });
});

describe("the Retro big screen", () => {
  it("in Write, shows how many cards each column holds and no card text", () => {
    const board = makeBoard({
      cards: [
        card("a", "start", { text: "Pair more" }),
        card("b", "start", { text: "Secret one" }),
        card("c", "stop", { text: "Long standups" }),
        card("d", "start", { text: "Merged in", groupedWith: "a" }),
      ],
    });
    render(<RetroBigScreenRound board={board} hidesCard={(id) => id === "b"} />);
    expect(screen.getByRole("heading", { name: "Write phase" })).toBeInTheDocument();
    const counts = within(screen.getByRole("list", { name: "Cards per column" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(counts).toEqual(["Start2", "Stop1", "Continue0"]);
    expect(screen.queryByText(/Pair more|Secret one|Long standups/)).toBeNull();
  });

  it("from Discuss on, lists the top cards by votes, leaving out hidden and grouped ones", () => {
    const board = makeBoard({
      phase: "discuss",
      cards: [
        card("a", "start", { text: "Pair more", votes: 2 }),
        card("b", "stop", { text: "Secret one", votes: 9 }),
        card("c", "stop", { text: "Long standups", votes: 5 }),
        card("d", "start", { text: "Merged in", votes: 7, groupedWith: "a" }),
      ],
    });
    render(<RetroBigScreenRound board={board} hidesCard={(id) => id === "b"} />);
    const top = within(screen.getByRole("list", { name: "Top cards" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(top).toEqual(["Long standups5 votes", "Pair more2 votes"]);
  });

  it("shows the board's own timer while it runs and once it ran out, not while it sits paused", () => {
    const { result, rerender } = renderHook(
      ({ s, running }: { s: number; running: boolean }) =>
        useBoardTimer({ timerSeconds: s, timerRunning: running }),
      { initialProps: { s: 300, running: false } }
    );
    expect(result.current).toBeNull();
    rerender({ s: 2, running: true });
    expect(result.current).toMatchObject({ endsAt: T0 + 2000, pausedSeconds: 2 });
    advance(2000);
    rerender({ s: 0, running: false });
    expect(result.current).toMatchObject({ endsAt: T0 + 2000, pausedSeconds: 0 });
    rerender({ s: 300, running: false });
    expect(result.current).toBeNull();
    // First seen at zero: no end time to count from.
    const late = renderHook(() => useBoardTimer({ timerSeconds: 0, timerRunning: false }));
    expect(late.result.current).toBeNull();
  });
});

describe("a wall round on the big screen", () => {
  const round = (o: Partial<WallRoundScreen>): WallRoundScreen => ({
    id: "round_000001",
    prompt: "What slowed us down?",
    open: true,
    mode: "hidden",
    revealed: false,
    count: 3,
    posts: null,
    ...o,
  });

  it("shows only the count while posts are hidden until reveal", () => {
    render(<WallBigScreenRound round={round({})} />);
    expect(screen.getByRole("heading", { name: "What slowed us down?" })).toBeInTheDocument();
    expect(screen.getByText("3 posts so far, hidden until the host reveals them.")).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows the visible posts, never the ones the host hid", () => {
    render(
      <WallBigScreenRound
        round={round({
          mode: "live",
          revealed: true,
          posts: [
            { id: "p1", text: "Flaky CI", votes: 2, merged: [] },
            { id: "p2", text: "Off-topic rant", votes: 0, merged: [], hidden: true },
          ],
        })}
      />
    );
    expect(screen.getByText("Flaky CI")).toBeInTheDocument();
    expect(screen.queryByText("Off-topic rant")).toBeNull();
  });

  it("says the wall is opening before the first round", () => {
    render(<WallBigScreenRound round={null} />);
    expect(screen.getByText("The wall opens in a moment.")).toBeInTheDocument();
  });
});
